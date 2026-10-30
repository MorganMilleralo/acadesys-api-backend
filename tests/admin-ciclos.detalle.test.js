// ============================================================
// Regresión del bug real: GET /api/admin/ciclos/:id devolvía 500
// porque la consulta de horarios seleccionaba `h.Docente`, una columna
// que NO existe en la tabla HorarioCurso del esquema desplegado
// (verificado con SHOW COLUMNS: IdHorario, IdCiclo, IdCurso, DiaNumero,
// DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro).
//
// El docente real se deriva de Asignacion_Aula -> Usuario, igual que ya lo
// hace GET /api/ciclos/:id/cursos.
//
// Runner nativo de Node (node --test), sin dependencias extra: se inyecta un
// pool falso en require.cache para montar el router real de Express.
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const CICLOS = {
  13: { IdCiclo: 13, IdAcademia: 1, Nombre: 'Ciclo Semestral UNFV 2026', UniversidadObjetivo: 'UNFV', Capacidad: 250, TotalAlumnos: 1, TotalCursos: 1 },
};

// Guarda las sentencias SQL recibidas para inspeccionarlas en los tests.
const sentencias = [];

function consulta(sql, params = []) {
  const texto = String(sql);
  sentencias.push(texto);

  // Contrato de esquema: reproducir el error real si se vuelve a referenciar
  // la columna inexistente de HorarioCurso.
  if (/FROM HorarioCurso/i.test(texto) && /h\.Docente\b/i.test(texto)) {
    const error = new Error("Unknown column 'h.Docente' in 'field list'");
    error.code = 'ER_BAD_FIELD_ERROR';
    return Promise.reject(error);
  }

  if (/c\.IdCiclo = \?/i.test(texto)) {
    const fila = CICLOS[Number(params[0])];
    return Promise.resolve([fila ? [fila] : []]);
  }
  if (/FROM Ciclo c\b/i.test(texto) && /c\.IdAcademia = \?/i.test(texto) && /ORDER BY c\.EstadoRegistro/i.test(texto)) {
    return Promise.resolve([[
      { IdCiclo: 13, IdAcademia: 1, Nombre: 'Ciclo Semestral UNFV 2026', UniversidadObjetivo: 'UNFV', Capacidad: 250, TotalAlumnos: 1, TotalCursos: 16, Precio: 0, EstadoRegistro: 1 },
      { IdCiclo: 1, IdAcademia: 1, Nombre: 'Semestral San Marcos', UniversidadObjetivo: 'UNMSM', Capacidad: 100, TotalAlumnos: 6, TotalCursos: 10, Precio: 0, EstadoRegistro: 1 },
    ]]);
  }
  if (/FROM CicloCurso cc/i.test(texto)) {
    return Promise.resolve([[{ IdCiclo: Number(params[0]), IdCurso: 7, Orden: 1, Nombre: 'Álgebra', Codigo: 'ALG', Descripcion: '' }]]);
  }
  if (/FROM HorarioCurso h/i.test(texto)) {
    return Promise.resolve([[{ IdHorario: 50, IdCiclo: Number(params[0]), IdCurso: 7, DiaNumero: 1, DiaSemana: 'Lunes', HoraInicio: '08:00', HoraFin: '10:00', Docente: 'Juan Pérez', Orden: 1, Curso: 'Álgebra' }]]);
  }
  return Promise.resolve([[]]);
}

const poolFalso = {
  query: consulta,
  async getConnection() {
    return {
      beginTransaction: async () => {},
      query: consulta,
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    };
  },
  end: async () => {},
};

// Inyectar el pool falso ANTES de requerir el router real.
const rutaDb = require.resolve('../config/db');
require.cache[rutaDb] = { id: rutaDb, filename: rutaDb, loaded: true, exports: poolFalso };

const routerAdminCiclos = require('../routes/admin-ciclos.routes');
const ciclosModulo = require('../routes/ciclos.routes');

function crearApp(rol = 'Administrador') {
  const app = express();
  app.use(express.json());
  // Simula lo que auth.middleware resuelve desde la BD.
  app.use((req, res, next) => {
    req.usuario = { id: 1, idUsuario: 1, idAcademia: 1, idPerfil: 9, rol };
    next();
  });
  app.use('/api/admin/ciclos', routerAdminCiclos);
  return app;
}

async function conServidor(fn) {
  const server = crearApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`, '/api/admin/ciclos');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/admin/ciclos/:id con ciclo válido responde 200 (antes: 500)', async () => {
  await conServidor(async (base, ruta) => {
    const res = await fetch(`${base}${ruta}/13`);
    assert.equal(res.status, 200);
    const cuerpo = await res.json();
    assert.equal(cuerpo.ciclo.IdCiclo, 13);
    assert.ok(Array.isArray(cuerpo.cursos));
    assert.ok(Array.isArray(cuerpo.horarios));
  });
});

test('la consulta de horarios no referencia la columna inexistente y deriva el docente de Asignacion_Aula', async () => {
  sentencias.length = 0;
  await conServidor(async (base, ruta) => {
    const res = await fetch(`${base}${ruta}/13`);
    assert.equal(res.status, 200);
  });
  const sqlHorarios = sentencias.find((s) => /FROM HorarioCurso h/i.test(s));
  assert.ok(sqlHorarios, 'debe ejecutarse la consulta de horarios');
  assert.equal(/h\.Docente\b/i.test(sqlHorarios), false, 'no debe seleccionar HorarioCurso.Docente');
  assert.match(sqlHorarios, /Asignacion_Aula/i, 'debe derivar el docente de Asignacion_Aula');
  assert.match(sqlHorarios, /AS Docente/i);
});

test('GET /api/admin/ciclos/:id con ID inexistente responde 404', async () => {
  await conServidor(async (base, ruta) => {
    const res = await fetch(`${base}${ruta}/999999`);
    assert.equal(res.status, 404);
    const cuerpo = await res.json();
    assert.match(cuerpo.error, /no encontrado/i);
  });
});

test('GET /api/admin/ciclos/:id con ID inválido responde 400', async () => {
  await conServidor(async (base, ruta) => {
    const res = await fetch(`${base}${ruta}/abc`);
    assert.equal(res.status, 400);
    const cuerpo = await res.json();
    assert.match(cuerpo.error, /inválido/i);
  });
});

test('GET /api/admin/ciclos/:id sin rol autorizado responde 403', async () => {
  const server = crearApp('Alumno').listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/ciclos/13`);
    assert.equal(res.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Regresión de capacidad: el commit 4c36c12 recortaba toda capacidad a 100.
// Plan 26/10, AC-05: límite nuevo 120; los históricos no se recortan ni se ocultan.
// ---------------------------------------------------------------------------

test('el detalle devuelve la capacidad real (250), sin recortarla a 100', async () => {
  await conServidor(async (base, ruta) => {
    const res = await fetch(`${base}${ruta}/13`);
    assert.equal(res.status, 200);
    const { ciclo } = await res.json();
    assert.equal(ciclo.Capacidad, 250);
  });
});

test('el listado conserva capacidad histórica 250 y exige revisión antes de ofrecer vacantes', async () => {
  await conServidor(async (base, ruta) => {
    const res = await fetch(`${base}${ruta}`);
    assert.equal(res.status, 200);
    const filas = await res.json();
    const c13 = filas.find((c) => c.IdCiclo === 13);
    assert.equal(c13.Capacidad, 250);
    assert.equal(c13.VacantesDisponibles, 0);
    assert.equal(c13.RequiereRevisionCapacidad, true);
    const c1 = filas.find((c) => c.IdCiclo === 1);
    assert.equal(c1.VacantesDisponibles, 94);
  });
});

test('el tope de nuevas capacidades corresponde al plan AC-05 (1..120)', () => {
  assert.equal(ciclosModulo.MIN_CAPACIDAD, 1);
  assert.equal(ciclosModulo.MAX_CAPACIDAD, 120);
});


