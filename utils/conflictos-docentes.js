'use strict';

// Ambos escritores (asignaciones y horarios) toman antes el lock de Academia.
// Intervalos contiguos son compatibles; solo se comparan ciclos de fechas coincidentes.
async function conflictoAsignacion(connection, idAcademia, idUsuario, idCiclo, idCurso, idAula = null) {
  const [rows] = await connection.query(`
    SELECT otro.IdHorario AS ConflictoDocente
    FROM HorarioCurso nuevo
    INNER JOIN Ciclo destino ON destino.IdCiclo = nuevo.IdCiclo AND destino.IdAcademia = ?
    INNER JOIN Asignacion_Aula aa ON (aa.IdUsuario = ? OR aa.IdAula = ?) AND aa.IdAcademia = destino.IdAcademia AND aa.EstadoRegistro = 1
    INNER JOIN Ciclo c ON c.IdCiclo = aa.IdCiclo AND c.IdAcademia = aa.IdAcademia AND c.EstadoRegistro = 1
    INNER JOIN CicloCurso cc ON cc.IdCiclo = c.IdCiclo AND cc.IdCurso = aa.IdCurso AND cc.EstadoRegistro = 1
    INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso AND cu.EstadoRegistro = 1
    INNER JOIN HorarioCurso otro ON otro.IdCiclo = aa.IdCiclo AND otro.IdCurso = aa.IdCurso AND otro.EstadoRegistro = 1
    WHERE nuevo.IdCiclo = ? AND nuevo.IdCurso = ? AND nuevo.EstadoRegistro = 1
      AND NOT (aa.IdCiclo = nuevo.IdCiclo AND aa.IdCurso = nuevo.IdCurso)
      AND otro.DiaNumero = nuevo.DiaNumero AND otro.HoraInicio < nuevo.HoraFin AND otro.HoraFin > nuevo.HoraInicio
      AND COALESCE(c.FechaInicio, '1000-01-01') <= COALESCE(destino.FechaFin, '9999-12-31')
      AND COALESCE(destino.FechaInicio, '1000-01-01') <= COALESCE(c.FechaFin, '9999-12-31')
    LIMIT 1 FOR UPDATE`, [idAcademia, idUsuario, idAula, idCiclo, idCurso]);
  return rows.length > 0;
}

async function conflictoHorario(connection, idAcademia, idCiclo, idCurso, idHorario, dia, inicio, fin) {
  const [rows] = await connection.query(`
    SELECT h.IdHorario AS ConflictoDocente
    FROM Asignacion_Aula actual
    INNER JOIN Usuario u ON u.IdUsuario = actual.IdUsuario AND u.IdAcademia = actual.IdAcademia AND u.EstadoRegistro = 1
    INNER JOIN Ciclo destino ON destino.IdCiclo = actual.IdCiclo AND destino.IdAcademia = actual.IdAcademia
    INNER JOIN Asignacion_Aula otra ON (otra.IdUsuario = actual.IdUsuario OR otra.IdAula = actual.IdAula)
      AND otra.IdAcademia = actual.IdAcademia AND otra.EstadoRegistro = 1
    INNER JOIN Ciclo c ON c.IdCiclo = otra.IdCiclo AND c.IdAcademia = otra.IdAcademia AND c.EstadoRegistro = 1
    INNER JOIN CicloCurso cc ON cc.IdCiclo = c.IdCiclo AND cc.IdCurso = otra.IdCurso AND cc.EstadoRegistro = 1
    INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso AND cu.EstadoRegistro = 1
    INNER JOIN HorarioCurso h ON h.IdCiclo = otra.IdCiclo AND h.IdCurso = otra.IdCurso AND h.EstadoRegistro = 1
    WHERE actual.IdAcademia = ? AND actual.IdCiclo = ? AND actual.IdCurso = ? AND actual.EstadoRegistro = 1
      AND h.IdHorario <> ? AND h.DiaNumero = ? AND h.HoraInicio < ? AND h.HoraFin > ?
      AND EXISTS (SELECT 1 FROM Usuario_Perfiles up INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil
        WHERE up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1 AND p.EstadoRegistro = 1
          AND LOWER(TRIM(p.Nombre)) IN ('docente', 'tutor de aula'))
      AND COALESCE(c.FechaInicio, '1000-01-01') <= COALESCE(destino.FechaFin, '9999-12-31')
      AND COALESCE(destino.FechaInicio, '1000-01-01') <= COALESCE(c.FechaFin, '9999-12-31')
    LIMIT 1 FOR UPDATE`, [idAcademia, idCiclo, idCurso, idHorario, dia, fin, inicio]);
  return rows.length > 0;
}

module.exports = { conflictoAsignacion, conflictoHorario };
