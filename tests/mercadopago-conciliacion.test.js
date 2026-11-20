'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

// Configuración exclusivamente ficticia para pruebas aisladas. Nunca conecta con Mercado Pago.
Object.assign(process.env, {
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
});

const { simular, secuencia, servir, consultas, eventos } = require('./soporte');
const { ErrorPago } = require('../utils/pagos-proveedor');

const ORDER_ID = 'ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9';
const REFERENCE = 'ACS-7-11111111-1111-4111-8111-111111111111';
const llamadasProveedor = [];
let ordenSimulada;
let proveedorConfigurado = true;

// Doble del adaptador: estas pruebas verifican la coordinación y persistencia,
// mientras mercadopago-adapter.test.js verifica la comunicación del adaptador.
const adapterPath = require.resolve('../services/mercadopago.adapter');
require.cache[adapterPath] = {
  id: adapterPath,
  filename: adapterPath,
  loaded: true,
  exports: {
    verificarConfiguracion() {
      if (!proveedorConfigurado) {
        throw new ErrorPago(503, 'MERCADOPAGO_NO_CONFIGURADO', 'Credenciales de prueba ausentes.');
      }
    },
    async consultarOrdenVerificada({ orderId, referenciaInterna }) {
      llamadasProveedor.push({ orderId, referenciaInterna });
      return ordenSimulada;
    },
  },
};

const tx = require('../services/transacciones-pago.service');
const originales = {
  confirmar: tx.confirmarPagoProveedor,
  actualizar: tx.actualizarEstadoNoAprobado,
  obtenerReferencia: tx.obtenerReferenciaConciliable,
};
const aplicadas = [];
tx.confirmarPagoProveedor = async (pago) => {
  aplicadas.push(['confirmar', pago.idOrdenProveedor]);
  return { confirmada: true };
};
tx.actualizarEstadoNoAprobado = async (pago) => {
  aplicadas.push(['actualizar', pago.estado]);
  return { confirmada: false };
};

const conciliacion = require('../services/conciliacion-pagos.service');

function pagoProveedor(estadoProveedor, estado, referenciaInterna = REFERENCE) {
  return {
    proveedor: 'MERCADOPAGO',
    referenciaInterna,
    idOrdenProveedor: ORDER_ID,
    idPagoProveedor: ORDER_ID,
    idTransaccion: 31,
    idPago: 7,
    monto: 150,
    moneda: 'PEN',
    estadoProveedor,
    estado,
    fechaActualizacionProveedor: 1795176300000,
  };
}

function reiniciar() {
  llamadasProveedor.length = 0;
  aplicadas.length = 0;
  proveedorConfigurado = true;
  conciliacion._ultimas.clear();
}

test('conciliación Mercado Pago acredita solo después de consultar la Order guardada', async () => {
  reiniciar();
  ordenSimulada = pagoProveedor('processed:accredited', 'APROBADA');

  const resultado = await conciliacion.conciliarReferencia({
    referenciaInterna: REFERENCE,
    idOrdenProveedor: ORDER_ID,
  });

  assert.deepEqual(llamadasProveedor, [{ orderId: ORDER_ID, referenciaInterna: REFERENCE }]);
  assert.deepEqual(aplicadas, [['confirmar', ORDER_ID]]);
  assert.equal(resultado.confirmada, true);
  assert.equal(resultado.pagosEncontrados, 1);
});

test('conciliación Mercado Pago no marca como pagada una Order pendiente o rechazada', async () => {
  reiniciar();
  ordenSimulada = pagoProveedor('failed:cc_rejected', 'RECHAZADA');

  const resultado = await conciliacion.conciliarReferencia({
    referenciaInterna: REFERENCE,
    idOrdenProveedor: ORDER_ID,
  });

  assert.equal(resultado.confirmada, false);
  assert.deepEqual(aplicadas, [['actualizar', 'RECHAZADA']]);
});

test('conciliación rechaza una Order que pertenece a otra referencia de AcadeSys', async () => {
  reiniciar();
  ordenSimulada = pagoProveedor('processed:accredited', 'APROBADA', 'ACS-8-22222222-2222-4222-8222-222222222222');

  await assert.rejects(
    conciliacion.conciliarReferencia({ referenciaInterna: REFERENCE, idOrdenProveedor: ORDER_ID }),
    (error) => error.code === 'MERCADOPAGO_ORDEN_NO_COINCIDE',
  );
  assert.equal(aplicadas.length, 0);
});

test('conciliación administrativa se limita a la transacción de la academia', async (t) => {
  reiniciar();
  ordenSimulada = pagoProveedor('processed:accredited', 'APROBADA');
  tx.obtenerReferenciaConciliable = async ({ idTransaccion, idAcademia }) => {
    if (idAcademia !== 4 || Number(idTransaccion) !== 31) return null;
    return {
      idTransaccion: 31,
      idPago: 7,
      referenciaInterna: REFERENCE,
      idOrdenProveedor: ORDER_ID,
      estado: 'PENDIENTE',
    };
  };

  const pedir = await servir(t, [['/api/admin/pagos', 'admin-pagos.routes']], {
    id: 1,
    idAcademia: 4,
    rol: 'Administrador',
  });

  const respuesta = await pedir('POST', '/api/admin/pagos/transacciones/31/conciliar');
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.body.confirmada, true);

  conciliacion._ultimas.clear();
  const ajena = await pedir('POST', '/api/admin/pagos/transacciones/99/conciliar');
  assert.equal(ajena.status, 404);
});

test('sin credenciales del proveedor, la conciliación administrativa responde 503 sin consultar MySQL', async (t) => {
  reiniciar();
  proveedorConfigurado = false;
  simular();
  const pedir = await servir(t, [['/api/admin/pagos', 'admin-pagos.routes']], {
    id: 1,
    idAcademia: 4,
    rol: 'Administrador',
  });

  const respuesta = await pedir('POST', '/api/admin/pagos/transacciones/31/conciliar');
  assert.equal(respuesta.status, 503);
  assert.equal(consultas.length, 0);
  assert.equal(llamadasProveedor.length, 0);
});

test('un comprobante manual en revisión bloquea el checkout online', async () => {
  const fin = secuencia([
    {
      sql: /FROM PagosMensualidad p .*FOR UPDATE/,
      params: [7, 10, 1],
      rows: [{ IdPago: 7, IdUsuario: 10, IdCiclo: 3, Mes: '2026-11', Monto: '150.00', Estado: 'Pendiente', IdAcademia: 1 }],
    },
    {
      sql: /FROM PagoComprobante .*EN_REVISION/,
      params: [7, 10, 1],
      rows: [{ IdComprobante: 5 }],
    },
  ]);

  await assert.rejects(
    tx.reservarCheckoutAlumno({ idPago: 7, idUsuario: 10, idAcademia: 1 }),
    (error) => error.code === 'COMPROBANTE_EN_REVISION' && error.status === 409,
  );
  assert.ok(eventos.includes('rollback'));
  assert.ok(!eventos.includes('commit'));
  fin();
});

test('una reserva CREANDO sin Order durante el plazo configurado se descarta y se reemplaza', async () => {
  const pasos = [
    {
      sql: /FROM PagosMensualidad p .*FOR UPDATE/,
      rows: [{ IdPago: 7, IdUsuario: 10, IdCiclo: 3, Mes: '2026-11', Monto: '150.00', Estado: 'Pendiente', IdAcademia: 1, Nombres: 'A' }],
    },
    { sql: /FROM PagoComprobante/, rows: [] },
    {
      sql: /FROM PagoTransaccion .*FOR UPDATE/,
      params: [7, 10, 1, 'MERCADOPAGO'],
      rows: [{
        IdTransaccion: 30,
        IdPago: 7,
        ReferenciaInterna: 'ACS-7-vieja',
        IdOrdenProveedor: null,
        Monto: '150.00',
        Moneda: 'PEN',
        Estado: 'CREANDO',
        AntiguedadSegundos: 300,
      }],
    },
  ];
  const vistas = [];
  simular((sql, params) => {
    vistas.push(sql);
    const paso = pasos.shift();
    if (paso) {
      assert.match(sql, paso.sql);
      if (paso.params) assert.deepEqual(params, paso.params);
      return [paso.rows];
    }
    if (/^INSERT INTO PagoTransaccion/.test(sql)) return [{ insertId: 32 }];
    return [{ affectedRows: 1 }];
  });

  const resultado = await tx.reservarCheckoutAlumno({ idPago: 7, idUsuario: 10, idAcademia: 1 });
  assert.equal(resultado.idTransaccion, 32);
  assert.equal(resultado.estado, 'CREANDO');
  assert.ok(vistas.some((sql) => /UPDATE PagoTransaccion/.test(sql)));
  assert.ok(eventos.includes('commit'));
});

after(() => {
  tx.confirmarPagoProveedor = originales.confirmar;
  tx.actualizarEstadoNoAprobado = originales.actualizar;
  tx.obtenerReferenciaConciliable = originales.obtenerReferencia;
});
