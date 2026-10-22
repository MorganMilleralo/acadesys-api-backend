// ============================================================================
// PRUEBAS DE ESCALA POR UNIVERSIDAD OBJETIVO
// ----------------------------------------------------------------------------
// La escala de puntaje de un ciclo depende SOLO de su universidad objetivo y
// debe ser la MISMA en todos los modulos: registro de notas (validacion y
// contexto), dashboard (normalizacion del promedio) y Tutor IA (contexto que
// ve el alumno). Si un modulo usara otro valor por defecto, el alumno veria
// una escala y el servidor validaria otra.
//
// Estas pruebas son 100% aisladas: no hay MySQL real (tests/aislamiento.js
// bloquea mysql2 y dotenv) y el SDK de Gemini se sustituye por un doble local,
// asi que no se llama a ningun proveedor externo.
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simular, servir } = require('./soporte');
const {
  ESCALAS_POR_UNIVERSIDAD,
  ESCALA_POR_DEFECTO,
  escalaMaximaPorUniversidad,
} = require('../utils/escalas');

// Doble local del SDK de Gemini: este archivo nunca llama al proveedor real.
const sdk = require.resolve('@google/generative-ai');
require.cache[sdk] = { id: sdk, filename: sdk, loaded: true, exports: {
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { async generateContent() {
        return { response: { text: () => JSON.stringify({ respuesta: 'Respuesta simulada', planEstudio: [] }) } };
      } };
    }
  },
} };
process.env.GEMINI_API_KEY = 'clave-ficticia-sin-acceso-a-proveedor';

// Escala esperada por universidad (contrato unico del sistema).
//   - las universidades con escala ya configurada NO se tocan;
//   - las universidades nuevas usan la escala interna preuniversitaria (20).
const UNIVERSIDADES = [
  ['UNMSM', 2000],
  ['UNI', 2000],
  ['PUCP', 1000],
  ['UNFV', 1000],
  ['UNAC', 100],
  ['UNT', 300],
  ['UNALM', 20],
  ['UPCH', 20],
  ['ULIMA', 20],
  ['UPC', 20],
  ['USMP', 20],
  ['UTP', 20],
  ['Preuniversitario', 20],
];

const identidad = { IdUsuario: 10, NombreCompleto: 'Persona Ficticia', CodigoUsuario: 'PRUEBA' };
const alumno = { id: 10, idAcademia: 1, rol: 'Alumno' };

test('la tabla compartida declara una escala valida para cada universidad', () => {
  for (const [universidad, escala] of UNIVERSIDADES) {
    assert.equal(escalaMaximaPorUniversidad(universidad), escala, 'escala de ' + universidad);
    assert.equal(ESCALAS_POR_UNIVERSIDAD[universidad], escala, 'tabla de ' + universidad);
  }
});

test('las universidades nuevas usan la escala interna preuniversitaria y el default es unico', () => {
  for (const universidad of ['UNALM', 'UPCH', 'ULIMA', 'UPC', 'USMP', 'UTP']) {
    assert.equal(escalaMaximaPorUniversidad(universidad), 20, universidad);
  }
  // Sin escala propia -> escala interna preuniversitaria (nunca 2000).
  assert.equal(escalaMaximaPorUniversidad('Sin definir'), 20);
  assert.equal(escalaMaximaPorUniversidad('desconocida'), 20);
  assert.equal(escalaMaximaPorUniversidad(''), 20);
  assert.equal(escalaMaximaPorUniversidad(null), 20);
  assert.equal(escalaMaximaPorUniversidad(undefined), 20);
  assert.equal(ESCALA_POR_DEFECTO, 20);
});

test('la clave se resuelve sin distinguir mayusculas ni espacios', () => {
  assert.equal(escalaMaximaPorUniversidad(' unmsm '), 2000);
  assert.equal(escalaMaximaPorUniversidad('preuniversitario'), 20);
  assert.equal(escalaMaximaPorUniversidad('Preuniversitario'), 20);
});

test('notas expone exactamente la escala de la tabla compartida', async t => {
  const pedir = await servir(t, [['/api/notas', 'notas.routes']]);

  for (const [universidad, escala] of UNIVERSIDADES) {
    simular((sql) => {
      assert.match(sql, /FROM Ciclo ci/);
      return [[{ IdCiclo: 7, Nombre: 'Ciclo demo', UniversidadObjetivo: universidad }]];
    });

    const r = await pedir('GET', '/api/notas/contexto/7');
    assert.equal(r.status, 200);
    assert.equal(r.body.escalaMaxima, escala, 'notas / ' + universidad);
  }
});

test('el dashboard normaliza el promedio con la MISMA escala que valida notas', async t => {
  const pedir = await servir(t, [['/api/admin', 'dashboard.routes']]);

  for (const [universidad, escala] of UNIVERSIDADES) {
    simular((sql) => {
      if (/AS TotalEstudiantes/.test(sql)) return [[{ TotalEstudiantes: 1 }]];
      if (/AS MatriculasActivas/.test(sql)) return [[{ MatriculasActivas: 1 }]];
      if (/AS TotalEvaluaciones/.test(sql)) {
        return [[{
          IdCiclo: 1, Nombre: 'Ciclo demo', UniversidadObjetivo: universidad, EstadoRegistro: 1,
          Capacidad: 20, TotalAlumnos: 1, TotalEvaluaciones: 1, FechaInicio: null, FechaFin: null,
        }]];
      }
      if (/AS TotalMorosos/.test(sql)) return [[{ TotalMorosos: 0 }]];
      if (/AS TotalPagos/.test(sql)) return [[{ TotalPagos: 1, Pagados: 1, Pendientes: 0 }]];
      if (/AS PromedioBruto/.test(sql)) {
        return [[{
          IdCiclo: 1, Nombre: 'Ciclo demo', UniversidadObjetivo: universidad,
          PromedioBruto: escala, Evaluaciones: 1,
        }]];
      }
      throw new Error('Fixture dashboard: ' + sql);
    });

    const r = await pedir('GET', '/api/admin/dashboard/overview');
    assert.equal(r.status, 200);
    // normalizarPromedio(escala, universidad) = (escala / escala) * 20 = 20.
    // Si el dashboard usara otra escala, este valor no seria 20.
    assert.equal(r.body.rendimientoPorCiclo[0].promedio, 20, 'dashboard / ' + universidad);
  }
});

test('el Tutor IA expone la MISMA escala que notas y dashboard', async t => {
  const pedir = await servir(t, [['/api', 'ia.routes']], alumno);

  for (const [universidad, escala] of UNIVERSIDADES) {
    simular((sql) => {
      if (/SELECT COUNT\(\*\) \+ 1 AS Puesto/.test(sql)) return [[{ Puesto: 1 }]];
      if (/FROM Evaluacion e/.test(sql)) {
        return [[{
          IdEvaluacion: 1, Curso: 'Simulacro general', TipoEvaluacion: 'Simulacro',
          Calificacion: escala, EstadoRegistro: 1,
        }]];
      }
      if (/FROM Matricula m/.test(sql)) {
        return [[{
          IdMatricula: 100, IdCiclo: 7, NombreCiclo: 'Ciclo demo', UniversidadObjetivo: universidad,
        }]];
      }
      if (/FROM CicloCurso/.test(sql)) return [[]];
      if (/FROM Usuario u/.test(sql)) return [[identidad]];
      throw new Error('Fixture ia: ' + sql);
    });

    const r = await pedir('POST', '/api/tutor-ia/diagnostico', { pregunta: 'Diagnostico' });
    assert.equal(r.status, 200);
    assert.equal(r.body.contexto.escalaMaxima, escala, 'tutor ia / ' + universidad);
  }
});

test('notas, dashboard y Tutor IA coinciden para la misma universidad', async t => {
  const pedirNotas = await servir(t, [['/api/notas', 'notas.routes']]);
  const pedirDashboard = await servir(t, [['/api/admin', 'dashboard.routes']]);
  const pedirIa = await servir(t, [['/api', 'ia.routes']], alumno);

  for (const [universidad, escala] of UNIVERSIDADES) {
    // notas
    simular(() => [[{ IdCiclo: 7, Nombre: 'Ciclo demo', UniversidadObjetivo: universidad }]]);
    const notas = await pedirNotas('GET', '/api/notas/contexto/7');

    // dashboard
    simular((sql) => {
      if (/AS TotalEstudiantes/.test(sql)) return [[{ TotalEstudiantes: 1 }]];
      if (/AS MatriculasActivas/.test(sql)) return [[{ MatriculasActivas: 1 }]];
      if (/AS TotalEvaluaciones/.test(sql)) {
        return [[{
          IdCiclo: 1, Nombre: 'Ciclo demo', UniversidadObjetivo: universidad, EstadoRegistro: 1,
          Capacidad: 20, TotalAlumnos: 1, TotalEvaluaciones: 1, FechaInicio: null, FechaFin: null,
        }]];
      }
      if (/AS TotalMorosos/.test(sql)) return [[{ TotalMorosos: 0 }]];
      if (/AS TotalPagos/.test(sql)) return [[{ TotalPagos: 1, Pagados: 1, Pendientes: 0 }]];
      if (/AS PromedioBruto/.test(sql)) {
        return [[{
          IdCiclo: 1, Nombre: 'Ciclo demo', UniversidadObjetivo: universidad,
          PromedioBruto: escala, Evaluaciones: 1,
        }]];
      }
      throw new Error('Fixture dashboard: ' + sql);
    });
    const dashboard = await pedirDashboard('GET', '/api/admin/dashboard/overview');

    // tutor ia
    simular((sql) => {
      if (/SELECT COUNT\(\*\) \+ 1 AS Puesto/.test(sql)) return [[{ Puesto: 1 }]];
      if (/FROM Evaluacion e/.test(sql)) {
        return [[{
          IdEvaluacion: 1, Curso: 'Simulacro general', TipoEvaluacion: 'Simulacro',
          Calificacion: escala, EstadoRegistro: 1,
        }]];
      }
      if (/FROM Matricula m/.test(sql)) {
        return [[{
          IdMatricula: 100, IdCiclo: 7, NombreCiclo: 'Ciclo demo', UniversidadObjetivo: universidad,
        }]];
      }
      if (/FROM CicloCurso/.test(sql)) return [[]];
      if (/FROM Usuario u/.test(sql)) return [[identidad]];
      throw new Error('Fixture ia: ' + sql);
    });
    const ia = await pedirIa('POST', '/api/tutor-ia/diagnostico', { pregunta: 'Diagnostico' });

    assert.equal(notas.status, 200);
    assert.equal(dashboard.status, 200);
    assert.equal(ia.status, 200);

    assert.equal(notas.body.escalaMaxima, escala, 'notas / ' + universidad);
    assert.equal(ia.body.contexto.escalaMaxima, escala, 'tutor ia / ' + universidad);
    // El dashboard normaliza siempre a base 20: con la escala correcta, un
    // promedio igual a la escala maxima se convierte en 20.
    assert.equal(dashboard.body.rendimientoPorCiclo[0].promedio, 20, 'dashboard / ' + universidad);

    // Y las tres rutas comparten la MISMA funcion de escala.
    assert.equal(
      notas.body.escalaMaxima,
      ia.body.contexto.escalaMaxima,
      'discrepencia entre notas y tutor ia para ' + universidad
    );
  }
});


