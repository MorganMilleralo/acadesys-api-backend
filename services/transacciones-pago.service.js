
'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const { rollbackSeguro } = require('../utils/validaciones');
const { ErrorPago, aCentimos, idOrdenCulqi } = require('../utils/pagos-proveedor');

const PROVEEDOR = 'CULQI';
const MONEDA = 'PEN';

// W3: una reserva en CREANDO sin preferencia guardada después de 2 minutos es
// huérfana. Su URL nunca llegó al alumno, así que nadie puede pagarla.
const CREACION_HUERFANA_SEGUNDOS = 120;
// W4: Mercado Pago vence el checkout a los 60 min (adaptador). Solo se
// reemplaza localmente a los 65 min, cuando el proveedor ya no lo acepta.
const REEMPLAZO_CHECKOUT_SEGUNDOS = 65 * 60;
const ESTADOS_PAGO_EN_CURSO = new Set(['pending', 'in_process', 'authorized', 'in_mediation']);
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
 * ¿Mercado Pago informó un pago todavía en curso para esta transacción?
 * Falla cerrada: ante auditoría ilegible se asume que sí y no se reemplaza.
 */
async function pagoEnCurso(connection, tx, idAcademia) {
  if (ESTADOS_PAGO_EN_CURSO.has(tx.CodigoEstadoProveedor) && tx.CodigoEstadoProveedor !== 'pending') return true;
  if (tx.Estado !== 'PENDIENTE') return false;
  const [auditorias] = await connection.query(
    `SELECT IdAuditoria, Motivo FROM PagoAuditoria
     WHERE IdPago = ? AND IdAcademia = ? AND Evento = 'MERCADOPAGO_EVENTO'
     ORDER BY IdAuditoria DESC FOR UPDATE`, [tx.IdPago, idAcademia],
  );
  for (const row of auditorias) {
    let recibo;
    try { recibo = JSON.parse(row.Motivo); } catch { return true; }
    if (Number(recibo?.transaccion) !== Number(tx.IdTransaccion)) continue;
    return ESTADOS_PAGO_EN_CURSO.has(recibo.estado);
  }
  return false;
}

async function descartarTransaccion(connection, tx, idAcademia, cuota, estadoNuevo, evento, motivo) {
  const [cambio] = await connection.query(
    `UPDATE PagoTransaccion SET FechaActualizacion = NOW(), Estado = ?
     WHERE IdTransaccion = ? AND Estado = ? AND EstadoRegistro = 1`,
    [estadoNuevo, tx.IdTransaccion, tx.Estado],
  );
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

    const [pagos] = await connection.query(
      `SELECT p.IdPago, p.IdUsuario, p.IdCiclo, p.Mes, p.Monto, p.Estado,
              u.IdAcademia, u.CorreoElectronico, u.Celular AS Telefono,
              u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno,
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

    // W5: el pago manual y el online no se superponen. Mientras administración
    // revisa un comprobante, no se abre un cobro online de la misma cuota.
    const [enRevision] = await connection.query(
      `SELECT IdComprobante FROM PagoComprobante
       WHERE IdPago = ? AND IdUsuario = ? AND IdAcademia = ?
         AND EstadoRevision = 'EN_REVISION' AND EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [pagoId, usuarioId, academiaId],
    );
    if (enRevision.length) {
      await connection.rollback();
      throw errorPago(409, 'COMPROBANTE_EN_REVISION',
        'Esta cuota tiene un comprobante en revisión. Espera la respuesta de la academia antes de pagar online.');
    }

    const filtroTerminal = "Estado NOT IN ('ERROR', 'EXPIRADA', 'CANCELADA', 'RECHAZADA')";
    const [existentes] = await connection.query(
      `SELECT IdTransaccion, IdPago, ReferenciaInterna, IdOrdenProveedor, ClaveIdempotencia,
              Monto, Moneda, Estado, UrlCheckout, CodigoEstadoProveedor,
              TIMESTAMPDIFF(SECOND, FechaCreacion, NOW()) AS AntiguedadSegundos
       FROM PagoTransaccion
       WHERE IdPago = ? AND IdUsuario = ? AND IdAcademia = ?
         AND Proveedor = ? AND EstadoRegistro = 1
         AND ${filtroTerminal}
       ORDER BY IdTransaccion DESC LIMIT 1 FOR UPDATE`,
      [pagoId, usuarioId, academiaId, proveedorActual],
    );

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
          'Reserva sin preferencia guardada por más de 2 minutos; su URL nunca llegó al alumno.');
        actual = null;
      } else if (proveedorActual === 'MERCADOPAGO'
          && ['PENDIENTE', 'RECHAZADA', 'CANCELADA'].includes(actual.Estado) && medible
          && antiguedad >= REEMPLAZO_CHECKOUT_SEGUNDOS && !(await pagoEnCurso(connection, actual, academiaId))) {
        await descartarTransaccion(connection, actual, academiaId, pago, 'EXPIRADA', 'CHECKOUT_EXPIRADO',
          'Checkout vencido en Mercado Pago (60 min); se reemplaza por uno nuevo con el importe vigente.');
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
    const [insertado] = await connection.query(
      `INSERT INTO PagoTransaccion
        (IdPago, IdUsuario, IdAcademia, Proveedor, ReferenciaInterna,
         ClaveIdempotencia, Monto, Moneda, Estado, FechaCreacion, FechaActualizacion, EstadoRegistro)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CREANDO', NOW(), NOW(), 1)`,
      [pagoId, usuarioId, academiaId, proveedorActual, referenciaInterna, idempotencyKey, Number(pago.Monto), MONEDA],
    );

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

  await pool.query(
    `UPDATE PagoTransaccion
     SET IdOrdenProveedor = ?, UrlCheckout = NULL,
         CodigoEstadoProveedor = IF(Estado = 'CREANDO', ?, CodigoEstadoProveedor),
         Estado = IF(Estado = 'CREANDO' AND ? = 'pending', 'PENDIENTE', Estado),
         FechaActualizacion = NOW()
     WHERE IdTransaccion = ? AND EstadoRegistro = 1
       AND Proveedor = 'CULQI'
       AND (IdOrdenProveedor IS NULL OR IdOrdenProveedor = ?)
       AND Estado <> 'ERROR'`,
    [orden, estadoProveedorActual, estadoProveedorActual, id, orden],
  );

  const [rows] = await pool.query(
    `SELECT IdTransaccion, Estado, UrlCheckout, IdOrdenProveedor
     FROM PagoTransaccion
     WHERE IdTransaccion = ? AND EstadoRegistro = 1
     LIMIT 1`,
    [id],
  );
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
  await pool.query(
    `UPDATE PagoTransaccion
     SET Estado = 'ERROR', FechaActualizacion = NOW()
     WHERE IdTransaccion = ? AND Estado = 'CREANDO'
       AND IdOrdenProveedor IS NULL AND Proveedor = 'CULQI'
       AND EstadoRegistro = 1`,
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
 * Solo recibe datos normalizados tras firma + consultas al SDK. La auditoría
 * existente guarda la versión de cada pago, sin ampliar el esquema de Morgan.
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
    const [localizadas] = await pool.query(
      'SELECT IdPago FROM PagoTransaccion WHERE Proveedor = ? AND ReferenciaInterna = ? AND EstadoRegistro = 1 LIMIT 1',
      [proveedorActual, referencia],
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
       LIMIT 1 FOR UPDATE`, [proveedorActual, referencia],
    );
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
    const [auditorias] = await connection.query(
      `SELECT IdAuditoria, Motivo FROM PagoAuditoria
       WHERE IdPago = ? AND IdAcademia = ? AND Evento = ?
       ORDER BY IdAuditoria DESC FOR UPDATE`, [tx.IdPago, tx.IdAcademia, eventoEstado],
    );
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
        const [cambio] = await connection.query(
          `UPDATE PagosMensualidad SET Estado = 'Pagado', FechaPago = COALESCE(FechaPago, NOW())
           WHERE IdPago = ? AND IdUsuario = ? AND EstadoRegistro = 1 AND Estado IN ('Pendiente', 'Moroso')`,
          [tx.IdPago, tx.IdUsuario],
        );
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

    const [cambioTx] = await connection.query(
      `UPDATE PagoTransaccion SET Estado = ?, IdOrdenProveedor = ?,
         CodigoEstadoProveedor = ?, FechaActualizacion = NOW(),
         FechaConfirmacion = IF(? = 'APROBADA', COALESCE(FechaConfirmacion, NOW()), FechaConfirmacion)
       WHERE IdTransaccion = ? AND EstadoRegistro = 1 AND Proveedor = ?`,
      [estadoTx, orden, codigoProveedor || estadoProveedor, estadoTx, tx.IdTransaccion, proveedorActual],
    );
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

/** C4: listado de transacciones online de la academia del administrador. */
async function listarTransaccionesAdmin({ idAcademia, filtros }) {
  const academiaId = idPositivo(idAcademia);
  if (!academiaId || !filtros) throw errorPago(400, 'FILTROS_INVALIDOS', 'Los filtros de transacciones no son válidos.');
  const condiciones = ['pt.IdAcademia = ?', 'pt.EstadoRegistro = 1', 'p.EstadoRegistro = 1'];
  const params = [academiaId];
  if (filtros.idCiclo) { condiciones.push('p.IdCiclo = ?'); params.push(filtros.idCiclo); }
  if (filtros.periodo) { condiciones.push('p.Mes = ?'); params.push(filtros.periodo); }
  if (filtros.estado === 'REQUIERE_REVISION') {
    condiciones.push(`(pt.Estado IN ('PAGO_DUPLICADO', 'REEMBOLSADA', 'CONTRACARGO')
      OR (pt.Estado = 'CREANDO' AND pt.FechaCreacion < NOW() - INTERVAL ${CREACION_HUERFANA_SEGUNDOS} SECOND))`);
  } else if (filtros.estado) {
    condiciones.push('pt.Estado = ?'); params.push(filtros.estado);
  }
  const desde = `FROM PagoTransaccion pt
     INNER JOIN PagosMensualidad p ON p.IdPago = pt.IdPago AND p.IdUsuario = pt.IdUsuario
     INNER JOIN Usuario u ON u.IdUsuario = pt.IdUsuario AND u.IdAcademia = pt.IdAcademia
     INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = pt.IdAcademia
     WHERE ${condiciones.join(' AND ')}`;
  const [totales] = await pool.query(`SELECT COUNT(*) AS Total ${desde}`, params);
  const [rows] = await pool.query(
    `SELECT pt.IdTransaccion, pt.IdPago, pt.Proveedor, pt.ReferenciaInterna, pt.IdOrdenProveedor,
            pt.Monto, pt.Moneda, pt.Estado, pt.CodigoEstadoProveedor,
            pt.FechaCreacion, pt.FechaActualizacion, pt.FechaConfirmacion,
            TIMESTAMPDIFF(SECOND, pt.FechaCreacion, NOW()) AS AntiguedadSegundos,
            p.IdCiclo, c.Nombre AS Ciclo, p.Mes AS Periodo, p.Estado AS EstadoCuota, p.Monto AS MontoCuota,
            u.IdUsuario, u.CodigoUsuario,
            CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, NULLIF(u.ApellidoMaterno, '')) AS Alumno
     ${desde}
     ORDER BY pt.IdTransaccion DESC
     LIMIT ? OFFSET ?`,
    [...params, filtros.limite, filtros.desde],
  );
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
  const [cuotas] = await pool.query(
    `SELECT p.IdPago FROM PagosMensualidad p
     INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
     INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
     WHERE p.IdPago = ? AND u.IdAcademia = ? AND p.EstadoRegistro = 1 LIMIT 1`,
    [pagoId, academiaId],
  );
  if (!cuotas.length) throw errorPago(404, 'CUOTA_NO_ENCONTRADA', 'La cuota no existe en tu academia.');
  const [rows] = await pool.query(
    `SELECT IdAuditoria, IdComprobante, IdUsuarioActor, Evento, EstadoAnterior, EstadoNuevo,
            MontoAnterior, MontoNuevo, Motivo, FechaCreacion
     FROM PagoAuditoria WHERE IdPago = ? AND IdAcademia = ?
     ORDER BY IdAuditoria DESC LIMIT 200`,
    [pagoId, academiaId],
  );
  return rows.map((row) => {
    let detalle = null;
    if (row.Evento === 'MERCADOPAGO_EVENTO') {
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
 * Referencia conciliable: la última transacción con preferencia creada.
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
  const condiciones = ['IdAcademia = ?', 'Proveedor = ?', 'EstadoRegistro = 1', 'IdOrdenProveedor IS NOT NULL'];
  const params = [academiaId, PROVEEDOR];
  if (pagoId) { condiciones.push('IdPago = ?'); params.push(pagoId); }
  if (txId) { condiciones.push('IdTransaccion = ?'); params.push(txId); }
  if (usuarioId) { condiciones.push('IdUsuario = ?'); params.push(usuarioId); }
  const [rows] = await pool.query(
    `SELECT IdTransaccion, IdPago, ReferenciaInterna, IdOrdenProveedor, Estado FROM PagoTransaccion
     WHERE ${condiciones.join(' AND ')}
     ORDER BY IdTransaccion DESC LIMIT 1`,
    params,
  );
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
