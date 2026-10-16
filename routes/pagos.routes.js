const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const requiereRol = require("../middlewares/roles.middleware");

// GET /api/pagos/ciclo/:idCiclo - Monitor de mensualidades y morosidad de un ciclo
router.get(
  "/pagos/ciclo/:idCiclo",
  requiereRol("Administrador", "Tutor de Aula"),
  async (req, res) => {
    try {
      const { idCiclo } = req.params;
      const idAcademia = req.usuario.idAcademia;

      const [rows] = await pool.query(
        `SELECT p.IdPago, u.IdUsuario, u.CodigoUsuario,
                    CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, NULLIF(u.ApellidoMaterno, '')) AS Alumno,
                    c.Nombre AS Ciclo, p.Mes, p.Monto,
                    COALESCE(p.Estado, 'Sin registro') AS Estado, p.FechaPago
             FROM Matricula m
             INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
             INNER JOIN Ciclo c ON m.IdCiclo = c.IdCiclo
             LEFT JOIN PagosMensualidad p
               ON p.IdUsuario = m.IdUsuario
              AND p.IdCiclo = m.IdCiclo
              AND p.EstadoRegistro = 1
             WHERE m.IdCiclo = ?
               AND m.EstadoRegistro = 1
               AND u.IdAcademia = ?
               AND u.EstadoRegistro = 1
               AND c.IdAcademia = ?
               AND c.EstadoRegistro = 1
             ORDER BY u.ApellidoPaterno ASC, u.Nombres ASC, p.IdPago ASC`,
        [idCiclo, idAcademia, idAcademia],
      );

      res.json(rows);
    } catch (error) {
      console.error("Error en GET /pagos/ciclo/:idCiclo:", error.message);
      res.status(500).json({ error: error.message });
    }
  },
);

// PUT /api/pagos/:id/estado - Actualizar pago (Marcar como Pagado/Moroso)
router.put(
  "/pagos/:id/estado",
  requiereRol("Administrador", "Tutor de Aula"),
  async (req, res) => {
    const { id } = req.params;
    const { Estado } = req.body;
    const idAcademia = req.usuario.idAcademia;

    if (!["Pagado", "Moroso"].includes(Estado)) {
      return res.status(400).json({
        error: 'El estado debe ser estrictamente "Pagado" o "Moroso".',
      });
    }

    const fechaPago = Estado === "Pagado" ? new Date() : null;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [pagos] = await connection.query(
        `SELECT p.IdPago, p.Estado, p.Mes
         FROM PagosMensualidad p
         INNER JOIN Usuario u ON p.IdUsuario = u.IdUsuario
         WHERE p.IdPago = ? AND u.IdAcademia = ?
         LIMIT 1 FOR UPDATE`,
        [id, idAcademia],
      );

      if (!pagos.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Registro de pago no encontrado en tu academia." });
      }

      const pagoActual = pagos[0];
      const esInscripcionPendiente =
        String(pagoActual.Mes || '').trim().toLowerCase() === 'inscripcion'
        && String(pagoActual.Estado || '').trim().toLowerCase() === 'pendiente';

      // Un registro de inscripción del checkout simulado no puede convertirse
      // manualmente en Pagado/Moroso: falta la confirmación verificable de pago.
      if (esInscripcionPendiente) {
        await connection.rollback();
        return res.status(409).json({
          error: 'La inscripción sigue pendiente en modo demostración. No puede marcarse como pagada ni morosa sin un proceso de confirmación aprobado.'
        });
      }

      await connection.query(
        `UPDATE PagosMensualidad p
         INNER JOIN Usuario u ON p.IdUsuario = u.IdUsuario
         SET p.Estado = ?, p.FechaPago = ?
         WHERE p.IdPago = ? AND u.IdAcademia = ?`,
        [Estado, fechaPago, id, idAcademia],
      );
      await connection.commit();
      res.json({ message: `Pago actualizado a estado: ${Estado}` });
    } catch (error) {
      try { await connection.rollback(); } catch (_) {}
      console.error("Error en PUT /pagos/:id/estado:", error.message);
      res.status(500).json({ error: 'No se pudo actualizar el estado de pago.' });
    } finally {
      connection.release();
    }
  },
);

module.exports = router;
