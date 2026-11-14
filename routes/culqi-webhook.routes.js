
'use strict';

const router = require('express').Router();
const culqi = require('../services/culqi.adapter');
const transacciones = require('../services/transacciones-pago.service');
const { ErrorPago } = require('../utils/pagos-proveedor');

// Culqi no envía JWT de alumno: este endpoint usa la autenticación Basic
// configurada al registrar el webhook en CulqiPanel. El evento solo aporta el
// ID; el estado y el importe se vuelven a consultar con la llave privada.
router.post('/culqi', async (req, res) => {
  try {
    const notificacion = culqi.validarNotificacion(req);
    const pago = await culqi.consultarOrdenVerificada(notificacion);
    const resultado = pago.estadoProveedor === 'paid'
      ? await transacciones.confirmarPagoProveedor(pago)
      : await transacciones.actualizarEstadoNoAprobado(pago);

    // Acusar recibo únicamente después del COMMIT SQL. Eventos repetidos son idempotentes.
    return res.status(200).json({ recibido: true, ...resultado });
  } catch (error) {
    const conocido = error instanceof ErrorPago;
    const status = conocido ? error.status : 503;
    const code = conocido ? error.code : 'CULQI_WEBHOOK_REINTENTAR';
    if (status >= 500) {
      res.set('Retry-After', '60');
      console.error('Webhook Culqi:', code);
    }
    return res.status(status).json({
      code,
      error: status >= 500
        ? 'No se pudo verificar la orden. El proveedor puede volver a notificar.'
        : 'Notificación no válida o no autenticada.',
    });
  }
});

module.exports = router;