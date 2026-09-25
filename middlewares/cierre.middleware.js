// middlewares/cierre.middleware.js
const pool = require("../config/db");

// Valida si las actas de la academia del usuario autenticado siguen abiertas para edición
const verificarPeriodoAbierto = async (req, res, next) => {
  try {
    const idAcademia = req.usuario?.idAcademia;

    if (!idAcademia) {
      return res.status(401).json({
        error:
          "Token inválido: No se pudo identificar la academia del usuario.",
      });
    }

    // Consulta si existen notas selladas (EstadoRegistro = 2) dentro de su academia
    const [notasBloqueadas] = await pool.query(
      `SELECT COUNT(*) AS total
             FROM Evaluacion e
             INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
             INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
             WHERE e.EstadoRegistro = 2 AND u.IdAcademia = ?`,
      [idAcademia],
    );

    if (notasBloqueadas[0].total > 0) {
      return res.status(403).json({
        error:
          "Periodo Cerrado: Las actas oficiales de tu academia ya fueron selladas. Edición bloqueada.",
      });
    }

    next();
  } catch (error) {
    console.error("Error en verificarPeriodoAbierto:", error.message);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = verificarPeriodoAbierto;
