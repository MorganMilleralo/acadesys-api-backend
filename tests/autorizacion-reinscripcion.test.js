'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validarAutorizacionReinscripcion, idPositivoEstrictamente } = require('../utils/autorizacion-reinscripcion');

const existente = { IdUsuario: 12, IdAcademia: 3, NombrePerfil: 'Alumno' };
const ciclo = { IdCiclo: 9, IdAcademia: 3 };
const sesionAlumno = { id: 12, idUsuario: 12, idAcademia: 3, rol: 'Alumno' };

test('IDs estrictos no aceptan booleanos, decimales ni cadenas manipuladas', () => {
  assert.equal(idPositivoEstrictamente(12), 12);
  assert.equal(idPositivoEstrictamente('12'), 12);
  for (const valor of [true, false, 0, -1, 1.2, '12x', ' 12x ', [], null, undefined]) {
    assert.equal(idPositivoEstrictamente(valor), null);
  }
});

test('una reinscripción pública sin sesión se rechaza antes de escribir', () => {
  const rechazo = validarAutorizacionReinscripcion({ usuarioSesion: null, usuarioExistente: existente, ciclo });
  assert.equal(rechazo.status, 401);
  assert.equal(rechazo.body.code, 'REINSCRIPCION_REQUIERE_SESION');
});

test('el mismo alumno autenticado en la misma academia puede continuar', () => {
  assert.equal(validarAutorizacionReinscripcion({ usuarioSesion: sesionAlumno, usuarioExistente: existente, ciclo }), null);
});

test('la sesión de otro alumno no puede reutilizar el correo', () => {
  const rechazo = validarAutorizacionReinscripcion({
    usuarioSesion: { ...sesionAlumno, id: 13, idUsuario: 13 },
    usuarioExistente: existente,
    ciclo,
  });
  assert.equal(rechazo.status, 403);
  assert.equal(rechazo.body.code, 'CUENTA_NO_COINCIDE');
});

test('administrador no puede utilizar el checkout de reinscripción como alumno', () => {
  const rechazo = validarAutorizacionReinscripcion({
    usuarioSesion: { ...sesionAlumno, rol: 'Administrador' },
    usuarioExistente: existente,
    ciclo,
  });
  assert.equal(rechazo.status, 403);
  assert.equal(rechazo.body.code, 'ROL_NO_PERMITIDO');
});

test('cuenta de otra academia no puede reinscribirse en el ciclo seleccionado', () => {
  const rechazo = validarAutorizacionReinscripcion({
    usuarioSesion: { ...sesionAlumno, idAcademia: 4 },
    usuarioExistente: { ...existente, IdAcademia: 4 },
    ciclo,
  });
  assert.equal(rechazo.status, 403);
  assert.equal(rechazo.body.code, 'ACADEMIA_NO_COINCIDE');
});

test('sesión sin rol válido se rechaza por defecto', () => {
  const rechazo = validarAutorizacionReinscripcion({
    usuarioSesion: { ...sesionAlumno, rol: 'Tutor de Aula' },
    usuarioExistente: existente,
    ciclo,
  });
  assert.equal(rechazo.status, 403);
});
