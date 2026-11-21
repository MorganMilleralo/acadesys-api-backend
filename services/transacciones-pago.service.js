

'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const { rollbackSeguro } = require('../utils/validaciones');
const { ErrorPago, aCentimos, idOrdenMercadoPago, idempotencyKeyValida } = require('../utils/pagos-proveedor');
const { obtenerConfiguracionPagos, validarUrlCheckout } = require('../config/pagos');
const { consultar, ejecutar } = require('../config/procedimientos');
const boletas = require('./boletas.service');

const CONFIG_PAGOS = obtenerConfiguracionPagos();
const PROVEEDOR = CONFIG_PAGOS.provider;
const MONEDA = CONFIG_PAGOS.currency;

// Una reserva en CREANDO sin orden guardada después de 2 minutos es huérfana:
// la orden nunca llegó al alumno, así que nadie puede pagarla.
const CREACION_HUERFANA_SEGUNDOS = CONFIG_PAGOS.reservationTimeoutSeconds;
const ESTADOS_TRANSACCION = new Set(['CREANDO', 'PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA',
  'REEMBOLSADA', 'CONTRACARGO', 'PAGO_DUPLICADO', 'ERROR', 'EXPIRADA']);

function errorPago(status, code, message) {
  return new ErrorPago(status, code, message);
}

function referenciaInternaValida(valor) {
  const prefijo = CONFIG_PAGOS.referencePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return typeof valor === 'string' && new RegExp(`^${prefijo}-[1-9]\\d{0,14}-[a-f0-9-]{36}$`, 'i').test(valor);
}

function idPositivo(valor) {
  if (!['number', 'string'].includes(typeof valor) || !/^[1-9]\d*$/.test(String(valor))) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

async function auditar(connection, datos) {
  const [resultado] = await ejecutar(connection, 'sp_transacciones_registrar_auditoria_pago', [
      datos.idPago,
      datos.idAcademia,
      datos.evento,
      datos.estadoAnterior ?? null,
      datos.estadoNuevo ?? null,
      datos.montoAnterior ?? null,
      datos.montoNuevo ?? null,
      datos.motivo ?? null,
    ]);
  if (resultado.affectedRows !== 1) throw errorPago(503, 'AUDITORIA_NO_GUARDADA', 'No se pudo registrar la auditoría del pago.');
}

async function descartarTransaccion(connection, tx, idAcademia, cuota, estadoNuevo, evento, motivo) {
  const [cambio] = await ejecutar(connection, 'sp_transacciones_cambiar_estado_si_coincide', [estadoNuevo, tx.IdTransaccion, tx.Estado]);
  if (cambio.affectedRows !== 1) throw errorPago(409, 'CHECKOUT_EN_PREPARACION', 'El checkout cambió de estado; actualiza la pantalla.');
  await auditar(connection, {
    idPago: tx.IdPago ?? cuota.IdPago, idAcademia, evento,
    estadoAnterior: tx.Estado, estadoNuevo,
    montoAnterior: Number(tx.Monto), montoNuevo: Number(cuota.Monto),
    motivo: `Transacción ${tx.IdTransaccion}. ${motivo}`,
  });
}

/**
 * Reserva una transacción para una cuota que pertenece al alumno autenticado.
 * La fila de PagosMensualidad se bloquea antes de comprobar si ya existe un
 * checkout pendiente, evitando dos reservas concurrentes para la misma cuota.
 */
async function reservarCheckoutAlumno({ idPago, idUsuario, idAcademia, proveedor = PROVEEDOR }) {
  const pagoId = idPositivo(idPago);
  const usuarioId = idPositivo(idUsuario);
  const academiaId = idPositivo(idAcademia);
  const proveedorActual = String(proveedor || PROVEEDOR).trim().toUpperCase();
  if (proveedorActual !== PROVEEDOR) {
    throw errorPago(400, 'PROVEEDOR_INVALIDO', 'El proveedor de pago no coincide con la configuración activa.');
  }
  if (!pagoId || !usuarioId || !academiaId) {
    throw errorPago(400, 'DATOS_INVALIDOS', 'No se pudo identificar la cuota o la sesión del alumno.');
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [pagos] = await consultar(connection, 'sp_transacciones_bloquear_cuota_alumno', [pagoId, usuarioId, academiaId]);

    if (!pagos.length) {
      await connection.rollback();
      throw errorPago(404, 'CUOTA_NO_ENCONTRADA', 'La cuota no existe en tu cuenta.');
    }

    const pago = pagos[0];
    const estadoPago = String(pago.Estado || '').trim().toLowerCase();
    if (estadoPago === 'pagado') {
      await connection.rollback();
      throw errorPago(409, 'CUOTA_YA_PAGADA', 'Esta cuota ya está pagada.');
    }
    if (!['pendiente', 'moroso'].includes(estadoPago)) {
      await connection.rollback();
      throw errorPago(409, 'CUOTA_NO_COBRABLE', 'La cuota no está en un estado cobrable.');
    }

    const montoCentimos = aCentimos(pago.Monto);
    if (montoCentimos === null || montoCentimos <= 0) {
      await connection.rollback();
      throw errorPago(409, 'MONTO_NO_COBRABLE', 'La cuota no tiene un importe válido para pagar online.');
    }

    // El pago manual y el online no se superponen. Mientras administración
    // revisa un comprobante, no se abre un cobro online de la misma cuota.
    const [enRevision] = await consultar(connection, 'sp_transacciones_bloquear_comprobante', [pagoId, usuarioId, academiaId]);
    if (enRevision.length) {
      await connection.rollback();
      throw errorPago(409, 'COMPROBANTE_EN_REVISION',
        'Esta cuota tiene un comprobante en revisión. Espera la respuesta de la academia antes de pagar online.');
    }

    const [existentes] = await consultar(connection, 'sp_transacciones_bloquear_transaccion_por_id_pago', [pagoId, usuarioId, academiaId, proveedorActual]);

    const datosAlumno = {
      emailAlumno: pago.CorreoElectronico || null,
      telefonoAlumno: pago.Telefono || null,
      nombreAlumno: pago.Nombres || '',
      apellidoPaterno: pago.ApellidoPaterno || '',
      apellidoMaterno: pago.ApellidoMaterno || '',
      alumno: pago.Alumno || 'Alumno',
      ciclo: pago.Ciclo || 'Ciclo académico',
      concepto: String(pago.Mes || ''),
    };

    let actual = existentes[0] || null;
    if (actual) {
      const antiguedad = Number(actual.AntiguedadSegundos);
      const medible = Number.isSafeInteger(antiguedad) && antiguedad >= 0;
      if (actual.Estado === 'CREANDO' && !actual.IdOrdenProveedor && medible
          && antiguedad >= CREACION_HUERFANA_SEGUNDOS) {
        await descartarTransaccion(connection, actual, academiaId, pago, 'ERROR', 'CHECKOUT_CREACION_DESCARTADA',
          'Reserva sin orden guardada por más de 2 minutos; nunca llegó al alumno.');
        actual = null;
      }
    }

    if (actual) {
      if (aCentimos(actual.Monto) !== montoCentimos || actual.Moneda !== MONEDA) {
        await connection.rollback();
        throw errorPago(409, 'CHECKOUT_IMPORTE_CAMBIADO',
          'El importe de la cuota cambió desde el último intento. Actualiza la lista antes de volver a pagar.');
      }

      if (idOrdenMercadoPago(actual.IdOrdenProveedor)) {
        await connection.commit();
        return {
          reutilizada: true,
          enPreparacion: false,
          idPago: pagoId,
          idTransaccion: Number(actual.IdTransaccion),
          referenciaInterna: actual.ReferenciaInterna,
          idempotencyKey: actual.ClaveIdempotencia,
          idOrdenProveedor: actual.IdOrdenProveedor,
          checkoutUrl: actual.UrlCheckout || null,
          monto: Number(actual.Monto),
          moneda: actual.Moneda,
          estado: actual.Estado,
          proveedor: proveedorActual,
          ...datosAlumno,
        };
      }

      if (actual.Estado === 'CREANDO') {
        const antiguedad = Number(actual.AntiguedadSegundos);
        const puedeReintentar = Number.isSafeInteger(antiguedad)
          && antiguedad >= CREACION_HUERFANA_SEGUNDOS
          && idempotencyKeyValida(actual.ClaveIdempotencia);
        await connection.commit();
        if (!puedeReintentar) {
          return {
            reutilizada: false,
            enPreparacion: true,
            idTransaccion: Number(actual.IdTransaccion),
            estado: actual.Estado,
          };
        }
        return {
          reutilizada: true,
          requiereReintento: true,
          enPreparacion: false,
          idPago: pagoId,
          idTransaccion: Number(actual.IdTransaccion),
          referenciaInterna: actual.ReferenciaInterna,
          idempotencyKey: actual.ClaveIdempotencia,
          idOrdenProveedor: null,
          checkoutUrl: null,
          monto: Number(actual.Monto),
          moneda: actual.Moneda,
          estado: actual.Estado,
          proveedor: proveedorActual,
          ...datosAlumno,
        };
      } else {
        await connection.commit();
        return {
          reutilizada: false,
          enPreparacion: true,
          idTransaccion: Number(actual.IdTransaccion),
          estado: actual.Estado,
        };
      }
    }

    const referenciaInterna = `${CONFIG_PAGOS.referencePrefix}-${pagoId}-${crypto.randomUUID()}`;
    const idempotencyKey = crypto.randomUUID();
    const [insertado] = await ejecutar(connection, 'sp_transacciones_registrar_transaccion', [
        pagoId,
        usuarioId,
        academiaId,
        proveedorActual,
        referenciaInterna,
        idempotencyKey,
        Number(pago.Monto),
        MONEDA,
      ]);

    await connection.commit();
    return {
      reutilizada: false,
      enPreparacion: false,
      idPago: pagoId,
      idTransaccion: Number(insertado.insertId),
      referenciaInterna,
      idempotencyKey,
      monto: Number(pago.Monto),
      moneda: MONEDA,
      estado: 'CREANDO',
      checkoutUrl: null,
      proveedor: proveedorActual,
      ...datosAlumno,
    };
  } catch (error) {
    await rollbackSeguro(connection);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function guardarOrdenCreada({
  idTransaccion,
  idOrdenProveedor,
  checkoutUrl,
  estadoProveedor = 'created',
  proveedor = PROVEEDOR,
}) {
  const id = idPositivo(idTransaccion);
  const proveedorActual = String(proveedor || PROVEEDOR).trim().toUpperCase();
  const orden = idOrdenMercadoPago(idOrdenProveedor);
  if (!id || proveedorActual !== PROVEEDOR || !orden || orden !== String(idOrdenProveedor).trim()) {
    throw errorPago(400, 'ORDEN_MERCADOPAGO_INVALIDA', 'Los datos de la orden de Mercado Pago no son válidos.');
  }

  const urlCheckout = validarUrlCheckout(checkoutUrl);
  const estadoProveedorActual = String(estadoProveedor || '').trim().toLowerCase();
  // Estados iniciales de Checkout Pro: created o action_required (esperando el pago).
  if (!/^(created|action_required)(:[a-z_]+)?$/.test(estadoProveedorActual)) {
    throw errorPago(409, 'ESTADO_ORDEN_MERCADOPAGO_INVALIDO', 'Mercado Pago devolvió un estado inicial inesperado.');
  }

  await ejecutar(pool, 'sp_transacciones_guardar_orden_proveedor', [
    orden,
    urlCheckout,
    estadoProveedorActual,
    proveedorActual,
    id,
  ]);
  // La lectura posterior verifica que la orden y su URL quedaron persistidas.
  const [rows] = await consultar(pool, 'sp_transacciones_obtener_transaccion_por_id_transaccion', [id]);
  if (!rows.length) {
    throw errorPago(404, 'TRANSACCION_NO_ENCONTRADA', 'No se encontró la transacción creada.');
  }
  if (rows[0].IdOrdenProveedor !== orden || rows[0].UrlCheckout !== urlCheckout || rows[0].Estado === 'ERROR') {
    throw errorPago(409, 'ORDEN_NO_GUARDADA', 'La orden de Mercado Pago no coincide con la transacción reservada.');
  }
  return rows[0];
}

async function marcarErrorCreacion(idTransaccion, proveedor = PROVEEDOR) {
  const id = idPositivo(idTransaccion);
  const proveedorActual = String(proveedor || PROVEEDOR).trim().toUpperCase();
  if (!id || proveedorActual !== PROVEEDOR) return;
  await ejecutar(pool, 'sp_transacciones_marcar_error_creacion', [id, proveedorActual]);
}

async function obtenerEstadoPagoAlumno({ idPago, idUsuario, idAcademia }) {
  const pagoId = idPositivo(idPago);
  const usuarioId = idPositivo(idUsuario);
  const academiaId = idPositivo(idAcademia);
  if (!pagoId || !usuarioId || !academiaId) throw errorPago(400, 'DATOS_INVALIDOS', 'La cuota seleccionada no es válida.');
  const [rows] = await consultar(pool, 'sp_transacciones_obtener_estado_pago', [pagoId, usuarioId, academiaId]);
  if (!rows.length) throw errorPago(404, 'CUOTA_NO_ENCONTRADA', 'La cuota no existe en tu cuenta.');
  const row = rows[0];
  return {
    idPago: Number(row.IdPago),
    estadoPago: row.EstadoPago,
    monto: Number(row.Monto),
    transaccion: row.IdTransaccion ? {
      idTransaccion: Number(row.IdTransaccion),
      proveedor: row.Proveedor,
      orderId: row.IdOrdenProveedor || null,
      estado: row.EstadoTransaccion,
      referenciaInterna: row.ReferenciaInterna,
      checkoutUrl: row.UrlCheckout,
      monto: Number(row.MontoTransaccion),
      moneda: row.Moneda,
      fechaCreacion: row.FechaCreacion,
      fechaConfirmacion: row.FechaConfirmacion,
    } : null,
  };
}

/**
 * Solo recibe datos normalizados tras validar el aviso y consultar al proveedor. La auditoría
 * existente guarda la versión de cada pago.
 */
function estadoInternoMercadoPago(estadoProveedor) {
  const valor = String(estadoProveedor || '').trim().toLowerCase();
  if (valor === 'processed:accredited') return 'APROBADA';
  if (valor === 'processed:partially_refunded' || valor === 'refunded:refunded') return 'REEMBOLSADA';
  if (valor.startsWith('failed:')) return 'RECHAZADA';
  if (valor === 'canceled:canceled') return 'CANCELADA';
  if (valor.startsWith('created:') || valor.startsWith('processing:') || valor.startsWith('action_required:')) return 'PENDIENTE';
  return null;
}

async function aplicarPagoProveedor(datos) {
  const proveedorActual = String(datos?.proveedor || PROVEEDOR).trim().toUpperCase();
  const {
    referenciaInterna: referencia,
    idOrdenProveedor: orden,
    idPagoProveedor,
    monto,
    moneda,
    estadoProveedor,
    estado,
    fechaActualizacionProveedor,
  } = datos || {};

  const estadoDerivado = estadoInternoMercadoPago(estadoProveedor);
  const importe = aCentimos(monto);
  const idOrdenValido = idOrdenMercadoPago(orden);
  const idRecursoValido = idOrdenMercadoPago(idPagoProveedor);
  if (proveedorActual !== PROVEEDOR
      || typeof referencia !== 'string'
      || !referenciaInternaValida(referencia)
      || !idOrdenValido
      || !idRecursoValido
      || idRecursoValido !== idOrdenValido
      || importe === null
      || importe <= 0
      || moneda !== MONEDA
      || !estadoDerivado
      || estado !== estadoDerivado
      || !Number.isSafeInteger(fechaActualizacionProveedor)
      || fechaActualizacionProveedor <= 0) {
    throw errorPago(409, 'EVENTO_PAGO_INVALIDO', 'La orden verificada no contiene los datos requeridos para actualizar la cuota.');
  }

  let connection;
  try {
    const [localizadas] = await consultar(pool, 'sp_transacciones_obtener_transaccion_por_proveedor', [proveedorActual, referencia]);
    if (!localizadas.length) throw errorPago(404, 'TRANSACCION_NO_ENCONTRADA', 'No existe la transacción asociada a la orden notificada.');

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [cuotas] = await consultar(connection, 'sp_transacciones_bloquear_cuota', [localizadas[0].IdPago]);
    if (!cuotas.length) throw errorPago(404, 'CUOTA_NO_ENCONTRADA', 'No existe la cuota relacionada con la orden.');
    const cuota = cuotas[0];
    const [rows] = await consultar(connection, 'sp_transacciones_bloquear_transaccion_por_proveedor', [proveedorActual, referencia]);
    const tx = rows[0];

    if (!tx
        || tx.ReferenciaInterna !== referencia
        || Number(tx.IdPago) !== Number(cuota.IdPago)
        || Number(tx.IdUsuario) !== Number(cuota.IdUsuario)
        || Number(tx.IdAcademia) !== Number(cuota.IdAcademia)
        || tx.Proveedor !== proveedorActual) {
      throw errorPago(409, 'TRANSACCION_NO_COINCIDE', 'La orden no corresponde a la transacción y cuota registradas.');
    }
    if ((tx.IdOrdenProveedor && tx.IdOrdenProveedor !== orden)
        || (!tx.IdOrdenProveedor && tx.Estado !== 'CREANDO')) {
      throw errorPago(409, 'ORDEN_NO_COINCIDE', 'La orden recibida no coincide con la orden reservada en AcadeSys.');
    }
    if (aCentimos(tx.Monto) !== importe || aCentimos(cuota.Monto) !== importe || tx.Moneda !== MONEDA) {
      throw errorPago(409, 'IMPORTE_NO_COINCIDE', 'El importe o la moneda de la orden no coincide con la cuota registrada.');
    }

    const eventoEstado = `${proveedorActual}_EVENTO`;
    const [auditorias] = await consultar(connection, 'sp_transacciones_bloquear_auditoria_pago', [tx.IdPago, tx.IdAcademia, eventoEstado]);
    const estadoAuditable = (valor) => {
      if (typeof valor !== 'string') return false;
      const [status, detail] = valor.split(':', 2);
      if (!status || !detail) return false;
      if (status === 'failed') return true;
      if (status === 'processing') return ['in_process', 'pending_review_manual'].includes(detail);
      if (status === 'action_required') return ['waiting_payment', 'waiting_capture'].includes(detail);
      return [
        'created:created',
        'processed:accredited',
        'processed:partially_refunded',
        'refunded:refunded',
        'canceled:canceled',
      ].includes(valor);
    };

    const recibos = auditorias.map((row) => {
      let recibo;
      try { recibo = JSON.parse(row.Motivo); } catch { /* falla cerrada */ }
      if (!recibo
          || recibo.v !== 1
          || !idOrdenMercadoPago(recibo.pago)
          || !idPositivo(recibo.transaccion)
          || !Number.isSafeInteger(recibo.actualizado)
          || !estadoAuditable(recibo.estado)) {
        throw errorPago(409, 'AUDITORIA_PAGO_INVALIDA', 'La auditoría de Mercado Pago requiere revisión.');
      }
      return recibo;
    }).filter((recibo) => Number(recibo.transaccion) === Number(tx.IdTransaccion));

    const anterior = recibos.find((recibo) => recibo.pago === String(idRecursoValido));
    const resultado = { idPago: Number(tx.IdPago), idTransaccion: Number(tx.IdTransaccion) };
    if (anterior && fechaActualizacionProveedor <= anterior.actualizado) {
      if (fechaActualizacionProveedor === anterior.actualizado && anterior.estado !== estadoProveedor) {
        throw errorPago(409, 'VERSION_PAGO_CONFLICTIVA', 'Mercado Pago devolvió estados distintos para la misma versión de la orden.');
      }
      await connection.commit();
      return { ...resultado, idempotente: true, atrasada: fechaActualizacionProveedor < anterior.actualizado };
    }

    const estadosReversion = new Set(['REEMBOLSADA']);
    const esReversion = estadosReversion.has(estadoDerivado);
    const estadoAnteriorFinal = anterior && (
      anterior.estado === 'processed:accredited'
      || anterior.estado === 'processed:partially_refunded'
      || anterior.estado === 'refunded:refunded'
      || anterior.estado.startsWith('failed:')
      || anterior.estado === 'canceled:canceled'
    );
    if (estadoAnteriorFinal
        && anterior.estado !== estadoProveedor
        && !esReversion) {
      throw errorPago(409, 'TRANSICION_PROVEEDOR_INVALIDA', 'La transición de la orden requiere revisión administrativa.');
    }

    let estadoTx = tx.Estado;
    let codigoProveedor = estadoProveedor;
    let pagoDuplicado = false;
    let confirmada = false;

    if (estadoDerivado === 'APROBADA') {
      const yaConfirmado = recibos.some((recibo) => recibo.pago === String(idRecursoValido)
        && recibo.estado === 'processed:accredited');
      if (String(cuota.Estado).trim().toLowerCase() === 'pagado') {
        if (yaConfirmado) {
          confirmada = tx.Estado === 'APROBADA';
        } else {
          pagoDuplicado = true;
          if (tx.Estado !== 'APROBADA') estadoTx = 'PAGO_DUPLICADO';
          await auditar(connection, {
            idPago: tx.IdPago,
            idAcademia: tx.IdAcademia,
            evento: 'PAGO_DUPLICADO_PROVEEDOR',
            estadoAnterior: cuota.Estado,
            estadoNuevo: cuota.Estado,
            montoAnterior: Number(cuota.Monto),
            montoNuevo: importe / 100,
            motivo: `Orden adicional ${idRecursoValido}; transacción ${tx.IdTransaccion}. Requiere revisión administrativa.`,
          });
        }
      } else {
        if (!['CREANDO', 'PENDIENTE', 'RECHAZADA', 'CANCELADA', 'EXPIRADA'].includes(tx.Estado)) {
          throw errorPago(409, 'ESTADO_TRANSACCION_NO_CONFIRMABLE', 'La transacción requiere revisión antes de confirmar la cuota.');
        }
        const [cambio] = await ejecutar(connection, 'sp_transacciones_actualizar_estado_cuota', [tx.IdPago, tx.IdUsuario]);
        if (cambio.affectedRows !== 1) throw errorPago(409, 'CUOTA_NO_ACTUALIZADA', 'No se pudo confirmar la cuota.');
        estadoTx = 'APROBADA';
        confirmada = true;
        await auditar(connection, {
          idPago: tx.IdPago,
          idAcademia: tx.IdAcademia,
          evento: `PAGO_${proveedorActual}_CONFIRMADO`,
          estadoAnterior: cuota.Estado,
          estadoNuevo: 'Pagado',
          montoAnterior: Number(cuota.Monto),
          montoNuevo: importe / 100,
          motivo: `Orden ${idRecursoValido}; transacción ${tx.IdTransaccion}. Verificado mediante Orders API.`,
        });
      }
    } else if (esReversion) {
      estadoTx = 'REEMBOLSADA';
    } else if (!['APROBADA', 'PAGO_DUPLICADO', 'REEMBOLSADA', 'CONTRACARGO'].includes(tx.Estado)) {
      estadoTx = estadoDerivado;
    }

    const [cambioTx] = await ejecutar(connection, 'sp_transacciones_actualizar_estado_proveedor', [
      estadoTx,
      orden,
      estadoProveedor,
      tx.IdTransaccion,
      proveedorActual,
    ]);
    if (cambioTx.affectedRows !== 1) {
      throw errorPago(409, 'TRANSACCION_NO_ACTUALIZADA', 'No se pudo actualizar la transacción del proveedor.');
    }

    await auditar(connection, {
      idPago: tx.IdPago,
      idAcademia: tx.IdAcademia,
      evento: eventoEstado,
      estadoAnterior: tx.Estado,
      estadoNuevo: estadoTx,
      montoAnterior: Number(tx.Monto),
      montoNuevo: importe / 100,
      motivo: JSON.stringify({
        v: 1,
        transaccion: Number(tx.IdTransaccion),
        pago: String(idRecursoValido),
        orden: orden,
        actualizado: fechaActualizacionProveedor,
        estado: estadoProveedor,
      }),
    });

    if (esReversion) {
      await auditar(connection, {
        idPago: tx.IdPago,
        idAcademia: tx.IdAcademia,
        evento: `${proveedorActual}_REQUIERE_REVISION`,
        estadoAnterior: cuota.Estado,
        estadoNuevo: cuota.Estado,
        montoAnterior: Number(cuota.Monto),
        montoNuevo: Number(cuota.Monto),
        motivo: `Mercado Pago reportó ${estadoProveedor} para la orden ${orden}. La mensualidad no se revierte automáticamente; requiere revisión.`,
      });
    }

    await connection.commit();
    return { ...resultado, confirmada, pagoDuplicado, requiereRevision: esReversion, idempotente: false };
  } catch (error) {
    await rollbackSeguro(connection);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function confirmarPagoProveedor(datos) {
  const proveedor = String(datos?.proveedor || PROVEEDOR).trim().toUpperCase();
  if (proveedor !== PROVEEDOR) throw errorPago(409, 'PROVEEDOR_NO_ADMITIDO', 'La orden no pertenece al proveedor configurado.');
  if (datos?.estado !== 'APROBADA' || datos?.estadoProveedor !== 'processed:accredited') {
    throw errorPago(409, 'PAGO_NO_APROBADO', 'La orden no figura como acreditada en Mercado Pago.');
  }
  const resultado = await aplicarPagoProveedor(datos);
  // La boleta electrónica se emite después del commit y no afecta la confirmación.
  if (resultado?.confirmada && resultado.idPago) boletas.programarEmision(resultado.idPago);
  return resultado;
}

async function actualizarEstadoNoAprobado(datos) {
  const proveedor = String(datos?.proveedor || PROVEEDOR).trim().toUpperCase();
  if (proveedor !== PROVEEDOR) throw errorPago(409, 'PROVEEDOR_NO_ADMITIDO', 'La orden no pertenece al proveedor configurado.');
  if (datos?.estado === 'APROBADA' || datos?.estadoProveedor === 'processed:accredited') {
    throw errorPago(409, 'ESTADO_PROVEEDOR_INVALIDO', 'Una orden acreditada debe pasar por la confirmación transaccional.');
  }
  return aplicarPagoProveedor(datos);
}

function filtroTexto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * Filtros administrativos validados. Devuelve null si alguno no es válido,
 * para responder 400 en lugar de ignorarlo en silencio.
 */
function normalizarFiltrosTransacciones(query = {}) {
  const filtros = { idCiclo: null, periodo: null, estado: null, limite: 50, desde: 0 };
  if (query.idCiclo !== undefined && query.idCiclo !== '') {
    filtros.idCiclo = idPositivo(query.idCiclo);
    if (!filtros.idCiclo) return null;
  }
  const periodo = filtroTexto(query.periodo);
  if (periodo) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo) && periodo.toLowerCase() !== 'inscripcion') return null;
    filtros.periodo = periodo.toLowerCase() === 'inscripcion' ? 'Inscripcion' : periodo;
  }
  const estado = filtroTexto(query.estado).toUpperCase();
  if (estado) {
    if (!ESTADOS_TRANSACCION.has(estado) && estado !== 'REQUIERE_REVISION') return null;
    filtros.estado = estado;
  }
  if (query.limite !== undefined && query.limite !== '') {
    const limite = idPositivo(query.limite);
    if (!limite || limite > 200) return null;
    filtros.limite = limite;
  }
  if (query.desde !== undefined && query.desde !== '') {
    if (!/^\d{1,9}$/.test(String(query.desde))) return null;
    filtros.desde = Number(query.desde);
  }
  return filtros;
}

function motivoRevision(row) {
  if (row.Estado === 'PAGO_DUPLICADO') return 'Pago adicional aprobado sobre una cuota ya pagada: evaluar devolución.';
  if (row.Estado === 'REEMBOLSADA') return 'Mercado Pago informó un reembolso: la cuota requiere revisión administrativa.';
  if (row.Estado === 'CONTRACARGO') return 'El proveedor informó un contracargo: la cuota requiere revisión administrativa.';
  if (row.Estado === 'CREANDO' && Number(row.AntiguedadSegundos) >= CREACION_HUERFANA_SEGUNDOS) {
    return 'Checkout pendiente de recuperación idempotente; no se abrirá una segunda orden.';
  }
  return null;
}

/** Listado de transacciones online de la academia del administrador. */
async function listarTransaccionesAdmin({ idAcademia, filtros }) {
  const academiaId = idPositivo(idAcademia);
  if (!academiaId || !filtros) throw errorPago(400, 'FILTROS_INVALIDOS', 'Los filtros de transacciones no son válidos.');
  const filtrosSql = [
    academiaId,
    filtros.idCiclo || null,
    filtros.periodo || null,
    filtros.estado || null,
    CREACION_HUERFANA_SEGUNDOS,
  ];
  const [totales] = await consultar(pool, 'sp_transacciones_contar_admin', filtrosSql);
  const [rows] = await consultar(pool, 'sp_transacciones_listar_admin', [
    ...filtrosSql,
    filtros.limite,
    filtros.desde,
  ]);
  return {
    transacciones: rows.map((row) => {
      const revision = motivoRevision(row);
      return {
        idTransaccion: Number(row.IdTransaccion),
        idPago: Number(row.IdPago),
        idUsuario: Number(row.IdUsuario),
        alumno: row.Alumno || null,
        codigoUsuario: row.CodigoUsuario || null,
        idCiclo: Number(row.IdCiclo),
        ciclo: row.Ciclo || null,
        periodo: row.Periodo || null,
        metodo: row.Proveedor === PROVEEDOR ? 'Mercado Pago' : `${row.Proveedor} (histórico)`,
        monto: Number(row.Monto),
        moneda: row.Moneda,
        estado: row.Estado,
        codigoProveedor: row.CodigoEstadoProveedor || null,
        referencia: row.ReferenciaInterna,
        idOrdenProveedor: row.IdOrdenProveedor || null,
        estadoCuota: row.EstadoCuota,
        montoCuota: Number(row.MontoCuota),
        fechaCreacion: row.FechaCreacion,
        fechaActualizacion: row.FechaActualizacion,
        fechaConfirmacion: row.FechaConfirmacion || null,
        requiereRevision: Boolean(revision),
        motivoRevision: revision,
      };
    }),
    paginacion: { total: Number(totales[0]?.Total || 0), limite: filtros.limite, desde: filtros.desde },
  };
}

/** Historial de auditoría de una cuota de la academia del administrador. */
async function auditoriaPagoAdmin({ idPago, idAcademia }) {
  const pagoId = idPositivo(idPago);
  const academiaId = idPositivo(idAcademia);
  if (!pagoId || !academiaId) throw errorPago(400, 'DATOS_INVALIDOS', 'La cuota no es válida.');
  const [cuotas] = await consultar(pool, 'sp_transacciones_verificar_cuota', [pagoId, academiaId]);
  if (!cuotas.length) throw errorPago(404, 'CUOTA_NO_ENCONTRADA', 'La cuota no existe en tu academia.');
  const [rows] = await consultar(pool, 'sp_transacciones_listar_auditoria_pago', [pagoId, academiaId]);
  return rows.map((row) => {
    let detalle = null;
    if (/_EVENTO$/.test(String(row.Evento || ''))) {
      try { detalle = JSON.parse(row.Motivo); } catch { detalle = null; }
    }
    return {
      idAuditoria: Number(row.IdAuditoria),
      evento: row.Evento,
      estadoAnterior: row.EstadoAnterior,
      estadoNuevo: row.EstadoNuevo,
      montoAnterior: row.MontoAnterior === null ? null : Number(row.MontoAnterior),
      montoNuevo: row.MontoNuevo === null ? null : Number(row.MontoNuevo),
      motivo: detalle ? `El proveedor informó "${detalle.estado}" para el pago ${detalle.pago}.` : row.Motivo,
      detalleProveedor: detalle,
      idComprobante: row.IdComprobante === null ? null : Number(row.IdComprobante),
      automatico: row.IdUsuarioActor === null,
      fecha: row.FechaCreacion,
    };
  });
}

/**
 * Referencia conciliable: la última transacción con orden creada.
 * Con idUsuario se limita al alumno; sin él, a la academia (administrador).
 */
async function obtenerReferenciaConciliable({ idPago = null, idTransaccion = null, idUsuario = null, idAcademia }) {
  const academiaId = idPositivo(idAcademia);
  const pagoId = idPago === null ? null : idPositivo(idPago);
  const txId = idTransaccion === null ? null : idPositivo(idTransaccion);
  const usuarioId = idUsuario === null ? null : idPositivo(idUsuario);
  if (!academiaId || (!pagoId && !txId) || (idUsuario !== null && !usuarioId)) {
    throw errorPago(400, 'DATOS_INVALIDOS', 'No se pudo identificar la transacción.');
  }
  const [rows] = await consultar(pool, 'sp_transacciones_obtener_conciliable', [
    academiaId,
    PROVEEDOR,
    pagoId || null,
    txId || null,
    usuarioId || null,
  ]);
  if (!rows.length) return null;
  return { idTransaccion: Number(rows[0].IdTransaccion), idPago: Number(rows[0].IdPago),
    referenciaInterna: rows[0].ReferenciaInterna, idOrdenProveedor: rows[0].IdOrdenProveedor,
    estado: rows[0].Estado };
}

module.exports = {
  PROVEEDOR,
  MONEDA,
  aCentimos,
  reservarCheckoutAlumno,
  guardarOrdenCreada,
  marcarErrorCreacion,
  obtenerEstadoPagoAlumno,
  confirmarPagoProveedor,
  actualizarEstadoNoAprobado,
  normalizarFiltrosTransacciones,
  listarTransaccionesAdmin,
  auditoriaPagoAdmin,
  obtenerReferenciaConciliable,
};
