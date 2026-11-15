'use strict';

// Conciliación con Culqi: consulta la orden
// guardada en BD, nunca datos del navegador, y reutiliza la misma
// verificación que el webhook.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { secuencia, simular, servir, consultas, eventos } = require('./soporte');

const rutaCulqi = require.resolve('../services/culqi.adapter');
const llamadas = [];
let ordenSimulada;
let configurada = true;
const { ErrorPago } = require('../utils/pagos-proveedor');
require.cache[rutaCulqi] = { id: rutaCulqi, filename: rutaCulqi, loaded: true, exports: {
  verificarConfiguracion() {
    if (!configurada) throw new ErrorPago(503, 'PASARELA_NO_CONFIGURADA', 'Culqi no está configurado.');
  },
  async consultarOrdenVerificada({ orderId }) { llamadas.push(orderId); return ordenSimulada; },
} };
const rutaTx = require.resolve('../services/transacciones-pago.service');
const tx = require(rutaTx);
const aplicadas = [];
const real = { confirmar: tx.confirmarPagoProveedor, actualizar: tx.actualizarEstadoNoAprobado };
tx.confirmarPagoProveedor = async (p) => { aplicadas.push(['confirmar', p.idOrdenProveedor]); return { confirmada: true }; };
tx.actualizarEstadoNoAprobado = async (p) => { aplicadas.push(['actualizar', p.estado]); return { confirmada: false }; };
const conciliacion = require('../services/conciliacion-pagos.service');

const ref = 'ACS-7-11111111-1111-4111-8111-111111111111';
const orden = (estadoProveedor, estado, referenciaInterna = ref) => ({ proveedor: 'CULQI', referenciaInterna,
  idOrdenProveedor: 'ord_test_abcdefgh12', idPagoProveedor: 'ord_test_abcdefgh12', idTransaccion: 31, idPago: 7,
  monto: 150, moneda: 'PEN', estadoProveedor, estado, fechaActualizacionProveedor: 1 });
function reiniciar() { llamadas.length = 0; aplicadas.length = 0; configurada = true; conciliacion._ultimas.clear(); }

test('conciliación Culqi confirma una orden pagada con la orden guardada en BD', async () => {
  reiniciar(); ordenSimulada = orden('paid', 'APROBADA');
  const r = await conciliacion.conciliarReferencia({ referenciaInterna: ref, idOrdenProveedor: 'ord_test_abcdefgh12' });
  assert.deepEqual(llamadas, ['ord_test_abcdefgh12']);
  assert.deepEqual(aplicadas, [['confirmar', 'ord_test_abcdefgh12']]);
  assert.equal(r.confirmada, true); assert.equal(r.pagosEncontrados, 1);
});

test('una orden expirada no confirma y una orden ajena se rechaza', async () => {
  reiniciar(); ordenSimulada = orden('expired', 'EXPIRADA');
  const r = await conciliacion.conciliarReferencia({ referenciaInterna: ref, idOrdenProveedor: 'ord_test_abcdefgh12' });
  assert.equal(r.confirmada, false); assert.deepEqual(aplicadas, [['actualizar', 'EXPIRADA']]);
  ordenSimulada = orden('paid', 'APROBADA', 'ACS-8-otra');
  await assert.rejects(conciliacion.conciliarReferencia({ referenciaInterna: ref, idOrdenProveedor: 'ord_test_abcdefgh12' }),
    (e) => e.code === 'CULQI_ORDEN_NO_COINCIDE');
  assert.equal(aplicadas.length, 1);
});

const filaRef = { IdTransaccion: 31, IdPago: 7, ReferenciaInterna: ref, IdOrdenProveedor: 'ord_test_abcdefgh12', Estado: 'PENDIENTE' };

test('conciliación administrativa usa Culqi y solo transacciones de la academia', async t => {
  reiniciar(); ordenSimulada = orden('paid', 'APROBADA');
  const pedir = await servir(t, [['/api/admin/pagos', 'admin-pagos.routes']], { id: 1, idAcademia: 4, rol: 'Administrador' });
  let fin = secuencia([{ sql: /FROM PagoTransaccion WHERE .*IdTransaccion = \?/, params: [4, 'CULQI', null, null, 31, 31, null, null], rows: [filaRef] }]);
  let r = await pedir('POST', '/api/admin/pagos/transacciones/31/conciliar');
  assert.equal(r.status, 200); assert.equal(r.body.confirmada, true); fin();
  fin = secuencia([{ sql: /FROM PagoTransaccion/, rows: [] }]);
  conciliacion._ultimas.clear();
  r = await pedir('POST', '/api/admin/pagos/transacciones/99/conciliar');
  assert.equal(r.status, 404); fin();
});

test('conciliación sin credenciales de Culqi responde 503 sin tocar la BD', async t => {
  reiniciar(); configurada = false; simular();
  const pedir = await servir(t, [['/api/admin/pagos', 'admin-pagos.routes']], { id: 1, idAcademia: 4, rol: 'Administrador' });
  const r = await pedir('POST', '/api/admin/pagos/transacciones/31/conciliar');
  assert.equal(r.status, 503); assert.equal(consultas.length, 0); assert.equal(llamadas.length, 0);
});

test('un comprobante en revisión bloquea el checkout Culqi antes de crear la orden', async () => {
  const fin = secuencia([
    { sql: /FROM PagosMensualidad p .*FOR UPDATE/, params: [7, 10, 1], rows: [{ IdPago: 7, IdUsuario: 10, IdCiclo: 3,
      Mes: '2026-11', Monto: '150.00', Estado: 'Pendiente', IdAcademia: 1 }] },
    { sql: /FROM PagoComprobante .*EN_REVISION/, params: [7, 10, 1], rows: [{ IdComprobante: 5 }] },
  ]);
  await assert.rejects(tx.reservarCheckoutAlumno({ idPago: 7, idUsuario: 10, idAcademia: 1 }),
    (e) => e.code === 'COMPROBANTE_EN_REVISION' && e.status === 409);
  assert.ok(eventos.includes('rollback')); assert.ok(!eventos.includes('commit'));
  fin();
});

test('una reserva CREANDO sin orden de más de 2 minutos se descarta y se crea una nueva', async () => {
  const pasos = [
    { sql: /FROM PagosMensualidad p .*FOR UPDATE/, rows: [{ IdPago: 7, IdUsuario: 10, IdCiclo: 3,
      Mes: '2026-11', Monto: '150.00', Estado: 'Pendiente', IdAcademia: 1, Nombres: 'A' }] },
    { sql: /FROM PagoComprobante/, rows: [] },
    { sql: /FROM PagoTransaccion .*FOR UPDATE/, params: [7, 10, 1, 'CULQI'], rows: [{ IdTransaccion: 30, IdPago: 7,
      ReferenciaInterna: 'ACS-7-vieja', IdOrdenProveedor: null, Monto: '150.00', Moneda: 'PEN', Estado: 'CREANDO',
      AntiguedadSegundos: 300 }] },
  ];
  const vistas = [];
  simular((sql, params) => {
    vistas.push(sql);
    const paso = pasos.shift();
    if (paso) { assert.match(sql, paso.sql); if (paso.params) assert.deepEqual(params, paso.params); return [paso.rows]; }
    if (/^INSERT INTO PagoTransaccion/.test(sql)) return [{ insertId: 32 }];
    return [{ affectedRows: 1 }];
  });
  const r = await tx.reservarCheckoutAlumno({ idPago: 7, idUsuario: 10, idAcademia: 1 });
  assert.equal(r.idTransaccion, 32); assert.equal(r.estado, 'CREANDO');
  assert.ok(vistas.some(q => /^UPDATE PagoTransaccion SET Estado = \?/.test(q) || /UPDATE PagoTransaccion/.test(q)));
  assert.ok(eventos.includes('commit'));
});

test.after(() => { tx.confirmarPagoProveedor = real.confirmar; tx.actualizarEstadoNoAprobado = real.actualizar; });
