'use strict';

// Fotos de perfil en MySQL (FotoPerfil): sobreviven a los despliegues de Render.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'acadesys-foto-'));
process.env.UPLOADS_DIR = raiz;
after(() => fs.rmSync(raiz, { recursive: true, force: true }));

const express = require('express');
const { simular, servir, consultas, eventos } = require('./soporte');
const { PROFILE_UPLOADS_DIR } = require('../config/storage');

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const nombre = 'foto-perfil-10-lz1abc-0123456789abcdef.png';

async function servirFotos(t) {
  const app = express();
  app.use('/uploads/perfiles', require('../routes/foto-perfil.routes'), express.static(PROFILE_UPLOADS_DIR));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  return async ruta => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${ruta}`);
    return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
  };
}

test('la foto guardada en MySQL se sirve sin sesión, con caché y tipo correcto', async t => {
  simular((sql, params) => {
    assert.match(sql, /FROM FotoPerfil WHERE NombreArchivo = \?/); assert.deepEqual(params, [nombre]);
    return [[{ Contenido: png, TipoMime: 'image/png' }]];
  });
  const pedir = await servirFotos(t);
  const r = await pedir('/uploads/perfiles/' + nombre);
  assert.equal(r.status, 200); assert.ok(r.body.equals(png));
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.match(r.headers.get('cache-control'), /immutable/);
});

test('nombres inválidos no consultan la base; ausentes o sin tabla pasan al disco', async t => {
  const pedir = await servirFotos(t);
  simular();
  assert.equal((await pedir('/uploads/perfiles/..%2F..%2Fsecreto.png')).status, 404);
  assert.equal((await pedir('/uploads/perfiles/cualquier.png')).status, 404);
  assert.equal(consultas.length, 0);
  simular(() => [[]]);
  assert.equal((await pedir('/uploads/perfiles/' + nombre)).status, 404);
  fs.mkdirSync(PROFILE_UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROFILE_UPLOADS_DIR, nombre), png);
  simular(() => { throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' }); });
  const r = await pedir('/uploads/perfiles/' + nombre);
  assert.equal(r.status, 200); assert.ok(r.body.equals(png));
  fs.unlinkSync(path.join(PROFILE_UPLOADS_DIR, nombre));
});

function baseUsuario({ sinTabla = false } = {}) {
  const vistas = [];
  simular((sql, params) => {
    vistas.push({ sql, params });
    if (/INFORMATION_SCHEMA\.COLUMNS.*FotoUrl/.test(sql)) return [[{ 1: 1 }]];
    if (/FROM Academia .*FOR UPDATE/.test(sql)) return [[]];
    if (/^SELECT DNI, CorreoElectronico, FotoUrl FROM Usuario/.test(sql)) return [[{ DNI: '12345678', CorreoElectronico: 'a@b.pe', FotoUrl: '/uploads/perfiles/foto-perfil-10-old-aaaaaaaaaaaaaaaa.jpg' }]];
    if (/^INSERT INTO FotoPerfil/.test(sql) && sinTabla) throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' });
    if (/^SELECT FotoUrl FROM Usuario/.test(sql)) return [[{ FotoUrl: '/uploads/perfiles/nueva' }]];
    if (/^SELECT/.test(sql) && /FROM Usuario u/.test(sql)) return [[{ IdUsuario: 10, Nombres: 'Ana' }]];
    if (/^SELECT/.test(sql)) return [[]];
    return [{ affectedRows: 1 }];
  });
  return vistas;
}

test('subir foto la guarda en FotoPerfil en la transacción y borra la anterior tras el commit', async t => {
  const vistas = baseUsuario();
  const pedir = await servir(t, [['/api', 'usuario.routes']], { id: 10, idUsuario: 10, idAcademia: 1, rol: 'Alumno' });
  const r = await pedir('PUT', '/api/usuarios/me', { fotoBase64: png.toString('base64'), tipoMime: 'image/png' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ins = vistas.find(v => /^INSERT INTO FotoPerfil/.test(v.sql));
  assert.ok(ins, 'debe insertar la foto');
  assert.match(ins.params[0], /^foto-perfil-10-[a-z0-9]+-[a-f0-9]{16}\.png$/);
  assert.equal(ins.params[1], 10); assert.ok(ins.params[2].equals(png)); assert.equal(ins.params[3], 'image/png');
  const upd = vistas.find(v => /^UPDATE Usuario SET/.test(v.sql));
  assert.equal(upd.params[0], '/uploads/perfiles/' + ins.params[0]);
  const iIns = vistas.indexOf(ins);
  const del = vistas.findIndex(v => /^DELETE FROM FotoPerfil/.test(v.sql));
  assert.ok(del > iIns); assert.deepEqual(vistas[del].params, ['foto-perfil-10-old-aaaaaaaaaaaaaaaa.jpg']);
  assert.ok(eventos.includes('commit'));
  assert.equal(fs.existsSync(PROFILE_UPLOADS_DIR) ? fs.readdirSync(PROFILE_UPLOADS_DIR).length : 0, 0);
});

test('sin la tabla FotoPerfil la foto responde 503 y no cambia el usuario', async t => {
  t.mock.method(console, 'error', () => {});
  baseUsuario({ sinTabla: true });
  const pedir = await servir(t, [['/api', 'usuario.routes']], { id: 10, idUsuario: 10, idAcademia: 1, rol: 'Alumno' });
  const r = await pedir('PUT', '/api/usuarios/me', { fotoBase64: png.toString('base64'), tipoMime: 'image/png' });
  assert.equal(r.status, 503); assert.equal(r.body.code, 'ALMACEN_NO_CONFIGURADO');
  assert.ok(eventos.includes('rollback')); assert.ok(!eventos.includes('commit'));
});
