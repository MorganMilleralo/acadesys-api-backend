'use strict';

const { consultar } = require('../config/procedimientos');

// Cobertura de docentes y horarios por curso. No requiere IdDocente en HorarioCurso.
async function consultarCobertura(connection, idAcademia, idCiclo = null) {
  const [rows] = await consultar(connection, 'sp_dashboard_cobertura_docente', [idAcademia, idCiclo]);
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
