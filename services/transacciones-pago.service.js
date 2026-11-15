
'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const { rollbackSeguro } = require('../utils/validaciones');
const { ErrorPago, aCentimos, idOrdenCulqi } = require('../utils/pagos-proveedor');
const { consultar, ejecutar } = require('../config/procedimientos');

const PROVEEDOR = 'CULQI';
const MONEDA = 'PEN';

// Una reserva en CREANDO sin orden guardada después de 2 minutos es huérfana:
// la orden nunca llegó al alumno, así que nadie puede pagarla.
const CREACION_HUERFANA_SEGUNDOS = 120;
const ESTADOS_TRANSACCION = new Set(['CREANDO', 'PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA',
  'REEMBOLSADA', 'CONTRACARGO', 'PAGO_DUPLICADO', 'ERROR', 'EXPIRADA']);

function errorPago(status, code, message) {
  return new ErrorPago(status, code, message);
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
  if (proveedorActual !== 'CULQI') {
    throw errorPago(400, 'PROVEEDOR_INVALIDO', 'El proveedor de pago no está admitido.');
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
    if (proveedorActual === 'CULQI' && (montoCentimos < 600 || montoCentimos > 50000)) {
      await connection.rollback();
      throw errorPago(422, 'MONTO_FUERA_DE_RANGO_BILLETERAS',
        'El pago con billeteras móviles debe estar entre S/ 6.00 y S/ 500.00. Contacta con la academia para otra forma de pago.');
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
          'El importe de la cuota cambió desde tu último intento. Podrás pagar con el importe nuevo cuando venza el checkout anterior (máximo 65 minutos).');
      }

      if (proveedorActual === 'CULQI' && actual.Estado === 'PENDIENTE'
          && idOrdenCulqi(actual.IdOrdenProveedor)) {
        await connection.commit();
        return {
          reutilizada: true, enPreparacion: false,
          idPago: pagoId,
          idTransaccion: Number(actual.IdTransaccion),
          referenciaInterna: actual.ReferenciaInterna,
          idempotencyKey: actual.ClaveIdempotencia,
          idOrdenProveedor: actual.IdOrdenProveedor,
          monto: Number(actual.Monto), moneda: actual.Moneda, estado: actual.Estado,
          proveedor: proveedorActual,
          ...datosAlumno,
        };
      }

      if (proveedorActual === 'CULQI' && actual.Estado === 'CREANDO'
          && idOrdenCulqi(actual.IdOrdenProveedor)) {
        await connection.commit();
        return {
          reutilizada: false, enPreparacion: false, requiereConfirmacion: true,
          idPago: pagoId,
          idTransaccion: Number(actual.IdTransaccion),
          referenciaInterna: actual.ReferenciaInterna,
          idempotencyKey: actual.ClaveIdempotencia,
          idOrdenProveedor: actual.IdOrdenProveedor,
          monto: Number(actual.Monto), moneda: actual.Moneda, estado: actual.Estado,
          proveedor: proveedorActual,
          ...datosAlumno,
        };
      }

      await connection.commit();
      return {
        reutilizada: false,
        enPreparacion: true,
        idTransaccion: Number(actual.IdTransaccion),
        estado: actual.Estado,
      };
    }

    const referenciaInterna = `ACS-${pagoId}-${crypto.randomUUID()}`;
    const idempotencyKey = `ACS-${crypto.randomUUID()}`;
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
  checkoutUrl = null,
  estadoProveedor = 'pending',
  proveedor = PROVEEDOR,
}) {
  const id = idPositivo(idTransaccion);
  const proveedorActual = String(proveedor || PROVEEDOR).trim().toUpperCase();
  const orden = idOrdenCulqi(idOrdenProveedor);
  if (!id || proveedorActual !== 'CULQI' || !orden || orden !== String(idOrdenProveedor).trim()
      || (checkoutUrl !== null && checkoutUrl !== undefined && checkoutUrl !== '')) {
    throw errorPago(400, 'ORDEN_CULQI_INVALIDA', 'Los datos de la orden Culqi no son válidos.');
  }

  const estadoProveedorActual = String(estadoProveedor || '').trim().toLowerCase();
  if (!['created', 'pending'].includes(estadoProveedorActual)) {
    throw errorPago(409, 'ESTADO_ORDEN_CULQI_INVALIDO', 'Culqi devolvió un estado de orden no esperado.');
  }

  await ejecutar(pool, 'sp_transacciones_guardar_orden_proveedor', [orden, estadoProveedorActual, id]);

  const [rows] = await consultar(pool, 'sp_transacciones_obtener_transaccion_por_id_transaccion', [id]);
  if (!rows.length) {
    throw errorPago(404, 'TRANSACCION_NO_ENCONTRADA', 'No se encontró la transacción creada.');
  }
  if (rows[0].IdOrdenProveedor !== orden || rows[0].Estado === 'ERROR') {
    throw errorPago(409, 'ORDEN_NO_GUARDADA', 'La orden Culqi no coincide con la transacción reservada.');
  }
  return rows[0];
}

async function marcarErrorCreacion(idTransaccion, proveedor = PROVEEDOR) {
  const id = idPositivo(idTransaccion);
  const proveedorActual = String(proveedor || PROVEEDOR).trim().toUpperCase();
  if (!id || proveedorActual !== 'CULQI') return;
  await ejecutar(pool, 'sp_transacciones_marcar_error_creacion', [id]);
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
      orderId: row.Proveedor === 'CULQI' ? row.IdOrdenProveedor : null,
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
async function aplicarPagoProveedor(datos) {
  const proveedorActual = String(datos?.proveedor || PROVEEDOR).trim().toUpperCase();
  const { referenciaInterna: referencia, idOrdenProveedor: orden, idPagoProveedor,
    idTransaccion, idPago: idPagoMetadata, monto, moneda, estadoProveedor, fechaActualizacionProveedor } = datos;
  if (proveedorActual !== 'CULQI') {
    throw errorPago(409, 'PROVEEDOR_NO_ADMITIDO', 'La notificación pertenece a un proveedor no admitido.');
  }

  const esCulqi = proveedorActual === 'CULQI';
  const estadoAprobado = esCulqi ? 'paid' : 'approved';
  const estados = esCulqi
    ? { created: 'PENDIENTE', pending: 'PENDIENTE', paid: 'APROBADA', expired: 'EXPIRADA', deleted: 'CANCELADA' }
    : { approved: 'APROBADA', pending: 'PENDIENTE', in_process: 'PENDIENTE',
      authorized: 'PENDIENTE', in_mediation: 'PENDIENTE', rejected: 'RECHAZADA',
      cancelled: 'CANCELADA', refunded: 'REEMBOLSADA', charged_back: 'CONTRACARGO' };
  const importe = aCentimos(monto);
  const idOrdenValido = idOrdenCulqi(orden);
  const idPagoProveedorValido = idOrdenCulqi(idPagoProveedor);
  if (typeof referencia !== 'string' || !/^ACS-[1-9]\d*-[-a-f0-9]{36}$/.test(referencia)
      || !idOrdenValido || !idPagoProveedorValido || !idPositivo(idTransaccion) || !importe
      || moneda !== MONEDA || !Object.hasOwn(estados, estadoProveedor)
      || datos.estado !== estados[estadoProveedor]
      || !Number.isSafeInteger(fechaActualizacionProveedor) || fechaActualizacionProveedor <= 0) {
    throw errorPago(409, 'EVENTO_PAGO_INVALIDO', 'La operación verificada no contiene los datos requeridos.');
  }
  if (esCulqi && (String(idPagoProveedor) !== String(orden)
      || !idPositivo(idPagoMetadata)
      || !referencia.startsWith(`ACS-${Number(idPagoMetadata)}-`))) {
    throw errorPago(409, 'ORDEN_CULQI_NO_COINCIDE', 'La orden, cuota y referencia no coinciden con la notificación.');
  }

  let connection;
  try {
    // Localizar sin lock, luego tomar cuota ANTES de transacción, como checkout.
    const [localizadas] = await consultar(pool, 'sp_transacciones_obtener_transaccion_por_proveedor', [proveedorActual, referencia]);
    if (!localizadas.length) throw errorPago(404, 'TRANSACCION_NO_ENCONTRADA', 'No existe la transacción notificada.');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [cuotas] = await consultar(connection, 'sp_transacciones_bloquear_cuota', [localizadas[0].IdPago]);
    if (!cuotas.length) throw errorPago(404, 'CUOTA_NO_ENCONTRADA', 'No existe la cuota relacionada.');
    const cuota = cuotas[0];
    const [rows] = await consultar(connection, 'sp_transacciones_bloquear_transaccion_por_proveedor', [proveedorActual, referencia]);
    const tx = rows[0];
    if (!tx || Number(tx.IdTransaccion) !== Number(idTransaccion) || tx.ReferenciaInterna !== referencia
        || Number(tx.IdPago) !== Number(cuota.IdPago) || Number(tx.IdUsuario) !== Number(cuota.IdUsuario)
        || Number(tx.IdAcademia) !== Number(cuota.IdAcademia) || tx.Proveedor !== proveedorActual
        || (esCulqi && Number(tx.IdPago) !== Number(idPagoMetadata))) {
      throw errorPago(409, 'TRANSACCION_NO_COINCIDE', 'El pago no corresponde a la transacción y cuota registradas.');
    }
    if ((tx.IdOrdenProveedor && tx.IdOrdenProveedor !== orden)
        || (!tx.IdOrdenProveedor && tx.Estado !== 'CREANDO')) {
      throw errorPago(409, 'ORDEN_NO_COINCIDE', 'La orden no coincide con la transacción interna.');
    }
    if (aCentimos(tx.Monto) !== importe || aCentimos(cuota.Monto) !== importe || tx.Moneda !== MONEDA) {
      throw errorPago(409, 'IMPORTE_NO_COINCIDE', 'El importe o moneda no coincide con la cuota registrada.');
    }

    const eventoEstado = `${proveedorActual}_EVENTO`;
    const [auditorias] = await consultar(connection, 'sp_transacciones_bloquear_auditoria_pago', [tx.IdPago, tx.IdAcademia, eventoEstado]);
    const recibos = auditorias.map(row => {
      let recibo;
      try { recibo = JSON.parse(row.Motivo); } catch { /* falla cerrada */ }
      const reciboPagoValido = idOrdenCulqi(recibo?.pago);
      if (!recibo || recibo.v !== 1 || !reciboPagoValido
          || !idPositivo(recibo.transaccion) || !Number.isSafeInteger(recibo.actualizado)
          || !Object.hasOwn(estados, recibo.estado)) {
        throw errorPago(409, 'AUDITORIA_PAGO_INVALIDA', 'La auditoría del proveedor requiere revisión.');
      }
      return recibo;
    }).filter(r => Number(r.transaccion) === Number(tx.IdTransaccion));
    const anterior = recibos.find(r => r.pago === String(idPagoProveedor));
    const resultado = { idPago: Number(tx.IdPago), idTransaccion: Number(tx.IdTransaccion) };
    if (anterior && fechaActualizacionProveedor <= anterior.actualizado) {
      if (fechaActualizacionProveedor === anterior.actualizado && anterior.estado !== estadoProveedor) {
        throw errorPago(409, 'VERSION_PAGO_CONFLICTIVA', 'El proveedor devolvió estados distintos para la misma versión.');
      }
      await connection.commit();
      return { ...resultado, idempotente: true, atrasada: fechaActualizacionProveedor < anterior.actualizado };
    }
    const estadosFinales = ['paid', 'expired', 'deleted'];
    const estadosReversion = [];
    if (anterior && estadosFinales.includes(anterior.estado)
        && !estadosReversion.includes(estadoProveedor) && estadoProveedor !== anterior.estado) {
      throw errorPago(409, 'TRANSICION_PROVEEDOR_INVALIDA', 'La transición del pago requiere conciliación.');
    }

    let estadoTx = tx.Estado;
    let codigoProveedor = tx.CodigoEstadoProveedor;
    let pagoDuplicado = false;
    let confirmada = false;
    const esReversion = estadosReversion.includes(estadoProveedor);
    if (estadoProveedor === estadoAprobado) {
      codigoProveedor = estadoProveedor;
      const yaConfirmado = recibos.some(r => r.pago === String(idPagoProveedor) && r.estado === estadoAprobado);
      if (String(cuota.Estado).toLowerCase() === 'pagado') {
        if (yaConfirmado) {
          confirmada = tx.Estado === 'APROBADA';
        } else {
          pagoDuplicado = true;
          if (tx.Estado !== 'APROBADA') estadoTx = 'PAGO_DUPLICADO';
          await auditar(connection, {
            idPago: tx.IdPago, idAcademia: tx.IdAcademia, evento: 'PAGO_DUPLICADO_PROVEEDOR',
            estadoAnterior: cuota.Estado, estadoNuevo: cuota.Estado,
            montoAnterior: Number(cuota.Monto), montoNuevo: importe / 100,
            motivo: `Pago adicional ${idPagoProveedor}; transacción ${tx.IdTransaccion}. Requiere revisión administrativa.`,
          });
        }
      } else {
        if (!['CREANDO', 'PENDIENTE', 'RECHAZADA', 'CANCELADA', 'EXPIRADA'].includes(tx.Estado)) {
          throw errorPago(409, 'ESTADO_TRANSACCION_NO_CONFIRMABLE', 'La transacción requiere conciliación.');
        }
        const [cambio] = await ejecutar(connection, 'sp_transacciones_actualizar_estado_cuota', [tx.IdPago, tx.IdUsuario]);
        if (cambio.affectedRows !== 1) throw errorPago(409, 'CUOTA_NO_ACTUALIZADA', 'No se pudo confirmar la cuota.');
        estadoTx = 'APROBADA';
        confirmada = true;
        await auditar(connection, {
          idPago: tx.IdPago, idAcademia: tx.IdAcademia,
          evento: `PAGO_${proveedorActual}_CONFIRMADO`,
          estadoAnterior: cuota.Estado, estadoNuevo: 'Pagado',
          montoAnterior: Number(cuota.Monto), montoNuevo: importe / 100,
          motivo: `Pago ${idPagoProveedor}; orden ${orden}; transacción ${tx.IdTransaccion}. Verificado con API.`,
        });
      }
    } else if (!['APROBADA', 'PAGO_DUPLICADO', 'REEMBOLSADA', 'CONTRACARGO', 'EXPIRADA'].includes(tx.Estado)
        && !recibos.some(r => r.actualizado >= fechaActualizacionProveedor)) {
      estadoTx = estados[estadoProveedor];
      codigoProveedor = estadoProveedor;
    }

    const [cambioTx] = await ejecutar(connection, 'sp_transacciones_actualizar_estado_proveedor', [
        estadoTx,
        orden,
        codigoProveedor || estadoProveedor,
        tx.IdTransaccion,
        proveedorActual,
      ]);
    if (cambioTx.affectedRows !== 1) throw errorPago(409, 'TRANSACCION_NO_ACTUALIZADA', 'No se pudo actualizar la transacción.');
    await auditar(connection, {
      idPago: tx.IdPago, idAcademia: tx.IdAcademia, evento: eventoEstado,
      estadoAnterior: tx.Estado, estadoNuevo: estadoTx,
      montoAnterior: Number(tx.Monto), montoNuevo: importe / 100,
      motivo: JSON.stringify({ v: 1, transaccion: Number(tx.IdTransaccion), pago: String(idPagoProveedor),
        preferencia: orden, actualizado: fechaActualizacionProveedor, estado: estadoProveedor }),
    });
    if (esReversion) {
      await auditar(connection, {
        idPago: tx.IdPago, idAcademia: tx.IdAcademia, evento: `${proveedorActual}_REQUIERE_REVISION`,
        estadoAnterior: cuota.Estado, estadoNuevo: cuota.Estado,
        montoAnterior: Number(cuota.Monto), montoNuevo: Number(cuota.Monto),
        motivo: `Pago ${idPagoProveedor}: ${estadoProveedor}. Conciliar manualmente; no se revierte la cuota automáticamente.`,
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
  if (proveedor !== 'CULQI') throw errorPago(409, 'PROVEEDOR_NO_ADMITIDO', 'Solo se admite Culqi.');
  const estadoEsperado = 'paid';
  if (datos?.estadoProveedor !== estadoEsperado) throw errorPago(409, 'PAGO_NO_APROBADO', 'La operación no está aprobada.');
  return aplicarPagoProveedor(datos);
}

async function actualizarEstadoNoAprobado(datos) {
  const proveedor = String(datos?.proveedor || PROVEEDOR).trim().toUpperCase();
  if (proveedor !== 'CULQI') throw errorPago(409, 'PROVEEDOR_NO_ADMITIDO', 'Solo se admite Culqi.');
  const estadoAprobado = 'paid';
  if (datos?.estadoProveedor === estadoAprobado) throw errorPago(409, 'ESTADO_PROVEEDOR_INVALIDO', 'Usa la confirmación transaccional.');
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
  if (row.Estado === 'REEMBOLSADA') return 'Culqi informó un reembolso: la cuota no se revirtió automáticamente.';
  if (row.Estado === 'CONTRACARGO') return 'Culqi informó un contracargo: la cuota no se revirtió automáticamente.';
  if (row.Estado === 'CREANDO' && Number(row.AntiguedadSegundos) >= CREACION_HUERFANA_SEGUNDOS) {
    return 'Checkout sin confirmar del proveedor; se descartará en el próximo intento del alumno.';
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
        metodo: row.Proveedor === PROVEEDOR ? 'Culqi' : row.Proveedor,
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
