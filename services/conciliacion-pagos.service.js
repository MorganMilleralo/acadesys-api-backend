'use strict';

/**
 * Conciliación activa con Mercado Pago (W1 del informe de verificación).
 *
 * El webhook es la vía principal de confirmación. Si un aviso se pierde (por
 * ejemplo, Render dormido > 22 s y reintentos fuera de la ventana de firma),
 * esta función busca los pagos de la referencia interna y aplica cada uno con
 * EXACTAMENTE la misma verificación y transacción SQL que el webhook:
 * consultarPagoVerificado + confirmarPagoProveedor / actualizarEstadoNoAprobado.
 * La búsqueda por sí sola nunca confirma un pago.
 */

const pasarela = require('./mercadopago.adapter');
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

async function conciliarReferencia(referenciaInterna) {
  const ids = await pasarela.buscarPagosPorReferencia(referenciaInterna);
  const resultados = [];
  // Del más antiguo al más reciente: el control de versiones del servicio
  // descarta igual cualquier evento atrasado, pero así la auditoría queda en orden.
  for (const id of ids.slice().reverse()) {
    const pago = await pasarela.consultarPagoVerificado(id);
    if (pago.referenciaInterna !== referenciaInterna) continue;
    try {
      const resultado = pago.estadoProveedor === 'approved'
        ? await transacciones.confirmarPagoProveedor(pago)
        : await transacciones.actualizarEstadoNoAprobado(pago);
      resultados.push({ idPagoProveedor: id, estado: pago.estado, ...resultado });
    } catch (error) {
      // Un 409 (transición inválida, importe distinto) queda registrado para
      // revisión y no impide aplicar los demás pagos. Lo demás se propaga.
      if (!(error instanceof ErrorPago) || error.status !== 409) throw error;
      resultados.push({ idPagoProveedor: id, estado: pago.estado, error: error.code });
    }
  }
  return {
    pagosEncontrados: ids.length,
    confirmada: resultados.some((r) => r.confirmada === true),
    requiereRevision: resultados.some((r) => r.error || r.pagoDuplicado || r.requiereRevision),
    resultados,
  };
}

module.exports = { ESPERA_ENTRE_CONCILIACIONES_MS, puedeConciliar, conciliarReferencia, _ultimas: ultimas };
