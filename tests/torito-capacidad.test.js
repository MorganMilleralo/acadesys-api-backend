'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simular, servir, eventos, consultas } = require('./soporte');
const base = { nombre: 'Ciclo Semestral UNI', universidadObjetivo: 'UNI', precio: 200, publicar: false };

test('AC-05 creación usa 100 solo al omitir capacidad; acepta 1 y 120 y rechaza coerciones', async t => {
  const pedir = await servir(t, [['/api/admin/ciclos', 'admin-ciclos.routes']]);
  for (const capacidad of [undefined, 1, 100, 120, '120']) {
    let persistida;
    simular((sql, params) => {
      if (/INSERT INTO Ciclo /.test(sql)) { persistida = params.at(-1); return [{ insertId: 7 }]; }
      return [[]];
    });
    assert.equal((await pedir('POST', '/api/admin/ciclos', { ...base, capacidad })).status, 201);
    assert.equal(persistida, capacidad === undefined ? 100 : Number(capacidad));
    assert.deepEqual(eventos, ['begin', 'commit', 'release']);
  }
  for (const capacidad of [null, 0, -1, 1.5, 121, 500, '', true, [100], {}, '1e2']) {
    simular();
    assert.equal((await pedir('POST', '/api/admin/ciclos', { ...base, capacidad })).status, 400);
    assert.equal(consultas.length, 0);
  }
});

test('AC-05 edición no reduce por debajo de inscritos ni corrige históricos automáticamente', async t => {
  const pedir = await servir(t, [['/api/admin/ciclos', 'admin-ciclos.routes']]);
  for (const capacidad of [50, 120]) {
    simular(sql => /FROM Ciclo c/.test(sql) ? [[{
      IdCiclo: 7, Nombre: base.nombre, UniversidadObjetivo: 'UNI', Precio: 200,
      Capacidad: 250, TotalAlumnos: 130,
    }]] : [[]]);
    assert.equal((await pedir('PUT', '/api/admin/ciclos/7', { capacidad })).status, 409);
    assert.ok(!consultas.some(({ q }) => /^(UPDATE|INSERT|DELETE)/.test(q)));
    assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
  }
});

test('AC-05 catálogo conserva disponibilidad histórica sin actualizar capacidad', async t => {
  const anterior = process.env.PUBLIC_REGISTRATION_ACADEMY_ID;
  process.env.PUBLIC_REGISTRATION_ACADEMY_ID = '1';
  t.after(() => { if (anterior === undefined) delete process.env.PUBLIC_REGISTRATION_ACADEMY_ID; else process.env.PUBLIC_REGISTRATION_ACADEMY_ID = anterior; });
  const pedir = await servir(t, [['/api/ciclos', 'ciclos.routes']]);
  for (const capacidad of [null, 0, 250]) {
    simular(() => [[{ IdCiclo: 1, Capacidad: capacidad, TotalAlumnos: 6 }]]);
    const r = await pedir('GET', '/api/ciclos/publicos');
    assert.equal(r.status, 200);
    const salida = r.body[0];
    assert.equal(salida.capacidad, capacidad ?? 0);
    assert.equal(salida.disponible, true);
    assert.equal(salida.vacantesDisponibles, capacidad === 250 ? 244 : null);
    assert.equal(salida.requiereRevisionCapacidad, true);
  }
  simular(() => [[{ Capacidad: 100, TotalAlumnos: 6 }]]);
  assert.equal((await pedir('GET', '/api/ciclos/publicos')).body[0].vacantesDisponibles, 94);
});

test('AC-05 reapertura conserva históricos y rechaza aforo lleno sin cambiar capacidades', async t => {
  const pedir = await servir(t, [['/api/admin/ciclos', 'admin-ciclos.routes']]);
  for (const capacidad of [null, 0, 250]) {
    simular(() => [[{ IdCiclo: 7, Capacidad: capacidad, TotalAlumnos: 1 }]]);
    assert.equal((await pedir('PATCH', '/api/admin/ciclos/7/estado', { estado: 'abrir' })).status, 200);
    assert.ok(consultas.some(({ q }) => /UPDATE Ciclo SET EstadoRegistro/.test(q)));
    assert.ok(!consultas.some(({ q }) => /SET Capacidad/.test(q)));
  }
  simular(() => [[{ IdCiclo: 7, Capacidad: 250, TotalAlumnos: 250 }]]);
  assert.equal((await pedir('PATCH', '/api/admin/ciclos/7/estado', { estado: 'abrir' })).status, 409);
  assert.ok(!consultas.some(({ q }) => /^UPDATE/.test(q)));
});

test('AC-05 editar histórico reenviando su mismo aforo lo conserva; no permite otro aforo fuera de rango', async t => {
  const pedir = await servir(t, [['/api/admin/ciclos', 'admin-ciclos.routes']]);
  for (const capacidad of [0, null, 250]) {
    simular((sql, params) => {
      if (/FROM Ciclo c/.test(sql)) return [[{ IdCiclo: 7, Nombre: base.nombre,
        UniversidadObjetivo: 'UNI', Precio: 200, Capacidad: capacidad, TotalAlumnos: 130 }]];
      if (/UPDATE Ciclo SET/.test(sql)) assert.equal(params[11], capacidad);
      return [[]];
    });
    assert.equal((await pedir('PUT', '/api/admin/ciclos/7', { capacidad })).status, 200);
    assert.deepEqual(eventos, ['begin', 'commit', 'release']);
    assert.equal((await pedir('PUT', '/api/admin/ciclos/7', { capacidad: 300 })).status, 400);
  }
});
