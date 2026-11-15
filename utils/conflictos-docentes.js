'use strict';
const { consultar } = require('../config/procedimientos');

// Ambos escritores (asignaciones y horarios) toman antes el lock de Academia.
// Intervalos contiguos son compatibles; solo se comparan ciclos de fechas coincidentes.
async function conflictoAsignacion(connection, idAcademia, idUsuario, idCiclo, idCurso, idAula = null) {
  const [rows] = await consultar(connection, 'sp_academico_bloquear_horario_por_id_usuario', [idAcademia, idUsuario, idAula, idCiclo, idCurso]);
  return rows.length > 0;
}

async function conflictoHorario(connection, idAcademia, idCiclo, idCurso, idHorario, dia, inicio, fin) {
  const [rows] = await consultar(connection, 'sp_academico_bloquear_asignacion_por_id_ciclo', [idAcademia, idCiclo, idCurso, idHorario, dia, fin, inicio]);
  return rows.length > 0;
}

module.exports = { conflictoAsignacion, conflictoHorario };
