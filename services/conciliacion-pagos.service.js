'use strict';

/**
 * Conciliación activa de Mercado Pago. La notificación es la señal; la fuente
 * de verdad es siempre la consulta GET de la order al proveedor.
 */

const mercadopago = require('./mercadopago.adapter');
const transacciones = require('./transacciones-pago.service');
const { ErrorPago } = require('../utils/pagos-proveedor');
const { obtenerConfiguracionPagos } = require('../config/pagos');

const ESPERA_ENTRE_CONCILIACIONES_MS = obtenerConfiguracionPagos().reconciliationIntervalMs;
const ultimas = new Map();

function puedeConciliar(referencia, ahora = Date.now()) {
  const ultima = ultimas.get(referencia);
  if (ultima && ahora - ultima < ESPERA_ENTRE_CONCILIACIONES_MS) return false;
  ultimas.set(referencia, ahora);
  if (ultimas.size > 5000) ultimas.delete(ultimas.keys().next().value);
  return true;
}

async function conciliarReferencia({ referenciaInterna, idOrdenProveedor } = {}) {
  const pago = await mercadopago.consultarOrdenVerificada({
    orderId: idOrdenProveedor,
    referenciaInterna,
  });
  if (pago.referenciaInterna !== referenciaInterna) {
    throw new ErrorPago(409, 'MERCADOPAGO_ORDEN_NO_COINCIDE',
      'La orden consultada no corresponde a la transacción reservada.', false);
  }

  try {
    const resultado = pago.estado === 'APROBADA'
      ? await transacciones.confirmarPagoProveedor(pago)
      : await transacciones.actualizarEstadoNoAprobado(pago);
    return {
      pagosEncontrados: 1,
      confirmada: resultado.confirmada === true,
      requiereRevision: resultado.requiereRevision === true || resultado.pagoDuplicado === true,
      resultados: [{ idPagoProveedor: pago.idPagoProveedor, estado: pago.estado, ...resultado }],
    };
  } catch (error) {
    if (!(error instanceof ErrorPago) || error.status !== 409) throw error;
    return {
      pagosEncontrados: 1,
      confirmada: false,
      requiereRevision: true,
      resultados: [{ idPagoProveedor: pago.idPagoProveedor, estado: pago.estado, error: error.code }],
    };
  }
}

module.exports = {
  ESPERA_ENTRE_CONCILIACIONES_MS,
  puedeConciliar,
  conciliarReferencia,
  _ultimas: ultimas,
};
