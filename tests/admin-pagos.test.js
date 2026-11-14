'use strict';

// C4 del informe de verificación: listado administrativo de transacciones
// online y auditoría por cuota. Solo lectura y siempre dentro de la academia.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simular, secuencia, servir, consultas } = require('./soporte');

const rutas = [['/api/admin/pagos', 'admin-pagos.routes']];
const admin = { id: 1, idAcademia: 4, rol: 'Administrador' };
const fila = {
  IdTransaccion: 31, IdPago: 7, Proveedor: 'CULQI', ReferenciaInterna: 'ACS-7-ref',
  IdOrdenProveedor: 'pref-1', Monto: '150.00', Moneda: 'PEN', Estado: 'PAGO_DUPLICADO',
  CodigoEstadoProveedor: 'approved', FechaCreacion: '2026-11-14T10:00:00.000Z',
  FechaActualizacion: '2026-11-14T10:05:00.000Z', FechaConfirmacion: null, AntiguedadSegundos: 600,
  IdCiclo: 3, Ciclo: 'Semestral San Marcos', Periodo: '2026-11', EstadoCuota: 'Pagado', MontoCuota: '150.00',
  IdUsuario: 10, CodigoUsuario: 'A001', Alumno: 'Alumno Ficticio',
};

test('C4 lista transacciones de la academia con filtros parametrizados y paginación', async t => {
  const fin = secuencia([
    { sql: /SELECT COUNT\(\*\) AS Total FROM PagoTransaccion pt/, params: [4, 3, '2026-11', 'PAGO_DUPLICADO'],
      rows: [{ Total: 1 }], verificar(q) { assert.match(q, /pt\.IdAcademia = \?/); } },
    { sql: /FROM PagoTransaccion pt.*ORDER BY pt\.IdTransaccion DESC LIMIT \? OFFSET \?/,
      params: [4, 3, '2026-11', 'PAGO_DUPLICADO', 20, 40], rows: [fila] },
  ]);
  const pedir = await servir(t, rutas, admin);
  const r = await pedir('GET', '/api/admin/pagos/transacciones?idCiclo=3&periodo=2026-11&estado=pago_duplicado&limite=20&desde=40');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.paginacion, { total: 1, limite: 20, desde: 40 });
  const [tx] = r.body.transacciones;
  assert.equal(tx.metodo, 'Culqi'); assert.equal(tx.monto, 150); assert.equal(tx.periodo, '2026-11');
  assert.equal(tx.requiereRevision, true); assert.match(tx.motivoRevision, /devolución/);
  fin();
});

test('C4 filtro REQUIERE_REVISION usa estados fijos, sin texto del usuario en el SQL', async t => {
  const fin = secuencia([
    { sql: /COUNT/, params: [4, 'Inscripcion'], rows: [{ Total: 0 }],
      verificar(q) { assert.match(q, /'PAGO_DUPLICADO', 'REEMBOLSADA', 'CONTRACARGO'/); assert.doesNotMatch(q, /requiere/i); } },
    { sql: /LIMIT \? OFFSET \?/, params: [4, 'Inscripcion', 50, 0], rows: [] },
  ]);
  const pedir = await servir(t, rutas, admin);
  const r = await pedir('GET', '/api/admin/pagos/transacciones?estado=requiere_revision&periodo=inscripcion');
  assert.equal(r.status, 200); assert.deepEqual(r.body.transacciones, []);
  fin();
});

test('C4 rechaza filtros inválidos sin consultar la base', async t => {
  simular();
  const pedir = await servir(t, rutas, admin);
  for (const q of ['idCiclo=abc', 'periodo=2026-13', 'estado=PAGADO', 'limite=500', 'desde=-1', "estado=x'%20OR%201=1"]) {
    const r = await pedir('GET', '/api/admin/pagos/transacciones?' + q);
    assert.equal(r.status, 400, q); assert.equal(r.body.code, 'FILTROS_INVALIDOS');
  }
  assert.equal(consultas.length, 0);
});

test('C4 solo administradores consultan transacciones', async t => {
  simular();
  const pedir = await servir(t, rutas, { id: 10, idAcademia: 4, rol: 'Alumno' });
  assert.equal((await pedir('GET', '/api/admin/pagos/transacciones')).status, 403);
  assert.equal(consultas.length, 0);
});

test('C4 auditoría de una cuota exige que pertenezca a la academia y traduce eventos del proveedor', async t => {
  const fin = secuencia([
    { sql: /FROM PagosMensualidad p/, params: [7, 4], rows: [{ IdPago: 7 }] },
    { sql: /FROM PagoAuditoria WHERE IdPago = \? AND IdAcademia = \?/, params: [7, 4], rows: [
      { IdAuditoria: 2, IdComprobante: null, IdUsuarioActor: null, Evento: 'MERCADOPAGO_EVENTO', EstadoAnterior: 'PENDIENTE',
        EstadoNuevo: 'APROBADA', MontoAnterior: '150.00', MontoNuevo: '150.00',
        Motivo: JSON.stringify({ v: 1, transaccion: 31, pago: '123', preferencia: 'pref-1', actualizado: 1, estado: 'approved' }),
        FechaCreacion: '2026-11-14T10:05:00.000Z' },
      { IdAuditoria: 1, IdComprobante: 5, IdUsuarioActor: 1, Evento: 'COMPROBANTE_APROBADO', EstadoAnterior: 'Pendiente',
        EstadoNuevo: 'Pagado', MontoAnterior: null, MontoNuevo: '150.00', Motivo: 'Revisión manual', FechaCreacion: '2026-11-13T10:00:00.000Z' },
    ] },
  ]);
  const pedir = await servir(t, rutas, admin);
  const r = await pedir('GET', '/api/admin/pagos/7/auditoria');
  assert.equal(r.status, 200);
  assert.equal(r.body.eventos[0].automatico, true); assert.match(r.body.eventos[0].motivo, /approved/);
  assert.equal(r.body.eventos[1].automatico, false); assert.equal(r.body.eventos[1].montoAnterior, null);
  fin();
});

test('C4 auditoría de una cuota de otra academia responde 404', async t => {
  const fin = secuencia([{ sql: /FROM PagosMensualidad p/, params: [8, 4], rows: [] }]);
  const pedir = await servir(t, rutas, admin);
  assert.equal((await pedir('GET', '/api/admin/pagos/8/auditoria')).status, 404);
  fin();
});
