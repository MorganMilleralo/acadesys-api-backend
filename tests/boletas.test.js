'use strict';

// Boleta electrónica SUNAT: emisión mediante fact_api y descarga desde AcadeSys.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { simular } = require('./soporte');

const PDF = Buffer.from('%PDF-1.4 boleta de prueba');
const XML = Buffer.from('<?xml version="1.0"?><Invoice/>');
const falso = { solicitudes: [], fallarSunat: false, boletasCreadas: 0 };
let servidorFact;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { falso.solicitudes.push(`${req.method} ${req.path}`); next(); });
  app.post('/api/auth/login', (req, res) => {
    if (req.body.email !== 'facturacion@acadesys.pe' || req.body.password !== 'clave-prueba') return res.status(401).json({ message: 'Credenciales inválidas' });
    res.json({ access_token: 'token-1', token_type: 'Bearer' });
  });
  app.use('/api/v1', (req, res, next) => (req.get('authorization') === 'Bearer token-1' ? next() : res.status(401).json({ message: 'Unauthenticated.' })));
  app.post('/api/v1/boletas', (req, res) => {
    falso.ultimaBoleta = req.body;
    falso.boletasCreadas += 1;
    res.status(201).json({ success: true, data: { id: 90, serie: 'B001', correlativo: '00000012', numero_completo: 'B001-00000012' } });
  });
  app.post('/api/v1/boletas/90/send-sunat', (_req, res) => (falso.fallarSunat
    ? res.status(400).json({ success: false, message: 'Error al enviar a SUNAT: servicio no disponible' })
    : res.json({ success: true, data: { estado_sunat: 'ACEPTADO' } })));
  app.post('/api/v1/boletas/90/generate-pdf', (_req, res) => res.json({ success: true }));
  app.get('/api/v1/boletas/90/download-pdf', (_req, res) => res.type('application/pdf').send(PDF));
  app.get('/api/v1/boletas/90/download-xml', (_req, res) => res.type('application/xml').send(XML));
  servidorFact = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  process.env.FACT_API_URL = `http://127.0.0.1:${servidorFact.address().port}`;
  process.env.FACT_API_EMAIL = 'facturacion@acadesys.pe';
  process.env.FACT_API_PASSWORD = 'clave-prueba';
  process.env.FACT_API_AFECTACION_IGV = '10';
});
after(() => new Promise((r) => { servidorFact.close(r); servidorFact.closeAllConnections(); }));
beforeEach(() => { falso.solicitudes.length = 0; falso.fallarSunat = false; falso.boletasCreadas = 0; });

const cuota = {
  IdBoleta: 7, IdPago: 51, IdExterno: null, Monto: '400.00', Moneda: 'PEN', Intentos: 1,
  Mes: '2026-11', Ciclo: 'Veranito San Marcos', DNI: '74125896', Nombres: 'Alexandra',
  ApellidoPaterno: 'Inocente', ApellidoMaterno: 'Rojas', CorreoElectronico: 'alexandra@correo.pe',
};

function baseDeDatos(fila) {
  const llamadas = [];
  simular((sql, params) => {
    llamadas.push({ sql, params });
    if (/CALL sp_boletas_reclamar_emision/.test(sql)) return [fila ? [fila] : []];
    if (/UPDATE BoletaElectronica/.test(sql)) return [{ affectedRows: 1 }];
    throw new Error(`Consulta no prevista: ${sql}`);
  });
  return llamadas;
}

test('emite la boleta: crea, envía a SUNAT y guarda el PDF y el XML en la base de datos', async () => {
  const { emitirBoleta } = require('../services/boletas.service');
  const llamadas = baseDeDatos({ ...cuota });
  const r = await emitirBoleta(51);
  assert.equal(r.emitida, true);
  assert.equal(r.numeroCompleto, 'B001-00000012');
  assert.deepEqual(falso.solicitudes, [
    'POST /api/auth/login', 'POST /api/v1/boletas', 'POST /api/v1/boletas/90/send-sunat',
    'POST /api/v1/boletas/90/generate-pdf', 'GET /api/v1/boletas/90/download-pdf', 'GET /api/v1/boletas/90/download-xml',
  ]);
  assert.equal(falso.ultimaBoleta.client.tipo_documento, '1');
  assert.equal(falso.ultimaBoleta.client.numero_documento, '74125896');
  assert.equal(falso.ultimaBoleta.client.razon_social, 'Alexandra Inocente Rojas');
  assert.equal(falso.ultimaBoleta.detalles[0].descripcion, 'Mensualidad 2026-11 - Veranito San Marcos');
  assert.equal(llamadas[0].params.length, 3);
  for (const v of [7, '90', 'B001', '00000012', 'B001-00000012']) assert.ok(llamadas[1].params.includes(v), `falta ${v}`);
  const emitida = llamadas[2].params;
  assert.ok(emitida.includes('ACEPTADO'));
  assert.ok(emitida.some((p) => Buffer.isBuffer(p) && p.equals(PDF)));
  assert.ok(emitida.some((p) => Buffer.isBuffer(p) && p.equals(XML)));
});

test('si SUNAT falla, la boleta queda en ERROR y el reintento reutiliza la misma boleta', async () => {
  const { emitirBoleta } = require('../services/boletas.service');
  falso.fallarSunat = true;
  let llamadas = baseDeDatos({ ...cuota });
  const r = await emitirBoleta(51);
  assert.equal(r.emitida, false);
  assert.match(r.error, /SUNAT no aceptó/);
  const error = llamadas.find((l) => /MensajeError = \?/.test(l.sql));
  assert.ok(error, 'debe marcar la boleta con error');

  falso.fallarSunat = false;
  llamadas = baseDeDatos({ ...cuota, IdExterno: '90', Intentos: 2 });
  const reintento = await emitirBoleta(51);
  assert.equal(reintento.emitida, true);
  assert.equal(falso.boletasCreadas, 1, 'no se crea una segunda boleta en fact_api');
  assert.ok(!llamadas.some((l) => /IdExterno = \?/.test(l.sql) && /SET IdExterno/.test(l.sql)));
});

test('sin reserva (otro proceso la emite o ya está emitida) no llama a fact_api', async () => {
  const { emitirBoleta } = require('../services/boletas.service');
  baseDeDatos(null);
  const r = await emitirBoleta(51);
  assert.equal(r.motivo, 'SIN_RESERVA');
  assert.deepEqual(falso.solicitudes, []);
});

test('el monto de la cuota incluye IGV y un alumno sin DNI va como cliente sin documento', () => {
  const { construirBoleta } = require('../services/facturacion.adapter');
  const { obtenerConfiguracionFacturacion } = require('../config/facturacion');
  const config = obtenerConfiguracionFacturacion();
  const b = construirBoleta(config, { ...cuota, DNI: null, Mes: 'Inscripcion' });
  const d = b.detalles[0];
  assert.equal(d.tip_afe_igv, '10');
  assert.equal(Math.round(d.mto_valor_unitario * 1.18 * 100) / 100, 400);
  assert.equal(b.client.tipo_documento, '0');
  assert.equal(d.descripcion, 'Inscripción - Veranito San Marcos');
  const exonerada = construirBoleta({ ...config, afectacion: '20' }, cuota);
  assert.equal(exonerada.detalles[0].mto_valor_unitario, 400);
  assert.equal(exonerada.detalles[0].porcentaje_igv, 0);
});

async function servirAlumno(t) {
  const app = express();
  app.use((req, _res, next) => { req.usuario = { id: 12, idAcademia: 1, rol: 'Alumno' }; next(); });
  app.use('/api/alumno', require('../routes/alumno.routes'));
  const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  t.after(() => new Promise((r) => { s.close(r); s.closeAllConnections(); }));
  return (ruta) => fetch(`http://127.0.0.1:${s.address().port}${ruta}`);
}

test('el alumno descarga el PDF de su boleta y recibe 404 si aún no se emitió', async (t) => {
  const pedir = await servirAlumno(t);
  let fila = { IdPago: 51, Estado: 'EMITIDA', NumeroCompleto: 'B001-00000012', PdfArchivo: PDF, XmlArchivo: XML };
  simular((sql, params) => {
    assert.match(sql, /FROM BoletaElectronica/);
    assert.deepEqual(params, [51, 12, 1]);
    return [fila ? [fila] : []];
  });
  let r = await pedir('/api/alumno/pagos/51/boleta');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), /B001-00000012\.pdf/);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(PDF));

  r = await pedir('/api/alumno/pagos/51/boleta?formato=xml');
  assert.equal(r.headers.get('content-type'), 'application/xml');

  fila = { IdPago: 51, Estado: 'EMITIENDO', PdfArchivo: null };
  r = await pedir('/api/alumno/pagos/51/boleta');
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, 'BOLETA_NO_DISPONIBLE');

  fila = null;
  r = await pedir('/api/alumno/pagos/51/boleta');
  assert.equal(r.status, 404);
});
