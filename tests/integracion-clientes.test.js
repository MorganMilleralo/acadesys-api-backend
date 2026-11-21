'use strict';

// API de integración de clientes: seguridad, validación, idempotencia y errores.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { simular, servir } = require('./soporte');
const integracion = require('../services/integracion-clientes.service');
const rutas = require('../routes/integracion.routes');

const { clave, hash } = integracion.generarClave();
const CONSUMIDOR = { IdConsumidor: 4, IdAcademia: 1, Nombre: 'Equipo Morán', Prefijo: clave.slice(0, 10), LimitePorMinuto: 60 };
const VERSION = 'a'.repeat(64);

function alumno(id, extra = {}) {
  return {
    IdUsuario: id, CodigoUsuario: `ACAD-${id}`, DNI: '74125896', Nombres: 'Alexandra', ApellidoPaterno: 'Inocente',
    ApellidoMaterno: null, CorreoElectronico: ' Alex@Correo.PE ', Celular: '987654321', Ciclos: 'Veranito||Semestral',
    FechaCreacion: new Date('2026-11-01T10:00:00Z'), Version: VERSION, VersionConfirmada: null, FechaConfirmacion: null, ...extra,
  };
}

// Base simulada: autenticación por hash, lista de alumnos y bitácora.
function base({ alumnos = [alumno(10), alumno(11)], limite = 60, fallaListado = false, confirmar } = {}) {
  const llamadas = [];
  simular((sql, params) => {
    llamadas.push({ sql, params });
    if (/CALL sp_integracion_autenticar/.test(sql)) {
      return [params[0] === hash ? [{ ...CONSUMIDOR, LimitePorMinuto: limite }] : []];
    }
    if (/INSERT INTO IntegracionAuditoria/.test(sql)) return [{ affectedRows: 1 }];
    if (/FROM Usuario u/.test(sql) && /IntegracionEntrega/.test(sql)) {
      if (fallaListado) throw Object.assign(new Error('conexión perdida'), { code: 'PROTOCOL_CONNECTION_LOST' });
      return [alumnos.slice(0, params[params.length - 1] ?? alumnos.length)];
    }
    if (/CALL sp_integracion_confirmar_cliente/.test(sql)) return [[confirmar ? confirmar(params) : { Resultado: 'NUEVO', VersionVigente: VERSION }]];
    throw new Error(`Consulta no prevista: ${sql}`);
  });
  return llamadas;
}

async function app(t) {
  const a = express();
  a.set('trust proxy', 1);
  a.use('/api/integracion/v1', rutas);
  const s = await new Promise((r) => { const x = a.listen(0, '127.0.0.1', () => r(x)); });
  t.after(() => new Promise((r) => { s.close(r); s.closeAllConnections(); }));
  return async (ruta, { metodo = 'GET', clave: k = clave, cuerpo, tipo = 'application/json', ip } = {}) => {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/integracion/v1${ruta}`, {
      method: metodo,
      headers: {
        ...(k ? { 'X-API-Key': k } : {}),
        ...(cuerpo !== undefined ? { 'Content-Type': tipo } : {}),
        ...(ip ? { 'X-Forwarded-For': ip } : {}),
      },
      body: cuerpo === undefined ? undefined : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
    });
    return { status: r.status, headers: r.headers, body: await r.json() };
  };
}

beforeEach(() => {
  rutas._limitadores.limitePorClave.reiniciar();
  rutas._limitadores.fallosPorIp.reiniciar();
});

test('la clave se genera con formato fijo y solo se guarda su SHA-256', () => {
  const g = integracion.generarClave();
  assert.match(g.clave, /^acs_[A-Za-z0-9_-]{43}$/);
  assert.equal(g.hash, integracion.hashClave(g.clave));
  assert.equal(g.hash.length, 64);
  assert.notEqual(integracion.generarClave().clave, g.clave);
});

test('sin clave o con clave mal formada responde 401 sin consultar la base de alumnos', async (t) => {
  const pedir = await app(t);
  const llamadas = base();
  let r = await pedir('/clientes', { clave: null });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.codigo, 'CLAVE_REQUERIDA');
  assert.ok(r.headers.get('x-request-id'));
  r = await pedir('/clientes', { clave: 'clave-falsa' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.codigo, 'CLAVE_INVALIDA');
  assert.ok(!llamadas.some((l) => /FROM Usuario u/.test(l.sql)));
});

test('lista solo datos públicos del cliente, normalizados y con paginación por cursor', async (t) => {
  const pedir = await app(t);
  base({ alumnos: [alumno(10), alumno(11), alumno(12)] });
  const r = await pedir('/clientes?limite=2');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.body.datos.length, 2);
  assert.deepEqual(r.body.paginacion, { limite: 2, cantidad: 2, hayMas: true, siguienteCursor: '11' });
  const c = r.body.datos[0];
  assert.equal(c.idCliente, 'ACAD-10');
  assert.equal(c.tipoDocumento, 'DNI');
  assert.equal(c.correo, 'alex@correo.pe');
  assert.deepEqual(c.ciclos, ['Veranito', 'Semestral']);
  assert.equal(c.nombreCompleto, 'Alexandra Inocente');
  for (const prohibido of ['Clave', 'clave', 'FotoUrl', 'IdUsuario', 'idAcademia']) assert.ok(!(prohibido in c), prohibido);
});

test('valida parámetros: límite, cursor, parámetros desconocidos e idCliente', async (t) => {
  const pedir = await app(t);
  base();
  for (const [ruta, codigo] of [
    ['/clientes?limite=0', 'LIMITE_INVALIDO'],
    ['/clientes?limite=101', 'LIMITE_INVALIDO'],
    ['/clientes?cursor=-1', 'CURSOR_INVALIDO'],
    ['/clientes?orden=desc', 'PARAMETRO_NO_PERMITIDO'],
    ["/clientes/1'%20OR%201=1", 'ID_CLIENTE_INVALIDO'],
  ]) {
    const r = await pedir(ruta);
    assert.equal(r.status, 400, ruta);
    assert.equal(r.body.error.codigo, codigo, ruta);
  }
});

test('pendientes pide solo los no confirmados y confirmaciones elimina duplicados del mismo envío', async (t) => {
  const pedir = await app(t);
  const llamadas = base();
  await pedir('/clientes/pendientes');
  const listado = llamadas.find((l) => /FROM Usuario u/.test(l.sql));
  assert.ok(listado.params.includes(1), 'debe pedir solo pendientes');

  const r = await pedir('/clientes/confirmaciones', {
    metodo: 'POST',
    cuerpo: { clientes: [{ idCliente: 'ACAD-10', version: VERSION }, { idCliente: 'ACAD-10', version: VERSION }, { idCliente: 'ACAD-11', version: VERSION }] },
  });
  assert.equal(r.status, 200);
  assert.equal(llamadas.filter((l) => /sp_integracion_confirmar_cliente/.test(l.sql)).length, 2);
  assert.deepEqual(r.body.resumen, { recibidos: 3, procesados: 2, NUEVO: 2 });
});

test('una confirmación repetida o desactualizada se informa sin error', async (t) => {
  const pedir = await app(t);
  base({ confirmar: (p) => (p.includes('ACAD-10') ? { Resultado: 'YA_CONFIRMADO' } : { Resultado: 'VERSION_DESACTUALIZADA', VersionVigente: 'b'.repeat(64) }) });
  const r = await pedir('/clientes/confirmaciones', {
    metodo: 'POST', cuerpo: { clientes: [{ idCliente: 'ACAD-10', version: VERSION }, { idCliente: 'ACAD-11', version: VERSION }] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.resultados[0].resultado, 'YA_CONFIRMADO');
  assert.equal(r.body.resultados[1].versionVigente, 'b'.repeat(64));
});

test('rechaza cuerpos inválidos, demasiado grandes o sin JSON', async (t) => {
  const pedir = await app(t);
  base();
  const casos = [
    [{ cuerpo: 'x', tipo: 'text/plain' }, 415, 'TIPO_NO_SOPORTADO'],
    [{ cuerpo: '{"clientes":[' }, 400, 'JSON_INVALIDO'],
    [{ cuerpo: { clientes: [] } }, 400, 'SIN_CLIENTES'],
    [{ cuerpo: { clientes: [{ idCliente: 'ACAD-10', version: 'corta' }] } }, 400, 'CLIENTES_INVALIDOS'],
    [{ cuerpo: { clientes: [{ idCliente: 'ACAD-10', version: VERSION }], admin: true } }, 400, 'CAMPO_NO_PERMITIDO'],
    [{ cuerpo: { clientes: Array.from({ length: 101 }, () => ({ idCliente: 'A', version: VERSION })) } }, 413, 'DEMASIADOS_CLIENTES'],
    [{ cuerpo: JSON.stringify({ clientes: 'x'.repeat(40000) }) }, 413, 'CUERPO_DEMASIADO_GRANDE'],
  ];
  for (const [opciones, status, codigo] of casos) {
    const r = await pedir('/clientes/confirmaciones', { metodo: 'POST', ...opciones });
    assert.equal(r.status, status, codigo);
    assert.equal(r.body.error.codigo, codigo);
  }
});

test('aplica el límite por minuto de cada aplicativo con Retry-After', async (t) => {
  const pedir = await app(t);
  base({ limite: 3 });
  for (let i = 0; i < 3; i += 1) assert.equal((await pedir('/clientes')).status, 200);
  const r = await pedir('/clientes');
  assert.equal(r.status, 429);
  assert.equal(r.body.error.codigo, 'LIMITE_EXCEDIDO');
  assert.ok(Number(r.headers.get('retry-after')) > 0);
});

test('bloquea una IP tras 10 claves inválidas', async (t) => {
  const pedir = await app(t);
  base();
  const falsa = integracion.generarClave().clave;
  for (let i = 0; i < 10; i += 1) assert.equal((await pedir('/clientes', { clave: falsa, ip: '203.0.113.9' })).status, 401);
  const r = await pedir('/clientes', { ip: '203.0.113.9' });
  assert.equal(r.status, 429);
  assert.equal(r.body.error.codigo, 'DEMASIADOS_INTENTOS');
  assert.equal((await pedir('/clientes', { ip: '203.0.113.10' })).status, 200, 'otra IP no se bloquea');
});

test('si la base de datos falla responde 503 sin detalles internos', async (t) => {
  const pedir = await app(t);
  base({ fallaListado: true });
  const r = await pedir('/clientes');
  assert.equal(r.status, 503);
  assert.equal(r.body.error.codigo, 'SERVICIO_NO_DISPONIBLE');
  assert.doesNotMatch(JSON.stringify(r.body), /PROTOCOL|conexión perdida|stack/);
});

test('registra cada solicitud en la bitácora, también las rechazadas', async (t) => {
  const pedir = await app(t);
  const llamadas = base();
  await pedir('/clientes', { clave: null });
  await pedir('/clientes');
  await new Promise((r) => setTimeout(r, 30));
  const auditorias = llamadas.filter((l) => /INSERT INTO IntegracionAuditoria/.test(l.sql));
  assert.equal(auditorias.length, 2);
  assert.ok(auditorias.some((a) => a.params.includes(401) && a.params.includes('CLAVE_REQUERIDA')));
  assert.ok(auditorias.some((a) => a.params.includes(200) && a.params.includes(4)));
});

test('el administrador crea una clave que se muestra una sola vez y solo se guarda su hash', async (t) => {
  const pedir = await servir(t, [['/api/admin/integraciones', 'admin-integraciones.routes']]);
  let guardado;
  simular((sql, params) => {
    assert.match(sql, /INSERT INTO IntegracionConsumidor/);
    guardado = params;
    return [{ affectedRows: 1, insertId: 7 }];
  });
  const r = await pedir('POST', '/api/admin/integraciones', { nombre: 'Equipo Morán', limitePorMinuto: 30 });
  assert.equal(r.status, 201);
  assert.match(r.body.clave, /^acs_/);
  assert.ok(guardado.includes(integracion.hashClave(r.body.clave)));
  assert.ok(!guardado.includes(r.body.clave), 'la clave en claro no se guarda');
  simular(() => [{ affectedRows: 1 }]);
  assert.equal((await pedir('POST', '/api/admin/integraciones', { nombre: 'x' })).status, 400);
});
