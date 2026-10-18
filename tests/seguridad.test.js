const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simular, secuencia, servir, consultas, eventos } = require('./soporte');
const requiereRol = require('../middlewares/roles.middleware');
const jwt = require('jsonwebtoken');
const verificarToken = require('../middlewares/auth.middleware');
const usuario = { IdUsuario: 10, IdAcademia: 1, IdPerfil: 2, Rol: 'Docente' };
const token = (datos = { id: 10, idAcademia: 1 }, options = {}) => jwt.sign(datos, process.env.JWT_SECRET, { expiresIn: '5m', ...options });
async function autenticar(authorization) {
  const req = { headers: { authorization } };
  const resultado = { status: 200, req };
  const res = { status(s) { resultado.status = s; return this; }, json(b) { resultado.body = b; return this; } };
  await verificarToken(req, res, () => { resultado.next = true; });
  return resultado;
}

test('roles exactos normalizados y equivalencia administrativa en ambas direcciones', () => {
  for (const permitido of ['Administrador', 'Recursos Humanos']) {
    for (const rol of ['Administrador', 'Recursos Humanos', '  RECURSOS   HUMANOS ', 'Ádministrador']) {
      let aprobado = false;
      requiereRol(permitido)({ usuario: { rol } }, {}, () => { aprobado = true; });
      assert.ok(aprobado, rol);
    }
  }
  for (const rol of ['Superadministrador', 'RRHH', 'Administrador externo', 'Docente', 'Tutor de Aula', 'Alumno', '']) {
    let status;
    const res = { status(s) { status = s; return this; }, json() {} };
    requiereRol('Administrador')({ usuario: { rol, idPerfil: 1 } }, res, () => assert.fail('Autorizacion indebida'));
    assert.equal(status, 403, rol);
  }
});

test('Bearer y JWT invalidos no consultan la BD', async () => {
  simular();
  for (const header of [undefined, 'Basic abc', 'Bearer', 'Bearer a b', 'Bearer invalido',
    'Bearer ' + token({ id: true, idAcademia: 1 }),
    'Bearer ' + token({ id: 10, idAcademia: 1 }, { algorithm: 'HS384' }),
    'Bearer ' + token({ id: 10, idAcademia: 1 }, { expiresIn: -1 })]) {
    assert.equal((await autenticar(header)).status, 401);
  }
  assert.equal(consultas.length, 0);
});

test('sesion toma el perfil vigente y rechaza inactivos, multiples perfiles y otra academia', async () => {
  for (const [rows, esperado] of [[[usuario], 200], [[], 401], [[usuario, usuario], 403], [[{ ...usuario, IdAcademia: 2 }], 401]]) {
    const fin = secuencia([{ sql: /FROM Usuario u.*up.EstadoRegistro = 1.*p.EstadoRegistro = 1.*u.EstadoRegistro = 1.*LIMIT 2/, rows }]);
    const r = await autenticar('Bearer ' + token({ id: 10, idAcademia: 1, rol: 'Administrador' }));
    assert.equal(r.status, esperado);
    if (esperado === 200) assert.equal(r.req.usuario.rol, 'Docente');
    fin();
  }
});

test('fallo de BD al autenticar devuelve 503 y no deja continuar', async () => {
  simular(() => { throw new Error('Fallo de BD simulado'); });
  const r = await autenticar('Bearer ' + token());
  assert.equal(r.status, 503); assert.equal(r.next, undefined);
});

const privadas = [['/api', 'perfil.routes'], ['/api', 'menu.routes'], ['/api', 'usuario.routes']];
for (const rol of ['Alumno', 'Docente', 'Tutor de Aula', 'Administrador externo']) {
  test(rol + ' no administra perfiles, menus ni usuarios', async t => {
    simular();
    const pedir = await servir(t, privadas, { id: 10, idAcademia: 1, rol });
    for (const [metodo, ruta] of [['GET', '/api/perfiles'], ['POST', '/api/perfiles'], ['PUT', '/api/perfiles/1'], ['DELETE', '/api/perfiles/1'], ['POST', '/api/menus'], ['POST', '/api/menus/asignar'], ['GET', '/api/usuarios']]) {
      assert.equal((await pedir(metodo, ruta, metodo === 'GET' ? undefined : {})).status, 403, ruta);
    }
    assert.equal(consultas.length, 0);
  });
}
for (const rol of ['Administrador', 'Recursos Humanos']) {
  test(rol + ' conserva las rutas administrativas', async t => {
    simular(q => [/^SELECT/.test(q) ? [] : { insertId: 1, affectedRows: 1 }]);
    const pedir = await servir(t, privadas, { id: 10, idAcademia: 1, rol });
    for (const [metodo, ruta, body] of [['GET', '/api/perfiles'], ['GET', '/api/usuarios'], ['POST', '/api/perfiles', { NombrePerfil: 'Ficticio' }], ['PUT', '/api/perfiles/99', { NombrePerfil: 'Ficticio' }], ['DELETE', '/api/perfiles/99', {}], ['POST', '/api/menus', { Nombre: 'Prueba' }], ['POST', '/api/menus/asignar', { IdPerfil: 99, IdOpcionMenu: 99 }]]) {
      assert.equal((await pedir(metodo, ruta, body)).status, 200, ruta);
    }
  });
}

test('docente consulta solo sus asignaciones con academia, curso y estados validos', async t => {
  const fin = secuencia([{ sql: /FROM Asignacion_Aula aa/, params: [1, 0, 10], rows: [{ idAsignacion: 7 }], verificar(q) {
    assert.match(q, /aa.IdUsuario = \?/); assert.match(q, /c.IdAcademia = aa.IdAcademia/);
    assert.match(q, /a.IdAcademia = aa.IdAcademia/); assert.match(q, /cc.EstadoRegistro = 1/);
  } }]);
  const pedir = await servir(t, [['/api', 'academico.routes']], { id: 10, idAcademia: 1, rol: 'Docente' });
  const r = await pedir('GET', '/api/asignaciones');
  assert.equal(r.status, 200); assert.deepEqual(r.body, [{ idAsignacion: 7 }]); fin();
});

test('no se inventa alumno-aula para leer ni registrar asistencias', async t => {
  simular();
  const pedir = await servir(t, [['/api', 'academico.routes']]);
  for (const metodo of ['GET', 'POST']) {
    const r = await pedir(metodo, '/api/asistencias', metodo === 'POST' ? { idAula: 1, listaAlumnos: [{ idMatricula: 1 }] } : undefined);
    assert.equal(r.status, 409); assert.equal(r.body.codigo, 'RELACION_ALUMNO_AULA_PENDIENTE');
  }
  assert.equal(consultas.length, 0);
});

test('docentes no publican comunicados institucionales sin alcance verificable', async t => {
  simular();
  const pedir = await servir(t, [['/api', 'comunicados.routes']], { id: 10, idAcademia: 1, rol: 'Docente' });
  assert.equal((await pedir('POST', '/api/comunicados', {})).status, 403);
  assert.equal(consultas.length, 0);
});

test('materiales filtra por academia antes de listar, escribir archivos o eliminar', async t => {
  const fin = secuencia([
    { sql: /FROM MaterialAcademico ma.*c.IdAcademia = \?/, params: [1], rows: [] },
    { sql: /FROM CicloCurso cc.*c.IdAcademia = \?/, params: [7, 3, 1], rows: [] },
    { sql: /FROM MaterialAcademico ma.*c.IdAcademia = \?/, params: [99, 1], rows: [] },
  ]);
  const pedir = await servir(t, [['/api/materiales', 'materiales.routes']]);
  assert.equal((await pedir('GET', '/api/materiales/admin')).status, 200);
  assert.equal((await pedir('POST', '/api/materiales', { idCiclo: 7, idCurso: 3, titulo: 'Ficticio', fileData: 'a'.repeat(30) })).status, 400);
  assert.equal((await pedir('DELETE', '/api/materiales/99')).status, 404); fin();
});

const bcrypt = require('bcrypt');
const cuenta = { ...usuario, Clave: bcrypt.hashSync('clave-ficticia', 4), NombreCompleto: 'Persona Ficticia' };
test('login y auth/login conservan respuesta y validan perfiles activos', async t => {
  simular((q, p) => {
    assert.match(q, /INNER JOIN perfil p.*p.EstadoRegistro = 1/);
    assert.match(q, /LIMIT 2$/); assert.equal(p.length, 8);
    return [[cuenta]];
  });
  const pedir = await servir(t, [['/api', 'auth.routes']]);
  for (const ruta of ['/api/login', '/api/auth/login']) {
    const r = await pedir('POST', ruta, { usuario: 'ficticio@example.invalid', password: 'clave-ficticia' });
    assert.equal(r.status, 200); assert.ok(r.body.token); assert.equal(r.body.rol, 'Docente');
    assert.equal(r.body.idUsuario, 10); assert.equal(r.body.user.id, 10); assert.ok(r.body.academia);
    assert.equal(jwt.verify(r.body.token, process.env.JWT_SECRET).id, 10);
  }
});

test('login no entrega JWT cuando hay multiples perfiles activos', async t => {
  simular(() => [[cuenta, { ...cuenta, IdPerfil: 3 }]]);
  const pedir = await servir(t, [['/api', 'auth.routes']]);
  const r = await pedir('POST', '/api/login', { usuario: 'ficticio', password: 'clave-ficticia' });
  assert.equal(r.status, 403); assert.equal(r.body.token, undefined);
});

test('cambio de perfil deja una sola asignacion activa y conserva historial', async t => {
  const fin = secuencia([
    { sql: /^UPDATE Usuario /, rows: { affectedRows: 1 } },
    { sql: /SELECT IdPerfil FROM perfil.*EstadoRegistro = 1/, params: [3], rows: [{ IdPerfil: 3 }] },
    { sql: /SELECT IdUsuarioPerfil.*IdUsuario = \? AND IdPerfil = \?.*FOR UPDATE/, params: ['10', 3], rows: [{ IdUsuarioPerfil: 8 }] },
    { sql: /UPDATE Usuario_Perfiles SET EstadoRegistro = 0/, params: ['10'], rows: { affectedRows: 2 } },
    { sql: /UPDATE Usuario_Perfiles SET EstadoRegistro = 1 WHERE IdUsuarioPerfil = \?/, params: [8], rows: { affectedRows: 1 } },
  ]);
  const pedir = await servir(t, privadas);
  const r = await pedir('PUT', '/api/usuarios/10', { Nombres: 'Ficticio', ApellidoPaterno: 'Prueba', IdPerfil: 3 });
  assert.equal(r.status, 200); fin(); assert.deepEqual(eventos, ['begin', 'commit', 'release']);
});

test('perfil inactivo revierte la actualizacion del usuario', async t => {
  const fin = secuencia([
    { sql: /^UPDATE Usuario /, rows: { affectedRows: 1 } },
    { sql: /SELECT IdPerfil FROM perfil/, rows: [] },
  ]);
  const pedir = await servir(t, privadas);
  assert.equal((await pedir('PUT', '/api/usuarios/10', { IdPerfil: 99 })).status, 400);
  fin(); assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
});
