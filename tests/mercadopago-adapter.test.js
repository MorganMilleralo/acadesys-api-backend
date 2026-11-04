'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const adapter = require('../services/mercadopago.adapter');
const { aCentimos, urlCheckoutValida } = require('../utils/pagos-proveedor');
const { entorno, proveedorSimulado, firma, referencia, clave, checkoutUrl } = require('./mercadopago-soporte');

function entrada() {
  return { idTransaccion: 1, referenciaInterna: referencia, idempotencyKey: clave, monto: '150.00',
    moneda: 'PEN', concepto: '2026-11', ciclo: 'QA', payerEmail: 'comprador@example.test',
    notificationUrl: process.env.MERCADOPAGO_WEBHOOK_URL, returnUrl: process.env.PAYMENT_RETURN_URL };
}

test('MP SDK real crea preferencia PEN y conserva contrato, referencia e idempotencia', async t => {
  entorno(t); const mp = proveedorSimulado(t);
  assert.deepEqual(await adapter.crearOrdenPago(entrada()), {
    idOrdenProveedor: 'pref-1', checkoutUrl, estado: 'pending',
  });
  assert.equal(mp.llamadas.length, 2);
  const request = mp.llamadas[1];
  assert.equal(request.method, 'POST');
  assert.equal(new Headers(request.options.headers).get('x-idempotency-key'), clave);
  assert.equal(request.body.external_reference, referencia);
  assert.deepEqual(request.body.metadata, { acadesys_transaction_id: '1' });
  assert.equal(request.body.items[0].unit_price, 150);
  assert.equal(request.body.items[0].currency_id, 'PEN');
  assert.equal(request.body.notification_url, process.env.MERCADOPAGO_WEBHOOK_URL + '?source_news=webhooks');
  assert.equal(request.body.back_urls.success, process.env.PAYMENT_RETURN_URL);
});

for (const variable of ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET', 'MERCADOPAGO_SELLER_ID']) {
  test(`MP rechaza configuración ausente: ${variable}`, async t => {
    entorno(t); const mp = proveedorSimulado(t); delete process.env[variable];
    await assert.rejects(adapter.crearOrdenPago(entrada()), { status: 503, code: 'PASARELA_NO_CONFIGURADA', safeToMarkError: true });
    assert.equal(mp.llamadas.length, 0);
  });
}

for (const cambio of [{ id: 901 }, { country_id: 'AR' }, { site_id: 'MLA' }, { tags: ['normal'] }]) {
  test(`MP comprueba cuenta Perú, vendedor y modo: ${JSON.stringify(cambio)}`, async t => {
    entorno(t); const mp = proveedorSimulado(t); Object.assign(mp.vendedor, cambio);
    await assert.rejects(adapter.crearOrdenPago(entrada()), { code: 'CUENTA_PROVEEDOR_INCOMPATIBLE', safeToMarkError: true });
    assert.equal(mp.llamadas.length, 1);
  });
}

for (const status of [400, 401, 403, 422, 429, 500, 503]) {
  test(`MP error HTTP ${status} no filtra respuesta y no reintenta POST`, async t => {
    entorno(t); const mp = proveedorSimulado(t);
    mp.responder = req => req.method === 'POST'
      ? new Response(JSON.stringify({ message: 'dato-privado', status }), { status }) : null;
    await assert.rejects(adapter.crearOrdenPago(entrada()), error => {
      assert.ok(!error.message.includes('dato-privado'));
      assert.equal(error.safeToMarkError, [400, 401, 403, 422].includes(status));
      return true;
    });
    assert.equal(mp.llamadas.filter(r => r.method === 'POST').length, 1);
  });
}

test('MP timeout del transporte aborta, conserva incertidumbre y no repite POST', async t => {
  entorno(t); const mp = proveedorSimulado(t);
  mp.responder = req => req.method === 'POST' ? new Promise((_, reject) => {
    req.options.signal.addEventListener('abort', () => reject(new Error('timeout simulado')), { once: true });
  }) : null;
  await assert.rejects(adapter.crearOrdenPago(entrada()), { code: 'PROVEEDOR_NO_DISPONIBLE', safeToMarkError: false });
  assert.equal(mp.llamadas.length, 2);
});

for (const cambio of [{ id: null }, { init_point: 'http://www.mercadopago.com.pe' },
  { init_point: 'https://www.mercadopago.com.pe.ejemplo.com/' }, { collector_id: 901 }, { external_reference: 'ajena' }]) {
  test(`MP preferencia inválida no libera una reserva ambigua: ${Object.keys(cambio)[0]}=${Object.values(cambio)[0]}`, async t => {
    entorno(t); const mp = proveedorSimulado(t);
    mp.responder = req => req.method === 'POST'
      ? new Response(JSON.stringify({ ...mp.preferencia, ...cambio }), { status: 200 }) : null;
    await assert.rejects(adapter.crearOrdenPago(entrada()), { code: 'RESPUESTA_PROVEEDOR_INVALIDA', safeToMarkError: false });
  });
}

test('MP exige HTTPS y contrato de webhook antes de llamar al proveedor', async t => {
  entorno(t); const mp = proveedorSimulado(t);
  for (const cambios of [{ returnUrl: 'http://localhost:5173' }, { notificationUrl: 'https://qa.example.com/otra-ruta' }]) {
    await assert.rejects(adapter.crearOrdenPago({ ...entrada(), ...cambios }), { status: 503, safeToMarkError: true });
  }
  assert.equal(mp.llamadas.length, 0);
});

test('MP importes estrictos: no redondea diferencias, booleanos ni precisión extra', () => {
  for (const valor of [true, false, [], {}, '', ' ', null, undefined, -1, NaN, Infinity, '150.001', '1e2', '100000000']) {
    assert.equal(aCentimos(valor), null, String(valor));
  }
  assert.equal(aCentimos('150.00'), 15000);
  assert.equal(aCentimos(0.01), 1);
});

test('MP URL admite dominios oficiales regional y global sin aceptar dominios parecidos', () => {
  assert.equal(urlCheckoutValida('https://www.mercadopago.com/mpe/checkout/start?pref_id=pref-1'), true);
  assert.equal(urlCheckoutValida(checkoutUrl), true);
  for (const url of ['https://www.mercadopago.com.ejemplo.test/checkout/start',
    'https://www.mercadopago.com@ejemplo.test/checkout/start', 'https://www.mercadopago.com/otra-ruta']) {
    assert.equal(urlCheckoutValida(url), false);
  }
});

function request(headers = firma(), query = { 'data.id': '123' }, body = { type: 'payment', data: { id: '123' } }) {
  return { headers, rawHeaders: Object.entries(headers).flat(), query, body };
}

test('MP firma oficial acepta timestamps en segundos y milisegundos', t => {
  entorno(t);
  for (const ts of [String(Math.floor(Date.now() / 1000)), String(Date.now())]) {
    assert.equal(adapter.validarNotificacion(request(firma({ ts }))), '123');
  }
});

test('MP rechaza firma inválida, antigua, futura, headers ausentes y query duplicado', t => {
  entorno(t);
  const invalida = firma(); invalida['x-signature'] = invalida['x-signature'].replace(/v1=./, 'v1=z');
  for (const req of [request(invalida), request({}), request({ 'x-signature': firma()['x-signature'] }),
    request(firma({ ts: String(Math.floor(Date.now() / 1000) - 301) })),
    request(firma({ ts: String(Math.floor(Date.now() / 1000) + 310) })),
    request(firma(), { 'data.id': ['123', '999'] }), request(firma(), {}),
    request({ ...firma(), 'x-request-id': 'id;ts:1' })]) {
    assert.throws(() => adapter.validarNotificacion(req), { status: 401 });
  }
  const duplicada = request(); duplicada.rawHeaders.push('x-request-id', 'otro');
  assert.throws(() => adapter.validarNotificacion(duplicada), { status: 401 });
});

test('MP no usa body como sustituto del identificador firmado y rechaza otros tópicos', t => {
  entorno(t);
  assert.throws(() => adapter.validarNotificacion(request(firma(), { 'data.id': '123' },
    { type: 'payment', data: { id: '999' } })), { status: 400 });
  assert.throws(() => adapter.validarNotificacion(request(firma(), { 'data.id': '123' },
    { type: 'merchant_order' })), { status: 400 });
});

test('MP consulta Payment + MerchantOrder + Preference con IDs distintos', async t => {
  entorno(t); const mp = proveedorSimulado(t);
  const resultado = await adapter.consultarPagoVerificado('123');
  assert.equal(resultado.idOrdenProveedor, 'pref-1');
  assert.equal(resultado.idPagoProveedor, '123');
  assert.equal(resultado.idTransaccion, 1);
  assert.equal(resultado.estado, 'APROBADA');
  assert.deepEqual(mp.llamadas.map(r => r.path), ['/v1/payments/123', '/merchant_orders/55', '/checkout/preferences/pref-1']);
});

for (const [objeto, cambio] of [
  ['pago', { id: 124 }], ['pago', { collector_id: 901 }], ['pago', { live_mode: true }],
  ['pago', { currency_id: 'USD' }], ['pago', { transaction_amount: 149.99 }],
  ['pago', { transaction_amount: 150.001 }], ['pago', { external_reference: 'ajena' }],
  ['pago', { captured: false }], ['pago', { transaction_amount_refunded: 1 }],
  ['pago', { date_last_updated: 'fecha inválida' }], ['pago', { status: 'desconocido' }],
  ['orden', { preference_id: 'otra' }], ['orden', { collector: { id: 901 } }],
  ['orden', { payments: [{ id: 999 }] }], ['orden', { total_amount: 300 }],
  ['preferencia', { collector_id: 901 }], ['preferencia', { external_reference: 'ajena' }],
  ['preferencia', { metadata: {} }], ['preferencia', { items: [] }],
]) {
  test(`MP no verifica un recurso inconsistente: ${objeto}.${Object.keys(cambio)[0]}`, async t => {
    entorno(t); const mp = proveedorSimulado(t); Object.assign(mp[objeto], cambio);
    await assert.rejects(adapter.consultarPagoVerificado('123'));
  });
}
