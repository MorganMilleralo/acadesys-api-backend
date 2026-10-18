const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simular, secuencia, servir, consultas } = require('./soporte');

// Sustituir todo el SDK antes de importar las rutas. Nunca se llama a Gemini.
const sdk = require.resolve('@google/generative-ai');
const prompts = [];
require.cache[sdk] = { id: sdk, filename: sdk, loaded: true, exports: {
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { async generateContent(prompt) {
        prompts.push(prompt);
        return { response: { text: () => JSON.stringify({ respuesta: 'Respuesta simulada', planEstudio: [] }) } };
      } };
    }
  },
} };
process.env.GEMINI_API_KEY = 'clave-ficticia-sin-acceso-a-proveedor';
const alumno = { id: 10, idAcademia: 1, rol: 'Alumno' };
const rutas = [['/api', 'ia.routes']];
const identidad = { IdUsuario: 10, NombreCompleto: 'Persona Ficticia', CodigoUsuario: 'PRUEBA' };
const matricula = { IdMatricula: 100, IdCiclo: 7, NombreCiclo: 'Ciclo Ficticio', UniversidadObjetivo: 'UNMSM' };

test('Tutor IA usa curso de evaluacion, incluye cerradas y separa sus escalas', async t => {
  prompts.length = 0;
  const fin = secuencia([
    { sql: /FROM Usuario u/, params: [10, 1], rows: [identidad] },
    { sql: /FROM Matricula m.*c.IdAcademia = \?/, params: [10, 1, 1], rows: [matricula] },
    { sql: /FROM CicloCurso/, rows: [{ IdCurso: 3, Nombre: 'Curso Ficticio' }] },
    { sql: /FROM Evaluacion e.*cu.IdCurso = e.IdCurso.*e.EstadoRegistro IN \(1, 2\)/, params: [10, 7, 1], rows: [
      { IdEvaluacion: 1, IdCurso: 3, Curso: 'Curso Ficticio', TipoEvaluacion: 'Evaluacion', Calificacion: 16 },
      { IdEvaluacion: 2, IdCurso: null, Curso: 'Simulacro general', TipoEvaluacion: 'Simulacro', Calificacion: 1200 },
      { IdEvaluacion: 3, IdCurso: null, Curso: 'Pendiente', TipoEvaluacion: 'Practica', Calificacion: 18 },
    ] },
    { sql: /e2.EstadoRegistro IN \(1, 2\).*e2.IdCurso IS NULL AND e2.TipoEvaluacion = 'Simulacro'/,
      params: [7, 1, 1200], rows: [{ Puesto: 2 }] },
  ]);
  const pedir = await servir(t, rutas, alumno);
  const r = await pedir('POST', '/api/tutor-ia/diagnostico', { pregunta: 'Ayudame a estudiar', idUsuario: 999, calificaciones: [9999] });
  assert.equal(r.status, 200); assert.equal(r.body.respuesta, 'Respuesta simulada');
  assert.equal(r.body.contexto.promedioGeneral, 1200);
  assert.equal(r.body.contexto.cursos[0].promedio, 16);
  assert.equal(r.body.contexto.historial[0].escalaMaxima, 20);
  assert.equal(r.body.contexto.historial[1].escalaMaxima, 2000);
  assert.equal(r.body.contexto.historial[2].ambito, 'pendiente');
  assert.match(prompts[0], /provisional/); assert.doesNotMatch(prompts[0], /Persona Ficticia|9999/);
  fin();
});

test('Tutor IA sin escala conocida no inventa promedio ni ranking de simulacros', async t => {
  const fin = secuencia([
    { sql: /FROM Usuario u/, rows: [identidad] },
    { sql: /FROM Matricula m/, rows: [{ ...matricula, UniversidadObjetivo: 'Sin definir' }] },
    { sql: /FROM CicloCurso/, rows: [] },
    { sql: /FROM Evaluacion e/, rows: [{ IdCurso: null, Curso: 'Simulacro general', TipoEvaluacion: 'Simulacro', Calificacion: 100 }] },
  ]);
  const pedir = await servir(t, rutas, alumno);
  const r = await pedir('POST', '/api/tutor-ia', { pregunta: 'Diagnostico' });
  assert.equal(r.status, 200); assert.equal(r.body.contexto.escalaMaxima, null);
  assert.equal(r.body.contexto.promedioGeneral, null); assert.equal(r.body.contexto.puestoRanking, null); fin();
});

test('Tutor IA devuelve esquema pendiente y no llama al proveedor si falta IdCurso', async t => {
  prompts.length = 0;
  const fin = secuencia([
    { sql: /FROM Usuario u/, rows: [identidad] },
    { sql: /FROM Matricula m/, rows: [matricula] },
    { sql: /FROM CicloCurso/, rows: [] },
    { sql: /FROM Evaluacion e/, error: Object.assign(new Error('Columna ausente simulada'), { code: 'ER_BAD_FIELD_ERROR' }) },
  ]);
  const pedir = await servir(t, rutas, alumno);
  const r = await pedir('POST', '/api/tutor-ia', { pregunta: 'Diagnostico' });
  assert.equal(r.status, 503); assert.equal(r.body.codigo, 'ESQUEMA_ACADEMICO_PENDIENTE');
  assert.equal(prompts.length, 0); fin();
});

test('recuperacion publica rechaza tokens invalidos antes de consultar o enviar correo', async t => {
  simular();
  const pedir = await servir(t, [['/api/matriculas', 'matriculas.routes']], null);
  const r = await pedir('POST', '/api/matriculas/restablecer-clave', { token: 'invalido-ficticio' });
  assert.equal(r.status, 400); assert.equal(consultas.length, 0);
});
