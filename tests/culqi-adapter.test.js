
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const culqi = require('../services/culqi.adapter');

const ORDER_ID = 'ord_test_ABCDEF1234567890';
const REFERENCE = 'ACS-19-11111111-1111-4111-8111-111111111111';
const ORDER = {
  object: 'order',
  id: ORDER_ID,
  amount: 40000,
  currency_code: 'PEN',
  description: 'AcadeSys Mensualidad Ciclo QA',
  order_number: 'ACS-12',
  state: 'created',
  creation_date: Date.now(),
  expiration_date: Math.floor(Date.now() / 1000) + 1800,
  metadata: {
    acadesys_transaction_id: '12',
    acadesys_payment_id: '19',
    acadesys_reference: REFERENCE,
  },
};

function configurar(t) {
  const env = {
    CULQI_SECRET_KEY: 'sk_test_DEMOKEY12345',
    CULQI_PUBLIC_KEY: 'pk_test_DEMOKEY12345',
    CULQI_WEBHOOK_USERNAME: 'acadesysqa',
    CULQI_WEBHOOK_PASSWORD: 'password_de_prueba_largo',
    CULQI_ORDER_EXPIRATION_MINUTES: '30',
  };
  const anterior = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(anterior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function crearReserva(overrides = {}) {
  return {
    idTransaccion: 12,
    idPago: 19,
    referenciaInterna: REFERENCE,
    monto: 400,
    moneda: 'PEN',
    concepto: 'Mensualidad',
    ciclo: 'Ciclo QA',
    emailAlumno: 'alumno@example.test',
    telefonoAlumno: '999888777',
    nombreAlumno: 'Alex',
    apellidoPaterno: 'Prueba',
    apellidoMaterno: 'QA',
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('Culqi verifica que la llave pública y privada sean del mismo entorno', t => {
  configurar(t);
  assert.doesNotThrow(() => culqi.verificarConfiguracion());
  process.env.CULQI_PUBLIC_KEY = 'pk_live_mismatched_environment';
  assert.throws(() => culqi.verificarConfiguracion(), error => error.code === 'CULQI_NO_CONFIGURADO');
});

test('Culqi crea una orden de billeteras por S/400 y la confirma con llave privada', async t => {
  configurar(t);
  const llamadas = [];
  t.mock.method(global, 'fetch', async (url, options = {}) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.culqi.com');
    const body = options.body ? JSON.parse(options.body) : undefined;
    llamadas.push({ path: parsed.pathname, method: options.method, headers: options.headers, body });
    if (parsed.pathname === '/v2/orders' && options.method === 'POST') return jsonResponse(ORDER, 201);
    if (parsed.pathname === `/v2/orders/${ORDER_ID}` && options.method === 'GET') {
      return jsonResponse(ORDER, 200);
    }
    if (parsed.pathname === `/v2/orders/${ORDER_ID}/confirm` && options.method === 'POST') {
      return jsonResponse({ ...ORDER, state: 'pending' }, 200);
    }
    assert.fail(`Endpoint inesperado: ${options.method} ${parsed.pathname}`);
  });

  const creada = await culqi.crearOrdenPago(crearReserva());
  assert.deepEqual(creada, {
    idOrdenProveedor: ORDER_ID,
    estado: 'created',
    montoCentimos: 40000,
    moneda: 'PEN',
  });
  assert.equal(llamadas[0].body.amount, 40000);
  assert.equal(llamadas[0].body.currency_code, 'PEN');
  assert.equal(llamadas[0].body.confirm, false);
  assert.equal(llamadas[0].body.order_number, 'ACS-12');
  assert.equal(llamadas[0].body.metadata.acadesys_reference, REFERENCE);
  assert.equal(llamadas[0].body.client_details.phone_number, '+51999888777');
  assert.equal(llamadas[0].headers.Authorization, `Bearer ${process.env.CULQI_SECRET_KEY}`);

  const confirmada = await culqi.confirmarOrdenPago(ORDER_ID, crearReserva());
  assert.equal(confirmada.state, 'pending');
  assert.equal(llamadas[1].method, 'GET');
  assert.equal(llamadas[1].headers.Authorization, `Bearer ${process.env.CULQI_SECRET_KEY}`);
  assert.equal(llamadas[2].method, 'POST');
  assert.equal(llamadas[2].headers.Authorization, `Bearer ${process.env.CULQI_SECRET_KEY}`);
  assert.deepEqual(llamadas[2].body, { confirm: true });
});


test('Culqi reutiliza una orden ya confirmada sin volver a confirmar ni crear otra', async t => {
  configurar(t);
  const llamadas = [];
  const reserva = crearReserva();
  t.mock.method(global, 'fetch', async (url, options = {}) => {
    const parsed = new URL(url);
    llamadas.push({ path: parsed.pathname, method: options.method, headers: options.headers,
      body: options.body ? JSON.parse(options.body) : undefined });
    return jsonResponse({ ...ORDER, state: 'pending' });
  });

  const orden = await culqi.confirmarOrdenPago(ORDER_ID, reserva);
  assert.equal(orden.state, 'pending');
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].method, 'GET');
});

test('Culqi no confirma una orden con importe o referencia distintos de la reserva', async t => {
  configurar(t);
  t.mock.method(global, 'fetch', async () => jsonResponse({
    ...ORDER,
    amount: 39900,
  }));
  await assert.rejects(
    () => culqi.confirmarOrdenPago(ORDER_ID, crearReserva()),
    error => error.code === 'CULQI_ORDEN_RESPUESTA_INVALIDA',
  );
});

test('Culqi rechaza importes fuera del rango QR sin llamar a la API', async t => {
  configurar(t);
  let llamadas = 0;
  t.mock.method(global, 'fetch', async () => { llamadas += 1; return jsonResponse(ORDER); });
  await assert.rejects(
    () => culqi.crearOrdenPago(crearReserva({ monto: 501 })),
    error => error.code === 'DATOS_ORDEN_CULQI_INVALIDOS',
  );
  assert.equal(llamadas, 0);
});

test('Culqi exige teléfono registrado y no inventa datos del alumno', async t => {
  configurar(t);
  let llamadas = 0;
  t.mock.method(global, 'fetch', async () => { llamadas += 1; return jsonResponse(ORDER); });
  await assert.rejects(
    () => culqi.crearOrdenPago(crearReserva({ telefonoAlumno: '' })),
    error => error.code === 'TELEFONO_TITULAR_INVALIDO',
  );
  assert.equal(llamadas, 0);
});


test('Culqi rechaza números que no son celulares móviles peruanos', t => {
  configurar(t);
  assert.equal(culqi.normalizarTelefono('12345678'), null);
  assert.equal(culqi.normalizarTelefono('51912345678'), '+51912345678');
  assert.equal(culqi.normalizarTelefono('+51912345678'), '+51912345678');
});

test('Culqi webhook requiere Basic Auth y valida evento order.status.changed', t => {
  configurar(t);
  const basic = `Basic ${Buffer.from(`${process.env.CULQI_WEBHOOK_USERNAME}:${process.env.CULQI_WEBHOOK_PASSWORD}`).toString('base64')}`;
  const req = {
    headers: { authorization: basic },
    body: {
      id: 'evt_test_123',
      type: 'order.status.changed',
      creation_date: Date.now(),
      data: JSON.stringify({ id: ORDER_ID }),
    },
  };
  assert.equal(culqi.validarNotificacion(req).orderId, ORDER_ID);
  assert.throws(
    () => culqi.validarNotificacion({ headers: {}, body: req.body }),
    error => error.status === 401,
  );
});

test('Culqi consulta la orden por API y normaliza el estado pagado', async t => {
  configurar(t);
  t.mock.method(global, 'fetch', async (url, options = {}) => {
    assert.equal(new URL(url).pathname, `/v2/orders/${ORDER_ID}`);
    assert.equal(options.headers.Authorization, `Bearer ${process.env.CULQI_SECRET_KEY}`);
    return jsonResponse({ ...ORDER, state: 'paid', updated_at: Date.now() });
  });

  const pago = await culqi.consultarOrdenVerificada({ orderId: ORDER_ID });
  assert.equal(pago.proveedor, 'CULQI');
  assert.equal(pago.estadoProveedor, 'paid');
  assert.equal(pago.estado, 'APROBADA');
  assert.equal(pago.monto, 400);
  assert.equal(pago.moneda, 'PEN');
  assert.equal(pago.idPagoProveedor, ORDER_ID);
  assert.equal(pago.referenciaInterna, REFERENCE);
});

test('Culqi rechaza órdenes cuya metadata no coincide con AcadeSys', async t => {
  configurar(t);
  t.mock.method(global, 'fetch', async () => jsonResponse({
    ...ORDER,
    metadata: { ...ORDER.metadata, acadesys_reference: 'ACS-999-incorrecta' },
    updated_at: Date.now(),
  }));
  await assert.rejects(
    () => culqi.consultarOrdenVerificada({ orderId: ORDER_ID }),
    error => error.code === 'CULQI_ORDEN_NO_COINCIDE',
  );
});