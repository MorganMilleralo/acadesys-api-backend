// Bloquea únicamente la evaluación cuyo ciclo, curso, periodo y tipo estén cerrados.
// Requiere la migración 20261016_periodo_evaluacion.sql antes de usarlo.
const pool = require('../config/db');

function idPositivo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function textoPeriodo(valor) {
  const s = String(valor ?? 'General').trim().replace(/\s+/g, ' ');
  return s.length > 0 && s.length <= 50 ? s : null;
}

const verificarPeriodoAbierto = async (req, res, next) => {
  // El registro masivo valida cada matrícula/curso dentro de su transacción,
  // después de bloquear la fila del ciclo. Evitamos una comprobación global aquí.
  if (req.method === 'POST') return next();
  if (req.method !== 'PUT' || !req.params?.id) return next();

  const idEvaluacion = idPositivo(req.params.id);
  if (!idEvaluacion) {
    return res.status(400).json({ error: 'El identificador de evaluación no es válido.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT e.IdEvaluacion, e.EstadoRegistro, e.Periodo, e.TipoEvaluacion,
              m.IdCiclo, m.IdCurso, u.IdAcademia
       FROM Evaluacion e
       INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
       INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
       WHERE e.IdEvaluacion = ?
       LIMIT 1`,
      [idEvaluacion],
    );

    // Si no se encuentra, dejamos que el controlador de la ruta responda 404.
    if (!rows.length) return next();
    const evaluacion = rows[0];

    if (Number(evaluacion.EstadoRegistro) === 2) {
      return res.status(403).json({ error: 'Esta evaluación ya está sellada y no puede modificarse.' });
    }

    const periodo = textoPeriodo(evaluacion.Periodo || 'General');
    if (!periodo) {
      return res.status(409).json({ error: 'La evaluación tiene un periodo inválido; revisa sus datos antes de editarla.' });
    }

    const [cierres] = await pool.query(
      `SELECT ac.IdCierre
       FROM Auditoria_Cierres ac
       INNER JOIN Ciclo ci ON ci.IdCiclo = ac.IdCiclo
       WHERE ac.IdCiclo = ?
         AND ac.IdCurso <=> ?
         AND ac.Periodo = ?
         AND ac.TipoEvaluacion = ?
         AND ci.IdAcademia = ?
       LIMIT 1`,
      [evaluacion.IdCiclo, evaluacion.IdCurso, periodo, evaluacion.TipoEvaluacion, evaluacion.IdAcademia],
    );

    if (cierres.length) {
      return res.status(403).json({
        error: `El periodo "${periodo}" de esta evaluación ya está cerrado para el curso y ciclo seleccionados.`,
      });
    }

    return next();
  } catch (error) {
    console.error('[Cierre] No se pudo comprobar el estado de la evaluación:', error.message);
    return res.status(500).json({ error: 'No se pudo verificar si la evaluación está abierta.' });
  }
};

module.exports = verificarPeriodoAbierto;
