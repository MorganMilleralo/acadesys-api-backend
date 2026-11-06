'use strict';

const router = require('express').Router();
const pasarela = require('../services/mercadopago.adapter');
const transacciones = require('../services/transacciones-pago.service');
const { ErrorPago } = require('../utils/pagos-proveedor');

// Público: la autenticación es HMAC del proveedor, nunca JWT ni URL de retorno.
router.post('/mercadopago', async (req, res) => {
  try {
    const id = pasarela.validarNotificacion(req);
    const pago = await pasarela.consultarPagoVerificado(id);
    const resultado = pago.estadoProveedor === 'approved'
      ? await transacciones.confirmarPagoProveedor(pago)
      : await transacciones.actualizarEstadoNoAprobado(pago);
    // No acusar recibo antes del COMMIT. Sin cola durable, el reintento lo hace MP.
    return res.status(200).json({ recibido: true, ...resultado });
  } catch (error) {
    const conocido = error instanceof ErrorPago;
    const status = conocido ? error.status : 503;
    const code = conocido ? error.code : 'WEBHOOK_REINTENTAR';
    if (status >= 500) {
      res.set('Retry-After', '60');
      console.error('Webhook Mercado Pago:', code);
    }
    return res.status(status).json({ code, error: 'No se pudo procesar la notificación.' });
  }
});

// También cubre el parser montado en index.js; no registrar body ni cabeceras.
router.errorHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 503;
  return res.status(status).json({ code: 'WEBHOOK_CUERPO_INVALIDO', error: 'No se pudo leer la notificación.' });
};

module.exports = router;
