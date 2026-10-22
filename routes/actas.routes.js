const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');
const { idPositivo, rollbackSeguro } = require('../utils/validaciones');

const TIPOS_VALIDOS = new Map([
  ['practica', 'Practica'],
  ['evaluacion', 'Evaluacion'],
  ['examen', 'Examen'],
  ['simulacro', 'Simulacro'],
]);

function normalizarTipo(valor) {
  if (typeof valor !== 'string') return null;
  const clave = valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return TIPOS_VALIDOS.get(clave) || null;
}

function periodoValido(valor) {
  const periodo = typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '';
  return periodo.length >= 1 && periodo.length <= 50 ? periodo : null;
}

// PUT /api/actas/cierre
// Body: { idCiclo, idCurso, periodo, tipoEvaluacion }
// Contrato legado de main: IdCurso es el alcance de Matricula, no de Evaluacion.
// Se conserva por compatibilidad; no representa un nuevo cierre semanal.
router.put('/actas/cierre', requiereRol('Administrador'), async (req, res) => {
  const idCiclo = idPositivo(req.body?.idCiclo ?? req.body?.IdCiclo);
  const idCursoRaw = req.body?.idCurso ?? req.body?.IdCurso;
  const idCurso = idCursoRaw === null || idCursoRaw === undefined || idCursoRaw === ''
    ? null
    : Number(idCursoRaw);
  const periodo = periodoValido(req.body?.periodo ?? req.body?.Periodo);
  const tipoEvaluacion = normalizarTipo(req.body?.tipoEvaluacion ?? req.body?.TipoEvaluacion);
  const idAdmin = idPositivo(req.usuario?.idUsuario ?? req.usuario?.id);
  const idAcademia = idPositivo(req.usuario?.idAcademia);

  const cursoFueIndicado = Object.prototype.hasOwnProperty.call(req.body || {}, 'idCurso')
    || Object.prototype.hasOwnProperty.call(req.body || {}, 'IdCurso');
  if (!cursoFueIndicado) {
    return res.status(400).json({ error: 'Indica idCurso explícitamente; usa null para las evaluaciones cuya matrícula todavía no tiene un curso asignado.' });
  }
  if (idCursoRaw != null && idCursoRaw !== '' && !idPositivo(idCursoRaw)) return res.status(400).json({ error: 'IdCurso no válido.' });
  if (!Number.isInteger(idCiclo) || idCiclo <= 0 || (idCurso !== null && (!Number.isInteger(idCurso) || idCurso <= 0))) {
    return res.status(400).json({ error: 'Debes indicar un idCiclo válido y un idCurso positivo o null.' });
  }
  if (!periodo) return res.status(400).json({ error: 'El periodo es obligatorio y debe tener hasta 50 caracteres.' });
  if (!tipoEvaluacion) {
    return res.status(400).json({ error: 'Tipo de evaluación inválido. Usa Práctica, Evaluación, Examen o Simulacro.' });
  }
  if (!Number.isInteger(idAdmin) || idAdmin <= 0 || !Number.isInteger(idAcademia) || idAcademia <= 0) {
    return res.status(401).json({ error: 'No se pudo validar la identidad o academia del administrador.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Se serializa el cierre por ciclo para que el registro de notas, que también
    // bloquea esta fila, no inserte calificaciones durante el cierre.
    const [ciclos] = await connection.query(
      `SELECT IdCiclo FROM Ciclo
       WHERE IdCiclo = ? AND IdAcademia = ? AND EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [idCiclo, idAcademia],
    );
    if (!ciclos.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'El ciclo no existe, está inactivo o no pertenece a tu academia.' });
    }

    if (idCurso !== null) {
      const [cursos] = await connection.query(
        `SELECT IdCurso FROM CicloCurso
         WHERE IdCiclo = ? AND IdCurso = ? AND EstadoRegistro = 1
         LIMIT 1`,
        [idCiclo, idCurso],
      );
      if (!cursos.length) {
        await connection.rollback();
        return res.status(404).json({ error: 'El curso no está asociado al ciclo indicado.' });
      }
    }

    const [cierresPrevios] = await connection.query(
      `SELECT IdCierre FROM Auditoria_Cierres
       WHERE IdCiclo = ? AND IdCurso <=> ? AND Periodo = ? AND TipoEvaluacion = ?
       LIMIT 1 FOR UPDATE`,
      [idCiclo, idCurso, periodo, tipoEvaluacion],
    );
    if (cierresPrevios.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'Este curso, ciclo, periodo y tipo de evaluación ya están cerrados.' });
    }

    const [actualizacion] = await connection.query(
      `UPDATE Evaluacion e
       INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
       INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
       SET e.EstadoRegistro = 2,
           e.UsuarioModificacion = ?,
           e.FechaModificacion = NOW()
       WHERE m.IdCiclo = ?
         AND m.IdCurso <=> ?
         AND e.Periodo = ?
         AND e.TipoEvaluacion = ?
         AND e.EstadoRegistro = 1
         AND u.IdAcademia = ?`,
      [idAdmin, idCiclo, idCurso, periodo, tipoEvaluacion, idAcademia],
    );

    await connection.query(
      `INSERT INTO Auditoria_Cierres
         (IdAdministrador, IdCiclo, IdCurso, Periodo, TipoEvaluacion, FechaCierre)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [idAdmin, idCiclo, idCurso, periodo, tipoEvaluacion],
    );

    await connection.commit();
    return res.json({
      mensaje: 'Cierre de acta registrado correctamente.',
      alcance: { idCiclo, idCurso, periodo, tipoEvaluacion, alcanceCurso: idCurso === null ? 'Matrículas sin curso asignado' : 'Curso específico' },
      evaluacionesSelladas: Number(actualizacion.affectedRows || 0),
    });
  } catch (error) {
    if (connection) {
      await rollbackSeguro(connection);
    }
    console.error('Error en PUT /api/actas/cierre:', error.message);
    return res.status(500).json({ error: 'No se pudo cerrar el acta. La operación fue revertida.' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;


