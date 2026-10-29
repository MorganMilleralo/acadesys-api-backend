'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');
const { idPositivo, rollbackSeguro } = require('../utils/validaciones');
const {
  normalizarPeriodoMensualidad,
  fechaISOValida,
  normalizarReferenciaPago,
  normalizarUrlComprobante,
  esEstadoPago,
} = require('../utils/pagos');

const estadosRevision = new Set(['EN_REVISION', 'APROBADO', 'RECHAZADO']);
const normalizarEstadoRevision = (valor) => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, '_');
const idActor = (req) => idPositivo(req.usuario?.idUsuario ?? req.usuario?.id);
const idAcademiaActor = (req) => idPositivo(req.usuario?.idAcademia);

async function auditarPago(connection, datos) {
  await connection.query(
    `INSERT INTO PagoAuditoria
      (IdPago, IdComprobante, IdUsuarioActor, IdAcademia, Evento,
       EstadoAnterior, EstadoNuevo, MontoAnterior, MontoNuevo, Motivo, FechaCreacion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      datos.idPago,
      datos.idComprobante ?? null,
      datos.idUsuarioActor ?? null,
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

// Monitor administrativo. Mantiene los alias PascalCase que consume la vista actual.
router.get('/pagos/ciclo/:idCiclo', requiereRol('Administrador'), async (req, res) => {
  const idCiclo = idPositivo(req.params.idCiclo);
  const idAcademia = idAcademiaActor(req);
  if (!idCiclo) return res.status(400).json({ error: 'El IdCiclo no es válido.' });
  if (!idAcademia) return res.status(401).json({ error: 'El administrador no tiene una academia válida.' });

  try {
    const [rows] = await pool.query(
      `SELECT p.IdPago, u.IdUsuario, u.CodigoUsuario,
              CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, NULLIF(u.ApellidoMaterno, '')) AS Alumno,
              c.Nombre AS Ciclo, p.Mes, p.Monto,
              COALESCE(p.Estado, 'Sin registro') AS Estado, p.FechaPago,
              p.FechaVencimiento,
              pc.IdComprobante, pc.Referencia AS ReferenciaComprobante,
              pc.UrlComprobante, pc.EstadoRevision AS EstadoRevisionComprobante,
              pc.MotivoRevision, pc.FechaCreacion AS FechaSolicitudComprobante
       FROM Matricula m
       INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
       INNER JOIN Ciclo c ON m.IdCiclo = c.IdCiclo AND c.IdAcademia = u.IdAcademia
       LEFT JOIN PagosMensualidad p
         ON p.IdUsuario = m.IdUsuario AND p.IdCiclo = m.IdCiclo AND p.EstadoRegistro = 1
       LEFT JOIN PagoComprobante pc ON pc.IdComprobante = (
         SELECT MAX(pc2.IdComprobante)
         FROM PagoComprobante pc2
         WHERE pc2.IdPago = p.IdPago AND pc2.IdAcademia = u.IdAcademia AND pc2.EstadoRegistro = 1
       )
       WHERE m.IdCiclo = ? AND m.EstadoRegistro = 1
         AND u.IdAcademia = ? AND u.EstadoRegistro = 1
         AND c.EstadoRegistro IN (0, 1)
       ORDER BY u.ApellidoPaterno ASC, u.Nombres ASC, p.IdPago ASC`,
      [idCiclo, idAcademia],
    );
    res.json(rows);
  } catch (error) {
    console.error('Error en GET /api/pagos/ciclo/:idCiclo:', error?.name || 'Error');
    res.status(500).json({ error: 'No se pudieron consultar los pagos.' });
  }
});

// Crea las cuotas de un periodo para todos los alumnos matriculados en el ciclo.
// Idempotente a nivel de ciclo/periodo: bloquea la fila del ciclo y omite las cuotas existentes.
router.post('/pagos/ciclo/:idCiclo/mensualidades', requiereRol('Administrador'), async (req, res) => {
  const idCiclo = idPositivo(req.params.idCiclo);
  const idAcademia = idAcademiaActor(req);
  const idAdministrador = idActor(req);
  const periodo = normalizarPeriodoMensualidad(req.body?.periodo ?? req.body?.mes);
  const fechaVencimiento = String(req.body?.fechaVencimiento ?? '').trim();

  if (!idCiclo) return res.status(400).json({ error: 'El IdCiclo no es válido.' });
  if (!idAcademia || !idAdministrador) return res.status(401).json({ error: 'La sesión administrativa no es válida.' });
  if (!periodo) return res.status(400).json({ error: 'El periodo debe tener el formato AAAA-MM.' });
  if (!fechaISOValida(fechaVencimiento)) return res.status(400).json({ error: 'La fecha de vencimiento debe ser una fecha válida con formato AAAA-MM-DD.' });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [ciclos] = await connection.query(
      `SELECT IdCiclo, IdAcademia, Nombre, PrecioMensual
       FROM Ciclo WHERE IdCiclo = ? AND IdAcademia = ? LIMIT 1 FOR UPDATE`,
      [idCiclo, idAcademia],
    );
    if (!ciclos.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'El ciclo no existe en tu academia.' });
    }

    const monto = Number(ciclos[0].PrecioMensual);
    if (ciclos[0].PrecioMensual === null || ciclos[0].PrecioMensual === undefined || String(ciclos[0].PrecioMensual).trim() === '' || !Number.isFinite(monto) || monto < 0) {
      await connection.rollback();
      return res.status(409).json({ code: 'PRECIO_MENSUAL_NO_CONFIGURADO', error: 'Configura un precio mensual válido para este ciclo antes de generar cuotas.' });
    }

    const [matriculas] = await connection.query(
      `SELECT m.IdUsuario
       FROM Matricula m
       INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
       WHERE m.IdCiclo = ? AND m.EstadoRegistro = 1
         AND u.IdAcademia = ? AND u.EstadoRegistro = 1
       ORDER BY m.IdUsuario ASC FOR UPDATE`,
      [idCiclo, idAcademia],
    );
    const idUsuarios = [...new Set(matriculas.map((row) => Number(row.IdUsuario)).filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (idUsuarios.length === 0) {
      await connection.rollback();
      return res.status(409).json({ error: 'El ciclo no tiene alumnos matriculados activos.' });
    }

    let creadas = 0;
    let existentes = 0;
    for (const idUsuario of idUsuarios) {
      const [pagosExistentes] = await connection.query(
        `SELECT IdPago, Estado, Monto
         FROM PagosMensualidad
         WHERE IdUsuario = ? AND IdCiclo = ? AND Mes = ? AND EstadoRegistro = 1
         ORDER BY IdPago ASC LIMIT 1 FOR UPDATE`,
        [idUsuario, idCiclo, periodo],
      );
      if (pagosExistentes.length) {
        existentes += 1;
        continue;
      }

      const [insertado] = await connection.query(
        `INSERT INTO PagosMensualidad
          (IdUsuario, IdCiclo, Mes, Monto, Estado, FechaPago, FechaVencimiento, EstadoRegistro)
         VALUES (?, ?, ?, ?, 'Pendiente', NULL, ?, 1)`,
        [idUsuario, idCiclo, periodo, monto, fechaVencimiento],
      );
      await auditarPago(connection, {
        idPago: insertado.insertId,
        idUsuarioActor: idAdministrador,
        idAcademia,
        evento: 'CUOTA_MENSUAL_CREADA',
        estadoAnterior: null,
        estadoNuevo: 'Pendiente',
        montoAnterior: null,
        montoNuevo: monto,
        motivo: `Generación de cuota ${periodo}.`,
      });
      creadas += 1;
    }

    await connection.commit();
    res.status(201).json({
      exito: true,
      idCiclo,
      periodo,
      montoUnitario: monto,
      fechaVencimiento,
      cuotasCreadas: creadas,
      cuotasYaExistentes: existentes,
      totalAlumnos: idUsuarios.length,
      mensaje: creadas ? `Se generaron ${creadas} cuotas; las existentes no se duplicaron.` : 'Todas las cuotas del periodo ya existían; no se duplicó ninguna.',
    });
  } catch (error) {
    await rollbackSeguro(connection);
    console.error('Error al generar mensualidades:', error?.name || 'Error');
    res.status(500).json({ error: 'No se pudieron generar las cuotas mensuales.' });
  } finally {
    if (connection) connection.release();
  }
});

// Cola administrativa de comprobantes recibidos.
router.get('/pagos/comprobantes', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = idAcademiaActor(req);
  if (!idAcademia) return res.status(401).json({ error: 'El administrador no tiene una academia válida.' });
  const estado = normalizarEstadoRevision(req.query?.estado || 'EN_REVISION');
  if (!estadosRevision.has(estado)) return res.status(400).json({ error: 'El filtro de comprobante no es válido.' });

  try {
    const [rows] = await pool.query(
      `SELECT pc.IdComprobante, pc.IdPago, pc.IdUsuario, pc.Referencia, pc.UrlComprobante,
              pc.EstadoRevision, pc.MotivoRevision, pc.FechaCreacion, pc.FechaRevision,
              p.IdCiclo, c.Nombre AS Ciclo, p.Mes, p.Monto, p.Estado AS EstadoPago,
              u.CodigoUsuario,
              CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, NULLIF(u.ApellidoMaterno, '')) AS Alumno
       FROM PagoComprobante pc
       INNER JOIN PagosMensualidad p ON p.IdPago = pc.IdPago AND p.IdUsuario = pc.IdUsuario
       INNER JOIN Usuario u ON u.IdUsuario = pc.IdUsuario AND u.IdAcademia = pc.IdAcademia
       INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = pc.IdAcademia
       WHERE pc.IdAcademia = ? AND pc.EstadoRevision = ? AND pc.EstadoRegistro = 1
         AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
       ORDER BY pc.FechaCreacion ASC, pc.IdComprobante ASC`,
      [idAcademia, estado],
    );
    res.json(rows);
  } catch (error) {
    console.error('Error en GET /api/pagos/comprobantes:', error?.name || 'Error');
    res.status(500).json({ error: 'No se pudieron consultar los comprobantes.' });
  }
});

// Un comprobante aprobado es la única vía manual de convertir un pago pendiente en Pagado.
router.put('/pagos/comprobantes/:idComprobante/estado', requiereRol('Administrador'), async (req, res) => {
  const idComprobante = idPositivo(req.params.idComprobante);
  const idAcademia = idAcademiaActor(req);
  const idAdministrador = idActor(req);
  const estado = normalizarEstadoRevision(req.body?.Estado ?? req.body?.estado);
  const motivo = String(req.body?.motivo ?? req.body?.Motivo ?? '').trim();

  if (!idComprobante) return res.status(400).json({ error: 'El IdComprobante no es válido.' });
  if (!idAcademia || !idAdministrador) return res.status(401).json({ error: 'La sesión administrativa no es válida.' });
  if (!['APROBADO', 'RECHAZADO'].includes(estado)) return res.status(400).json({ error: 'El estado debe ser APROBADO o RECHAZADO.' });
  if (estado === 'RECHAZADO' && (motivo.length < 4 || motivo.length > 500)) return res.status(400).json({ error: 'Explica el rechazo con un motivo de entre 4 y 500 caracteres.' });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT pc.IdComprobante, pc.IdPago, pc.IdUsuario, pc.EstadoRevision,
              p.Estado AS EstadoPago, p.Monto, p.FechaPago, u.IdAcademia
       FROM PagoComprobante pc
       INNER JOIN PagosMensualidad p ON p.IdPago = pc.IdPago AND p.IdUsuario = pc.IdUsuario
       INNER JOIN Usuario u ON u.IdUsuario = pc.IdUsuario AND u.IdAcademia = pc.IdAcademia
       INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = pc.IdAcademia
       WHERE pc.IdComprobante = ? AND pc.IdAcademia = ? AND pc.EstadoRegistro = 1
         AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [idComprobante, idAcademia],
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'El comprobante no existe en tu academia.' });
    }
    const comprobante = rows[0];
    if (String(comprobante.EstadoRevision).toUpperCase() !== 'EN_REVISION') {
      await connection.rollback();
      return res.status(409).json({ error: 'Este comprobante ya fue revisado.' });
    }
    if (estado === 'APROBADO' && esEstadoPago(comprobante.EstadoPago, 'Pagado')) {
      await connection.rollback();
      return res.status(409).json({ error: 'El pago ya figura como pagado; no se aplicó una segunda confirmación.' });
    }

    const nuevoEstado = estado === 'APROBADO' ? 'APROBADO' : 'RECHAZADO';
    await connection.query(
      `UPDATE PagoComprobante
       SET EstadoRevision = ?, MotivoRevision = ?, FechaRevision = NOW(), IdRevisadoPor = ?
       WHERE IdComprobante = ? AND IdAcademia = ? AND EstadoRevision = 'EN_REVISION' AND EstadoRegistro = 1`,
      [nuevoEstado, estado === 'RECHAZADO' ? motivo : null, idAdministrador, idComprobante, idAcademia],
    );

    if (estado === 'APROBADO') {
      await connection.query(
        `UPDATE PagosMensualidad p
         INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
         SET p.Estado = 'Pagado', p.FechaPago = COALESCE(p.FechaPago, NOW())
         WHERE p.IdPago = ? AND p.IdUsuario = ? AND u.IdAcademia = ? AND p.EstadoRegistro = 1`,
        [comprobante.IdPago, comprobante.IdUsuario, idAcademia],
      );
    }

    await auditarPago(connection, {
      idPago: comprobante.IdPago,
      idComprobante,
      idUsuarioActor: idAdministrador,
      idAcademia,
      evento: estado === 'APROBADO' ? 'COMPROBANTE_APROBADO' : 'COMPROBANTE_RECHAZADO',
      estadoAnterior: comprobante.EstadoPago,
      estadoNuevo: estado === 'APROBADO' ? 'Pagado' : comprobante.EstadoPago,
      montoAnterior: Number(comprobante.Monto),
      montoNuevo: Number(comprobante.Monto),
      motivo: estado === 'APROBADO' ? 'Pago confirmado tras revisión administrativa del comprobante.' : motivo,
    });

    await connection.commit();
    res.json({
      exito: true,
      idComprobante,
      idPago: comprobante.IdPago,
      estadoComprobante: nuevoEstado,
      estadoPago: estado === 'APROBADO' ? 'Pagado' : comprobante.EstadoPago,
      fechaPago: estado === 'APROBADO' ? new Date().toISOString() : comprobante.FechaPago,
      mensaje: estado === 'APROBADO' ? 'Comprobante aprobado y pago confirmado.' : 'Comprobante rechazado; el pago continúa pendiente del proceso correspondiente.',
    });
  } catch (error) {
    await rollbackSeguro(connection);
    console.error('Error al revisar comprobante:', error?.name || 'Error');
    res.status(500).json({ error: 'No se pudo actualizar el comprobante.' });
  } finally {
    if (connection) connection.release();
  }
});

// Este endpoint heredado solo permite marcar Moroso. Pagado requiere comprobante aprobado.
router.put('/pagos/:id/estado', requiereRol('Administrador'), async (req, res) => {
  const idPago = idPositivo(req.params.id);
  const idAcademia = idAcademiaActor(req);
  const idAdministrador = idActor(req);
  const estadoSolicitado = String(req.body?.Estado ?? req.body?.estado ?? '').trim();
  if (!idPago) return res.status(400).json({ error: 'El IdPago no es válido.' });
  if (!['Pagado', 'Moroso'].includes(estadoSolicitado)) return res.status(400).json({ error: 'El estado debe ser estrictamente "Pagado" o "Moroso".' });
  if (!idAcademia || !idAdministrador) return res.status(401).json({ error: 'La sesión administrativa no es válida.' });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [pagos] = await connection.query(
      `SELECT p.IdPago, p.Estado, p.Mes, p.Monto, p.FechaPago, p.IdUsuario
       FROM PagosMensualidad p
       INNER JOIN Usuario u ON p.IdUsuario = u.IdUsuario
       INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
       WHERE p.IdPago = ? AND u.IdAcademia = ? AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [idPago, idAcademia],
    );
    if (!pagos.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Registro de pago no encontrado en tu academia.' });
    }

    const actual = pagos[0];
    const esInscripcionPendiente = String(actual.Mes || '').trim().toLowerCase() === 'inscripcion'
      && String(actual.Estado || '').trim().toLowerCase() === 'pendiente';
    if (esInscripcionPendiente && estadoSolicitado === 'Moroso') {
      await connection.rollback();
      return res.status(409).json({
        error: 'La inscripción de checkout sigue pendiente y no tiene una fecha de vencimiento confirmada; no se puede marcar como morosa automáticamente.',
        code: 'INSCRIPCION_SIN_VENCIMIENTO',
      });
    }
    if (estadoSolicitado === 'Pagado') {
      await connection.rollback();
      const esInscripcionPendiente = String(actual.Mes || '').trim().toLowerCase() === 'inscripcion' && String(actual.Estado || '').trim().toLowerCase() === 'pendiente';
      return res.status(409).json({
        error: esInscripcionPendiente
          ? 'La inscripción sigue pendiente en modo demostración. No puede marcarse como pagada sin una confirmación verificable.'
          : 'No se puede marcar un pago como Pagado directamente. Revisa y aprueba el comprobante o integra una confirmación verificable de la pasarela.',
        code: 'PAGO_REQUIERE_CONFIRMACION',
      });
    }

    const [comprobantes] = await connection.query(
      `SELECT IdComprobante FROM PagoComprobante
       WHERE IdPago = ? AND IdAcademia = ? AND EstadoRevision = 'EN_REVISION' AND EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [idPago, idAcademia],
    );
    if (comprobantes.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'Existe un comprobante en revisión; resuélvelo antes de cambiar el estado del pago.' });
    }
    if (esEstadoPago(actual.Estado, 'Pagado')) {
      await connection.rollback();
      return res.status(409).json({ error: 'Un pago confirmado no puede marcarse como moroso desde este endpoint.' });
    }
    if (esEstadoPago(actual.Estado, 'Moroso')) {
      await connection.rollback();
      return res.status(409).json({ error: 'El pago ya está marcado como moroso.' });
    }

    await connection.query(
      `UPDATE PagosMensualidad p
       INNER JOIN Usuario u ON p.IdUsuario = u.IdUsuario
       SET p.Estado = 'Moroso', p.FechaPago = NULL
       WHERE p.IdPago = ? AND u.IdAcademia = ? AND p.EstadoRegistro = 1`,
      [idPago, idAcademia],
    );
    await auditarPago(connection, {
      idPago,
      idUsuarioActor: idAdministrador,
      idAcademia,
      evento: 'PAGO_MARCADO_MOROSO',
      estadoAnterior: actual.Estado,
      estadoNuevo: 'Moroso',
      montoAnterior: Number(actual.Monto),
      montoNuevo: Number(actual.Monto),
      motivo: 'Marcado moroso por administración.',
    });
    await connection.commit();
    res.json({ exito: true, idPago, estado: 'Moroso', message: 'Pago actualizado a estado: Moroso.' });
  } catch (error) {
    await rollbackSeguro(connection);
    console.error('Error en PUT /api/pagos/:id/estado:', error?.name || 'Error');
    res.status(500).json({ error: 'No se pudo actualizar el estado de pago.' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
