
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const env = {
  PAYMENT_PROVIDER: 'MERCADOPAGO',
  PAYMENT_ENVIRONMENT: 'TEST',
  PAYMENT_CURRENCY: 'PEN',
  PAYMENT_REFERENCE_PREFIX: 'ACS',
  PAYMENT_CHECKOUT_RESERVATION_TIMEOUT_SECONDS: '120',
  PAYMENT_RECONCILIATION_INTERVAL_MS: '30000',
  MERCADOPAGO_API_BASE_URL: 'https://api.mercadopago.com',
  MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-FAKE-ACCESS-TOKEN-FOR-LOCAL-TESTS',
  MERCADOPAGO_WEBHOOK_SECRET: 'test-webhook-secret-only-for-unit-tests',
  MERCADOPAGO_ITEM_TITLE_PREFIX: 'AcadeSys',
  MERCADOPAGO_CHECKOUT_ALLOWED_HOSTS: 'www.mercadopago.com.pe',
  MERCADOPAGO_REQUEST_TIMEOUT_MS: '5000',
  MERCADOPAGO_WEBHOOK_TOLERANCE_SECONDS: '300',
  FRONTEND_PUBLIC_URL: 'https://acadesys-web-frontend.vercel.app',
  MERCADOPAGO_SUCCESS_RETURN_PATH: '/?payment_status=success',
  MERCADOPAGO_FAILURE_RETURN_PATH: '/?payment_status=failure',
  MERCADOPAGO_PENDING_RETURN_PATH: '/?payment_status=pending',
};
for (const [key, value] of Object.entries(env)) process.env[key] = value;

const adapter = require('../services/mercadopago.adapter');
const ORDER_ID = 'ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9';
const REFERENCE = 'ACS-19-11111111-1111-4111-8111-111111111111';
const ORDER = {
  id: ORDER_ID,
  type: 'online',
  processing_mode: 'manual',
  capture_mode: 'automatic_async',
  status: 'created',
  status_detail: 'created',
  external_reference: REFERENCE,
  total_amount: '150.00',
  total_paid_amount: '0.00',
  currency: 'PEN',
  checkout_url: `https://www.mercadopago.com.pe/checkout/v1/redirect?order_id=${ORDER_ID}`,
  created_date: '2026-11-20T10:00:00.000Z',
  last_updated_date: '2026-11-20T10:00:00.000Z',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function reservation(overrides = {}) {
  return {
    idTransaccion: 31,
    idPago: 19,
    referenciaInterna: REFERENCE,
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    monto: 150,
    moneda: 'PEN',
    concepto: 'Mensualidad noviembre',
    ciclo: 'Ciclo UNI',
    emailAlumno: 'alumno-test@example.test',
    ...overrides,
  };
}

test('crea una Order de Checkout Pro con clave idempotente y correo del alumno', async (t) => {
  let request;
  t.mock.method(global, 'fetch', async (url, options) => {
    request = { url: String(url), options, body: JSON.parse(options.body) };
    return jsonResponse(ORDER, 201);
  });

  const result = await adapter.crearOrdenPago(reservation());
  assert.equal(result.idOrdenProveedor, ORDER_ID);
  assert.equal(result.checkoutUrl, ORDER.checkout_url);
  assert.equal(request.url, 'https://api.mercadopago.com/v1/orders');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`);
  assert.equal(request.options.headers['X-Idempotency-Key'], reservation().idempotencyKey);
  assert.equal(request.body.type, 'online');
  assert.equal(request.body.processing_mode, 'manual');
  assert.equal(request.body.total_amount, '150.00');
  assert.equal(request.body.items[0].unit_price, '150.00');
  assert.equal(request.body.payer.email, reservation().emailAlumno);
  assert.equal(request.body.external_reference, REFERENCE);
});

test('consulta y normaliza una Order acreditada, sin confiar en el navegador', async (t) => {
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(String(url), `https://api.mercadopago.com/v1/orders/${ORDER_ID}`);
    assert.equal(options.method, 'GET');
    return jsonResponse({
      ...ORDER,
      status: 'processed',
      status_detail: 'accredited',
      total_paid_amount: '150.00',
      last_updated_date: '2026-11-20T10:05:00.000Z',
    });
  });

  const result = await adapter.consultarOrdenVerificada({ orderId: ORDER_ID, referenciaInterna: REFERENCE, monto: 150 });
  assert.equal(result.proveedor, 'MERCADOPAGO');
  assert.equal(result.estado, 'APROBADA');
  assert.equal(result.estadoProveedor, 'processed:accredited');
  assert.equal(result.monto, 150);
  assert.equal(result.moneda, 'PEN');
  assert.equal(result.idPagoProveedor, ORDER_ID);
});

test('no acepta una Order si el importe acreditado no coincide', async (t) => {
  t.mock.method(global, 'fetch', async () => jsonResponse({
    ...ORDER,
    status: 'processed',
    status_detail: 'accredited',
    total_paid_amount: '149.00',
  }));

  await assert.rejects(
    adapter.consultarOrdenVerificada({ orderId: ORDER_ID, referenciaInterna: REFERENCE, monto: 150 }),
    (error) => error.code === 'MERCADOPAGO_IMPORTE_NO_ACREDITADO',
  );
});

test('valida la firma HMAC del webhook Order y rechaza una firma alterada', () => {
  const requestId = '11111111-2222-4333-8444-555555555555';
  const timestamp = String(Date.now());
  const manifest = `id:${ORDER_ID.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const signature = crypto.createHmac('sha256', env.MERCADOPAGO_WEBHOOK_SECRET).update(manifest).digest('hex');
  const req = {
    originalUrl: `/api/webhooks/mercadopago?data.id=${ORDER_ID}&type=order`,
    headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${signature}` },
    body: { id: 'event-test-1', live_mode: false, type: 'order', action: 'order.processed', data: { id: ORDER_ID } },
  };

  assert.equal(adapter.validarNotificacion(req).orderId, ORDER_ID);
  assert.throws(
    () => adapter.validarNotificacion({ ...req, headers: { ...req.headers, 'x-signature': `ts=${timestamp},v1=${'0'.repeat(64)}` } }),
    (error) => error.code === 'MERCADOPAGO_FIRMA_INVALIDA',
  );
  assert.throws(
    () => adapter.validarNotificacion({
      ...req,
      body: { ...req.body, data: { id: 'ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP8' } },
    }),
    (error) => error.code === 'MERCADOPAGO_WEBHOOK_INVALIDO',
  );
});

test('rechaza un token que no corresponde a credenciales de prueba Checkout Pro Orders', () => {
  const previous = process.env.MERCADOPAGO_ACCESS_TOKEN;
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-INVALID-PREFIX-FOR-ORDERS';
  try {
    assert.throws(() => adapter.verificarConfiguracion(), (error) => error.code === 'MERCADOPAGO_TEST_TOKEN_INVALIDO');
  } finally {
    process.env.MERCADOPAGO_ACCESS_TOKEN = previous;
  }
});

test('acepta una orden nueva que Mercado Pago devuelve esperando el pago', async (t) => {
  t.mock.method(global, 'fetch', async () => jsonResponse({ ...ORDER, status: 'action_required', status_detail: 'waiting_payment' }, 201));
  const result = await adapter.crearOrdenPago(reservation());
  assert.equal(result.idOrdenProveedor, ORDER_ID);
  assert.equal(result.estadoProveedor, 'action_required:waiting_payment');
});

test('rechaza una orden nueva que ya llega procesada y muestra el estado recibido', async (t) => {
  t.mock.method(global, 'fetch', async () => jsonResponse({ ...ORDER, status: 'processed', status_detail: 'accredited' }, 201));
  await assert.rejects(adapter.crearOrdenPago(reservation()), /estado inicial \(processed:accredited\)/);
});

test('una orden creada que aún no se paga se concilia como pendiente', async (t) => {
  for (const [status, status_detail] of [['created', 'waiting_payment'], ['action_required', 'waiting_transfer'], ['created', undefined]]) {
    t.mock.method(global, 'fetch', async () => jsonResponse({ ...ORDER, status, status_detail }));
    const r = await adapter.consultarOrdenVerificada({ orderId: ORDER_ID, referenciaInterna: REFERENCE, monto: 150 });
    assert.equal(r.estado, 'PENDIENTE', `${status}:${status_detail}`);
    t.mock.restoreAll();
  }
});
