// Contrato comun de notas. La escala de curso 0..20 sigue pendiente de
// confirmacion funcional; se conserva la regla ya utilizada por AcadeSys.
const MAX_NOTA_CURSO = 20;
const ESCALAS = Object.freeze({
  UNMSM: 2000, UNI: 2000, PUCP: 1000, UNFV: 1000,
  UNAC: 100, UNT: 300, PREUNIVERSITARIO: 20,
});
const TIPOS = Object.freeze({
  practica: 'Practica', examen: 'Examen', simulacro: 'Simulacro',
  oral: 'Oral', tarea: 'Tarea', participacion: 'Participacion',
});
const normalizarTipo = (valor) => {
  if (typeof valor !== 'string') return null;
  const clave = valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return Object.hasOwn(TIPOS, clave) ? TIPOS[clave] : null;
};
const enteroPositivo = (valor) =>
  (typeof valor === 'number' || (typeof valor === 'string' && /^\d+$/.test(valor.trim()))) &&
  Number.isSafeInteger(Number(valor)) && Number(valor) > 0;
const calificacionValida = (valor) =>
  (typeof valor === 'number' || (typeof valor === 'string' && /^\d+$/.test(valor.trim()))) &&
  Number.isSafeInteger(Number(valor)) && Number(valor) >= 0;
const obtenerMaximoPermitido = (universidad = '') => {
  const clave = String(universidad).trim().toUpperCase();
  return Object.hasOwn(ESCALAS, clave) ? ESCALAS[clave] : null;
};
const esSimulacro = (nota) => nota.IdCurso === null && normalizarTipo(nota.TipoEvaluacion) === 'Simulacro';
const esNotaCurso = (nota) => enteroPositivo(nota.IdCurso) &&
  normalizarTipo(nota.TipoEvaluacion) !== null && normalizarTipo(nota.TipoEvaluacion) !== 'Simulacro';
const promedio = (notas) => notas.length
  ? Number((notas.reduce((suma, n) => suma + Number(n.Calificacion), 0) / notas.length).toFixed(2))
  : null;
const periodoValido = (valor) => typeof valor === 'string' && valor.trim().length > 0 && valor.trim().length <= 50;
const responderErrorEsquema = (res, error) => {
  if (!['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE'].includes(error.code)) return false;
  res.status(503).json({
    codigo: 'ESQUEMA_ACADEMICO_PENDIENTE',
    error: 'El esquema academico requiere una migracion pendiente de verificacion.',
  });
  return true;
};
module.exports = { MAX_NOTA_CURSO, normalizarTipo, enteroPositivo, calificacionValida,
  obtenerMaximoPermitido, esSimulacro, esNotaCurso, promedio, periodoValido, responderErrorEsquema };
