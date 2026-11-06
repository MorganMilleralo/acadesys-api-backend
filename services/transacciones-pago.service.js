'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const { rollbackSeguro } = require('../utils/validaciones');
const { ErrorPago, aCentimos, idProveedor, urlCheckoutValida } = require('../utils/pagos-proveedor');

const PROVEEDOR = 'MERCADOPAGO';
const MONEDA = 'PEN';

function errorPago(status, code, message) {
  return new ErrorPago(status, code, message);
}

function idPositivo(valor) {
  if (!['number', 'string'].includes(typeof valor) || !/^[1-9]\d*$/.test(String(valor))) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

async function auditar(connection, datos) {
  const [resultado] = await connection.query(
    `INSERT INTO PagoAuditoria
      (IdPago, IdComprobante, IdUsuarioActor, IdAcademia, Evento,
       EstadoAnterior, EstadoNuevo, MontoAnterior, MontoNuevo, Motivo, FechaCreacion)
     VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      datos.idPago,
      datos.idAcademia,
      datos.evento,
      datos.estadoAnterior ?? null,
      datos.estadoNuevo ?? null,
      datos.montoAnterior ?? null,
      datos.montoNuevo ?? null,
      datos.motivo ?? null,
    ],
  );
  if (resultado.affectedRows !== 1) throw errorPago(503, 'AUDITORIA_NO_GUARDADA', 'No se pudo registrar la auditoría del pago.');
}

/**
 * Reserva una transacción para una cuota que pertenece al alumno autenticado.
 * La fila de PagosMensualidad se bloquea antes de comprobar si ya existe un
 * checkout pendiente, evitando dos reservas concurrentes para la misma cuota.
 */
async function reservarCheckoutAlumno({ idPago, idUsuario, idAcademia }) {
  const pagoId = idPositivo(idPago);
  const usuarioId = idPositivo(idUsuario);
  const academiaId = idPositivo(idAcademia);
  if (!pagoId || !usuarioId || !academiaId) {
    throw errorPago(400, 'DATOS_INVALIDOS', 'No se pudo identificar la cuota o la sesión del alumno.');
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [pagos] = await connection.query(
      `SELECT p.IdPago, p.IdUsuario, p.IdCiclo, p.Mes, p.Monto, p.Estado,
              u.IdAcademia, u.CorreoElectronico,
              CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, NULLIF(u.ApellidoMaterno, '')) AS Alumno,
              c.Nombre AS Ciclo
       FROM PagosMensualidad p
       INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
       INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
       WHERE p.IdPago = ? AND p.IdUsuario = ? AND u.IdAcademia = ?
         AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [pagoId, usuarioId, academiaId],
    );

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
      throw errorPago(409, 'CUOTA_NO_COBRABLE', 'La cuota no está en un estado cobrable.');
    }

    const montoCentimos = aCentimos(pago.Monto);
    if (montoCentimos === null || montoCentimos <= 0) {
      await connection.rollback();
      throw errorPago(409, 'MONTO_NO_COBRABLE', 'La cuota no tiene un importe válido para pagar online.');
    }

    const [existentes] = await connection.query(
      `SELECT IdTransaccion, ReferenciaInterna, IdOrdenProveedor, ClaveIdempotencia,
              Monto, Moneda, Estado, UrlCheckout
       FROM PagoTransaccion
       WHERE IdPago = ? AND IdUsuario = ? AND IdAcademia = ?
         AND Proveedor = ? AND EstadoRegistro = 1
         AND Estado <> 'ERROR'
       ORDER BY IdTransaccion DESC LIMIT 1 FOR UPDATE`,
      [pagoId, usuarioId, academiaId, PROVEEDOR],
    );

    if (existentes.length) {
      const actual = existentes[0];
      if (aCentimos(actual.Monto) !== montoCentimos || actual.Moneda !== MONEDA) {
        throw errorPago(409, 'CHECKOUT_IMPORTE_CAMBIADO', 'La cuota cambió desde el intento previo; requiere conciliación.');
      }
      if (['PENDIENTE', 'RECHAZADA', 'CANCELADA'].includes(actual.Estado)
          && actual.IdOrdenProveedor && urlCheckoutValida(actual.UrlCheckout)) {
        await connection.commit();
        return {
          reutilizada: true,
          enPreparacion: false,
          idTransaccion: Number(actual.IdTransaccion),
          referenciaInterna: actual.ReferenciaInterna,
          idempotencyKey: actual.ClaveIdempotencia,
          monto: Number(actual.Monto),
          moneda: actual.Moneda,
          estado: actual.Estado,
          checkoutUrl: actual.UrlCheckout,
          emailAlumno: pago.CorreoElectronico || null,
          alumno: pago.Alumno || 'Alumno',
          ciclo: pago.Ciclo || 'Ciclo académico',
          concepto: String(pago.Mes || ''),
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
    const [insertado] = await connection.query(
      `INSERT INTO PagoTransaccion
        (IdPago, IdUsuario, IdAcademia, Proveedor, ReferenciaInterna,
         ClaveIdempotencia, Monto, Moneda, Estado, FechaCreacion, FechaActualizacion, EstadoRegistro)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CREANDO', NOW(), NOW(), 1)`,
      [pagoId, usuarioId, academiaId, PROVEEDOR, referenciaInterna, idempotencyKey, Number(pago.Monto), MONEDA],
    );

    await connection.commit();
    return {
      reutilizada: false,
      enPreparacion: false,
      idTransaccion: Number(insertado.insertId),
      referenciaInterna,
      idempotencyKey,
      monto: Number(pago.Monto),
      moneda: MONEDA,
      estado: 'CREANDO',
      checkoutUrl: null,
      emailAlumno: pago.CorreoElectronico || null,
      alumno: pago.Alumno || 'Alumno',
      ciclo: pago.Ciclo || 'Ciclo académico',
      concepto: String(pago.Mes || ''),
    };
  } catch (error) {
    await rollbackSeguro(connection);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function guardarOrdenCreada({ idTransaccion, idOrdenProveedor, checkoutUrl, estadoProveedor = 'pending' }) {
  const id = idPositivo(idTransaccion);
  const orden = String(idOrdenProveedor || '').trim();
  const url = String(checkoutUrl || '').trim();
  if (!id || !orden || orden.length > 120) throw errorPago(400, 'ORDEN_INVALIDA', 'El proveedor no devolvió un identificador de orden válido.');
  let urlValidada;
  try { urlValidada = new URL(url); } catch { throw errorPago(502, 'URL_CHECKOUT_INVALIDA', 'El proveedor no devolvió una URL de checkout válida.'); }
  if (!urlCheckoutValida(url)) throw errorPago(502, 'URL_CHECKOUT_INVALIDA', 'La URL debe ser un checkout HTTPS de Mercado Pago Perú.');

  const [actualizacion] = await pool.query(
    `UPDATE PagoTransaccion
     SET IdOrdenProveedor = ?, UrlCheckout = ?,
         CodigoEstadoProveedor = IF(Estado = 'CREANDO', ?, CodigoEstadoProveedor),
         Estado = IF(Estado = 'CREANDO', 'PENDIENTE', Estado),
         FechaActualizacion = NOW()
     WHERE IdTransaccion = ? AND EstadoRegistro = 1
       AND Proveedor = 'MERCADOPAGO'
       AND (IdOrdenProveedor IS NULL OR IdOrdenProveedor = ?)
       AND Estado <> 'ERROR'`,
    [orden, urlValidada.toString(), String(estadoProveedor).slice(0, 80), id, orden],
  );
  if (actualizacion.affectedRows !== 1) throw errorPago(409, 'ORDEN_NO_GUARDADA', 'No se pudo guardar el checkout; requiere conciliación.');
  const [rows] = await pool.query(
    `SELECT IdTransaccion, Estado, UrlCheckout FROM PagoTransaccion
     WHERE IdTransaccion = ? AND EstadoRegistro = 1 LIMIT 1`,
    [id],
  );
  if (!rows.length) throw errorPago(404, 'TRANSACCION_NO_ENCONTRADA', 'No se encontró la transacción creada.');
  return rows[0];
}

async function marcarErrorCreacion(idTransaccion) {
  const id = idPositivo(idTransaccion);
  if (!id) return;
  await pool.query(
    `UPDATE PagoTransaccion SET Estado = 'ERROR', FechaActualizacion = NOW()
     WHERE IdTransaccion = ? AND Estado = 'CREANDO' AND EstadoRegistro = 1`,
    [id],
  );
}

async function obtenerEstadoPagoAlumno({ idPago, idUsuario, idAcademia }) {
  const pagoId = idPositivo(idPago);
  const usuarioId = idPositivo(idUsuario);
  const academiaId = idPositivo(idAcademia);
  if (!pagoId || !usuarioId || !academiaId) throw errorPago(400, 'DATOS_INVALIDOS', 'La cuota seleccionada no es válida.');
  const [rows] = await pool.query(
    `SELECT p.IdPago, p.Estado AS EstadoPago, p.Monto,
            pt.IdTransaccion, pt.Proveedor, pt.Estado AS EstadoTransaccion,
            pt.IdOrdenProveedor, pt.ReferenciaInterna, pt.UrlCheckout,
            pt.Monto AS MontoTransaccion, pt.Moneda, pt.FechaCreacion,
            pt.FechaConfirmacion
     FROM PagosMensualidad p
     INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
     INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
     LEFT JOIN PagoTransaccion pt ON pt.IdTransaccion = (
       SELECT MAX(pt2.IdTransaccion) FROM PagoTransaccion pt2
       WHERE pt2.IdPago = p.IdPago AND pt2.IdUsuario = p.IdUsuario
         AND pt2.IdAcademia = u.IdAcademia AND pt2.EstadoRegistro = 1
     )
     WHERE p.IdPago = ? AND p.IdUsuario = ? AND u.IdAcademia = ?
       AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
     LIMIT 1`,
    [pagoId, usuarioId, academiaId],
  );
  if (!rows.length) throw errorPago(404, 'CUOTA_NO_ENCONTRADA', 'La cuota no existe en tu cuenta.');
  const row = rows[0];
  return {
    idPago: Number(row.IdPago),
    estadoPago: row.EstadoPago,
    monto: Number(row.Monto),
    transaccion: row.IdTransaccion ? {
      idTransaccion: Number(row.IdTransaccion),
      proveedor: row.Proveedor,
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
 * Solo recibe datos normalizados tras firma + consultas al SDK. La auditoría
 * existente guarda la versión de cada pago, sin ampliar el esquema de Morgan.
 */
async function aplicarPagoProveedor(datos) {
  const { referenciaInterna: referencia, idOrdenProveedor: orden, idPagoProveedor,
    idTransaccion, monto, moneda, estadoProveedor, fechaActualizacionProveedor } = datos;
  const estados = { approved: 'APROBADA', pending: 'PENDIENTE', in_process: 'PENDIENTE',
    authorized: 'PENDIENTE', in_mediation: 'PENDIENTE', rejected: 'RECHAZADA',
    cancelled: 'CANCELADA', refunded: 'REEMBOLSADA', charged_back: 'CONTRACARGO' };
  const importe = aCentimos(monto);
  if (datos.proveedor !== PROVEEDOR || typeof referencia !== 'string' || !/^ACS-[1-9]\d*-[-a-f0-9]{36}$/.test(referencia)
      || typeof orden !== 'string' || !/^[\w-]{1,120}$/.test(orden)
      || !idProveedor(idPagoProveedor) || !idPositivo(idTransaccion) || !importe
      || moneda !== MONEDA || !Object.hasOwn(estados, estadoProveedor)
      || datos.estado !== estados[estadoProveedor]
      || !Number.isSafeInteger(fechaActualizacionProveedor) || fechaActualizacionProveedor <= 0) {
    throw errorPago(409, 'EVENTO_PAGO_INVALIDO', 'La operación verificada no contiene los datos requeridos.');
  }

  let connection;
  try {
    // Localizar sin lock, luego tomar cuota ANTES de transacción, como checkout.
    const [localizadas] = await pool.query(
      'SELECT IdPago FROM PagoTransaccion WHERE Proveedor = ? AND ReferenciaInterna = ? AND EstadoRegistro = 1 LIMIT 1',
      [PROVEEDOR, referencia],
    );
    if (!localizadas.length) throw errorPago(404, 'TRANSACCION_NO_ENCONTRADA', 'No existe la transacción notificada.');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [cuotas] = await connection.query(
      `SELECT p.IdPago, p.IdUsuario, p.Monto, p.Estado, u.IdAcademia
       FROM PagosMensualidad p
       INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
       INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
       WHERE p.IdPago = ? AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`, [localizadas[0].IdPago],
    );
    if (!cuotas.length) throw errorPago(404, 'CUOTA_NO_ENCONTRADA', 'No existe la cuota relacionada.');
    const cuota = cuotas[0];
    const [rows] = await connection.query(
      `SELECT IdTransaccion, IdPago, IdUsuario, IdAcademia, ReferenciaInterna,
              IdOrdenProveedor, Monto, Moneda, Estado, CodigoEstadoProveedor
       FROM PagoTransaccion
       WHERE Proveedor = ? AND ReferenciaInterna = ? AND EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`, [PROVEEDOR, referencia],
    );
    const tx = rows[0];
    if (!tx || Number(tx.IdTransaccion) !== Number(idTransaccion) || tx.ReferenciaInterna !== referencia
        || Number(tx.IdPago) !== Number(cuota.IdPago) || Number(tx.IdUsuario) !== Number(cuota.IdUsuario)
        || Number(tx.IdAcademia) !== Number(cuota.IdAcademia)) {
      throw errorPago(409, 'TRANSACCION_NO_COINCIDE', 'El pago no corresponde a la transacción y cuota registradas.');
    }
    if ((tx.IdOrdenProveedor && tx.IdOrdenProveedor !== orden)
        || (!tx.IdOrdenProveedor && tx.Estado !== 'CREANDO')) {
      throw errorPago(409, 'ORDEN_NO_COINCIDE', 'La preferencia no coincide con la transacción interna.');
    }
    if (aCentimos(tx.Monto) !== importe || aCentimos(cuota.Monto) !== importe || tx.Moneda !== MONEDA) {
      throw errorPago(409, 'IMPORTE_NO_COINCIDE', 'El importe o moneda no coincide con la cuota registrada.');
    }
    const [auditorias] = await connection.query(
      `SELECT IdAuditoria, Motivo FROM PagoAuditoria
       WHERE IdPago = ? AND IdAcademia = ? AND Evento = 'MERCADOPAGO_EVENTO'
       ORDER BY IdAuditoria DESC FOR UPDATE`, [tx.IdPago, tx.IdAcademia],
    );
    const recibos = auditorias.map(row => {
      let recibo;
      try { recibo = JSON.parse(row.Motivo); } catch { /* falla cerrada */ }
      if (!recibo || recibo.v !== 1 || !idProveedor(recibo.pago)
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
    if (anterior && ['approved', 'refunded', 'charged_back', 'cancelled', 'rejected'].includes(anterior.estado)
        && !['refunded', 'charged_back'].includes(estadoProveedor)
        && estadoProveedor !== anterior.estado) {
      throw errorPago(409, 'TRANSICION_PROVEEDOR_INVALIDA', 'La transición del pago requiere conciliación.');
    }

    let estadoTx = tx.Estado;
    let codigoProveedor = tx.CodigoEstadoProveedor;
    let pagoDuplicado = false;
    let confirmada = false;
    const esReversion = ['refunded', 'charged_back'].includes(estadoProveedor);
    if (estadoProveedor === 'approved') {
      codigoProveedor = estadoProveedor;
      const yaConfirmado = recibos.some(r => r.pago === String(idPagoProveedor) && r.estado === 'approved');
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
        if (!['CREANDO', 'PENDIENTE', 'RECHAZADA', 'CANCELADA'].includes(tx.Estado)) {
          throw errorPago(409, 'ESTADO_TRANSACCION_NO_CONFIRMABLE', 'La transacción requiere conciliación.');
        }
        const [cambio] = await connection.query(
          `UPDATE PagosMensualidad SET Estado = 'Pagado', FechaPago = COALESCE(FechaPago, NOW())
           WHERE IdPago = ? AND IdUsuario = ? AND EstadoRegistro = 1 AND Estado IN ('Pendiente', 'Moroso')`,
          [tx.IdPago, tx.IdUsuario],
        );
        if (cambio.affectedRows !== 1) throw errorPago(409, 'CUOTA_NO_ACTUALIZADA', 'No se pudo confirmar la cuota.');
        estadoTx = 'APROBADA';
        confirmada = true;
        await auditar(connection, {
          idPago: tx.IdPago, idAcademia: tx.IdAcademia, evento: 'PAGO_MERCADOPAGO_CONFIRMADO',
          estadoAnterior: cuota.Estado, estadoNuevo: 'Pagado',
          montoAnterior: Number(cuota.Monto), montoNuevo: importe / 100,
          motivo: `Pago ${idPagoProveedor}; preferencia ${orden}; transacción ${tx.IdTransaccion}. Verificado con API.`,
        });
      }
    } else if (!['APROBADA', 'PAGO_DUPLICADO', 'REEMBOLSADA', 'CONTRACARGO'].includes(tx.Estado)
        && !recibos.some(r => r.actualizado >= fechaActualizacionProveedor)) {
      estadoTx = estados[estadoProveedor];
      codigoProveedor = estadoProveedor;
    }

    const [cambioTx] = await connection.query(
      `UPDATE PagoTransaccion SET Estado = ?, IdOrdenProveedor = ?,
         CodigoEstadoProveedor = ?, FechaActualizacion = NOW(),
         FechaConfirmacion = IF(? = 'APROBADA', COALESCE(FechaConfirmacion, NOW()), FechaConfirmacion)
       WHERE IdTransaccion = ? AND EstadoRegistro = 1`,
      [estadoTx, orden, codigoProveedor || estadoProveedor, estadoTx, tx.IdTransaccion],
    );
    if (cambioTx.affectedRows !== 1) throw errorPago(409, 'TRANSACCION_NO_ACTUALIZADA', 'No se pudo actualizar la transacción.');
    await auditar(connection, {
      idPago: tx.IdPago, idAcademia: tx.IdAcademia, evento: 'MERCADOPAGO_EVENTO',
      estadoAnterior: tx.Estado, estadoNuevo: estadoTx,
      montoAnterior: Number(tx.Monto), montoNuevo: importe / 100,
      motivo: JSON.stringify({ v: 1, transaccion: Number(tx.IdTransaccion), pago: String(idPagoProveedor),
        preferencia: orden, actualizado: fechaActualizacionProveedor, estado: estadoProveedor }),
    });
    if (esReversion) {
      await auditar(connection, {
        idPago: tx.IdPago, idAcademia: tx.IdAcademia, evento: 'MERCADOPAGO_REQUIERE_REVISION',
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
  if (datos?.estadoProveedor !== 'approved') throw errorPago(409, 'PAGO_NO_APROBADO', 'La operación no está aprobada.');
  return aplicarPagoProveedor(datos);
}

async function actualizarEstadoNoAprobado(datos) {
  if (datos?.estadoProveedor === 'approved') throw errorPago(409, 'ESTADO_PROVEEDOR_INVALIDO', 'Usa la confirmación transaccional.');
  return aplicarPagoProveedor(datos);
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
};
