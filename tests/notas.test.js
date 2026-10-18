const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simular, secuencia, servir, eventos, consultas } = require('./soporte');
const { normalizarTipo, enteroPositivo, calificacionValida, obtenerMaximoPermitido } = require('../utils/evaluaciones');
const rutas = [['/api/notas', 'notas.routes'], ['/api', 'actas.routes']];
const nota = { IdMatricula: 100, IdCurso: 3, TipoEvaluacion: 'Practica', Calificacion: 16 };
const lote = { idCiclo: 7, periodo: 'General', notas: [nota] };
const ciclo = { IdCiclo: 7, Nombre: 'Ciclo ficticio', UniversidadObjetivo: 'UNMSM' };
const evaluacion = { IdCiclo: 7, IdCurso: 3, Periodo: 'General', TipoEvaluacion: 'Practica', EstadoRegistro: 1 };

test('validadores rechazan coerciones y propiedades heredadas', () => {
  for (const valor of [true, false, {}, [], [3], null, '', '1e2', '-1', '0x10']) {
    assert.equal(enteroPositivo(valor), false, String(valor));
    assert.equal(calificacionValida(valor), false, String(valor));
  }
  assert.equal(normalizarTipo('__proto__'), null);
  assert.equal(normalizarTipo('constructor'), null);
  assert.equal(normalizarTipo(' Práctica '), 'Practica');
  assert.equal(obtenerMaximoPermitido(' unmsm '), 2000);
  assert.equal(obtenerMaximoPermitido('Sin definir'), null);
});

for (const rol of ['Docente', 'Tutor de Aula', 'Alumno']) {
  test(rol + ' no gestiona notas ni cierres sin autorizacion verificable', async t => {
    simular();
    const pedir = await servir(t, rutas, { id: 10, idAcademia: 1, rol });
    for (const [metodo, url, body] of [['GET', '/api/notas'], ['GET', '/api/notas/contexto/7'], ['GET', '/api/notas/matriculas/7'], ['POST', '/api/notas', lote], ['PUT', '/api/notas/1', { Calificacion: 17 }], ['PUT', '/api/actas/cierre', {}]]) {
      assert.equal((await pedir(metodo, url, body)).status, 403, url);
    }
    assert.equal(consultas.length, 0);
  });
}

test('alumno solo consulta su historial, con academia en ambos lados de la matricula', async t => {
  const fin = secuencia([{ sql: /u.IdUsuario = \? AND u.IdAcademia = \? AND ci.IdAcademia = \?/, params: [10, 1, 1], rows: [] }]);
  const pedir = await servir(t, rutas, { id: 10, idAcademia: 1, rol: 'Alumno' });
  assert.equal((await pedir('GET', '/api/notas/alumno/11')).status, 403);
  assert.equal((await pedir('GET', '/api/notas/alumno/10')).status, 200); fin();
});

test('historial separa cursos, simulacros y registros sin clasificar', async t => {
  simular(() => [[
    { ...evaluacion, Calificacion: 18, UniversidadObjetivo: 'UNMSM' },
    { ...evaluacion, IdCurso: null, TipoEvaluacion: 'Simulacro', Calificacion: 1400, UniversidadObjetivo: 'UNMSM' },
    { ...evaluacion, IdCurso: null, Calificacion: 99, UniversidadObjetivo: 'UNMSM' },
  ]]);
  const pedir = await servir(t, rutas);
  const r = await pedir('GET', '/api/notas/alumno/100');
  assert.equal(r.status, 200); assert.equal(r.body.promedioCursos, 18);
  assert.equal(r.body.promedioGeneral, 1400); assert.equal(r.body.promedioSimulacros, 1400);
  assert.equal(r.body.evaluacionesPendientesClasificar, 1);
  assert.equal(r.body.historialNotas.length, 3);
});

test('no promedia puntajes brutos de universidades con escalas diferentes', async t => {
  simular(() => [[
    { IdCurso: null, TipoEvaluacion: 'Simulacro', Calificacion: 1400, UniversidadObjetivo: 'UNMSM' },
    { IdCurso: null, TipoEvaluacion: 'Simulacro', Calificacion: 80, UniversidadObjetivo: 'UNAC' },
  ]]);
  const pedir = await servir(t, rutas);
  const r = await pedir('GET', '/api/notas/alumno/100');
  assert.equal(r.body.promedioSimulacros, null);
  assert.equal(r.body.escalaMaxima, null);
  assert.equal(r.body.escalasSimulacrosComparables, false);
});

test('ciclo, periodo y lista invalidos no abren transaccion', async t => {
  simular(); const pedir = await servir(t, rutas);
  for (const body of [{ ...lote, idCiclo: true }, { ...lote, periodo: {} }, { ...lote, periodo: '' }, { ...lote, notas: [] }, { ...lote, notas: Array(201).fill(nota) }]) {
    assert.equal((await pedir('POST', '/api/notas', body)).status, 400);
  }
  assert.deepEqual(eventos, []); assert.deepEqual(consultas, []);
});

test('tipos, cursos y calificaciones invalidos revierten el lote', async t => {
  const pedir = await servir(t, rutas);
  for (const parcial of [{ IdCurso: true }, { IdCurso: null }, { TipoEvaluacion: '__proto__' }, { TipoEvaluacion: 'Simulacro' }, { Calificacion: -1 }, { Calificacion: 21 }, { Calificacion: 15.5 }, { Calificacion: true }, { IdMatricula: [100] }]) {
    const fin = secuencia([{ sql: /FROM Ciclo.*FOR UPDATE/, rows: [ciclo] }]);
    const r = await pedir('POST', '/api/notas', { ...lote, notas: [{ ...nota, ...parcial }] });
    assert.equal(r.status, 400, JSON.stringify(parcial)); fin();
    assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
  }
});

test('ciclo ajeno e inexistente no admite notas', async t => {
  const fin = secuencia([{ sql: /FROM Ciclo.*IdAcademia = \?.*FOR UPDATE/, params: [7, 1], rows: [] }]);
  const pedir = await servir(t, rutas);
  assert.equal((await pedir('POST', '/api/notas', lote)).status, 404); fin();
  assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
});

test('matricula ajena o inactiva no admite notas aunque el ciclo sea valido', async t => {
  const fin = secuencia([
    { sql: /FROM Ciclo/, rows: [ciclo] },
    { sql: /FROM Matricula m.*m.IdCiclo = \?.*m.EstadoRegistro = 1.*u.EstadoRegistro = 1.*u.IdAcademia = \?/, params: [100, 7, 1], rows: [] },
  ]);
  const pedir = await servir(t, rutas);
  assert.equal((await pedir('POST', '/api/notas', lote)).status, 403); fin();
});

test('curso inactivo o fuera del ciclo no admite notas', async t => {
  const fin = secuencia([
    { sql: /FROM Ciclo/, rows: [ciclo] },
    { sql: /FROM Matricula/, rows: [{ IdMatricula: 100 }] },
    { sql: /FROM CicloCurso cc.*cu.EstadoRegistro = 1/, params: [7, 3], rows: [] },
  ]);
  const pedir = await servir(t, rutas);
  assert.equal((await pedir('POST', '/api/notas', lote)).status, 400); fin();
});

test('escala desconocida bloquea simulacros pero conserva contexto sin inventar un maximo', async t => {
  simular(() => [[{ ...ciclo, UniversidadObjetivo: 'Sin definir' }]]);
  const pedir = await servir(t, rutas);
  const contexto = await pedir('GET', '/api/notas/contexto/7');
  assert.equal(contexto.body.escalaMaxima, null); assert.equal(contexto.body.escalaMaximaCurso, 20);
  const r = await pedir('POST', '/api/notas', { ...lote, notas: [{ ...nota, IdCurso: null, TipoEvaluacion: 'Simulacro' }] });
  assert.equal(r.status, 409);
});

test('RRHH registra notas por Evaluacion.IdCurso aunque Matricula.IdCurso sea NULL', async t => {
  const fin = secuencia([
    { sql: /FROM Ciclo.*FOR UPDATE/, rows: [ciclo] },
    { sql: /FROM Matricula m/, rows: [{ IdMatricula: 100, IdCurso: null }], verificar(q) { assert.doesNotMatch(q, /m.IdCurso/); } },
    { sql: /FROM CicloCurso/, rows: [{ IdCurso: 3 }] },
    { sql: /FROM Auditoria_Cierres.*IdCurso <=> \?.*FOR UPDATE/, params: [7, 3, 'General', 'Practica'], rows: [] },
    { sql: /^INSERT INTO Evaluacion \( IdMatricula, IdCurso, Periodo/, params: [100, 3, 'General', 'Practica', 16, 10], rows: { affectedRows: 1 } },
  ]);
  const pedir = await servir(t, rutas, { id: 10, idAcademia: 1, rol: 'Recursos Humanos' });
  const r = await pedir('POST', '/api/notas', lote);
  assert.equal(r.status, 201); assert.equal(r.body.escalaMaximaCurso, 20); fin();
  assert.deepEqual(eventos, ['begin', 'commit', 'release']);
});

test('fallo al insertar la segunda nota provoca rollback sin commit', async t => {
  let insertadas = 0;
  simular(q => {
    if (/FROM Ciclo\b/.test(q)) return [[ciclo]];
    if (/FROM Matricula/.test(q)) return [[{ IdMatricula: 100 }]];
    if (/FROM CicloCurso/.test(q)) return [[{ IdCurso: 3 }]];
    if (/FROM Auditoria_Cierres/.test(q)) return [[]];
    if (/INSERT INTO Evaluacion/.test(q)) {
      if (++insertadas === 2) throw new Error('Fallo de insercion simulado');
      return [{ affectedRows: 1 }];
    }
    assert.fail(q);
  });
  const pedir = await servir(t, rutas);
  assert.equal((await pedir('POST', '/api/notas', { ...lote, notas: [nota, nota] })).status, 500);
  assert.equal(insertadas, 2); assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
});

test('PUT vuelve a verificar cierre dentro de la transaccion', async t => {
  const fin = secuencia([
    { sql: /FROM Evaluacion e/, rows: [evaluacion] },
    { sql: /FROM Auditoria_Cierres/, rows: [] },
    { sql: /SELECT m.IdCiclo/, rows: [{ IdCiclo: 7 }] },
    { sql: /FROM Ciclo.*FOR UPDATE/, rows: [ciclo] },
    { sql: /FROM Evaluacion e.*FOR UPDATE/, rows: [evaluacion] },
    { sql: /FROM CicloCurso/, rows: [{ IdCurso: 3 }] },
    { sql: /FROM Auditoria_Cierres.*FOR UPDATE/, params: [7, 3, 'General', 'Practica'], rows: [{ IdCierre: 1 }] },
  ]);
  const pedir = await servir(t, rutas);
  assert.equal((await pedir('PUT', '/api/notas/1', { Calificacion: 18 })).status, 409); fin();
  assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
});

test('nota historica sin curso no se modifica como simulacro', async t => {
  const historica = { ...evaluacion, IdCurso: null };
  const fin = secuencia([
    { sql: /FROM Evaluacion e/, rows: [historica] },
    { sql: /FROM Auditoria_Cierres/, rows: [] },
    { sql: /SELECT m.IdCiclo/, rows: [{ IdCiclo: 7 }] },
    { sql: /FROM Ciclo/, rows: [ciclo] },
    { sql: /FROM Evaluacion e.*FOR UPDATE/, rows: [historica] },
  ]);
  const pedir = await servir(t, rutas);
  assert.equal((await pedir('PUT', '/api/notas/1', { Calificacion: 18 })).status, 409); fin();
});

test('cierre sin notas no genera auditoria y libera la conexion', async t => {
  const fin = secuencia([
    { sql: /FROM Ciclo.*FOR UPDATE/, rows: [ciclo] },
    { sql: /FROM Auditoria_Cierres/, params: [7, null, 'General', 'Simulacro'], rows: [] },
    { sql: /UPDATE Evaluacion.*e.IdCurso <=> \?.*e.Periodo = \?.*e.TipoEvaluacion = \?/, rows: { affectedRows: 0 } },
  ]);
  const pedir = await servir(t, rutas);
  assert.equal((await pedir('PUT', '/api/actas/cierre', { idCiclo: 7, idCurso: null, periodo: 'General', tipoEvaluacion: 'Simulacro' })).status, 409);
  fin(); assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
});

test('fallo de auditoria revierte cierre; RRHH tiene el mismo alcance', async t => {
  const fin = secuencia([
    { sql: /FROM Ciclo.*FOR UPDATE/, rows: [ciclo] },
    { sql: /FROM CicloCurso/, rows: [{ IdCurso: 3 }] },
    { sql: /FROM Auditoria_Cierres/, params: [7, 3, 'Semana 2', 'Examen'], rows: [] },
    { sql: /UPDATE Evaluacion/, params: [10, 7, 3, 'Semana 2', 'Examen', 1], rows: { affectedRows: 4 } },
    { sql: /INSERT INTO Auditoria_Cierres.*RegistrosAfectados/, params: [10, 7, 3, 'Semana 2', 'Examen', 4], error: new Error('Auditoria fallida simulada') },
  ]);
  const pedir = await servir(t, rutas, { id: 10, idAcademia: 1, rol: 'Recursos Humanos' });
  assert.equal((await pedir('PUT', '/api/actas/cierre', { idCiclo: 7, idCurso: 3, periodo: 'Semana 2', tipoEvaluacion: 'Examen' })).status, 500);
  fin(); assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
});

test('cierre conserva identificadores numericos cuando React envia cadenas', async t => {
  const fin = secuencia([
    { sql: /FROM Ciclo/, params: [7, 1], rows: [ciclo] },
    { sql: /FROM CicloCurso/, params: [7, 3], rows: [{ IdCurso: 3 }] },
    { sql: /FROM Auditoria_Cierres/, rows: [] },
    { sql: /UPDATE Evaluacion/, rows: { affectedRows: 2 } },
    { sql: /INSERT INTO Auditoria_Cierres/, params: [10, 7, 3, 'General', 'Practica', 2], rows: { insertId: 1 } },
  ]);
  const pedir = await servir(t, rutas);
  const r = await pedir('PUT', '/api/actas/cierre', { idCiclo: '7', idCurso: '3', periodo: 'General', tipoEvaluacion: 'Practica' });
  assert.equal(r.status, 200); assert.equal(r.body.idCiclo, 7); assert.equal(r.body.idCurso, 3);
  assert.equal(r.body.notasBloqueadas, 2); fin();
});

test('esquema pendiente devuelve 503 sin exponer SQL ni datos internos', async t => {
  simular(() => { throw Object.assign(new Error('detalle SQL privado ficticio'), { code: 'ER_BAD_FIELD_ERROR' }); });
  const pedir = await servir(t, rutas);
  const r = await pedir('GET', '/api/notas');
  assert.equal(r.status, 503); assert.equal(r.body.codigo, 'ESQUEMA_ACADEMICO_PENDIENTE');
  assert.doesNotMatch(JSON.stringify(r.body), /detalle SQL privado/);
});

test('dashboard conserva estructura y separa notas de cursos y simulacros', async t => {
  const fin = secuencia([
    { sql: /COUNT\(DISTINCT u.IdUsuario\)/, rows: [{ TotalEstudiantes: 1 }] },
    { sql: /MatriculasActivas/, rows: [{ MatriculasActivas: 1 }] },
    { sql: /TotalAlumnos/, rows: [] },
    { sql: /TotalMorosos/, rows: [] },
    { sql: /TotalPagos/, rows: [] },
    { sql: /PromedioBruto/, rows: [
      { ...ciclo, PromedioBruto: 1500, PromedioCursos: 18, TotalSimulacros: 1, TotalNotasCurso: 1, Evaluaciones: 2 },
      { ...ciclo, IdCiclo: 8, UniversidadObjetivo: 'Desconocida', PromedioBruto: 900, TotalSimulacros: 1 },
    ] },
  ]);
  const pedir = await servir(t, [['/api/admin', 'dashboard.routes']]);
  const r = await pedir('GET', '/api/admin/dashboard/overview');
  assert.equal(r.status, 200); assert.ok(r.body.pagos); assert.ok(r.body.ciclos); assert.ok(r.body.actualizadoEn);
  assert.equal(r.body.rendimientoPorCiclo[0].promedio, 15);
  assert.equal(r.body.rendimientoPorCiclo[0].promedioCursos, 18);
  assert.equal(r.body.rendimientoPorCiclo[1].escalaConocida, false);
  assert.equal(r.body.resumen.promedioInstitucional, 15); fin();
});

test('alumno/me conserva contrato, incluye notas cerradas y no mezcla escalas', async t => {
  const fin = secuencia([
    { sql: /FROM Usuario u/, rows: [{ IdUsuario: 10, Nombres: 'Ficticio' }] },
    { sql: /FROM Matricula m.*c.IdAcademia = \?/, params: [10, 1], rows: [{ IdMatricula: 100, ...ciclo, Ciclo: ciclo.Nombre }] },
    { sql: /FROM CicloCurso/, rows: [] },
    { sql: /FROM HorarioCurso/, rows: [] },
    { sql: /FROM Evaluacion.*e.EstadoRegistro IN \(1, 2\)/, rows: [
      { ...evaluacion, Calificacion: 18, EstadoRegistro: 2 },
      { ...evaluacion, IdCurso: null, TipoEvaluacion: 'Simulacro', Calificacion: 1400 },
      { ...evaluacion, IdCurso: null, Calificacion: 100 },
    ] },
    { sql: /SELECT COUNT\(\*\) \+ 1 AS Puesto/, params: [7, 1, 1400], rows: [{ Puesto: 1 }] },
    { sql: /FROM MaterialAcademico/, rows: [] },
  ]);
  const pedir = await servir(t, [['/api/alumno', 'alumno.routes']], { id: 10, idAcademia: 1, rol: 'Alumno' });
  const r = await pedir('GET', '/api/alumno/me');
  assert.equal(r.status, 200); assert.ok(r.body.usuario); assert.ok(r.body.ciclo);
  assert.equal(r.body.matricula.idMatricula, 100);
  assert.equal(r.body.notas.promedioGeneral, 1400); assert.equal(r.body.notas.promedioCursos, 18);
  assert.equal(r.body.notas.historial[0].estadoRegistro, 2);
  assert.equal(r.body.notas.evaluacionesPendientesClasificar, 1); fin();
});
