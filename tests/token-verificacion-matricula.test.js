'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  crearTokenVerificacionMatricula,
  verificarTokenVerificacionMatricula,
} = require('../utils/token-verificacion-matricula');

const env = { JWT_SECRET: 'secreto-local-pruebas-no-usar-en-produccion-2026' };
const ahora = new Date('2026-10-21T12:00:00Z').getTime();
const datos = { nombres: 'Ana María', apellidos: 'Pérez Díaz', correo: '  ANA@example.test ', idCiclo: 8 };

test('token válido cifra los datos personales y puede verificarse', () => {
  const token = crearTokenVerificacionMatricula(datos, env, ahora);
  assert.equal(token.includes('ANA@example.test'), false);
  const payload = verificarTokenVerificacionMatricula(token, env, ahora + 1000);
  assert.deepEqual(
    { nombres: payload.nombres, apellidos: payload.apellidos, correo: payload.correo, idCiclo: payload.idCiclo },
    { nombres: 'Ana María', apellidos: 'Pérez Díaz', correo: 'ana@example.test', idCiclo: 8 },
  );
});

test('token vencido se rechaza', () => {
  const token = crearTokenVerificacionMatricula(datos, env, ahora);
  assert.equal(verificarTokenVerificacionMatricula(token, env, ahora + 16 * 60 * 1000), null);
});

test('token manipulado y token de formato incorrecto se rechazan', () => {
  const token = crearTokenVerificacionMatricula(datos, env, ahora);
  assert.equal(verificarTokenVerificacionMatricula(`${token.slice(0, -1)}A`, env, ahora), null);
  assert.equal(verificarTokenVerificacionMatricula('v1.invalid.invalid.invalid', env, ahora), null);
  assert.equal(verificarTokenVerificacionMatricula({ token }, env, ahora), null);
});

test('datos inválidos no generan un token', () => {
  for (const cambiar of [
    { correo: 'no-es-correo' },
    { idCiclo: 0 },
    { nombres: 'A' },
    { apellidos: '' },
  ]) {
    assert.throws(() => crearTokenVerificacionMatricula({ ...datos, ...cambiar }, env, ahora));
  }
});

test('el secreto debe ser suficientemente largo', () => {
  assert.throws(() => crearTokenVerificacionMatricula(datos, { JWT_SECRET: 'corto' }, ahora), /JWT_SECRET/);
});
