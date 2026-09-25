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
                    CONCAT(u.Nombres, ' ', u.ApellidoPaterno, ' ', COALESCE(u.ApellidoMaterno, '')) AS Alumno,
                    c.Nombre AS Ciclo, p.Mes, p.Monto, p.Estado, p.FechaPago
             FROM PagosMensualidad p
             INNER JOIN Usuario u ON p.IdUsuario = u.IdUsuario
             INNER JOIN Ciclo c ON p.IdCiclo = c.IdCiclo
             WHERE p.IdCiclo = ? AND u.IdAcademia = ? AND p.EstadoRegistro = 1
             ORDER BY u.ApellidoPaterno ASC, p.IdPago ASC`,
        [idCiclo, idAcademia],
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

    try {
      const [result] = await pool.query(
        `UPDATE PagosMensualidad p
             INNER JOIN Usuario u ON p.IdUsuario = u.IdUsuario
             SET p.Estado = ?, p.FechaPago = ?
             WHERE p.IdPago = ? AND u.IdAcademia = ?`,
        [Estado, fechaPago, id, idAcademia],
      );

      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ error: "Registro de pago no encontrado en tu academia." });
      }

      res.json({ message: `Pago actualizado a estado: ${Estado}` });
    } catch (error) {
      console.error("Error en PUT /pagos/:id/estado:", error.message);
      res.status(500).json({ error: error.message });
    }
  },
);

module.exports = router;
