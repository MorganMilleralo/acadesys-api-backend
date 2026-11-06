// ============================================================
// Validación cruzada Ciclo ↔ Curso por universidad objetivo.
//
// Fuente de verdad verificada contra la BD real:
//   - Curso.UniversidadObjetivo (VARCHAR(50)) ES el campo estructurado.
//   - No existen tablas Plan/Malla/Universidad; los prefijos de los códigos
//     (SM-, UNI-, PUCP-, FV-, UNAC-) son solo descriptivos, NO la relación.
//
// El backend no debe aceptar CicloCurso que mezcle universidades:
//   ciclo UNMSM + curso UNI → rechazado (400), aunque el curso exista y
//   esté activo. Mensaje: "Uno o más cursos no corresponden a la
//   universidad seleccionada."
//
// Runner nativo de Node (node --test), pool falso inyectado en require.cache,
// igual que tests/admin-ciclos.detalle.test.js.
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Catálogo mínimo que replica el real (Producción): cada curso tiene
// SU universidad objetivo explícita en el campo UniversidadObjetivo.
const CATALOGO = {
  2: { IdCurso: 2, universidad: 'UNMSM' },   // SM-HV
  5: { IdCurso: 5, universidad: 'UNMSM' },   // SM-ALG
  11: { IdCurso: 11, universidad: 'UNI' },   // UNI-RM
  12: { IdCurso: 12, universidad: 'UNI' },   // UNI-ALG
  22: { IdCurso: 22, universidad: 'PUCP' },  // PUCP-ALG
  29: { IdCurso: 29, universidad: 'UNFV' },  // FV-ALG
  99: { IdCurso: 99, universidad: 'UNAC' },  // UNAC-ALG
};

const CICLO_EXISTENTE_UNI = {
  IdCiclo: 11, IdAcademia: 1, Nombre: 'Anual UNI 2026', UniversidadObjetivo: 'UNI',
  EstadoRegistro: 1, Turno: 'Mañana', Horario: '08:00 - 13:00', Precio: 120,
  DiasClase: 'Lunes a Sábado', PrefijoCodigo: 'UNI', Capacidad: 200,
  TotalAlumnos: 0, TotalCursos: 11,
};

const CICLO_EXISTENTE_UNMSM = {
  IdCiclo: 20, IdAcademia: 1, Nombre: 'Ciclo Regular San Marcos Demo', UniversidadObjetivo: 'UNMSM',
  EstadoRegistro: 1, Turno: 'Mañana', Horario: '08:00 - 13:00', Precio: 100,
  DiasClase: 'Lunes a Sábado', PrefijoCodigo: 'SM', Capacidad: 100,
  TotalAlumnos: 0, TotalCursos: 2,
};

const ejecutadas = [];

async function consulta(sql, params = []) {
  const q = sql.replace(/\s+/g, ' ').trim();
  ejecutadas.push(q);

  // bloquearIdentidades
  if (/SELECT IdAcademia FROM Academia/i.test(q)) return [[]];

  // POST: INSERT del ciclo (el backend no requiere id previo)
  if (/INSERT INTO Ciclo \(/i.test(q)) return [{ insertId: 99 }];

  // PUT: lock previo y lectura del ciclo existente
  if (/SELECT IdCiclo FROM Ciclo WHERE IdCiclo = \? AND IdAcademia = \? FOR UPDATE/i.test(q)) {
    return [[{ IdCiclo: Number(params[0]), IdAcademia: Number(params[1]) }]];
  }
  if (/FROM Ciclo c WHERE c\.IdCiclo = \? AND c\.IdAcademia = \? LIMIT 1/i.test(q)) {
    const fila = params[0] === CICLO_EXISTENTE_UNI.IdCiclo ? CICLO_EXISTENTE_UNI : CICLO_EXISTENTE_UNMSM;
    return [[fila]];
  }

  // Duplicados de nombre (POST y PUT)
  if (/LOWER\(TRIM\(Nombre\)\) = LOWER\(TRIM\(\?\)\)/i.test(q)) return [[]];

  // Existencia + universidad de los cursos seleccionados
  if (/SELECT IdCurso, UniversidadObjetivo FROM Curso/i.test(q)) {
    const filas = params
      .map((id) => CATALOGO[Number(id)])
      .filter((c) => !!c)
      .map((c) => ({ IdCurso: c.IdCurso, UniversidadObjetivo: c.universidad }));
    return [filas];
  }

  // Dependencias activas al retirar cursos
  if (/IdCurso IS NOT NULL/i.test(q)) return [[]];

  if (/UPDATE CicloCurso/i.test(q)) return [{ affectedRows: 1 }];
  if (/INSERT INTO CicloCurso/i.test(q)) return [{ insertId: 1 }];
  if (/UPDATE Ciclo SET/i.test(q)) return [{ affectedRows: 1 }];

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

// Inyectar el pool falso ANTES de requerir el router real.
const rutaDb = require.resolve('../config/db');
require.cache[rutaDb] = { id: rutaDb, filename: rutaDb, loaded: true, exports: poolFalso };

const routerAdminCiclos = require('../routes/admin-ciclos.routes');

function crearApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.usuario = { id: 1, idUsuario: 1, idAcademia: 1, idPerfil: 9, rol: 'Administrador' };
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
    await fn(`http://127.0.0.1:${port}`, '/api/admin/ciclos', ejecutadas);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    ejecutadas.length = 0;
  }
}

// Fechas relativas al día de ejecución: la regla de negocio exige que un ciclo
// nuevo empiece hoy o después. Con fechas fijas la suite caducaba con el tiempo.
function fechaRelativa(dias) {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function cuerpoCiclo(universidad, cursos, extra = {}) {
  return {
    nombre: 'Ciclo Regular San Marcos Demo',
    universidadObjetivo: universidad,
    turno: 'Mañana',
    horario: '08:00 - 13:00',
    fechaInicio: fechaRelativa(30),
    fechaFin: fechaRelativa(180),
    capacidad: 100,
    precio: 100,
    diasClase: 'Lunes a Sábado',
    prefijoCodigo: universidad.slice(0, 4).toUpperCase(),
    publicar: false,
    cursosSeleccionados: cursos,
    ...extra,
  };
}

test('POST ciclo UNMSM + cursos UNMSM → permitido (201) y valida la universidad de cada curso', async () => {
  await conServidor(async (base, ruta) => {
    const res = await fetch(`${base}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoCiclo('UNMSM', [2, 5])),
    });
    assert.equal(res.status, 201);
    const cuerpo = await res.json();
    assert.ok(Number.isInteger(cuerpo.idCiclo));
    // La consulta de cursos ya debe traer la universidad objetivo para validar.
    assert.ok(ejecutadas.some((q) => /SELECT Idcurso, UniversidadObjetivo FROM Curso/i.test(q)));
  });
});

test('POST ciclo UNMSM + curso UNI → rechazado (400), sin crear relaciones CicloCurso', async () => {
  await conServidor(async (base, ruta) => {
    const res = await fetch(`${base}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoCiclo('UNMSM', [2, 11])),
    });
    assert.equal(res.status, 400);
    const cuerpo = await res.json();
    assert.match(cuerpo.error, /no corresponden a la universidad seleccionada/);
    // No se escribió ninguna relación y no se llegó a reemplazar la oferta.
    assert.equal(ejecutadas.some((q) => q.startsWith('INSERT INTO CicloCurso')), false);
    assert.equal(ejecutadas.some((q) => q.startsWith('UPDATE CicloCurso')), false);
  });
});

test('PUT ciclo UNI + cursos UNI → permitido (200)', async () => {
  await conServidor(async (base, ruta) => {
    const res = await fetch(`${base}${ruta}/11`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...cuerpoCiclo('UNI', [11, 12]),
        nombre: 'Anual UNI 2026',
      }),
    });
    assert.equal(res.status, 200);
    assert.match((await res.json()).message, /actualizado/i);
  });
});

test('PUT ciclo UNMSM + curso UNFV → rechazado (400) con mensaje de universidad', async () => {
  await conServidor(async (base, ruta) => {
    const res = await fetch(`${base}${ruta}/20`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoCiclo('UNMSM', [2, 29])),
    });
    assert.equal(res.status, 400);
    const cuerpo = await res.json();
    assert.match(cuerpo.error, /no corresponden a la universidad seleccionada/);
    assert.equal(ejecutadas.some((q) => q.startsWith('UPDATE CicloCurso')), false);
  });
});

test('ciclo de universidad sin cursos (UTP) y oferta vacía → 201, no inventa asociaciones', async () => {
  await conServidor(async (base, ruta) => {
    const res = await fetch(`${base}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoCiclo('UTP', [], { nombre: 'Ciclo Regular Tecnologica del Peru' })),
    });
    assert.equal(res.status, 201);
    // Nunca se vinculan cursos ajenos ni se crean cursos fantasma.
    assert.equal(ejecutadas.some((q) => q.startsWith('INSERT INTO CicloCurso')), false);
    // La validación de universidad solo corre cuando se envían cursos.
    assert.equal(ejecutadas.some((q) => /SELECT Idcurso, UniversidadObjetivo FROM Curso/i.test(q)), false);
  });
});

test('PUT sin cursosSeleccionados conserva las relaciones existentes (no valida ni reemplaza)', async () => {
  await conServidor(async (base, ruta) => {
    const { cursosSeleccionados, ...cuerpo } = cuerpoCiclo('UNI', []);
    const res = await fetch(`${base}${ruta}/11`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cuerpo, nombre: 'Anual UNI 2026' }),
    });
    assert.equal(res.status, 200);
    // Sin el campo, la ruta no debe tocar la oferta del ciclo guardado.
    assert.equal(ejecutadas.some((q) => q.startsWith('UPDATE CicloCurso')), false);
    assert.equal(ejecutadas.some((q) => q.startsWith('INSERT INTO CicloCurso')), false);
  });
});
