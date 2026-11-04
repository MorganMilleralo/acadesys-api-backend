'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const { rollbackSeguro } = require('../utils/validaciones');

const PROVEEDOR = 'MERCADOPAGO';
const MONEDA = 'PEN';

function errorPago(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function aCentimos(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return Math.round((numero + Number.EPSILON) * 100);
}

function idPositivo(valor) {
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

async function auditar(connection, datos) {
  await connection.query(
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
    const estadoPago = String(pago.Estado || 'Pendiente').trim().toLowerCase();
    if (estadoPago === 'pagado') {
      await connection.rollback();
      throw errorPago(409, 'CUOTA_YA_PAGADA', 'Esta cuota ya está pagada.');
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
         AND Estado IN ('CREANDO', 'PENDIENTE')
       ORDER BY IdTransaccion DESC LIMIT 1 FOR UPDATE`,
      [pagoId, usuarioId, academiaId, PROVEEDOR],
    );

    if (existentes.length) {
      const actual = existentes[0];
      if (String(actual.Estado).toUpperCase() === 'PENDIENTE' && actual.UrlCheckout) {
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
  if (urlValidada.protocol !== 'https:') throw errorPago(502, 'URL_CHECKOUT_INVALIDA', 'La URL del checkout debe utilizar HTTPS.');

  await pool.query(
    `UPDATE PagoTransaccion
     SET IdOrdenProveedor = ?, UrlCheckout = ?, CodigoEstadoProveedor = ?,
         Estado = IF(Estado = 'CREANDO', 'PENDIENTE', Estado),
         FechaActualizacion = NOW()
     WHERE IdTransaccion = ? AND EstadoRegistro = 1
       AND Estado IN ('CREANDO', 'PENDIENTE', 'APROBADA')`,
    [orden, urlValidada.toString(), String(estadoProveedor).slice(0, 80), id],
  );
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
 * Llamar SOLAMENTE después de que el webhook haya verificado la firma y
 * consultado la operación directamente al proveedor. Nunca desde el navegador.
 */
async function confirmarPagoProveedor({
  proveedor = PROVEEDOR,
  referenciaInterna,
  idOrdenProveedor,
  monto,
  moneda = MONEDA,
  estadoProveedor = 'approved',
}) {
  const proveedorNormalizado = String(proveedor || '').trim().toUpperCase();
  const referencia = String(referenciaInterna || '').trim();
  const orden = String(idOrdenProveedor || '').trim();
  const importeEvento = aCentimos(monto);
  if (proveedorNormalizado !== PROVEEDOR || !referencia || !orden || importeEvento === null) {
    throw errorPago(400, 'EVENTO_PAGO_INVALIDO', 'La confirmación del proveedor no contiene los datos requeridos.');
  }
  if (String(moneda).toUpperCase() !== MONEDA || String(estadoProveedor).toLowerCase() !== 'approved') {
    throw errorPago(409, 'PAGO_NO_APROBADO', 'La operación no está aprobada en PEN.');
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT pt.IdTransaccion, pt.IdPago, pt.IdUsuario, pt.IdAcademia,
              pt.IdOrdenProveedor, pt.Monto AS MontoTransaccion, pt.Moneda,
              pt.Estado AS EstadoTransaccion,
              p.Monto AS MontoCuota, p.Estado AS EstadoPago
       FROM PagoTransaccion pt
       INNER JOIN PagosMensualidad p ON p.IdPago = pt.IdPago AND p.IdUsuario = pt.IdUsuario
       INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario AND u.IdAcademia = pt.IdAcademia
       INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
       WHERE pt.Proveedor = ? AND pt.ReferenciaInterna = ?
         AND pt.EstadoRegistro = 1 AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [PROVEEDOR, referencia],
    );
    if (!rows.length) {
      await connection.rollback();
      throw errorPago(404, 'TRANSACCION_NO_ENCONTRADA', 'No se encontró la transacción relacionada con la notificación.');
    }

    const tx = rows[0];
    if (tx.IdOrdenProveedor && String(tx.IdOrdenProveedor) !== orden) {
      await connection.rollback();
      throw errorPago(409, 'ORDEN_NO_COINCIDE', 'El identificador de orden no coincide con la transacción interna.');
    }
    if (aCentimos(tx.MontoTransaccion) !== importeEvento || aCentimos(tx.MontoCuota) !== importeEvento || String(tx.Moneda).toUpperCase() !== MONEDA) {
      await connection.rollback();
      throw errorPago(409, 'IMPORTE_NO_COINCIDE', 'El importe o la moneda del proveedor no coincide con la cuota registrada.');
    }

    if (String(tx.EstadoTransaccion).toUpperCase() === 'APROBADA'
        && String(tx.EstadoPago).toLowerCase() === 'pagado') {
      await connection.commit();
      return { confirmada: true, idempotente: true, idPago: Number(tx.IdPago), idTransaccion: Number(tx.IdTransaccion) };
    }

    if (String(tx.EstadoPago).toLowerCase() === 'pagado') {
      await connection.query(
        `UPDATE PagoTransaccion SET Estado = 'PAGO_DUPLICADO', IdOrdenProveedor = ?,
           CodigoEstadoProveedor = ?, FechaActualizacion = NOW()
         WHERE IdTransaccion = ? AND EstadoRegistro = 1`,
        [orden, String(estadoProveedor).slice(0, 80), tx.IdTransaccion],
      );
      await auditar(connection, {
        idPago: tx.IdPago,
        idAcademia: tx.IdAcademia,
        evento: 'PAGO_DUPLICADO_PROVEEDOR',
        estadoAnterior: tx.EstadoPago,
        estadoNuevo: tx.EstadoPago,
        montoAnterior: Number(tx.MontoCuota),
        montoNuevo: importeEvento / 100,
        motivo: 'El proveedor confirmó otra operación para una cuota que ya figuraba pagada. Requiere revisión administrativa.',
      });
      await connection.commit();
      return { confirmada: false, pagoDuplicado: true, idPago: Number(tx.IdPago), idTransaccion: Number(tx.IdTransaccion) };
    }

    if (!['CREANDO', 'PENDIENTE'].includes(String(tx.EstadoTransaccion).toUpperCase())) {
      await connection.rollback();
      throw errorPago(409, 'ESTADO_TRANSACCION_NO_CONFIRMABLE', 'La transacción ya no está en un estado confirmable.');
    }

    await connection.query(
      `UPDATE PagoTransaccion SET Estado = 'APROBADA', IdOrdenProveedor = ?,
         CodigoEstadoProveedor = ?, FechaConfirmacion = NOW(), FechaActualizacion = NOW()
       WHERE IdTransaccion = ? AND EstadoRegistro = 1`,
      [orden, String(estadoProveedor).slice(0, 80), tx.IdTransaccion],
    );
    const [actualizacion] = await connection.query(
      `UPDATE PagosMensualidad
       SET Estado = 'Pagado', FechaPago = COALESCE(FechaPago, NOW())
       WHERE IdPago = ? AND IdUsuario = ? AND EstadoRegistro = 1
         AND Estado IN ('Pendiente', 'Moroso')`,
      [tx.IdPago, tx.IdUsuario],
    );
    if (actualizacion.affectedRows !== 1) {
      await connection.rollback();
      throw errorPago(409, 'CUOTA_NO_ACTUALIZADA', 'No se pudo actualizar la cuota; requiere revisión.');
    }

    await auditar(connection, {
      idPago: tx.IdPago,
      idAcademia: tx.IdAcademia,
      evento: 'PAGO_MERCADOPAGO_CONFIRMADO',
      estadoAnterior: tx.EstadoPago,
      estadoNuevo: 'Pagado',
      montoAnterior: Number(tx.MontoCuota),
      montoNuevo: importeEvento / 100,
      motivo: 'Pago confirmado por webhook verificado y consulta al proveedor.',
    });

    await connection.commit();
    return { confirmada: true, idempotente: false, idPago: Number(tx.IdPago), idTransaccion: Number(tx.IdTransaccion) };
  } catch (error) {
    await rollbackSeguro(connection);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function actualizarEstadoNoAprobado({ referenciaInterna, estado, estadoProveedor = null }) {
  const referencia = String(referenciaInterna || '').trim();
  const estadosPermitidos = new Set(['PENDIENTE', 'RECHAZADA', 'CANCELADA', 'EXPIRADA']);
  const nuevoEstado = String(estado || '').trim().toUpperCase();
  if (!referencia || !estadosPermitidos.has(nuevoEstado)) {
    throw errorPago(400, 'ESTADO_PROVEEDOR_INVALIDO', 'El estado del proveedor no es válido.');
  }
  const [result] = await pool.query(
    `UPDATE PagoTransaccion SET Estado = ?, CodigoEstadoProveedor = ?, FechaActualizacion = NOW()
     WHERE Proveedor = ? AND ReferenciaInterna = ? AND EstadoRegistro = 1
       AND Estado NOT IN ('APROBADA', 'PAGO_DUPLICADO')`,
    [nuevoEstado, estadoProveedor ? String(estadoProveedor).slice(0, 80) : null, PROVEEDOR, referencia],
  );
  return { actualizada: result.affectedRows === 1 };
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
