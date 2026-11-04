'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { baseSimulada, entorno, proveedorSimulado, firma, servir, referencia } = require('./mercadopago-soporte');
const checkout = '/api/alumno/pagos/7/checkout';
const estado = '/api/alumno/pagos/7/estado';
const webhook = '/api/webhooks/mercadopago?data.id=123&type=payment';
const sesion = { authorization: 'sesion-ficticia' };

async function preparar(t, seed = true) {
  entorno(t);
  const db = baseSimulada(); if (seed) db.seed();
  const mp = proveedorSimulado(t);
  const http = await servir(t, db);
  const notificar = (headers = firma(), body = { type: 'payment', data: { id: '123' } }) =>
    http('POST', webhook, { headers, body });
  return { db, mp, http, notificar };
}
const eventos = (db, nombre) => db.state.auditorias.filter(a => a.Evento === nombre);

test('MP checkout toma monto de BD, crea una preferencia y conserva cuota pendiente', async t => {
  const { db, mp, http } = await preparar(t, false);
  const r = await http('POST', checkout, { headers: sesion, body: { monto: 1, moneda: 'USD', estado: 'approved', idUsuario: 99 } });
  assert.equal(r.status, 201); assert.equal(r.body.monto, 150); assert.equal(r.body.moneda, 'PEN');
  assert.equal(db.state.cuota.Estado, 'Pendiente'); assert.equal(db.state.auditorias.length, 0);
  assert.equal(db.state.transacciones[0].IdOrdenProveedor, 'pref-1');
  assert.equal(mp.llamadas[1].body.items[0].unit_price, 150);
});

test('MP checkout repetido reutiliza intento y no llama al proveedor', async t => {
  const { db, mp, http } = await preparar(t);
  const r = await http('POST', checkout, { headers: sesion });
  assert.equal(r.status, 200); assert.equal(r.body.reutilizada, true);
  assert.equal(db.state.transacciones.length, 1); assert.equal(mp.llamadas.length, 0);
});

test('MP checkouts concurrentes reservan una sola transacción y una sola preferencia', async t => {
  const { db, mp, http } = await preparar(t, false);
  const resultados = await Promise.all([http('POST', checkout, { headers: sesion }), http('POST', checkout, { headers: sesion })]);
  assert.ok(resultados.some(r => r.status === 201));
  assert.ok(resultados.every(r => [200, 201, 409].includes(r.status)));
  assert.equal(db.state.transacciones.length, 1);
  assert.equal(mp.llamadas.filter(r => r.method === 'POST').length, 1);
});

test('MP cuota ajena, pagada y ausencia de sesión no crean transacciones', async t => {
  const { db, mp, http } = await preparar(t, false);
  assert.equal((await http('POST', checkout)).status, 401);
  assert.equal((await http('POST', checkout, { headers: { ...sesion, 'x-usuario': '99' } })).status, 404);
  assert.equal((await http('POST', checkout, { headers: { ...sesion, 'x-rol': 'Docente' } })).status, 403);
  db.state.cuota.Estado = 'Pagado';
  assert.equal((await http('POST', checkout, { headers: sesion })).body.code, 'CUOTA_YA_PAGADA');
  assert.equal(db.state.transacciones.length, 0); assert.equal(mp.llamadas.length, 0);
});

test('MP configuración ausente retorna 503 sin reservar ni modificar la cuota', async t => {
  const { db, mp, http } = await preparar(t, false); delete process.env.MERCADOPAGO_ACCESS_TOKEN;
  const r = await http('POST', checkout, { headers: sesion });
  assert.equal(r.status, 503); assert.equal(r.body.code, 'PASARELA_NO_CONFIGURADA');
  assert.equal(db.state.transacciones.length, 0); assert.equal(db.state.cuota.Estado, 'Pendiente');
  assert.equal(db.queries.length, 0);
  assert.equal(mp.llamadas.length, 0);
});

test('MP sin credenciales no devuelve un checkout existente ni toca la BD', async t => {
  const { db, mp, http } = await preparar(t);
  const inicial = structuredClone(db.state);
  for (const nombre of ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET', 'MERCADOPAGO_SELLER_ID']) {
    const anterior = process.env[nombre]; delete process.env[nombre];
    const r = await http('POST', checkout, { headers: sesion });
    assert.equal(r.status, 503); assert.equal(r.body.code, 'PASARELA_NO_CONFIGURADA');
    assert.equal(r.body.checkoutUrl, undefined);
    process.env[nombre] = anterior;
  }
  assert.deepEqual(db.state, inicial);
  assert.equal(db.queries.length, 0); assert.equal(mp.llamadas.length, 0);
  const disponible = await http('POST', checkout, { headers: sesion });
  assert.equal(disponible.status, 200); assert.equal(disponible.body.reutilizada, true);
  assert.equal(disponible.body.checkoutUrl, inicial.transacciones[0].UrlCheckout);
  assert.deepEqual(db.state, inicial); assert.equal(mp.llamadas.length, 0);
});

test('MP deshabilitado no depende de consultar el esquema de pagos', async t => {
  const { db, mp, http } = await preparar(t, false);
  for (const nombre of ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET', 'MERCADOPAGO_SELLER_ID']) delete process.env[nombre];
  db.fault = () => { throw new Error('La tabla de pagos no está disponible en esta simulación'); };
  const r = await http('POST', checkout, { headers: sesion });
  assert.equal(r.status, 503); assert.equal(r.body.code, 'PASARELA_NO_CONFIGURADA');
  assert.equal(db.state.cuota.Estado, 'Pendiente'); assert.equal(db.state.transacciones.length, 0);
  assert.equal(db.queries.length, 0); assert.equal(mp.llamadas.length, 0);
});

test('MP error ambiguo mantiene CREANDO y bloquea un segundo POST al proveedor', async t => {
  const { db, mp, http } = await preparar(t, false);
  mp.responder = req => { if (req.method === 'POST') throw new Error('conexión interrumpida'); };
  assert.equal((await http('POST', checkout, { headers: sesion })).status, 502);
  assert.equal(db.state.transacciones[0].Estado, 'CREANDO');
  assert.equal((await http('POST', checkout, { headers: sesion })).body.code, 'CHECKOUT_EN_PREPARACION');
  assert.equal(mp.llamadas.filter(r => r.method === 'POST').length, 1);
});

test('MP fallo al persistir preferencia no filtra SQL ni permite otro checkout', async t => {
  const { db, mp, http } = await preparar(t, false);
  db.fault = q => { if (q.startsWith('UPDATE PagoTransaccion SET IdOrdenProveedor')) throw new Error('SQL secreto simulado'); };
  const r = await http('POST', checkout, { headers: sesion });
  assert.equal(r.status, 500); assert.ok(!JSON.stringify(r.body).includes('SQL secreto'));
  assert.equal(db.state.transacciones[0].Estado, 'CREANDO');
  db.fault = null;
  assert.equal((await http('POST', checkout, { headers: sesion })).status, 409);
  assert.equal(mp.llamadas.filter(r => r.method === 'POST').length, 1);
});

test('MP una preferencia pendiente no se reutiliza si cambia el importe en BD', async t => {
  const { db, mp, http } = await preparar(t); db.state.cuota.Monto = '160.00';
  const r = await http('POST', checkout, { headers: sesion });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'CHECKOUT_IMPORTE_CAMBIADO');
  assert.equal(mp.llamadas.length, 0);
});

test('MP regreso del checkout y parámetros de React no confirman ni consultan al proveedor', async t => {
  const { db, mp, http } = await preparar(t);
  const r = await http('GET', estado + '?status=approved&payment_id=123&collection_status=approved', { headers: sesion });
  assert.equal(r.status, 200); assert.equal(r.body.estadoPago, 'Pendiente');
  assert.equal(db.state.cuota.Estado, 'Pendiente'); assert.equal(db.state.auditorias.length, 0);
  assert.equal(mp.llamadas.length, 0);
  assert.equal((await http('GET', estado, { headers: { ...sesion, 'x-usuario': '99' } })).status, 404);
});

test('MP webhook válido sin JWT confirma cuota y auditoría después del COMMIT', async t => {
  const { db, notificar } = await preparar(t);
  const r = await notificar();
  assert.equal(r.status, 200); assert.equal(r.body.confirmada, true);
  assert.equal(db.commits, 1); assert.equal(db.releases, 1);
  assert.equal(db.state.cuota.Estado, 'Pagado'); assert.equal(db.state.transacciones[0].Estado, 'APROBADA');
  assert.equal(eventos(db, 'PAGO_MERCADOPAGO_CONFIRMADO').length, 1);
  const recibo = JSON.parse(eventos(db, 'MERCADOPAGO_EVENTO')[0].Motivo);
  assert.equal(recibo.pago, '123'); assert.equal(recibo.preferencia, 'pref-1');
});

test('MP webhook inválido no consulta al proveedor ni escribe en BD', async t => {
  const { db, mp, notificar } = await preparar(t);
  const r = await notificar({ 'x-signature': 'ts=1,v1=invalida', 'x-request-id': 'falso' });
  assert.equal(r.status, 401); assert.equal(db.queries.length, 0); assert.equal(mp.llamadas.length, 0);
});

test('MP webhook repetido conserva fecha y una sola confirmación', async t => {
  const { db, notificar } = await preparar(t);
  assert.equal((await notificar()).status, 200);
  const copia = structuredClone(db.state);
  const r = await notificar(); assert.equal(r.status, 200); assert.equal(r.body.idempotente, true);
  assert.deepEqual(db.state, copia);
});

for (const [status, esperado] of [['pending', 'PENDIENTE'], ['in_process', 'PENDIENTE'], ['authorized', 'PENDIENTE'],
  ['rejected', 'RECHAZADA'], ['cancelled', 'CANCELADA']]) {
  test(`MP pago ${status} nunca confirma mensualidad`, async t => {
    const { db, mp, notificar } = await preparar(t); mp.pago.status = status;
    const r = await notificar(); assert.equal(r.status, 200);
    assert.equal(db.state.cuota.Estado, 'Pendiente'); assert.equal(db.state.transacciones[0].Estado, esperado);
    assert.equal(eventos(db, 'PAGO_MERCADOPAGO_CONFIRMADO').length, 0);
    assert.equal(eventos(db, 'MERCADOPAGO_EVENTO').length, 1);
  });
}

test('MP pendiente luego aprobado actualiza la misma cuota una sola vez', async t => {
  const { db, mp, notificar } = await preparar(t); const fecha = Date.now() - 2000;
  mp.pago.status = 'pending'; mp.pago.date_last_updated = new Date(fecha).toISOString();
  assert.equal((await notificar()).status, 200);
  mp.pago.status = 'approved'; mp.pago.date_last_updated = new Date(fecha + 1000).toISOString();
  assert.equal((await notificar()).status, 200);
  assert.equal(db.state.cuota.Estado, 'Pagado'); assert.equal(eventos(db, 'PAGO_MERCADOPAGO_CONFIRMADO').length, 1);
});

test('MP dos notificaciones simultáneas del mismo pago solo confirman una vez', async t => {
  const { db, notificar } = await preparar(t);
  const resultados = await Promise.all([notificar(), notificar()]);
  assert.deepEqual(resultados.map(r => r.status), [200, 200]);
  assert.equal(resultados.filter(r => r.body.idempotente).length, 1);
  assert.equal(eventos(db, 'PAGO_MERCADOPAGO_CONFIRMADO').length, 1);
  assert.equal(eventos(db, 'MERCADOPAGO_EVENTO').length, 1);
});

test('MP evento atrasado no sobrescribe una aprobación ni añade auditoría duplicada', async t => {
  const { db, mp, notificar } = await preparar(t);
  assert.equal((await notificar()).status, 200);
  const copia = structuredClone(db.state);
  mp.pago.status = 'pending'; mp.pago.date_last_updated = new Date(Date.parse(mp.pago.date_last_updated) - 1000).toISOString();
  const r = await notificar(); assert.equal(r.status, 200); assert.equal(r.body.atrasada, true);
  assert.deepEqual(db.state, copia);
});

test('MP otro estado con misma versión se rechaza sin sobrescribir', async t => {
  const { db, mp, notificar } = await preparar(t); await notificar();
  const copia = structuredClone(db.state); mp.pago.status = 'pending';
  assert.equal((await notificar()).status, 409); assert.deepEqual(db.state, copia);
});

test('MP consultas concurrentes que terminan en orden inverso conservan la versión más reciente', async t => {
  const { db, mp, notificar } = await preparar(t);
  const pendiente = { ...mp.pago, status: 'pending', date_last_updated: new Date(Date.now() - 5000).toISOString() };
  let liberar, aviso;
  const bloqueada = new Promise(resolve => { liberar = resolve; });
  const iniciada = new Promise(resolve => { aviso = resolve; });
  let primera = true;
  mp.responder = async req => {
    if (req.path === '/v1/payments/123' && primera) {
      primera = false; aviso(); await bloqueada;
      return new Response(JSON.stringify(pendiente), { status: 200 });
    }
  };
  const atrasada = notificar();
  await iniciada;
  try { assert.equal((await notificar()).status, 200); } finally { liberar(); }
  const r = await atrasada; assert.equal(r.status, 200); assert.equal(r.body.atrasada, true);
  assert.equal(db.state.cuota.Estado, 'Pagado');
  assert.equal(eventos(db, 'MERCADOPAGO_EVENTO').length, 1);
});

for (const [destino, campo, valor, esperado] of [
  ['pago', 'transaction_amount', 1, 502], ['pago', 'currency_id', 'USD', 502],
  ['pago', 'external_reference', 'otra', 502], ['pago', 'collector_id', 901, 502],
  ['pago', 'live_mode', true, 502], ['tx', 'Monto', '140.00', 409], ['cuota', 'Monto', '160.00', 409],
  ['tx', 'IdOrdenProveedor', 'ajena', 409], ['tx', 'IdUsuario', 99, 409], ['tx', 'IdAcademia', 99, 409],
]) {
  test(`MP webhook inconsistente ${destino}.${campo} no confirma`, async t => {
    const { db, mp, notificar } = await preparar(t);
    const objeto = destino === 'pago' ? mp.pago : destino === 'tx' ? db.state.transacciones[0] : db.state.cuota;
    objeto[campo] = valor;
    const r = await notificar(); assert.equal(r.status, esperado);
    assert.equal(db.state.cuota.Estado, 'Pendiente'); assert.equal(db.state.auditorias.length, 0);
  });
}

test('MP metadata de otra transacción y referencia desconocida se rechazan', async t => {
  const { db, mp, notificar } = await preparar(t);
  mp.preferencia.metadata.acadesys_transaction_id = '999';
  assert.equal((await notificar()).status, 409);
  mp.preferencia.metadata.acadesys_transaction_id = '1';
  const otra = referencia.replace('ACS-7-', 'ACS-8-');
  mp.pago.external_reference = otra; mp.orden.external_reference = otra; mp.preferencia.external_reference = otra;
  assert.equal((await notificar()).status, 404); assert.equal(db.state.cuota.Estado, 'Pendiente');
});

test('MP aprobación llega antes de guardar preferencia: vincula solo CREANDO con metadata verificada', async t => {
  const { db, notificar } = await preparar(t);
  Object.assign(db.state.transacciones[0], { Estado: 'CREANDO', IdOrdenProveedor: null, UrlCheckout: null });
  assert.equal((await notificar()).status, 200);
  assert.equal(db.state.transacciones[0].IdOrdenProveedor, 'pref-1');
  assert.equal(db.state.cuota.Estado, 'Pagado');
});

test('MP comprobante manual ya aprobado conserva cuota y audita pago adicional una vez', async t => {
  const { db, notificar } = await preparar(t);
  db.state.cuota.Estado = 'Pagado'; db.state.cuota.FechaPago = 'fecha-manual';
  assert.equal((await notificar()).body.pagoDuplicado, true);
  assert.equal((await notificar()).body.idempotente, true);
  assert.equal(db.state.cuota.FechaPago, 'fecha-manual');
  assert.equal(db.state.transacciones[0].Estado, 'PAGO_DUPLICADO');
  assert.equal(eventos(db, 'PAGO_DUPLICADO_PROVEEDOR').length, 1);
  assert.equal(eventos(db, 'PAGO_MERCADOPAGO_CONFIRMADO').length, 0);
});

for (const punto of ['UPDATE PagosMensualidad', 'UPDATE PagoTransaccion SET Estado = ?',
  'PAGO_MERCADOPAGO_CONFIRMADO', 'MERCADOPAGO_EVENTO', 'COMMIT']) {
  test(`MP rollback completo y reintento cuando falla ${punto}`, async t => {
    const { db, notificar } = await preparar(t); const inicial = structuredClone(db.state);
    db.fault = (q, p) => { if (q.startsWith(punto) || p.includes(punto)) throw new Error('fallo SQL privado'); };
    const r = await notificar(); assert.equal(r.status, 503); assert.equal(r.headers.get('retry-after'), '60');
    assert.ok(!JSON.stringify(r.body).includes('SQL privado'));
    assert.deepEqual(db.state, inicial); assert.ok(db.rollbacks > 0);
    db.fault = null;
    assert.equal((await notificar()).status, 200); assert.equal(db.state.cuota.Estado, 'Pagado');
    assert.equal(eventos(db, 'PAGO_MERCADOPAGO_CONFIRMADO').length, 1);
  });
}

test('MP error temporal de API en webhook no responde éxito ni escribe', async t => {
  const { db, mp, notificar } = await preparar(t);
  mp.responder = () => new Response(JSON.stringify({ status: 503 }), { status: 503 });
  assert.equal((await notificar()).status, 502); assert.equal(db.state.cuota.Estado, 'Pendiente');
  assert.equal(db.queries.length, 0);
});

test('MP segundo pago aprobado de la misma preferencia se audita como duplicado', async t => {
  const { db, mp, http, notificar } = await preparar(t);
  assert.equal((await notificar()).status, 200);
  mp.pago.id = 124; mp.orden.payments.push({ id: 124 });
  const enviar = () => http('POST', webhook.replace('data.id=123', 'data.id=124'), {
    headers: firma({ id: '124' }), body: { type: 'payment', data: { id: '124' } },
  });
  const r = await enviar(); assert.equal(r.status, 200); assert.equal(r.body.pagoDuplicado, true);
  assert.equal((await enviar()).body.idempotente, true);
  assert.equal(db.state.transacciones[0].Estado, 'APROBADA');
  assert.equal(eventos(db, 'PAGO_MERCADOPAGO_CONFIRMADO').length, 1);
  assert.equal(eventos(db, 'PAGO_DUPLICADO_PROVEEDOR').length, 1);
});

test('MP rechazo permite reutilizar preferencia; otro payment_id válido puede aprobar', async t => {
  const { db, mp, http, notificar } = await preparar(t); mp.pago.status = 'rejected';
  await notificar();
  assert.equal((await http('POST', checkout, { headers: sesion })).body.reutilizada, true);
  assert.equal(mp.llamadas.filter(r => r.method === 'POST').length, 0);
  mp.pago.id = 124; mp.pago.status = 'approved'; mp.orden.payments.push({ id: 124 });
  mp.pago.date_last_updated = new Date(Date.now()).toISOString();
  const r = await http('POST', webhook.replace('data.id=123', 'data.id=124'), {
    headers: firma({ id: '124' }), body: { type: 'payment', data: { id: '124' } },
  });
  assert.equal(r.status, 200); assert.equal(db.state.cuota.Estado, 'Pagado');
});

test('MP código de proveedor refleja in_process aunque estado interno siga PENDIENTE', async t => {
  const { db, mp, notificar } = await preparar(t); mp.pago.status = 'pending';
  await notificar();
  mp.pago.status = 'in_process'; mp.pago.date_last_updated = new Date(Date.now()).toISOString();
  assert.equal((await notificar()).status, 200);
  assert.equal(db.state.transacciones[0].CodigoEstadoProveedor, 'in_process');
});

for (const punto of ['UPDATE PagosMensualidad', 'UPDATE PagoTransaccion SET Estado = ?', 'INSERT INTO PagoAuditoria']) {
  test(`MP affectedRows=0 en ${punto} no acusa éxito y revierte`, async t => {
    const { db, notificar } = await preparar(t); const inicial = structuredClone(db.state);
    db.fault = q => q.startsWith(punto) ? [{ affectedRows: 0 }] : null;
    const r = await notificar(); assert.ok(r.status >= 400);
    assert.deepEqual(db.state, inicial);
  });
}

test('MP guardar respuesta tardía de creación no degrada aprobación ni sustituye preferencia', async t => {
  const { db, notificar } = await preparar(t); await notificar();
  const servicio = require('../services/transacciones-pago.service');
  const datos = { idTransaccion: 1, idOrdenProveedor: 'pref-1', checkoutUrl: db.state.transacciones[0].UrlCheckout };
  await servicio.guardarOrdenCreada(datos);
  assert.equal(db.state.transacciones[0].Estado, 'APROBADA');
  assert.equal(db.state.transacciones[0].CodigoEstadoProveedor, 'approved');
  await assert.rejects(servicio.guardarOrdenCreada({ ...datos, idOrdenProveedor: 'otra' }), { code: 'ORDEN_NO_GUARDADA' });
  assert.equal(db.state.transacciones[0].IdOrdenProveedor, 'pref-1');
});

for (const status of ['refunded', 'charged_back']) {
  test(`MP ${status} posterior conserva cuota y genera revisión auditada`, async t => {
    const { db, mp, notificar } = await preparar(t); await notificar();
    mp.pago.status = status; mp.pago.date_last_updated = new Date(Date.now()).toISOString();
    const r = await notificar(); assert.equal(r.status, 200); assert.equal(r.body.requiereRevision, true);
    assert.equal(db.state.cuota.Estado, 'Pagado'); assert.equal(db.state.transacciones[0].Estado, 'APROBADA');
    assert.equal(eventos(db, 'MERCADOPAGO_REQUIERE_REVISION').length, 1);
  });
}
