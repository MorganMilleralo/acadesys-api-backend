const assert = require('node:assert/strict');
const express = require('express');
const rutaDB = require.resolve('../config/db');
let responder;
const eventos = [];
const consultas = [];
const conexion = {
  async query(sql, params = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    assert.equal((q.match(/\?/g) || []).length, params.length, 'Cantidad de parametros SQL: ' + q);
    consultas.push({ q, params });
    return responder(q, params);
  },
  async beginTransaction() { eventos.push('begin'); },
  async commit() { eventos.push('commit'); },
  async rollback() { eventos.push('rollback'); },
  release() { eventos.push('release'); },
};
require.cache[rutaDB] = { id: rutaDB, filename: rutaDB, loaded: true,
  exports: { query: conexion.query, getConnection: async () => conexion } };
function simular(fn = () => { throw new Error('Consulta no prevista'); }) {
  responder = fn; eventos.length = 0; consultas.length = 0;
}
function secuencia(pasos) {
  simular((sql, params) => {
    assert.ok(pasos.length, 'Consulta inesperada: ' + sql);
    const paso = pasos.shift();
    assert.match(sql, paso.sql);
    if (paso.params) assert.deepEqual(params, paso.params);
    if (paso.verificar) paso.verificar(sql, params);
    if (paso.error) throw paso.error;
    return [paso.rows ?? []];
  });
  return () => assert.equal(pasos.length, 0, 'Consultas esperadas sin ejecutar');
}
async function servir(t, rutas, identidad = { id: 10, idAcademia: 1, rol: 'Administrador' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.usuario = identidad; next(); });
  for (const [prefijo, archivo] of rutas) app.use(prefijo, require('../routes/' + archivo));
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return async (method, ruta, body) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${ruta}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
}
module.exports = { simular, secuencia, servir, eventos, consultas };


