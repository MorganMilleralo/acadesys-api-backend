'use strict';

// Acceso a datos por procedimientos almacenados: la API solo envía CALL.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ruta = require.resolve('../config/procedimientos');
delete require.cache[ruta];
const real = require('../config/procedimientos');

function ejecutorFalso(respuesta) {
  const llamadas = [];
  return { llamadas, async query(sql, params) { llamadas.push({ sql, params }); return [respuesta]; } };
}

test('consultar envía CALL con un marcador por parámetro y devuelve el primer conjunto de filas', async () => {
  const db = ejecutorFalso([[{ IdCiclo: 1 }, { IdCiclo: 2 }], { affectedRows: 0 }]);
  const [filas] = await real.consultar(db, 'sp_ciclos_listar_publicos', [4]);
  assert.deepEqual(db.llamadas, [{ sql: 'CALL sp_ciclos_listar_publicos(?)', params: [4] }]);
  assert.deepEqual(filas, [{ IdCiclo: 1 }, { IdCiclo: 2 }]);
});

test('ejecutar devuelve affectedRows e insertId del procedimiento de escritura', async () => {
  const db = ejecutorFalso([[{ affectedRows: 1, insertId: 41 }], { affectedRows: 0 }]);
  const [r] = await real.ejecutar(db, 'sp_materiales_registrar_material', [1, 2, 't', 'd', 'a.pdf', 9]);
  assert.equal(db.llamadas[0].sql, 'CALL sp_materiales_registrar_material(?, ?, ?, ?, ?, ?)');
  assert.deepEqual(r, { affectedRows: 1, insertId: 41 });
});

test('rechaza nombres que no sean de procedimientos y parámetros que no sean arreglo', async () => {
  const db = ejecutorFalso([[]]);
  await assert.rejects(real.consultar(db, 'DROP TABLE Usuario', []), /no válido/);
  await assert.rejects(real.consultar(db, 'sp_x; DELETE', []), /no válido/);
  await assert.rejects(real.consultar(db, 'sp_ciclos_listar_publicos', 4), /arreglo/);
  assert.equal(db.llamadas.length, 0);
});

test('el código de la API no contiene sentencias SQL: todo pasa por procedimientos', () => {
  const raiz = path.join(__dirname, '..');
  const carpetas = ['routes', 'services', 'utils', 'middlewares', 'scripts'];
  const sql = /\b(SELECT\s+[\w*]|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;
  for (const carpeta of carpetas) {
    for (const archivo of fs.readdirSync(path.join(raiz, carpeta)).filter((f) => f.endsWith('.js'))) {
      const fuente = fs.readFileSync(path.join(raiz, carpeta, archivo), 'utf8');
      assert.doesNotMatch(fuente, /\.query\(|\.execute\(/, `${carpeta}/${archivo} ejecuta SQL directo`);
      assert.doesNotMatch(fuente, sql, `${carpeta}/${archivo} contiene SQL`);
    }
  }
});

test('cada procedimiento que usa la API existe en database/procedimientos', () => {
  const raiz = path.join(__dirname, '..');
  const definidos = new Set();
  for (const f of fs.readdirSync(path.join(raiz, 'database/procedimientos'))) {
    for (const m of fs.readFileSync(path.join(raiz, 'database/procedimientos', f), 'utf8').matchAll(/CREATE PROCEDURE (sp_\w+)/g)) {
      assert.ok(!definidos.has(m[1]), `${m[1]} está definido dos veces`);
      definidos.add(m[1]);
    }
  }
  for (const carpeta of ['routes', 'services', 'utils', 'middlewares', 'scripts']) {
    for (const archivo of fs.readdirSync(path.join(raiz, carpeta)).filter((f) => f.endsWith('.js'))) {
      const fuente = fs.readFileSync(path.join(raiz, carpeta, archivo), 'utf8');
      for (const [, nombre] of fuente.matchAll(/['"](sp_[a-z0-9_]+)['"]/g)) {
        assert.ok(definidos.has(nombre), `${carpeta}/${archivo} usa ${nombre}, que no existe`);
      }
    }
  }
});
