'use strict';

const crypto = require('node:crypto');

const PROPOSITO_VERIFICACION = 'acadesys-matricula-email-v1';
const DURACION_MS = 15 * 60 * 1000;

function obtenerClave(env = process.env) {
  const secreto = String(env.JWT_SECRET || '');
  if (secreto.trim().length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres para crear enlaces de verificación.');
  }
  return crypto.createHash('sha256').update(secreto, 'utf8').digest();
}

function idCicloValido(valor) {
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0;
}

function crearTokenVerificacionMatricula(datos, env = process.env, ahoraMs = Date.now()) {
  if (!datos || typeof datos !== 'object') throw new TypeError('Los datos de verificación no son válidos.');
  const nombres = String(datos.nombres || '').trim().replace(/\s+/g, ' ');
  const apellidos = String(datos.apellidos || '').trim().replace(/\s+/g, ' ');
  const correo = String(datos.correo || '').trim().toLowerCase();
  const idCiclo = Number(datos.idCiclo);

  if (nombres.length < 2 || nombres.length > 100) throw new TypeError('Los nombres no son válidos.');
  if (apellidos.length < 2 || apellidos.length > 100) throw new TypeError('Los apellidos no son válidos.');
  if (correo.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new TypeError('El correo no es válido.');
  if (!idCicloValido(idCiclo)) throw new TypeError('El ciclo no es válido.');
  if (!Number.isFinite(ahoraMs)) throw new TypeError('La fecha del token no es válida.');

  const ahoraSeg = Math.floor(ahoraMs / 1000);
  const payload = {
    version: 1,
    proposito: PROPOSITO_VERIFICACION,
    nombres,
    apellidos,
    correo,
    idCiclo,
    emitidoEn: ahoraSeg,
    expiraEn: Math.floor((ahoraMs + DURACION_MS) / 1000),
    // El nonce evita que dos tokens emitidos para la misma solicitud sean iguales.
    nonce: crypto.randomBytes(16).toString('hex'),
  };

  const iv = crypto.randomBytes(12);
  const cifrador = crypto.createCipheriv('aes-256-gcm', obtenerClave(env), iv);
  const cifrado = Buffer.concat([
    cifrador.update(JSON.stringify(payload), 'utf8'),
    cifrador.final(),
  ]);
  const etiqueta = cifrador.getAuthTag();
  return `v1.${iv.toString('base64url')}.${etiqueta.toString('base64url')}.${cifrado.toString('base64url')}`;
}

function verificarTokenVerificacionMatricula(token, env = process.env, ahoraMs = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length < 40 || token.length > 4096) return null;
    const partes = token.split('.');
    if (partes.length !== 4 || partes[0] !== 'v1') return null;
    const [, ivTexto, etiquetaTexto, cifradoTexto] = partes;
    if (![ivTexto, etiquetaTexto, cifradoTexto].every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
    const iv = Buffer.from(ivTexto, 'base64url');
    const etiqueta = Buffer.from(etiquetaTexto, 'base64url');
    const cifrado = Buffer.from(cifradoTexto, 'base64url');
    if (iv.length !== 12 || etiqueta.length !== 16 || cifrado.length === 0 || cifrado.length > 2048) return null;

    const descifrador = crypto.createDecipheriv('aes-256-gcm', obtenerClave(env), iv);
    descifrador.setAuthTag(etiqueta);
    const claro = Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString('utf8');
    const payload = JSON.parse(claro);
    const ahoraSeg = Math.floor(ahoraMs / 1000);

    if (payload.version !== 1 || payload.proposito !== PROPOSITO_VERIFICACION) return null;
    if (!Number.isSafeInteger(payload.expiraEn) || payload.expiraEn <= ahoraSeg) return null;
    if (!Number.isSafeInteger(payload.emitidoEn) || payload.emitidoEn > ahoraSeg + 60) return null;
    if (payload.expiraEn - payload.emitidoEn > Math.ceil(DURACION_MS / 1000) + 1) return null;
    if (typeof payload.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(payload.nonce)) return null;

    const nombres = String(payload.nombres || '').trim();
    const apellidos = String(payload.apellidos || '').trim();
    const correo = String(payload.correo || '').trim().toLowerCase();
    if (nombres.length < 2 || nombres.length > 100 || apellidos.length < 2 || apellidos.length > 100) return null;
    if (correo.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return null;
    if (!idCicloValido(payload.idCiclo)) return null;

    return { nombres, apellidos, correo, idCiclo: Number(payload.idCiclo), expiraEn: payload.expiraEn };
  } catch (_) {
    // No se propagan detalles criptográficos ni el contenido del token al cliente.
    return null;
  }
}

module.exports = {
  PROPOSITO_VERIFICACION,
  DURACION_MS,
  crearTokenVerificacionMatricula,
  verificarTokenVerificacionMatricula,
};
