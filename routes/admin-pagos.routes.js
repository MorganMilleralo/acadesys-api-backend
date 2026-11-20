'use strict';

const express = require('express');
const router = express.Router();
const requiereRol = require('../middlewares/roles.middleware');
const { idPositivo } = require('../utils/validaciones');
const { ErrorPago } = require('../utils/pagos-proveedor');
const mercadopago = require('../services/mercadopago.adapter');
const transacciones = require('../services/transacciones-pago.service');
const conciliacion = require('../services/conciliacion-pagos.service');

const idAcademiaActor = (req) => idPositivo(req.usuario?.idAcademia);
router.use(requiereRol('Administrador'));

function responderError(res, error, contexto) {
  const conocido = error instanceof ErrorPago;
  const status = conocido ? error.status : 500;
  if (status >= 500) console.error(`Error en ${contexto}:`, conocido ? error.code : (error?.name || 'Error'));
  return res.status(status).json({
    code: conocido ? error.code : 'PAGOS_ADMIN_NO_DISPONIBLE',
    error: conocido ? error.message : 'No se pudo completar la consulta de pagos.',
  });
}

router.get('/transacciones', async (req, res) => {
  const idAcademia = idAcademiaActor(req);
  if (!idAcademia) return res.status(401).json({ error: 'La sesión administrativa no es válida.' });
  const filtros = transacciones.normalizarFiltrosTransacciones(req.query);
  if (!filtros) return res.status(400).json({ code: 'FILTROS_INVALIDOS', error: 'Los filtros de transacciones no son válidos.' });
  try {
    return res.json(await transacciones.listarTransaccionesAdmin({ idAcademia, filtros }));
  } catch (error) {
    return responderError(res, error, 'GET /api/admin/pagos/transacciones');
  }
});

router.get('/:idPago/auditoria', async (req, res) => {
  const idAcademia = idAcademiaActor(req);
  const idPago = idPositivo(req.params.idPago);
  if (!idAcademia) return res.status(401).json({ error: 'La sesión administrativa no es válida.' });
  if (!idPago) return res.status(400).json({ error: 'El IdPago no es válido.' });
  try {
    return res.json({ idPago, eventos: await transacciones.auditoriaPagoAdmin({ idPago, idAcademia }) });
  } catch (error) {
    return responderError(res, error, 'GET /api/admin/pagos/:idPago/auditoria');
  }
});

router.post('/transacciones/:idTransaccion/conciliar', async (req, res) => {
  const idAcademia = idAcademiaActor(req);
  const idTransaccion = idPositivo(req.params.idTransaccion);
  if (!idAcademia) return res.status(401).json({ error: 'La sesión administrativa no es válida.' });
  if (!idTransaccion) return res.status(400).json({ error: 'El IdTransaccion no es válido.' });
  try {
    mercadopago.verificarConfiguracion();
    const referencia = await transacciones.obtenerReferenciaConciliable({ idTransaccion, idAcademia });
    if (!referencia) {
      return res.status(404).json({ code: 'TRANSACCION_NO_CONCILIABLE', error: 'La transacción no existe en la academia o no tiene una orden de Mercado Pago.' });
    }
    if (!conciliacion.puedeConciliar(referencia.referenciaInterna)) {
      return res.status(429).json({ code: 'CONSULTA_RECIENTE', error: 'Esta transacción se consultó hace menos de 30 segundos.' });
    }
    return res.json({ idTransaccion, ...(await conciliacion.conciliarReferencia(referencia)) });
  } catch (error) {
    return responderError(res, error, 'POST /api/admin/pagos/transacciones/:idTransaccion/conciliar');
  }
});

module.exports = router;
