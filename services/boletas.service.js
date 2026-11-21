'use strict';

// Emisión de la boleta electrónica SUNAT de una cuota pagada.
// Se ejecuta después de confirmar el pago (Mercado Pago o comprobante aprobado)
// y nunca bloquea ni revierte ese pago: si el servicio de facturación falla,
// la boleta queda en ERROR y se reintenta en segundo plano.

const pool = require('../config/db');
const { consultar, ejecutar } = require('../config/procedimientos');
const { facturacionActiva, obtenerConfiguracionFacturacion } = require('../config/facturacion');
const facturacion = require('./facturacion.adapter');

const enCurso = new Set();

function idValido(valor) {
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function emitirBoleta(idPagoEntrada) {
  const idPago = idValido(idPagoEntrada);
  if (!idPago || !facturacionActiva()) return { emitida: false, motivo: 'NO_APLICA' };
  if (enCurso.has(idPago)) return { emitida: false, motivo: 'EN_CURSO' };
  enCurso.add(idPago);
  let boleta;
  try {
    const config = obtenerConfiguracionFacturacion();
    const [filas] = await consultar(pool, 'sp_boletas_reclamar_emision', [idPago, config.minutosBloqueo, config.maxIntentos]);
    boleta = filas[0];
    if (!boleta) return { emitida: false, motivo: 'SIN_RESERVA' };

    let idExterno = boleta.IdExterno ? String(boleta.IdExterno) : null;
    let numeroCompleto = null;
    if (!idExterno) {
      const creada = await facturacion.crearBoleta(boleta);
      idExterno = creada.idExterno;
      numeroCompleto = creada.numeroCompleto;
      // Se guarda antes de enviar a SUNAT: un reintento reutiliza la misma boleta.
      await ejecutar(pool, 'sp_boletas_guardar_externo', [
        boleta.IdBoleta, idExterno, creada.serie, creada.correlativo, creada.numeroCompleto,
      ]);
    }
    const estadoSunat = await facturacion.enviarSunat(idExterno);
    const { pdf, xml } = await facturacion.descargarArchivos(idExterno);
    const [resultado] = await ejecutar(pool, 'sp_boletas_marcar_emitida', [boleta.IdBoleta, estadoSunat, pdf, xml]);
    return { emitida: resultado.affectedRows === 1, idPago, numeroCompleto, estadoSunat };
  } catch (error) {
    const mensaje = String(error?.message || 'Error desconocido al emitir la boleta.').slice(0, 480);
    if (boleta?.IdBoleta) {
      await ejecutar(pool, 'sp_boletas_marcar_error', [boleta.IdBoleta, mensaje]).catch(() => {});
    }
    console.error(`Boleta de la cuota ${idPago} no emitida: ${mensaje}`);
    return { emitida: false, motivo: 'ERROR', error: mensaje };
  } finally {
    enCurso.delete(idPago);
  }
}

// Programa la emisión sin hacer esperar la respuesta del pago.
function programarEmision(idPago) {
  if (!facturacionActiva() || !idValido(idPago)) return;
  setImmediate(() => { emitirBoleta(idPago).catch(() => {}); });
}

async function reintentarPendientes(limite = 10) {
  if (!facturacionActiva()) return 0;
  const config = obtenerConfiguracionFacturacion();
  const [filas] = await consultar(pool, 'sp_boletas_listar_reintentos', [config.minutosBloqueo, config.maxIntentos, limite]);
  let emitidas = 0;
  for (const fila of filas) {
    const r = await emitirBoleta(fila.IdPago);
    if (r.emitida) emitidas += 1;
  }
  return emitidas;
}

let temporizador = null;
function iniciarReintentos(intervaloMs = 10 * 60 * 1000) {
  if (temporizador || !facturacionActiva()) return;
  temporizador = setInterval(() => {
    reintentarPendientes().catch((error) => console.error('Reintento de boletas fallido:', error?.message || error));
  }, intervaloMs);
  temporizador.unref();
}

module.exports = { emitirBoleta, programarEmision, reintentarPendientes, iniciarReintentos };
