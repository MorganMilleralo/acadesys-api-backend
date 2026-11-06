const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requiereGestionNotas,
  autorizarHistorialAlumno,
} = require('../middlewares/notas-acceso.middleware');

function crearRespuesta() {
  return {
    statusCode: 200,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    json(datos) { this.body = datos; return this; },
  };
}

function ejecutar(middleware, req) {
  const res = crearRespuesta();
  let llamadaNext = false;
  middleware(req, res, () => { llamadaNext = true; });
  return { res, llamadaNext };
}

test('listado de notas: academia y rol docente no acreditan asignacion de alumnos', () => {
  const resultado = ejecutar(requiereGestionNotas, {
    usuario: { id: 20, idUsuario: 20, idAcademia: 3, rol: 'Docente', idPerfil: 2 },
  });
  assert.equal(resultado.llamadaNext, false);
  assert.equal(resultado.res.statusCode, 403);
});

test('listado de notas: bloquea a un alumno', () => {
  const resultado = ejecutar(requiereGestionNotas, {
    usuario: { id: 20, idUsuario: 20, idAcademia: 3, rol: 'Alumno', idPerfil: 4 },
  });
  assert.equal(resultado.llamadaNext, false);
  assert.equal(resultado.res.statusCode, 403);
});

test('historial individual: permite al alumno consultar su propio ID', () => {
  const resultado = ejecutar(autorizarHistorialAlumno, {
    params: { id: '20' },
    usuario: { id: 20, idUsuario: 20, idAcademia: 3, rol: 'Alumno', idPerfil: 4 },
  });
  assert.equal(resultado.llamadaNext, true);
});

test('historial individual: bloquea al alumno que consulta otro ID', () => {
  const resultado = ejecutar(autorizarHistorialAlumno, {
    params: { id: '21' },
    usuario: { id: 20, idUsuario: 20, idAcademia: 3, rol: 'Alumno', idPerfil: 4 },
  });
  assert.equal(resultado.llamadaNext, false);
  assert.equal(resultado.res.statusCode, 403);
});

test('historial individual: rechaza un ID inválido', () => {
  const resultado = ejecutar(autorizarHistorialAlumno, {
    params: { id: 'abc' },
    usuario: { id: 20, idUsuario: 20, idAcademia: 3, rol: 'Alumno', idPerfil: 4 },
  });
  assert.equal(resultado.llamadaNext, false);
  assert.equal(resultado.res.statusCode, 400);
});

test('historial individual: bloquea al docente sin asignacion verificable', () => {
  const resultado = ejecutar(autorizarHistorialAlumno, {
    params: { id: '21' },
    usuario: { id: 20, idUsuario: 20, idAcademia: 3, rol: 'Docente', idPerfil: 2 },
  });
  assert.equal(resultado.llamadaNext, false);
  assert.equal(resultado.res.statusCode, 403);
});

test('historial individual: no permite consultar sin academia válida', () => {
  const resultado = ejecutar(autorizarHistorialAlumno, {
    params: { id: '20' },
    usuario: { id: 20, idUsuario: 20, rol: 'Alumno', idPerfil: 4 },
  });
  assert.equal(resultado.llamadaNext, false);
  assert.equal(resultado.res.statusCode, 401);
});


test('notas: no concede administrador solo por IdPerfil=1', () => {
  const resultado = ejecutar(requiereGestionNotas, {
    usuario: { id: 20, idUsuario: 20, idAcademia: 3, rol: 'Alumno', idPerfil: 1 },
  });
  assert.equal(resultado.llamadaNext, false);
  assert.equal(resultado.res.statusCode, 403);
});

test('notas: reconoce administrador por el rol actual sin depender del ID', () => {
  const resultado = ejecutar(requiereGestionNotas, {
    usuario: { id: 20, idUsuario: 20, idAcademia: 3, rol: 'Administrador', idPerfil: 8 },
  });
  assert.equal(resultado.llamadaNext, true);
});

test('notas e historial: equivalencia administrativa exacta, sin alias ni subcadenas', () => {
  for (const [rol, permitido] of [['Administrador', true], [' Recursos   Humanos ', true],
    ['Administrador externo', false], ['rrhh', false], ['Tutor de Aula', false]]) {
    const req = { usuario: { id: 20, idAcademia: 3, rol }, params: { id: '21' } };
    for (const middleware of [requiereGestionNotas, autorizarHistorialAlumno]) {
      const resultado = ejecutar(middleware, req);
      assert.equal(resultado.llamadaNext, permitido, rol);
      if (!permitido) assert.equal(resultado.res.statusCode, 403);
    }
  }
});


