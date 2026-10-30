'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simular, servir, eventos, consultas } = require('./soporte');
const { prepararPlan } = require('../scripts/plan-regularizacion-pagos');
test('AC-06 cobertura informa pendientes de docente y horario sin duplicar cursos', async t => {
  const pedir = await servir(t, [['/api', 'academico.routes']]);
  simular((sql, params) => {
    if (/AS TieneDocente/.test(sql)) {
      assert.deepEqual(params, [1, 7]);
      for (const campo of ['docente.EstadoRegistro = 1', 'p.EstadoRegistro = 1', 'a.EstadoRegistro = 1', 'aa.IdAcademia = c.IdAcademia']) assert.ok(sql.includes(campo));
      assert.match(sql, /EXISTS/);
      assert.doesNotMatch(sql, /h.IdDocente/);
      return [[{ IdCiclo: 7, IdCurso: 1, TieneDocente: 1, TieneHorario: 0 },
        { IdCiclo: 7, IdCurso: 2, TieneDocente: 0, TieneHorario: 1 },
        { IdCiclo: 7, IdCurso: 3, TieneDocente: 1, TieneHorario: 1 }]];
    }
    assert.deepEqual(params, [7, 1]);
    return [[{ IdCiclo: 7 }]];
  });
  const r = await pedir('GET', '/api/ciclos/7/cobertura');
  assert.equal(r.status, 200);
  assert.equal(r.body.totalCursos, 3);
  assert.equal(r.body.cursosConDocente, 2);
  assert.equal(r.body.cursosConHorario, 2);
  assert.equal(r.body.pendientes.length, 2);
  assert.equal(r.body.coberturaCompleta, false);
});

test('AC-06 cobertura no expone ciclo ajeno ni permite alumno/docente', async t => {
  const pedir = await servir(t, [['/api', 'academico.routes']]);
  simular(() => [[]]);
  assert.equal((await pedir('GET', '/api/ciclos/99/cobertura')).status, 404);
  assert.equal(consultas.length, 1);
  for (const rol of ['Alumno', 'Docente']) {
    const limitado = await servir(t, [['/api', 'academico.routes']], { id: 10, idAcademia: 1, rol });
    simular();
    assert.equal((await limitado('GET', '/api/ciclos/7/cobertura')).status, 403);
    assert.equal(consultas.length, 0);
  }
});

function fixtureAsignacion({ docente = true, vinculado = true, conflicto = false, duplicado = false } = {}) {
  simular((sql, params) => {
    if (/FROM Academia/.test(sql)) return [[{ IdAcademia: 1 }]];
    if (/FROM Usuario u/.test(sql)) {
      assert.deepEqual(params, [20, 1]);
      assert.match(sql, /u.EstadoRegistro = 1/);
      return [docente ? [{ IdUsuario: 20 }] : []];
    }
    if (/FROM Ciclo WHERE/.test(sql)) return [[{ IdCiclo: 7 }]];
    if (/FROM Curso WHERE/.test(sql)) return [[{ IdCurso: 3 }]];
    if (/FROM CicloCurso WHERE/.test(sql)) return [vinculado ? [{ IdCiclo: 7 }] : []];
    if (/AS ConflictoDocente/.test(sql)) {
      assert.deepEqual(params, [1, 20, 2, 7, 3]);
      assert.match(sql, /aa.IdUsuario = \? OR aa.IdAula = \?/);
      assert.match(sql, /otro.HoraInicio < nuevo.HoraFin AND otro.HoraFin > nuevo.HoraInicio/);
      assert.match(sql, /COALESCE\(c.FechaInicio/);
      return [conflicto ? [{ ConflictoDocente: 10 }] : []];
    }
    if (/FROM Aula WHERE/.test(sql)) return [[{ IdAula: 2 }]];
    if (/SELECT IdAsignacion/.test(sql)) return [duplicado ? [{ IdAsignacion: 8 }] : []];
    if (/INSERT INTO Asignacion_Aula/.test(sql)) return [{ insertId: 8 }];
    throw new Error(sql);
  });
}
test('AC-06 asignación rechaza docente inválido, curso ajeno, conflicto y duplicado; conserva alta válida', async t => {
  const pedir = await servir(t, [['/api', 'academico.routes']]);
  for (const [config, status] of [[{ docente: false }, 400], [{ vinculado: false }, 400],
    [{ conflicto: true }, 409], [{ duplicado: true }, 409], [{}, 201]]) {
    fixtureAsignacion(config);
    assert.equal((await pedir('POST', '/api/asignaciones', { idUsuario: 20, idCiclo: 7, idCurso: 3, idAula: 2 })).status, status);
    assert.match(consultas[0].q, /FROM Academia.*FOR UPDATE/);
    assert.deepEqual(eventos, ['begin', status === 201 ? 'commit' : 'rollback', 'release']);
    if (status !== 201) assert.ok(!consultas.some(({ q }) => /^INSERT|^UPDATE/.test(q)));
  }
});

test('AC-06 crear/editar horario rechaza conflicto de docente entre ciclos y revierte', async t => {
  const pedir = await servir(t, [['/api', 'academico.routes']]);
  for (const [metodo, ruta] of [['POST', '/api/horarios'], ['PUT', '/api/horarios/9']]) {
    simular((sql, params) => {
      if (/AS ConflictoDocente/.test(sql)) {
        assert.deepEqual(params, [1, 7, 3, metodo === 'PUT' ? 9 : 0, 1, '10:00:00', '08:00:00']);
        assert.match(sql, /h.IdHorario <> \?/);
        assert.match(sql, /otra.IdUsuario = actual.IdUsuario OR otra.IdAula = actual.IdAula/);
        return [[{ ConflictoDocente: 10 }]];
      }
      if (/SELECT IdHorario FROM HorarioCurso/.test(sql)) return [[]];
      return [[{ IdCiclo: 7, IdCurso: 3, IdHorario: 9 }]];
    });
    const r = await pedir(metodo, ruta, { idCiclo: 7, idCurso: 3, diaNumero: 1, diaSemana: 'Lunes', horaInicio: '08:00', horaFin: '10:00' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'CONFLICTO_HORARIO_ASIGNACION');
    assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
    assert.ok(!consultas.some(({ q }) => /^INSERT|^UPDATE/.test(q)));
  }
});

test('AC-07 dashboard sin filtros nunca calcula promedio académico multi-escala', async t => {
  const pedir = await servir(t, [['/api/admin', 'dashboard.routes']]);
  simular(sql => {
    assert.doesNotMatch(sql, /AVG\(/);
    if (/AS TotalEvaluaciones/.test(sql)) return [[{ IdCiclo: 1, EstadoRegistro: 1, Capacidad: 100, TotalAlumnos: 6 }]];
    if (/AS TieneDocente/.test(sql)) return [[{ IdCiclo: 1, IdCurso: 1, TieneDocente: 0, TieneHorario: 0 }]];
    return [[]];
  });
  const r = await pedir('GET', '/api/admin/dashboard/overview');
  assert.equal(r.status, 200);
  assert.equal(r.body.resumen.promedioInstitucional, null);
  assert.deepEqual(r.body.rendimientoPorCiclo, []);
  assert.equal(r.body.resumen.vacantesDisponibles, 94);
  assert.equal(r.body.coberturaDocente.totalCursos, 1);
  assert.equal(r.body.coberturaDocente.cursosConDocente, 0);
  assert.equal(r.body.coberturaDocente.pendientes.length, 1);
  assert.equal(r.body.rendimientoEstado.comparable, false);
});

test('HU-12 filtros afectan métricas operativas; un periodo arbitrario no acredita simulacro semanal', async t => {
  const pedir = await servir(t, [['/api/admin', 'dashboard.routes']]);
  simular((sql, params) => {
    assert.ok(sql.includes('IdAcademia'));
    assert.doesNotMatch(sql, /AVG\(/);
    assert.match(sql, /c.IdCiclo = \?/);
    assert.equal(params.at(-1), 7);
    if (/AS TotalEvaluaciones/.test(sql)) return [[{ IdCiclo: 7, EstadoRegistro: 1, Capacidad: 120, TotalAlumnos: 120 }]];
    if (/FROM PagosMensualidad/.test(sql)) assert.match(sql, /c.IdAcademia = u.IdAcademia/);
    return [[]];
  });
  const r = await pedir('GET', '/api/admin/dashboard/overview?idCiclo=7&periodo=Semana1');
  assert.equal(r.status, 200);
  assert.equal(r.body.resumen.promedioInstitucional, null);
  assert.deepEqual(r.body.rendimientoPorCiclo, []);
  assert.equal(r.body.rendimientoEstado.codigo, 'IDENTIFICACION_SEMANAL_PENDIENTE');
  assert.equal(r.body.resumen.vacantesDisponibles, 0);
});

test('AC-07 filtros inválidos no consultan SQL y ciclo ajeno no entrega métricas', async t => {
  const pedir = await servir(t, [['/api/admin', 'dashboard.routes']]);
  for (const query of ['idCiclo=x', 'idCiclo=0', 'periodo=Semana1', 'idCiclo=7&periodo=', 'idCiclo=7&idCiclo=8']) {
    simular();
    assert.equal((await pedir('GET', '/api/admin/dashboard/overview?' + query)).status, 400);
    assert.equal(consultas.length, 0);
  }
  simular(() => [[]]);
  assert.equal((await pedir('GET', '/api/admin/dashboard/overview?idCiclo=99')).status, 404);
  assert.ok(!consultas.some(({ q }) => /FROM PagosMensualidad/.test(q)));
});

const cuota = { IdPago: 5, IdUsuario: 20, IdCiclo: 7, IdAcademia: 1, Mes: '2026-10',
  Monto: '1.00', MontoAprobado: '300.00', Estado: 'Pendiente', FechaPago: null, EstadoRegistro: 1,
  decisionMorgan: 'EJEMPLO FICTICIO; no es una aprobación real' };
test('AC-01/P-07 plan offline conserva respaldo, vista previa y reversión condicional sin commit', () => {
  const plan = prepararPlan([cuota]);
  assert.deepEqual(plan.respaldo, [cuota]);
  assert.deepEqual(plan.vistaPrevia, [{ idPago: 5, anterior: '1.00', nuevo: '300.00' }]);
  assert.match(plan.aplicarSQL, /SET p.Monto = 300.00/);
  assert.match(plan.revertirSQL, /SET p.Monto = 1.00/);
  for (const sql of [plan.aplicarSQL, plan.revertirSQL]) {
    assert.match(sql, /p.FechaPago IS NULL/);
    assert.match(sql, /BINARY p.Estado = 'Pendiente'/);
    assert.match(sql, /u.IdAcademia = 1 AND c.IdAcademia = 1/);
    assert.match(sql, /ROLLBACK;$/);
    assert.doesNotMatch(sql, /^COMMIT;/m);
  }
});
test('P-07 generador rechaza confirmados, periodos ambiguos, importes inseguros y ausencia de decisión', () => {
  for (const cambio of [{ Estado: 'Pagado' }, { FechaPago: '2026-10-01' }, { EstadoRegistro: 0 },
    { Mes: 'Historico' }, { Mes: "2026-10'; DROP TABLE Ciclo; --" }, { MontoAprobado: '1.234' },
    { MontoAprobado: '1e3' }, { MontoAprobado: 300 }, { decisionMorgan: '' }, { IdPago: -1 }]) {
    assert.throws(() => prepararPlan([{ ...cuota, ...cambio }]));
  }
  assert.throws(() => prepararPlan([cuota, cuota]));
});
