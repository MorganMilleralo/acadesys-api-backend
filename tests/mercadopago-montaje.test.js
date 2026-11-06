'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const { once } = require('node:events');
const { entorno, baseSimulada, proveedorSimulado, firma } = require('./mercadopago-soporte');

test('MP index real monta webhook público, limita JSON y conserva protección JWT', async t => {
  entorno(t);
  const mp = proveedorSimulado(t); mp.pago.status = 'pending';
  const db = baseSimulada(); db.seed();
  const rutaDB = require.resolve('../config/db');
  require.cache[rutaDB] = { id: rutaDB, filename: rutaDB, loaded: true, exports: db.pool };
  // dotenv es sustituido explícitamente: no se abre .env; MySQL sigue bloqueado.
  const cargar = Module._load;
  t.mock.method(Module, '_load', function (nombre, ...args) {
    if (nombre === 'dotenv') return { config() {} };
    return cargar.call(this, nombre, ...args);
  });
  const valores = { DB_HOST: 'inexistente.invalid', DB_PORT: '3306', DB_USER: 'qa', DB_PASSWORD: 'ficticia', DB_NAME: 'qa', PORT: '0' };
  const anteriores = Object.fromEntries(Object.keys(valores).map(k => [k, process.env[k]]));
  Object.assign(process.env, valores);
  t.after(() => { for (const [k, v] of Object.entries(anteriores)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const listen = express.application.listen;
  t.mock.method(express.application, 'listen', function (_port, callback) {
    return listen.call(this, 0, '127.0.0.1', callback);
  });
  const { server } = require('../index');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/ping')).status, 200);
  assert.equal((await fetch(base + '/api/alumno/pagos/7/checkout', { method: 'POST' })).status, 401);
  assert.equal((await fetch(base + '/api/alumno/pagos/7/estado')).status, 401);
  assert.equal((await fetch(base + '/api/notas')).status, 401);
  const r = await fetch(base + '/api/webhooks/mercadopago?data.id=123&type=payment', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...firma() },
    body: JSON.stringify({ type: 'payment', data: { id: '123' } }),
  });
  assert.equal(r.status, 200); assert.equal(db.state.cuota.Estado, 'Pendiente');
  for (const [body, status] of [['{"privado":', 400], [JSON.stringify({ data: 'a'.repeat(33000) }), 413]]) {
    const respuesta = await fetch(base + '/api/webhooks/mercadopago', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    assert.equal(respuesta.status, status);
    assert.ok(!(await respuesta.text()).includes('privado'));
  }
});
