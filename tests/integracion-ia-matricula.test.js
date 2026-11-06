const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simular, secuencia, servir, consultas } = require('./soporte');
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

test('Tutor IA mantiene el contexto de main sin consultar Evaluacion.IdCurso', async t => {
  prompts.length = 0;
  const fin = secuencia([
    { sql: /FROM Usuario u/, params: [10, 1], rows: [identidad] },
    { sql: /FROM Matricula m.*c.IdAcademia = \?/, params: [10, 1, 1], rows: [matricula] },
    { sql: /FROM CicloCurso/, rows: [{ IdCurso: 3, Nombre: 'Curso Ficticio', Codigo: 'CF', Descripcion: 'Programa' }] },
    { sql: /FROM Evaluacion e.*e.EstadoRegistro IN \(1, 2\)/, params: [10, 7, 1], rows: [
      { IdEvaluacion: 1, Curso: 'Simulacro general', TipoEvaluacion: 'Simulacro', Calificacion: 1000, EstadoRegistro: 2 },
      { IdEvaluacion: 2, Curso: 'Simulacro general', TipoEvaluacion: 'Simulacro', Calificacion: 1400, EstadoRegistro: 1 },
    ], verificar(q) { assert.doesNotMatch(q,/e\.IdCurso/);assert.match(q,/ci.IdAcademia = u.IdAcademia/); } },
    { sql: /e2.EstadoRegistro IN \(1, 2\)/, params: [7, 1, 1200], rows: [{ Puesto: 2 }] },
  ]);
  const pedir = await servir(t, rutas, alumno);
  const r = await pedir('POST', '/api/tutor-ia/diagnostico', { pregunta: 'Ayudame a estudiar', idUsuario: 999, calificaciones: [9999] });
  assert.equal(r.status, 200); assert.equal(r.body.respuesta, 'Respuesta simulada');
  assert.equal(r.body.contexto.promedioGeneral, 1200);assert.equal(r.body.contexto.puestoRanking,2);
  assert.equal(r.body.contexto.escalaMaxima,2000);assert.equal(r.body.contexto.totalEvaluaciones,2);
  assert.equal(r.body.contexto.historial[0].estadoRegistro,2);
  assert.doesNotMatch(prompts[0], /Persona Ficticia|9999/);fin();
});

test('Tutor IA usa la escala unificada por universidad sin crear un contrato nuevo', async t => {
  const fin = secuencia([
    { sql: /FROM Usuario u/, rows: [identidad] },
    { sql: /FROM Matricula m/, rows: [{ ...matricula, UniversidadObjetivo: 'Sin definir' }] },
    { sql: /FROM CicloCurso/, rows: [] },
    { sql: /FROM Evaluacion e/, rows: [{ Curso: 'Simulacro general', TipoEvaluacion: 'Simulacro', Calificacion: 100 }] },
    { sql: /SELECT COUNT\(\*\) \+ 1 AS Puesto/, rows: [{Puesto:1}] },
  ]);
  const pedir = await servir(t, rutas, alumno);
  const r = await pedir('POST', '/api/tutor-ia', { pregunta: 'Diagnostico' });
  assert.equal(r.status, 200);
  // Una universidad sin escala propia usa la escala interna preuniversitaria
  // (20), la misma que aplican notas y dashboard (utils/escalas.js).
  assert.equal(r.body.contexto.escalaMaxima, 20);
  assert.equal(r.body.contexto.promedioGeneral,100);fin();
});

test('Tutor IA no llama al proveedor ni filtra SQL cuando falla el esquema', async t => {
  prompts.length = 0;
  const fin = secuencia([
    { sql: /FROM Usuario u/, rows: [identidad] },
    { sql: /FROM Matricula m/, rows: [matricula] },
    { sql: /FROM CicloCurso/, rows: [] },
    { sql: /FROM Evaluacion e/, error: Object.assign(new Error('SELECT tabla_privada'), { code: 'ER_BAD_FIELD_ERROR' }) },
  ]);
  const pedir = await servir(t, rutas, alumno);
  const r = await pedir('POST', '/api/tutor-ia', { pregunta: 'Diagnostico' });
  assert.equal(r.status, 500); assert.doesNotMatch(JSON.stringify(r.body),/SELECT|tabla_privada/);
  assert.equal(prompts.length, 0); fin();
});

test('recuperacion publica rechaza tokens invalidos antes de consultar o enviar correo', async t => {
  simular();
  const pedir = await servir(t, [['/api/matriculas', 'matriculas.routes']], null);
  const r = await pedir('POST', '/api/matriculas/restablecer-clave', { token: 'invalido-ficticio' });
  assert.equal(r.status, 400); assert.equal(consultas.length, 0);
});


