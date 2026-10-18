
const pool = require("../config/db");
const { responderErrorEsquema } = require("../utils/evaluaciones");

const verificarPeriodoAbierto = async (req, res, next) => {
  // El POST verifica cierres dentro de su propia transaccion.
  if (req.method !== "PUT") {
    return next();
  }

  const idEvaluacion = Number(req.params?.id);
  const idAcademia = Number(req.usuario?.idAcademia);

  if (
    !Number.isSafeInteger(idEvaluacion) ||
    idEvaluacion <= 0
  ) {
    return res.status(400).json({
      error: "Evaluacion invalida.",
    });
  }

  if (
    !Number.isSafeInteger(idAcademia) ||
    idAcademia <= 0
  ) {
    return res.status(401).json({
      error: "Academia no identificada.",
    });
  }

  try {
    const [evaluaciones] = await pool.query(
      `SELECT
          e.EstadoRegistro,
          e.IdCurso,
          e.Periodo,
          e.TipoEvaluacion,
          m.IdCiclo
       FROM Evaluacion e
       INNER JOIN Matricula m
         ON m.IdMatricula = e.IdMatricula
       INNER JOIN Usuario u
         ON u.IdUsuario = m.IdUsuario
       INNER JOIN Ciclo ci ON ci.IdCiclo = m.IdCiclo AND ci.IdAcademia = u.IdAcademia
       WHERE e.IdEvaluacion = ?
         AND u.IdAcademia = ?
       LIMIT 1`,
      [idEvaluacion, idAcademia]
    );

    if (!evaluaciones.length) {
      return res.status(404).json({
        error: "Evaluacion no encontrada.",
      });
    }

    const evaluacion = evaluaciones[0];

    if (Number(evaluacion.EstadoRegistro) !== 1) {
      return res.status(409).json({
        error: "La evaluacion no esta abierta.",
      });
    }

    const [cierres] = await pool.query(
      `SELECT IdCierre
       FROM Auditoria_Cierres
       WHERE IdCiclo = ?
         AND IdCurso <=> ?
         AND Periodo = ?
         AND TipoEvaluacion = ?
       LIMIT 1`,
      [
        evaluacion.IdCiclo,
        evaluacion.IdCurso,
        evaluacion.Periodo,
        evaluacion.TipoEvaluacion,
      ]
    );

    if (cierres.length) {
      return res.status(409).json({
        error: "El acta esta cerrada.",
      });
    }

    return next();
  } catch (error) {
    console.error("Verificacion de cierre:", error);
    if (responderErrorEsquema(res, error)) return;

    return res.status(500).json({
      error: "No se pudo verificar el acta.",
    });
  }
};

module.exports = verificarPeriodoAbierto;
