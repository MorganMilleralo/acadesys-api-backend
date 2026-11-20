'use strict';

const router = require('express').Router();
const mercadopago = require('../services/mercadopago.adapter');
const transacciones = require('../services/transacciones-pago.service');
const { ErrorPago } = require('../utils/pagos-proveedor');

router.post('/mercadopago', async (req, res) => {
  try {
    const notificacion = mercadopago.validarNotificacion(req);
    const pago = await mercadopago.consultarOrdenVerificada({ orderId: notificacion.orderId });
    const resultado = pago.estado === 'APROBADA'
      ? await transacciones.confirmarPagoProveedor(pago)
      : await transacciones.actualizarEstadoNoAprobado(pago);

    // Mercado Pago recibe ACK solo cuando el cambio quedó persistido en MySQL.
    return res.status(200).json({ recibido: true, proveedor: 'MERCADOPAGO', ...resultado });
  } catch (error) {
    const conocido = error instanceof ErrorPago;
    const status = conocido ? error.status : 503;
    const code = conocido ? error.code : 'MERCADOPAGO_WEBHOOK_REINTENTAR';
    if (status >= 500 || status === 409) {
      console.error('Webhook Mercado Pago:', code);
    }
    return res.status(status >= 500 ? 503 : status).json({
      code,
      error: status >= 500
        ? 'No se pudo verificar o persistir la orden. Mercado Pago puede volver a notificar.'
        : (conocido ? error.message : 'Notificación no válida.'),
    });
  }
});

module.exports = router;
