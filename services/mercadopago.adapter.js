'use strict';

/**
 * Adaptador provisional de contrato.
 * Torito debe reemplazar la implementación de crearOrdenPago por la integración
 * real de Mercado Pago Orders/Checkout. No simula pagos ni genera URLs falsas.
 * El resto del código de Morgan queda desacoplado del SDK/API del proveedor.
 */
async function crearOrdenPago() {
  const error = new Error('La integración de Mercado Pago todavía no está configurada en el backend.');
  error.status = 503;
  error.code = 'PASARELA_NO_CONFIGURADA';
  error.safeToMarkError = true;
  throw error;
}

module.exports = { crearOrdenPago };
