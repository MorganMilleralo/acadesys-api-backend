'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const referencia = 'ACS-7-11111111-1111-4111-8111-111111111111';
const clave = 'ACS-22222222-2222-4222-8222-222222222222';
const checkoutUrl = 'https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=pref-1';

// Modelo transaccional en memoria: el mutex se adquiere en el SELECT de cuota
// FOR UPDATE, no en beginTransaction. No pretende interpretar SQL ni probar MySQL.
function baseSimulada() {
  const inicial = () => ({ cuota: { IdPago: 7, IdUsuario: 10, IdAcademia: 1, IdCiclo: 3,
    Mes: '2026-11', Monto: '150.00', Estado: 'Pendiente', CorreoElectronico: 'alumno@example.test', Ciclo: 'QA' },
  transacciones: [], auditorias: [] });
  const db = { state: inicial(), queries: [], rollbacks: 0, commits: 0, releases: 0, fault: null };
  let cola = Promise.resolve();
  async function adquirir() {
    const anterior = cola;
    let liberar;
    cola = new Promise(resolve => { liberar = resolve; });
    await anterior;
    return liberar;
  }
  async function ejecutar(sql, params = [], conexion) {
    const q = sql.replace(/\s+/g, ' ').trim();
    assert.equal((q.match(/\?/g) || []).length, params.length, q);
    db.queries.push({ q, params });
    if (/FROM PagosMensualidad p/.test(q) && /FOR UPDATE/.test(q)) {
      assert.ok(conexion?.activa, 'El lock requiere transacción abierta');
      conexion.unlock = await adquirir();
      conexion.snapshot = structuredClone(db.state);
    }
    if (/FOR UPDATE/.test(q)) assert.ok(conexion?.unlock, 'Cuota debe bloquearse antes de transacción/auditoría');
    if (db.fault) { const respuesta = db.fault(q, params); if (respuesta) return respuesta; }
    const { cuota, transacciones, auditorias } = db.state;
    const copia = rows => [structuredClone(rows)];
    if (q.startsWith('SELECT IdPago FROM PagoTransaccion')) {
      return copia(transacciones.filter(t => t.ReferenciaInterna === params[1]).map(t => ({ IdPago: t.IdPago })));
    }
    if (q.includes('LEFT JOIN PagoTransaccion')) {
      if (Number(params[0]) !== cuota.IdPago || Number(params[1]) !== cuota.IdUsuario || Number(params[2]) !== cuota.IdAcademia) return [[]];
      const tx = transacciones.at(-1);
      return copia([{ ...cuota, EstadoPago: cuota.Estado, ...tx, Monto: cuota.Monto,
        EstadoTransaccion: tx?.Estado, MontoTransaccion: tx?.Monto }]);
    }
    if (/FROM PagosMensualidad p/.test(q) && /FOR UPDATE/.test(q)) {
      return copia(Number(params[0]) === cuota.IdPago && (params.length === 1
        || (params[1] === cuota.IdUsuario && params[2] === cuota.IdAcademia)) ? [cuota] : []);
    }
    if (q.startsWith('SELECT') && q.includes('FROM PagoTransaccion')) {
      let rows;
      if (q.includes('WHERE IdPago = ?')) {
        assert.match(q, /Estado <> 'ERROR'/);
        rows = transacciones.filter(t => t.IdPago === params[0] && t.IdUsuario === params[1]
          && t.IdAcademia === params[2] && t.Estado !== 'ERROR').slice(-1);
      } else if (q.includes('ReferenciaInterna = ?')) rows = transacciones.filter(t => t.ReferenciaInterna === params[1]);
      else rows = transacciones.filter(t => t.IdTransaccion === params[0]);
      return copia(rows);
    }
    if (q.startsWith('INSERT INTO PagoTransaccion')) {
      assert.ok(conexion?.unlock);
      const [IdPago, IdUsuario, IdAcademia, Proveedor, ReferenciaInterna, ClaveIdempotencia, Monto, Moneda] = params;
      const IdTransaccion = transacciones.length + 1;
      transacciones.push({ IdTransaccion, IdPago, IdUsuario, IdAcademia, Proveedor, ReferenciaInterna,
        ClaveIdempotencia, Monto, Moneda, Estado: 'CREANDO', IdOrdenProveedor: null, UrlCheckout: null });
      return [{ insertId: IdTransaccion, affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE PagoTransaccion SET IdOrdenProveedor')) {
      assert.match(q, /IdOrdenProveedor IS NULL OR IdOrdenProveedor = \?/);
      const tx = transacciones.find(t => t.IdTransaccion === params[3]);
      if (!tx || tx.Estado === 'ERROR' || (tx.IdOrdenProveedor && tx.IdOrdenProveedor !== params[4])) return [{ affectedRows: 0 }];
      if (tx.Estado === 'CREANDO') { tx.Estado = 'PENDIENTE'; tx.CodigoEstadoProveedor = params[2]; }
      tx.IdOrdenProveedor = params[0]; tx.UrlCheckout = params[1];
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("UPDATE PagoTransaccion SET Estado = 'ERROR'")) {
      const tx = transacciones.find(t => t.IdTransaccion === params[0] && t.Estado === 'CREANDO');
      if (tx) tx.Estado = 'ERROR';
      return [{ affectedRows: tx ? 1 : 0 }];
    }
    if (q.startsWith('UPDATE PagoTransaccion SET Estado = ?')) {
      assert.ok(conexion?.unlock);
      const tx = transacciones.find(t => t.IdTransaccion === params[4]);
      if (!tx) return [{ affectedRows: 0 }];
      tx.Estado = params[0]; tx.IdOrdenProveedor = params[1]; tx.CodigoEstadoProveedor = params[2];
      if (params[3] === 'APROBADA') tx.FechaConfirmacion ||= 'fecha-confirmacion';
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE PagosMensualidad SET')) {
      assert.ok(conexion?.unlock);
      assert.match(q, /Estado IN \('Pendiente', 'Moroso'\)/);
      if (cuota.IdPago !== params[0] || cuota.IdUsuario !== params[1] || !['Pendiente', 'Moroso'].includes(cuota.Estado)) return [{ affectedRows: 0 }];
      cuota.Estado = 'Pagado'; cuota.FechaPago ||= 'fecha-pago';
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT IdAuditoria')) return copia(auditorias.filter(a => a.Evento === 'MERCADOPAGO_EVENTO').slice().reverse());
    if (q.startsWith('INSERT INTO PagoAuditoria')) {
      assert.ok(conexion?.unlock);
      assert.ok(params[7].length <= 500, 'Motivo cabe en DDL de Morgan');
      auditorias.push({ IdAuditoria: auditorias.length + 1, Evento: params[2], Motivo: params[7] });
      return [{ affectedRows: 1, insertId: auditorias.length }];
    }
    throw new Error('SQL no previsto: ' + q);
  }
  db.pool = {
    query: (q, p) => ejecutar(q, p),
    async getConnection() {
      return {
        activa: false, unlock: null, snapshot: null,
        async beginTransaction() { this.activa = true; },
        query(q, p) { return ejecutar(q, p, this); },
        async commit() {
          if (db.fault) db.fault('COMMIT', []);
          db.commits++; this.snapshot = null; this.activa = false; this.unlock?.(); this.unlock = null;
        },
        async rollback() {
          if (this.snapshot) db.state = this.snapshot;
          this.snapshot = null; this.activa = false; db.rollbacks++; this.unlock?.(); this.unlock = null;
        },
        release() { assert.equal(this.unlock, null, 'No dejar locks al liberar conexión'); db.releases++; },
      };
    },
  };
  db.seed = () => db.state.transacciones.push({ IdTransaccion: 1, IdPago: 7, IdUsuario: 10, IdAcademia: 1,
    Proveedor: 'MERCADOPAGO', ReferenciaInterna: referencia, ClaveIdempotencia: clave,
    IdOrdenProveedor: 'pref-1', Monto: '150.00', Moneda: 'PEN', Estado: 'PENDIENTE', UrlCheckout: checkoutUrl });
  return db;
}

function entorno(t) {
  const valores = { MERCADOPAGO_ACCESS_TOKEN: 'token-ficticio-pruebas-sin-red',
    MERCADOPAGO_WEBHOOK_SECRET: 'firma-ficticia-exclusiva-tests', MERCADOPAGO_SELLER_ID: '900',
    MERCADOPAGO_ENV: 'test', MERCADOPAGO_WEBHOOK_URL: 'https://backend.example.com/api/webhooks/mercadopago',
    PAYMENT_RETURN_URL: 'https://frontend.example.com/alumno/pagos' };
  const anteriores = Object.fromEntries(Object.keys(valores).map(k => [k, process.env[k]]));
  Object.assign(process.env, valores);
  t.after(() => { for (const [k, v] of Object.entries(anteriores)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

function proveedorSimulado(t) {
  const mock = { llamadas: [], responder: null,
    vendedor: { id: 900, country_id: 'PE', site_id: 'MPE', tags: ['test_user'] },
    preferencia: { id: 'pref-1', collector_id: 900, external_reference: referencia,
      init_point: checkoutUrl, metadata: { acadesys_transaction_id: '1' },
      items: [{ quantity: 1, currency_id: 'PEN', unit_price: 150 }] },
    pago: { id: 123, collector_id: 900, live_mode: false, status: 'approved', captured: true,
      transaction_amount: 150, currency_id: 'PEN', external_reference: referencia,
      date_last_updated: new Date(Date.now() - 1000).toISOString(), order: { id: 55, type: 'mercadopago' } },
    orden: { id: 55, collector: { id: 900 }, external_reference: referencia,
      preference_id: 'pref-1', total_amount: 150, payments: [{ id: 123 }] } };
  const originalFetch = global.fetch;
  t.mock.method(global, 'fetch', async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === '127.0.0.1') return originalFetch(input, options);
    assert.equal(url.origin, 'https://api.mercadopago.com', 'Red externa prohibida');
    const llamada = { path: url.pathname, method: options.method || 'GET', options,
      body: options.body ? JSON.parse(options.body) : undefined };
    mock.llamadas.push(llamada);
    if (mock.responder) { const response = await mock.responder(llamada); if (response) return response; }
    let body;
    if (llamada.path === '/users/me') body = mock.vendedor;
    else if (llamada.path === '/checkout/preferences/' && llamada.method === 'POST') {
      mock.preferencia = { ...mock.preferencia, ...llamada.body };
      mock.pago.external_reference = llamada.body.external_reference;
      mock.orden.external_reference = llamada.body.external_reference;
      body = mock.preferencia;
    } else if (llamada.path === '/checkout/preferences/pref-1') body = mock.preferencia;
    else if (/^\/v1\/payments\/\d+$/.test(llamada.path)) body = mock.pago;
    else if (llamada.path === '/merchant_orders/55') body = mock.orden;
    else assert.fail('Endpoint SDK inesperado: ' + llamada.path);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return mock;
}

function firma({ id = '123', ts = String(Math.floor(Date.now() / 1000)), requestId = 'request-qa-1' } = {}) {
  const v1 = crypto.createHmac('sha256', process.env.MERCADOPAGO_WEBHOOK_SECRET)
    .update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}

async function servir(t, db) {
  const rutaDB = require.resolve('../config/db');
  require.cache[rutaDB] = { id: rutaDB, filename: rutaDB, loaded: true, exports: db.pool };
  for (const ruta of ['../services/transacciones-pago.service', '../routes/alumno-checkout.routes', '../routes/mercadopago-webhook.routes']) {
    delete require.cache[require.resolve(ruta)];
  }
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/webhooks', require('../routes/mercadopago-webhook.routes'));
  app.use((req, res, next) => {
    if (!req.headers.authorization) return res.status(401).json({ error: 'Sin sesión' });
    req.usuario = { id: Number(req.headers['x-usuario'] || 10), idAcademia: 1, rol: req.headers['x-rol'] || 'Alumno' };
    next();
  });
  app.use('/api/alumno', require('../routes/alumno-checkout.routes'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return async (method, path, { body, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
}

module.exports = { baseSimulada, entorno, proveedorSimulado, firma, servir, referencia, clave, checkoutUrl };
