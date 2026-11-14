'use strict';

// Panel administrativo de pagos online (C4 del informe de verificación).
// Montado en /api/admin/pagos después del candado JWT. Solo lectura, salvo la
// conciliación, que aplica pagos con la misma verificación que el webhook.

const express = require('express');
const router = express.Router();
const requiereRol = require('../middlewares/roles.middleware');
const { idPositivo } = require('../utils/validaciones');
const { ErrorPago } = require('../utils/pagos-proveedor');
const pasarela = require('../services/mercadopago.adapter');
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
    error: conocido && status < 500 ? error.message : 'No se pudo completar la consulta de pagos.',
  });
}

// GET /api/admin/pagos/transacciones?idCiclo=&periodo=AAAA-MM|Inscripcion&estado=&limite=&desde=
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

// GET /api/admin/pagos/:idPago/auditoria — historial manual y automático de la cuota.
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

// POST /api/admin/pagos/transacciones/:idTransaccion/conciliar
router.post('/transacciones/:idTransaccion/conciliar', async (req, res) => {
  const idAcademia = idAcademiaActor(req);
  const idTransaccion = idPositivo(req.params.idTransaccion);
  if (!idAcademia) return res.status(401).json({ error: 'La sesión administrativa no es válida.' });
  if (!idTransaccion) return res.status(400).json({ error: 'El IdTransaccion no es válido.' });
  try {
    pasarela.verificarConfiguracion();
    const referencia = await transacciones.obtenerReferenciaConciliable({ idTransaccion, idAcademia });
    if (!referencia) {
      return res.status(404).json({ code: 'TRANSACCION_NO_CONCILIABLE', error: 'La transacción no existe en tu academia o no llegó a crear un checkout.' });
    }
    if (!conciliacion.puedeConciliar(referencia.referenciaInterna)) {
      return res.status(429).json({ code: 'CONSULTA_RECIENTE', error: 'Esta transacción se consultó hace menos de 30 segundos.' });
    }
    const resultado = await conciliacion.conciliarReferencia(referencia.referenciaInterna);
    return res.json({ idTransaccion, ...resultado });
  } catch (error) {
    return responderError(res, error, 'POST /api/admin/pagos/transacciones/:id/conciliar');
  }
});

module.exports = router;
