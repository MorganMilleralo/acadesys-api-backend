'use strict';

// HU-19: los materiales ya no se sirven como estáticos públicos. Solo se
// descargan con sesión y con permiso sobre el ciclo del material.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'acadesys-mat-'));
process.env.UPLOADS_DIR = raiz;
after(() => fs.rmSync(raiz, { recursive: true, force: true }));

const express = require('express');
const { secuencia, simular, consultas } = require('./soporte');
const { MATERIAL_UPLOADS_DIR } = require('../config/storage');
fs.mkdirSync(MATERIAL_UPLOADS_DIR, { recursive: true });
fs.writeFileSync(path.join(MATERIAL_UPLOADS_DIR, 'guia.pdf'), '%PDF-1.4 prueba');

const material = { IdMaterial: 5, IdCiclo: 3, IdCurso: 8, NombreArchivo: 'Guía 1.pdf',
  UrlArchivo: 'https://api.ejemplo/uploads/materiales/guia.pdf' };

async function servir(t, identidad) {
  const app = express();
  app.use((req, _res, next) => { req.usuario = identidad; next(); });
  app.use('/api/materiales', require('../routes/materiales.routes'));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  return async ruta => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${ruta}`);
    const tipo = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers,
      body: tipo.includes('json') ? await res.json() : await res.text() };
  };
}
const pasoMaterial = (filas = [material]) => ({ sql: /FROM MaterialAcademico ma.*c\.IdAcademia = \?/, params: [5, 4], rows: filas });

test('administrador descarga el PDF de su academia sin caché pública', async t => {
  const fin = secuencia([pasoMaterial()]);
  const pedir = await servir(t, { idUsuario: 1, idAcademia: 4, rol: 'Administrador' });
  const r = await pedir('/api/materiales/5/descargar');
  assert.equal(r.status, 200);
  assert.equal(r.body, '%PDF-1.4 prueba');
  assert.match(r.headers.get('content-type'), /application\/pdf/);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.match(r.headers.get('content-disposition'), /attachment/);
  fin();
});

test('alumno matriculado en el ciclo descarga; sin matrícula recibe 404', async t => {
  const pedir = await servir(t, { idUsuario: 10, idAcademia: 4, rol: 'Alumno' });
  let fin = secuencia([pasoMaterial(), { sql: /FROM Matricula m/, params: [10, 3, 4], rows: [{ IdMatricula: 1 }] }]);
  assert.equal((await pedir('/api/materiales/5/descargar')).status, 200); fin();
  fin = secuencia([pasoMaterial(), { sql: /FROM Matricula m/, params: [10, 3, 4], rows: [] }]);
  const r = await pedir('/api/materiales/5/descargar');
  assert.equal(r.status, 404); assert.equal(r.body.error, 'Material no encontrado.'); fin();
});

test('docente solo descarga si está asignado al ciclo y curso', async t => {
  const pedir = await servir(t, { idUsuario: 20, idAcademia: 4, rol: 'Docente' });
  let fin = secuencia([pasoMaterial(), { sql: /FROM Asignacion_Aula aa/, params: [20, 3, 8, 4], rows: [{ IdAsignacion: 2 }] }]);
  assert.equal((await pedir('/api/materiales/5/descargar')).status, 200); fin();
  fin = secuencia([pasoMaterial(), { sql: /FROM Asignacion_Aula aa/, params: [20, 3, 8, 4], rows: [] }]);
  assert.equal((await pedir('/api/materiales/5/descargar')).status, 404); fin();
});

test('material de otra academia, rol desconocido o id inválido no se entregan', async t => {
  let pedir = await servir(t, { idUsuario: 1, idAcademia: 4, rol: 'Administrador' });
  let fin = secuencia([pasoMaterial([])]);
  assert.equal((await pedir('/api/materiales/5/descargar')).status, 404); fin();
  simular();
  assert.equal((await pedir('/api/materiales/abc/descargar')).status, 400);
  assert.equal(consultas.length, 0);
  pedir = await servir(t, { idUsuario: 7, idAcademia: 4, rol: 'Invitado' });
  fin = secuencia([pasoMaterial()]);
  assert.equal((await pedir('/api/materiales/5/descargar')).status, 404); fin();
});

test('URL manipulada o archivo ausente no escapa de la carpeta de materiales', async t => {
  const pedir = await servir(t, { idUsuario: 1, idAcademia: 4, rol: 'Administrador' });
  for (const UrlArchivo of ['/uploads/materiales/..%2F..%2Fsecreto.pdf', '/uploads/materiales/no-existe.pdf', '']) {
    const fin = secuencia([pasoMaterial([{ ...material, UrlArchivo }])]);
    const r = await pedir('/api/materiales/5/descargar');
    assert.equal(r.status, 404, UrlArchivo); assert.equal(r.body.code, 'ARCHIVO_NO_DISPONIBLE'); fin();
  }
});

test('index.js ya no expone /uploads completo, solo las fotos de perfil', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.doesNotMatch(fuente, /app\.use\(\s*["']\/uploads["']/);
  assert.match(fuente, /app\.use\(\s*["']\/uploads\/perfiles["'],\s*express\.static\(PROFILE_UPLOADS_DIR\)\)/);
});
