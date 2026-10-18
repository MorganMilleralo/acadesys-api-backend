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

test('un token de recuperacion no sirve como sesion aunque contenga IDs validos', async () => {
  simular();
  for (const datos of [
    { idUsuario: 10, proposito: 'reinscripcion-password-reset' },
    { id: 10, idAcademia: 1, proposito: 'reinscripcion-password-reset' },
  ]) {
    assert.equal((await autenticar('Bearer ' + token(datos))).status, 401);
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
    const fin = secuencia([
      { sql: /SELECT \* FROM perfil/, rows: [] },
      { sql: /FROM Usuario u/, rows: [] },
      { sql: /INSERT INTO perfil/, rows: { insertId: 99, affectedRows: 1 } },
      { sql: /SELECT IdPerfil, Nombre, EstadoRegistro FROM perfil/, rows: [{ IdPerfil: 99, Nombre: 'Ficticio', EstadoRegistro: 1 }] },
      { sql: /UPDATE perfil/, rows: { affectedRows: 1 } },
      { sql: /SELECT IdPerfil, Nombre, EstadoRegistro FROM perfil/, rows: [{ IdPerfil: 99, Nombre: 'Ficticio', EstadoRegistro: 1 }] },
      { sql: /COUNT\(\*\)/, rows: [{ total: 0 }] },
      { sql: /UPDATE perfil/, rows: { affectedRows: 1 } },
      { sql: /INSERT INTO OpcionesMenu /, rows: { insertId: 99, affectedRows: 1 } },
      { sql: /FROM OpcionesMenu WHERE/, rows: [{ IdOpcionMenu: 99 }] },
      { sql: /FROM perfil WHERE/, rows: [{ IdPerfil: 99 }] },
      { sql: /FROM OpcionesMenu_Perfiles/, rows: [] },
      { sql: /INSERT INTO OpcionesMenu_Perfiles/, rows: { insertId: 1, affectedRows: 1 } },
    ]);
    const pedir = await servir(t, privadas, { id: 10, idAcademia: 1, rol });
    for (const [metodo, ruta, body] of [['GET', '/api/perfiles'], ['GET', '/api/usuarios'], ['POST', '/api/perfiles', { NombrePerfil: 'Ficticio' }], ['PUT', '/api/perfiles/99', { NombrePerfil: 'Ficticio' }], ['DELETE', '/api/perfiles/99', {}], ['POST', '/api/menus', { Nombre: 'Prueba', UrlMenu: '/prueba' }], ['POST', '/api/menus/asignar', { IdPerfil: 99, IdOpcionMenu: 99 }]]) {
      assert.equal((await pedir(metodo, ruta, body)).status, metodo === 'POST' ? 201 : 200, ruta);
    }
    fin();
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
    { sql: /SELECT IdUsuario, EstadoRegistro FROM Usuario.*FOR UPDATE/, params: [10, 1], rows: [{ IdUsuario: 10, EstadoRegistro: 1 }] },
    { sql: /SELECT p.Nombre AS NombrePerfil/, rows: [{ NombrePerfil: 'Docente' }] },
    { sql: /SELECT IdPerfil, Nombre FROM perfil.*EstadoRegistro = 1.*FOR SHARE/, params: [3], rows: [{ IdPerfil: 3, Nombre: 'Tutor de Aula' }] },
    { sql: /^UPDATE Usuario /, rows: { affectedRows: 1 } },
    { sql: /SELECT IdUsuarioPerfil.*IdUsuario = \? AND IdPerfil = \?.*FOR UPDATE/, params: [10, 3], rows: [{ IdUsuarioPerfil: 8 }] },
    { sql: /UPDATE Usuario_Perfiles SET EstadoRegistro = 0/, params: [10], rows: { affectedRows: 2 } },
    { sql: /UPDATE Usuario_Perfiles SET EstadoRegistro = 1 WHERE IdUsuarioPerfil = \?/, params: [8], rows: { affectedRows: 1 } },
  ]);
  const pedir = await servir(t, privadas);
  const r = await pedir('PUT', '/api/usuarios/10', { Nombres: 'Ficticio', ApellidoPaterno: 'Prueba', IdPerfil: 3 });
  assert.equal(r.status, 200); fin(); assert.deepEqual(eventos, ['begin', 'commit', 'release']);
});

test('perfil inactivo revierte la actualizacion del usuario', async t => {
  const fin = secuencia([
    { sql: /SELECT IdUsuario, EstadoRegistro FROM Usuario.*FOR UPDATE/, params: [10, 1], rows: [{ IdUsuario: 10, EstadoRegistro: 1 }] },
    { sql: /SELECT p.Nombre AS NombrePerfil/, rows: [{ NombrePerfil: 'Docente' }] },
    { sql: /SELECT IdPerfil, Nombre FROM perfil/, rows: [] },
  ]);
  const pedir = await servir(t, privadas);
  assert.equal((await pedir('PUT', '/api/usuarios/10', { IdPerfil: 99 })).status, 400);
  fin(); assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
});

test('login conserva la conversion remota a bcrypt de una clave legada ficticia', async t => {
  const fin = secuencia([
    { sql: /FROM Usuario u.*LIMIT 2$/, rows: [{ ...cuenta, Clave: 'clave-ficticia' }] },
    { sql: /^UPDATE Usuario SET Clave = \?.*BINARY Clave = BINARY \?/, verificar(_q, params) {
      assert.equal(params[1], 10);
      assert.equal(params[2], 'clave-ficticia');
      assert.ok(bcrypt.compareSync('clave-ficticia', params[0]));
    }, rows: { affectedRows: 1 } },
  ]);
  const pedir = await servir(t, [['/api', 'auth.routes']]);
  const r = await pedir('POST', '/api/login', { usuario: 'ficticio', password: 'clave-ficticia' });
  assert.equal(r.status, 200); assert.ok(r.body.token); fin();
});

test('conversion legada no pisa una recuperacion concurrente ni emite JWT', async t => {
  const fin = secuencia([
    { sql: /FROM Usuario u/, rows: [{ ...cuenta, Clave: 'clave-ficticia' }] },
    { sql: /BINARY Clave = BINARY \?/, rows: { affectedRows: 0 } },
  ]);
  const pedir = await servir(t, [['/api', 'auth.routes']]);
  const r = await pedir('POST', '/api/login', { usuario: 'ficticio', password: 'clave-ficticia' });
  assert.equal(r.status, 401); assert.equal(r.body.token, undefined); fin();
});

test('usuarios/me permite autoservicio sin cambiar identidad, academia, clave ni permisos', async t => {
  const fila = { IdUsuario: 10, Nombres: 'Ficticio', IdPerfil: 2 };
  const fin = secuencia([
    { sql: /FROM Usuario u.*WHERE u.IdUsuario = \?/, params: [10], rows: [fila], verificar(q) { assert.doesNotMatch(q, /u\.Clave/); } },
    { sql: /^UPDATE Usuario SET Nombres=\? WHERE IdUsuario = \? AND EstadoRegistro = 1$/, params: ['Nuevo ficticio', 10], rows: { affectedRows: 1 } },
    { sql: /FROM Usuario u.*WHERE u.IdUsuario = \?/, params: [10], rows: [{ ...fila, Nombres: 'Nuevo ficticio' }] },
  ]);
  const pedir = await servir(t, privadas, { id: 10, idAcademia: 1, rol: 'Alumno' });
  const inicial = await pedir('GET', '/api/usuarios/me');
  assert.equal(inicial.status, 200); assert.equal(inicial.body.IdUsuario, 10);
  const r = await pedir('PUT', '/api/usuarios/me', { Nombres: 'Nuevo ficticio', IdUsuario: 99,
    IdPerfil: 1, IdAcademia: 2, EstadoRegistro: 0, Clave: 'ignorada', rol: 'Administrador' });
  assert.equal(r.status, 200); assert.equal(r.body.usuario.IdPerfil, 2); fin();
});

test('directorio preserva el formato pero no expone alumnos a personal sin alcance', async t => {
  for (const [rol, administrativo] of [['Docente', 0], ['Tutor de Aula', 0], ['Recursos Humanos', 1], ['Administrador', 1]]) {
    const fin = secuencia([{ sql: /u.IdAcademia = \?.*\(\? = 1 OR u.IdUsuario = \?\)/,
      params: [1, administrativo, 10], rows: [{ IdUsuario: 10, NombreCompleto: 'Persona Ficticia', Perfil: rol }],
      verificar(q) { assert.doesNotMatch(q, /DNI|CorreoElectronico|Clave|Celular/); } }]);
    const pedir = await servir(t, privadas, { id: 10, idAcademia: 1, rol });
    const r = await pedir('GET', '/api/usuarios/directorio');
    assert.equal(r.status, 200); assert.ok(Array.isArray(r.body)); fin();
  }
});

test('se conserva la proteccion del ultimo administrador con nombres exactos', async t => {
  for (const rol of ['Administrador', 'Recursos Humanos']) {
    const fin = secuencia([
      { sql: /SELECT IdUsuario, EstadoRegistro FROM Usuario.*FOR UPDATE/, rows: [{ IdUsuario: 10, EstadoRegistro: 1 }] },
      { sql: /SELECT p.Nombre AS NombrePerfil/, rows: [{ NombrePerfil: rol }] },
      { sql: /FROM Usuario u.*u.IdUsuario <> \?/, params: [1, 10], rows: [{ IdUsuario: 22, NombrePerfil: 'Administrador externo' }] },
    ]);
    const pedir = await servir(t, privadas, { id: 10, idAcademia: 1, rol });
    assert.equal((await pedir('PUT', '/api/usuarios/10', { EstadoRegistro: 0 })).status, 409);
    fin(); assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
  }
});

test('tutor sin asignacion verificable no consulta ni modifica pagos', async t => {
  simular();
  const pedir = await servir(t, [['/api', 'pagos.routes']], { id: 10, idAcademia: 1, rol: 'Tutor de Aula' });
  assert.equal((await pedir('GET', '/api/pagos/ciclo/7')).status, 403);
  assert.equal((await pedir('PUT', '/api/pagos/1/estado', { Estado: 'Pagado' })).status, 403);
  assert.equal(consultas.length, 0);
});

test('pago pendiente del checkout no se marca como cobrado manualmente', async t => {
  const fin = secuencia([{ sql: /FROM PagosMensualidad p.*FOR UPDATE/, params: ['1', 1],
    rows: [{ IdPago: 1, Estado: 'Pendiente', Mes: 'Inscripcion' }] }]);
  const pedir = await servir(t, [['/api', 'pagos.routes']]);
  assert.equal((await pedir('PUT', '/api/pagos/1/estado', { Estado: 'Pagado' })).status, 409);
  fin(); assert.deepEqual(eventos, ['begin', 'rollback', 'release']);
});

test('CRUD de horarios conserva el validador requerido por los nuevos endpoints', async t => {
  const body = { idCiclo: 7, idCurso: 3, diaNumero: 1, diaSemana: 'Lunes', horaInicio: '08:00', horaFin: '10:00' };
  const fin = secuencia([
    { sql: /FROM Ciclo WHERE/, params: [7, 1], rows: [{ IdCiclo: 7 }] },
    { sql: /FROM Curso WHERE/, params: [3], rows: [{ IdCurso: 3 }] },
    { sql: /INSERT INTO HorarioCurso/, params: [7, 3, 1, 'Lunes', '08:00', '10:00', 1], rows: { insertId: 5 } },
    { sql: /FROM Ciclo WHERE/, rows: [{ IdCiclo: 7 }] },
    { sql: /FROM Curso WHERE/, rows: [{ IdCurso: 3 }] },
    { sql: /UPDATE HorarioCurso.*h.IdHorario = \? AND c.IdAcademia = \?/, params: [7, 3, 1, 'Lunes', '08:00', '10:00', 1, 5, 1], rows: { affectedRows: 1 } },
    { sql: /UPDATE HorarioCurso.*SET h.EstadoRegistro = 0/, params: [5, 1], rows: { affectedRows: 1 } },
  ]);
  const pedir = await servir(t, [['/api', 'academico.routes']], { id: 10, idAcademia: 1, rol: 'Recursos Humanos' });
  assert.equal((await pedir('POST', '/api/horarios', body)).status, 201);
  assert.equal((await pedir('PUT', '/api/horarios/5', body)).status, 200);
  assert.equal((await pedir('DELETE', '/api/horarios/5')).status, 200); fin();
  simular();
  assert.equal((await pedir('POST', '/api/horarios', { ...body, horaInicio: '99:00' })).status, 400);
  assert.equal(consultas.length, 0);
});
