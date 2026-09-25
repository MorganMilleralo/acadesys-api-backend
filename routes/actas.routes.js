const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const requiereRol = require("../middlewares/roles.middleware");

// PUT /api/actas/cierre - Cierre oficial de actas por academia
router.put("/actas/cierre", requiereRol("Administrador"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const idAdmin = req.usuario.id;
    const idAcademia = req.usuario.idAcademia;

    // 1. Sella únicamente las evaluaciones de los alumnos de su propia academia
    const [result] = await connection.query(
      `UPDATE Evaluacion e
             INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
             INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
             SET e.EstadoRegistro = 2
             WHERE e.EstadoRegistro = 1 AND u.IdAcademia = ?`,
      [idAcademia],
    );

    // 2. Registro de auditoría
    await connection.query(
      "INSERT INTO Auditoria_Cierres (IdAdministrador, FechaCierre, RegistrosAfectados) VALUES (?, NOW(), ?)",
      [idAdmin, result.affectedRows],
    );

    await connection.commit();
    res.json({
      message: "Actas cerradas oficial y legalmente para tu academia.",
      notasBloqueadas: result.affectedRows,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error en PUT /actas/cierre:", error.message);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
