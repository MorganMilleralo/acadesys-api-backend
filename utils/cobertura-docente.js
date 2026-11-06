'use strict';

// Relaciones ya utilizadas por el backend. No requiere IdDocente en HorarioCurso.
async function consultarCobertura(connection, idAcademia, idCiclo = null) {
  const [rows] = await connection.query(`
    SELECT c.IdCiclo, c.Nombre AS Ciclo, cu.IdCurso, cu.Nombre AS Curso,
      EXISTS (
        SELECT 1 FROM Asignacion_Aula aa
        INNER JOIN Usuario docente ON docente.IdUsuario = aa.IdUsuario
          AND docente.IdAcademia = c.IdAcademia AND docente.EstadoRegistro = 1
        INNER JOIN Aula a ON a.IdAula = aa.IdAula
          AND a.IdAcademia = c.IdAcademia AND a.EstadoRegistro = 1
        WHERE aa.IdCiclo = c.IdCiclo AND aa.IdCurso = cu.IdCurso
          AND aa.IdAcademia = c.IdAcademia AND aa.EstadoRegistro = 1
          AND EXISTS (SELECT 1 FROM Usuario_Perfiles up INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil
            WHERE up.IdUsuario = docente.IdUsuario AND up.EstadoRegistro = 1 AND p.EstadoRegistro = 1
              AND LOWER(TRIM(p.Nombre)) IN ('docente', 'tutor de aula'))
      ) AS TieneDocente,
      EXISTS (SELECT 1 FROM HorarioCurso h
        WHERE h.IdCiclo = c.IdCiclo AND h.IdCurso = cu.IdCurso AND h.EstadoRegistro = 1
          AND h.DiaNumero BETWEEN 1 AND 7 AND h.HoraInicio < h.HoraFin) AS TieneHorario
    FROM Ciclo c
    INNER JOIN CicloCurso cc ON cc.IdCiclo = c.IdCiclo AND cc.EstadoRegistro = 1
    INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso AND cu.EstadoRegistro = 1
    WHERE c.IdAcademia = ? ${idCiclo === null ? 'AND c.EstadoRegistro = 1' : 'AND c.IdCiclo = ?'}
    GROUP BY c.IdCiclo, c.Nombre, cu.IdCurso, cu.Nombre
    ORDER BY c.IdCiclo, cu.Nombre`, idCiclo === null ? [idAcademia] : [idAcademia, idCiclo]);
  const cursos = rows.map(row => ({
    idCiclo: Number(row.IdCiclo), ciclo: row.Ciclo, idCurso: Number(row.IdCurso), curso: row.Curso,
    tieneDocente: Number(row.TieneDocente) === 1, tieneHorario: Number(row.TieneHorario) === 1,
  }));
  const pendientes = cursos.filter(curso => !curso.tieneDocente || !curso.tieneHorario);
  return {
    totalCursos: cursos.length,
    cursosConDocente: cursos.filter(curso => curso.tieneDocente).length,
    cursosConHorario: cursos.filter(curso => curso.tieneHorario).length,
    cursosCompletos: cursos.length - pendientes.length,
    coberturaCompleta: cursos.length > 0 && pendientes.length === 0,
    cursos, pendientes,
  };
}

module.exports = { consultarCobertura };
