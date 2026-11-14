'use strict';

/**
 * Conciliación activa con Culqi.
 *
 * El webhook POST /api/webhooks/culqi es la vía principal de confirmación. Si
 * un aviso se pierde (por ejemplo, Render dormido), esta función consulta la
 * orden guardada en PagoTransaccion y la aplica con EXACTAMENTE la misma
 * verificación y transacción SQL que el webhook:
 * consultarOrdenVerificada + confirmarPagoProveedor / actualizarEstadoNoAprobado.
 * Nunca usa datos enviados por el navegador.
 */

const culqi = require('./culqi.adapter');
const transacciones = require('./transacciones-pago.service');
const { ErrorPago } = require('../utils/pagos-proveedor');

// Evita consultar al proveedor en cada clic. Memoria local: suficiente para
// una sola instancia de Render; con varias instancias solo se pierde eficiencia.
const ESPERA_ENTRE_CONCILIACIONES_MS = 30000;
const ultimas = new Map();

function puedeConciliar(referencia, ahora = Date.now()) {
  const ultima = ultimas.get(referencia);
  if (ultima && ahora - ultima < ESPERA_ENTRE_CONCILIACIONES_MS) return false;
  ultimas.set(referencia, ahora);
  if (ultimas.size > 5000) ultimas.delete(ultimas.keys().next().value);
  return true;
}

async function conciliarReferencia({ referenciaInterna, idOrdenProveedor } = {}) {
  const pago = await culqi.consultarOrdenVerificada({ orderId: idOrdenProveedor });
  if (pago.referenciaInterna !== referenciaInterna) {
    throw new ErrorPago(409, 'CULQI_ORDEN_NO_COINCIDE',
      'La orden consultada no corresponde a esta transacción.', false);
  }
  const resultados = [];
  try {
    const resultado = pago.estadoProveedor === 'paid'
      ? await transacciones.confirmarPagoProveedor(pago)
      : await transacciones.actualizarEstadoNoAprobado(pago);
    resultados.push({ idPagoProveedor: pago.idPagoProveedor, estado: pago.estado, ...resultado });
  } catch (error) {
    // Un 409 (transición inválida, importe distinto) queda para revisión.
    if (!(error instanceof ErrorPago) || error.status !== 409) throw error;
    resultados.push({ idPagoProveedor: pago.idPagoProveedor, estado: pago.estado, error: error.code });
  }
  return {
    pagosEncontrados: 1,
    confirmada: resultados.some((r) => r.confirmada === true),
    requiereRevision: resultados.some((r) => r.error || r.pagoDuplicado || r.requiereRevision),
    resultados,
  };
}

module.exports = { ESPERA_ENTRE_CONCILIACIONES_MS, puedeConciliar, conciliarReferencia, _ultimas: ultimas };
