'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simular, servir, eventos, consultas } = require('./soporte');
const { prepararPrecios, salidaPrecios } = require('../utils/precios-ciclo');
const { obtenerPrecioInscripcion } = require('../utils/pagos');

test('Precios: NULL no es cero ni mensualidad heredada; catálogo coincide con checkout de Morgan', () => {
  for (const [inscripcion, legado, esperado] of [[null, '200.00', 200], ['250.00', '200.00', 250],
    ['0.00', '200.00', 0], [null, null, null]]) {
    const ciclo = { PrecioInscripcion: inscripcion, Precio: legado, PrecioMensual: null };
    const salida = salidaPrecios(ciclo);
    assert.equal(salida.precio, esperado);
    assert.equal(salida.precio, obtenerPrecioInscripcion(ciclo));
    assert.equal(salida.precioMensual, null);
    assert.equal(salida.precioHistorico, legado === null ? null : Number(legado));
  }
  assert.equal(prepararPrecios({}).precioInscripcion, null);
  assert.equal(prepararPrecios({}).precioMensual, null);
});

test('Precios: alias contradictorios e importes ambiguos se rechazan', () => {
  for (const campo of ['precio', 'precioInscripcion', 'precioMensual']) {
    for (const valor of ['', ' ', true, [], {}, -1, '1e2', '1.234', 10000]) {
      assert.ok(prepararPrecios({ [campo]: valor }).preciosError, `${campo}: ${JSON.stringify(valor)}`);
    }
  }
  assert.ok(prepararPrecios({ precio: 200, precioInscripcion: 250 }).preciosError);
  assert.ok(prepararPrecios({ precioMensual: 350, PrecioMensual: 400 }).preciosError);
  assert.equal(prepararPrecios({ PrecioInscripcion: '0.00', precioInscripcion: 0 }).preciosError, null);
});

test('Precios: alta persiste conceptos separados; omisión no activa tarifa gratuita', async t => {
  const pedir = await servir(t, [['/api/admin/ciclos', 'admin-ciclos.routes']]);
  const base = { nombre: 'Ciclo Semestral UNI', universidadObjetivo: 'UNI', publicar: false };
  for (const [body, precios] of [[{}, [null, null, null]], [{ precio: 200 }, [200, 200, null]],
    [{ precioInscripcion: 200, precioMensual: 350 }, [null, 200, 350]],
    [{ PrecioInscripcion: 0, PrecioMensual: null }, [null, 0, null]]]) {
    simular((sql, params) => {
      if (/INSERT INTO Ciclo /.test(sql)) {
        assert.match(sql, /Precio, PrecioInscripcion, PrecioMensual/);
        assert.deepEqual(params.slice(8, 11), precios);
        return [{ insertId: 7 }];
      }
      assert.doesNotMatch(sql, /PagosMensualidad/);
      return [[]];
    });
    assert.equal((await pedir('POST', '/api/admin/ciclos', { ...base, ...body })).status, 201);
    assert.deepEqual(eventos, ['begin', 'commit', 'release']);
  }
});

test('Precios: edición preserva Precio, capacidad histórica y cuotas; alias antiguo edita inscripción', async t => {
  const pedir = await servir(t, [['/api/admin/ciclos', 'admin-ciclos.routes']]);
  const ciclo = { IdCiclo: 7, Nombre: 'Ciclo Semestral UNI', UniversidadObjetivo: 'UNI',
    Precio: '180.00', PrecioInscripcion: '200.00', PrecioMensual: '350.00', Capacidad: 250, TotalAlumnos: 130 };
  for (const [body, precios] of [[{}, ['180.00', '200.00', '350.00']],
    [{ precio: 220 }, ['180.00', 220, '350.00']],
    [{ precioInscripcion: null, precioMensual: null }, ['180.00', null, null]],
    [{ precioInscripcion: 0, precioMensual: 400 }, ['180.00', 0, 400]]]) {
    let actualizado = false;
    simular((sql, params) => {
      assert.doesNotMatch(sql, /PagosMensualidad/);
      if (/FROM Ciclo c/.test(sql)) return [[ciclo]];
      if (/UPDATE Ciclo SET/.test(sql)) {
        actualizado = true;
        assert.deepEqual(params.slice(6, 9), precios);
        assert.equal(params[11], 250);
        assert.deepEqual(params.slice(-2), [7, 1]);
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });
    assert.equal((await pedir('PUT', '/api/admin/ciclos/7', body)).status, 200);
    assert.equal(actualizado, true);
    assert.ok(consultas.some(({ q }) => /FROM Ciclo WHERE.*FOR UPDATE/.test(q)));
    assert.deepEqual(eventos, ['begin', 'commit', 'release']);
  }
});

test('Precios: catálogo y administración exponen tarifa efectiva, conceptos y precio histórico', async t => {
  const anterior = process.env.PUBLIC_REGISTRATION_ACADEMY_ID;
  process.env.PUBLIC_REGISTRATION_ACADEMY_ID = '1';
  t.after(() => { if (anterior === undefined) delete process.env.PUBLIC_REGISTRATION_ACADEMY_ID; else process.env.PUBLIC_REGISTRATION_ACADEMY_ID = anterior; });
  const pedir = await servir(t, [['/api/ciclos', 'ciclos.routes'], ['/api/admin/ciclos', 'admin-ciclos.routes']]);
  simular(sql => {
    assert.match(sql, /c.PrecioInscripcion/);
    assert.match(sql, /c.PrecioMensual/);
    return [[{ IdCiclo: 7, Precio: '180.00', PrecioInscripcion: '220.00', PrecioMensual: null,
      Capacidad: 100, TotalAlumnos: 10 }]];
  });
  const admin = await pedir('GET', '/api/admin/ciclos');
  assert.equal(admin.status, 200);
  assert.equal(admin.body[0].Precio, 220);
  assert.equal(admin.body[0].PrecioHistorico, 180);
  assert.equal(admin.body[0].PrecioMensual, null);
  const catalogo = await pedir('GET', '/api/ciclos/publicos');
  assert.equal(catalogo.status, 200);
  assert.equal(catalogo.body[0].precio, 220);
  assert.equal(catalogo.body[0].precioInscripcionEfectivo, 220);
  assert.equal(catalogo.body[0].origenPrecioInscripcion, 'PrecioInscripcion');
});

test('Precios: mensualidad NULL devuelve 409 en ruta intacta de Morgan aunque exista Precio', async t => {
  const pedir = await servir(t, [['/api', 'pagos.routes']]);
  simular(() => [[{ IdCiclo: 7, Precio: 200, PrecioInscripcion: 200, PrecioMensual: null }]]);
  const r = await pedir('POST', '/api/pagos/ciclo/7/mensualidades', { periodo: '2026-11', fechaVencimiento: '2026-11-10' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'PRECIO_MENSUAL_NO_CONFIGURADO');
  assert.equal(consultas.length, 1);
  assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
});
