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

// Cuenta los elementos de primer nivel del arreglo literal que recibe cada
// llamada, para detectar procedimientos cuya firma cambió y el código no.
function contarArgumentos(fuente, inicio) {
  let profundidad = 0;
  let elementos = 0;
  let hayContenido = false;
  let comilla = null;
  for (let i = inicio; i < fuente.length; i += 1) {
    const c = fuente[i];
    if (comilla) {
      if (c === '\\') { i += 1; continue; }
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { comilla = c; hayContenido = true; continue; }
    if (c === '/' && fuente[i + 1] === '/') { i = fuente.indexOf('\n', i); continue; }
    if ('([{'.includes(c)) {
      profundidad += 1;
      if (profundidad > 1) hayContenido = true;
      continue;
    }
    if (')]}'.includes(c)) {
      profundidad -= 1;
      if (profundidad === 0) return elementos + (hayContenido ? 1 : 0);
      continue;
    }
    if (profundidad === 1 && c === ',') {
      if (hayContenido) elementos += 1;
      hayContenido = false;
      continue;
    }
    if (profundidad >= 1 && !/\s/.test(c)) hayContenido = true;
  }
  return null;
}

test('cada llamada envía tantos parámetros como declara su procedimiento', () => {
  const { catalogo } = require('./procedimientos-prueba');
  const raiz = path.join(__dirname, '..');
  const llamada = /\b(?:consultar|consultarVarios|ejecutar)\(\s*[\w.]+\s*,\s*['"](sp_[a-z0-9_]+)['"]\s*,\s*\[/g;
  let revisadas = 0;
  for (const carpeta of ['routes', 'services', 'utils', 'middlewares', 'scripts']) {
    for (const archivo of fs.readdirSync(path.join(raiz, carpeta)).filter((f) => f.endsWith('.js'))) {
      const fuente = fs.readFileSync(path.join(raiz, carpeta, archivo), 'utf8');
      for (const m of fuente.matchAll(llamada)) {
        const recibidos = contarArgumentos(fuente, m.index + m[0].length - 1);
        if (recibidos === null || /\.\.\./.test(fuente.slice(m.index, m.index + 400).split(']')[0])) continue;
        const esperados = catalogo.get(m[1])?.parametros.length;
        assert.equal(recibidos, esperados, `${carpeta}/${archivo}: ${m[1]} recibe ${recibidos} parámetros y el procedimiento declara ${esperados}`);
        revisadas += 1;
      }
    }
  }
  assert.ok(revisadas > 100, `solo se revisaron ${revisadas} llamadas`);
});
