// ============================================================
// Horarios: validación Ciclo ↔ Curso por UNIVERSIDAD OBJETIVO y por
// pertenencia a CicloCurso al crear/editar un horario (POST/PUT /api/horarios).
//
// Fuente de verdad verificada contra el modelo y la BD real:
//   - HorarioCurso(IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio,
//     HoraFin, Orden).
//   - La oferta del ciclo es CicloCurso(IdCiclo, IdCurso): un horario solo
//     puede usar cursos vinculados a su ciclo (ya validado inclusive antes
//     de este trabajo).
//   - Ciclo.UniversidadObjetivo Y Curso.UniversidadObjetivo deben coincidir
//     (PROTECCIÓN NUEVA): ciclo UNMSM + curso UNI → rechazado 400. Los
//     prefijos de código (SM-, UNI-, FV-...) son descriptivos, NUNCA la
//     fuente de la universidad.
//
// GET /api/horarios debe entregar `universidadCiclo`
// (Ciclo.UniversidadObjetivo) para que el frontend organice la retícula sin
// inferir universidades.
//
// Runner nativo de Node (node --test) con pool falso inyectado en
// require.cache, igual que tests/admin-ciclos.universidad-cursos.test.js.
// No se toca MySQL/Aiven: solo el router real con un pool simulado.
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Catálogos mínimos que replican el estado REAL de producción conocido:
// el horario 65 vincula Álgebra (FV-ALG, UNFV) al ciclo 1 (UNMSM) SIN
// relación CicloCurso activa (defecto de datos detectado en auditoría).
const CICLOS = {
  1: { IdCiclo: 1, IdAcademia: 1, Nombre: 'Semestral San Marcos', UniversidadObjetivo: 'UNMSM', EstadoRegistro: 1 },
  2: { IdCiclo: 2, IdAcademia: 1, Nombre: 'Anual UNI', UniversidadObjetivo: 'UNI', EstadoRegistro: 1 },
};

const UNIVERSIDAD_CURSO = {
  2: 'UNMSM',   // SM-HV
  5: 'UNMSM',   // SM-ALG
  11: 'UNI',    // UNI-ALG
  29: 'UNFV',   // FV-ALG
  99: 'UNAC',   // UNAC-ALG
};

// Oferta activa (CicloCurso). El curso 7 está vinculado pero SIN universidad.
const OFERTA = {
  1: new Set([2, 5, 29, 7]),
  2: new Set([11]),
};

const HORARIOS_GUARDADOS = [];
const ejecutadas = [];

async function consulta(sql, params = []) {
  const q = sql.replace(/\s+/g, ' ').trim();
  ejecutadas.push(q);

  // Serialización de horarios (lock de la academia)
  if (/SELECT IdAcademia FROM Academia WHERE IdAcademia = \? FOR UPDATE/i.test(q)) return [[]];

  // Ciclo dentro de la academia (ahora entrega la UniversidadObjetivo)
  if (/SELECT IdCiclo, UniversidadObjetivo FROM Ciclo WHERE IdCiclo = \? AND IdAcademia = \? AND EstadoRegistro = 1 LIMIT 1 FOR UPDATE/i.test(q)) {
    const ciclo = CICLOS[Number(params[0])];
    if (!ciclo) return [[]];
    return [[{ IdCiclo: ciclo.IdCiclo, UniversidadObjetivo: ciclo.UniversidadObjetivo }]];
  }

  // Curso activo y vinculado a CicloCurso (ahora entrega su universidad)
  if (/SELECT cu\.IdCurso, cu\.UniversidadObjetivo AS CursoUniversidad FROM Curso cu INNER JOIN CicloCurso cc/i.test(q)) {
    const idCiclo = Number(params[1]);
    const idCurso = Number(params[0]);
    if (!OFERTA[idCiclo] || !OFERTA[idCiclo].has(idCurso)) return [[]];
    return [[{ IdCurso: idCurso, CursoUniversidad: UNIVERSIDAD_CURSO[idCurso] ?? '' }]];
  }

  // Existencia del horario al editar (pertenencia a la academia)
  if (/SELECT h\.IdHorario FROM HorarioCurso h INNER JOIN Ciclo c/i.test(q)) {
    const idHorario = Number(params[0]);
    const guardado = HORARIOS_GUARDADOS.find((h) => h.IdHorario === idHorario);
    return guardado ? [[{ IdHorario: idHorario }]] : [[]];
  }

  // Solape por ciclo/día
  if (/SELECT IdHorario FROM HorarioCurso WHERE IdCiclo = \? AND DiaNumero/i.test(q)) return [[]];

  // Escrituras simuladas
  if (/INSERT INTO HorarioCurso/i.test(q)) {
    const idHorario = 900 + HORARIOS_GUARDADOS.length;
    HORARIOS_GUARDADOS.push({ IdHorario: idHorario, IdCiclo: Number(params[0]), IdCurso: Number(params[1]) });
    return [{ insertId: idHorario }];
  }
  if (/UPDATE HorarioCurso SET/i.test(q)) return [{ affectedRows: 1 }];

  // GET /horarios (lista simulada con las nuevas columnas de universidad)
  if (/FROM HorarioCurso h\s+INNER JOIN Ciclo c ON c\.IdCiclo = h\.IdCiclo\s+INNER JOIN Curso cu/i.test(q)) {
    return [[
      {
        idHorario: 65, idCiclo: 1, idCurso: 29, diaNumero: 3, diaSemana: 'Miércoles',
        horaInicio: '10:15', horaFin: '12:15', orden: 4, estadoRegistro: 1,
        ciclo: 'Semestral San Marcos', curso: 'Álgebra',
        universidadCiclo: 'UNMSM', universidadCurso: 'UNFV',
      },
      {
        idHorario: 1, idCiclo: 1, idCurso: 2, diaNumero: 1, diaSemana: 'Lunes',
        horaInicio: '08:00', horaFin: '10:00', orden: 1, estadoRegistro: 1,
        ciclo: 'Semestral San Marcos', curso: 'Habilidad Verbal',
        universidadCiclo: 'UNMSM', universidadCurso: 'UNMSM',
      },
    ]];
  }

  throw new Error('Consulta no prevista: ' + q);
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

const rutaDb = require.resolve('../config/db');
require.cache[rutaDb] = { id: rutaDb, filename: rutaDb, loaded: true, exports: poolFalso };

const routerAcademico = require('../routes/academico.routes');

function crearApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.usuario = { id: 10, idUsuario: 10, idAcademia: 1, rol: 'Administrador' };
    next();
  });
  app.use('/api', routerAcademico);
  return app;
}

async function conServidor(fn) {
  const server = crearApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    ejecutadas.length = 0;
    HORARIOS_GUARDADOS.length = 0;
  }
}

function cuerpoHorario(extra = {}) {
  return {
    idCiclo: 1,
    idCurso: 2,
    diaNumero: 1,
    diaSemana: 'Lunes',
    horaInicio: '08:00',
    horaFin: '10:00',
    orden: 1,
    ...extra,
  };
}

test('POST ciclo UNMSM + curso de su oferta (universidad UNMSM) → permitido (201)', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/horarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoHorario()),
    });
    assert.equal(res.status, 201);
    const cuerpo = await res.json();
    assert.ok(Number.isInteger(cuerpo.idHorario));
  });
});

test('POST ciclo UNMSM + curso que NO está en CicloCurso → rechazado (400)', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/horarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoHorario({ idCurso: 11 })), // UNI-ALG no está en la oferta del ciclo 1
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /vinculado mediante CicloCurso/i);
    assert.equal(ejecutadas.some((q) => q.startsWith('INSERT INTO HorarioCurso')), false);
  });
});

test('POST ciclo UNMSM + curso UNI (vínculo histórico) → rechazado (400) por universidad', async () => {
  await conServidor(async (base) => {
    // Falta el curso '11' con CICLOCURSO activo para probar el mensaje cruzado:
    // ampliamos la oferta temporalmente del ciclo 1.
    OFERTA[1].add(11);
    try {
      const res = await fetch(`${base}/api/horarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoHorario({ idCurso: 11 })),
      });
      assert.equal(res.status, 400);
      const cuerpo = await res.json();
      assert.match(cuerpo.error, /UNI.*UNMSM|UNMSM.*UNI|mezclar universidades/i);
      assert.equal(ejecutadas.some((q) => q.startsWith('INSERT INTO HorarioCurso')), false);
      assert.deepEqual(ejecutadas.filter((q) => q.startsWith('UPDATE HorarioCurso SET')), []);
    } finally {
      OFERTA[1].delete(11);
    }
  });
});

test('POST ciclo UNMSM + curso sin universidad objetivo → rechazado (400) con guía', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/horarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoHorario({ idCurso: 7 })),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /universidad objetivo/i);
    assert.equal(ejecutadas.some((q) => q.startsWith('INSERT INTO HorarioCurso')), false);
  });
});

test('PUT edición hacia un curso incompatible (universidad cruzada) → rechazada (400) sin UPDATE', async () => {
  await conServidor(async (base) => {
    HORARIOS_GUARDADOS.push({ IdHorario: 500, IdCiclo: 1, IdCurso: 2 });
    OFERTA[1].add(29); // FV-ALG (UNFV) con vínculo histórico al ciclo 1
    try {
      const res = await fetch(`${base}/api/horarios/500`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoHorario({ idCurso: 29, diaNumero: 2, diaSemana: 'Martes' })),
      });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /UNFV.*UNMSM|mezclar universidades|universidad objetivo/i);
      // No se ejecutó ningún UPDATE sobre HorarioCurso: la edición se rechaza.
      assert.deepEqual(ejecutadas.filter((q) => q.startsWith('UPDATE HorarioCurso SET')), []);
    } finally {
      OFERTA[1].delete(29);
    }
  });
});

test('PUT edición con curso compatible → permitida (200)', async () => {
  await conServidor(async (base) => {
    HORARIOS_GUARDADOS.push({ IdHorario: 501, IdCiclo: 1, IdCurso: 2 });
    const res = await fetch(`${base}/api/horarios/501`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoHorario({ diaNumero: 3, diaSemana: 'Miércoles', horaInicio: '16:00', horaFin: '18:00', orden: 5 })),
    });
    assert.equal(res.status, 200);
    assert.match((await res.json()).message, /actualizado/i);
    assert.ok(ejecutadas.some((q) => q.startsWith('UPDATE HorarioCurso SET')));
  });
});

test('GET /api/horarios entrega universidadCiclo (Ciclo.UniversidadObjetivo) para cada fila', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/horarios`);
    assert.equal(res.status, 200);
    const lista = await res.json();
    assert.ok(Array.isArray(lista) && lista.length >= 2);
    assert.ok(lista.every((fila) => 'universidadCiclo' in fila));
    assert.equal(lista.find((fila) => fila.idHorario === 1).universidadCiclo, 'UNMSM');
    // El cruce histórico (65) queda EXPUESTO con su par de universidades:
    // el frontend solo lo organiza (lo marca para el administrador);
    // NINGUNA prueba corrige datos.
    const cruce = lista.find((fila) => fila.idHorario === 65);
    assert.equal(cruce.universidadCiclo, 'UNMSM');
    assert.equal(cruce.universidadCurso, 'UNFV');
  });
});
