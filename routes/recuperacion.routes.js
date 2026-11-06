'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../config/db');

const router = express.Router();

const GOOGLE_SCRIPT_URL = String(process.env.GOOGLE_SCRIPT_URL || '').trim();
const GOOGLE_SCRIPT_TOKEN = String(process.env.GOOGLE_SCRIPT_TOKEN || '').trim();
const FRONTEND_PUBLIC_URL = String(
  process.env.FRONTEND_PUBLIC_URL || 'https://acadesys-web-frontend.vercel.app',
).trim().replace(/\/+$/, '');
const PROPOSITO_RECUPERACION = 'acadesys-password-reset';
const TOKEN_TTL = '15m';
const VENTANA_LIMITACION_MS = 15 * 60 * 1000;
const solicitudesPublicas = new Map();

const MENSAJE_PUBLICO =
  'Si existe una cuenta activa con esos datos, recibirás un enlace de recuperación en el correo registrado. Revisa también la carpeta de spam.';

function obtenerSecretoJWT() {
  const secreto = String(process.env.JWT_SECRET || '');
  if (secreto.length < 32) return null;
  return secreto;
}

function normalizarIdentificador(valor) {
  return String(valor ?? '').trim();
}

function normalizarCorreo(valor) {
  return String(valor ?? '').trim().toLowerCase();
}

function escaparHtml(valor = '') {
  return String(valor).replace(/[&<>"']/g, (caracter) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[caracter]);
}

function huellaClave(claveGuardada) {
  const secreto = obtenerSecretoJWT();
  if (!secreto) throw new Error('JWT_SECRET no está configurado correctamente.');
  return crypto
    .createHmac('sha256', secreto)
    .update(String(claveGuardada ?? ''))
    .digest('hex');
}

function huellasIguales(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
}

function correoConfigurado() {
  try {
    const url = new URL(GOOGLE_SCRIPT_URL);
    return url.protocol === 'https:' && GOOGLE_SCRIPT_TOKEN.length >= 32;
  } catch {
    return false;
  }
}

async function enviarCorreoHtml(destinatario, asunto, htmlBody) {
  if (!correoConfigurado()) {
    throw new Error('GOOGLE_SCRIPT_URL o GOOGLE_SCRIPT_TOKEN no están configurados correctamente.');
  }

  const response = await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: destinatario,
      subject: asunto,
      htmlBody,
      token: GOOGLE_SCRIPT_TOKEN,
    }),
  });

  const resultado = await response.json().catch(() => ({}));
  if (!response.ok || resultado?.status !== 'success') {
    throw new Error(resultado?.message || 'El servicio de correo no confirmó el envío.');
  }
  return resultado;
}

function crearEnlaceRestablecimiento(token) {
  // El fragmento (#...) no se envía al servidor web del frontend ni forma parte
  // de la petición HTTP, pero React puede leerlo al cargar la Landing Page.
  return `${FRONTEND_PUBLIC_URL}/#restablecer-password?token=${encodeURIComponent(token)}`;
}

function limitarSolicitudes(tipo, maxSolicitudes) {
  return (req, res, next) => {
    const ip = String(req.ip || req.socket?.remoteAddress || 'desconocida');
    const clave = `${tipo}:${ip}`;
    const ahora = Date.now();
    let registro = solicitudesPublicas.get(clave);

    if (!registro || ahora - registro.inicio >= VENTANA_LIMITACION_MS) {
      registro = { inicio: ahora, cantidad: 0 };
    }
    registro.cantidad += 1;
    solicitudesPublicas.set(clave, registro);

    // Limpieza defensiva para evitar que el mapa crezca indefinidamente.
    if (solicitudesPublicas.size > 5000) {
      for (const [claveGuardada, valor] of solicitudesPublicas) {
        if (ahora - valor.inicio >= VENTANA_LIMITACION_MS) solicitudesPublicas.delete(claveGuardada);
      }
    }

    if (registro.cantidad > maxSolicitudes) {
      res.set('Retry-After', String(Math.ceil(VENTANA_LIMITACION_MS / 1000)));
      return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.' });
    }
    return next();
  };
}

function mensajeTokenInvalido(res) {
  return res.status(400).json({
    code: 'ENLACE_RECUPERACION_INVALIDO',
    error: 'El enlace venció o ya fue utilizado. Solicita uno nuevo.',
  });
}

/**
 * POST /api/auth/recuperar-password
 * Público: acepta correo, código de usuario o DNI; no requiere Authorization.
 */
router.post('/recuperar-password', limitarSolicitudes('recuperacion', 5), async (req, res) => {
  const identificador = normalizarIdentificador(req.body?.usuario ?? req.body?.correo ?? req.body?.usuarioOCorreo);

  if (!identificador || identificador.length > 254 || /[\u0000-\u001f\u007f]/.test(identificador)) {
    return res.status(400).json({
      code: 'IDENTIFICADOR_INVALIDO',
      error: 'Ingresa un correo, código de usuario o DNI válido.',
    });
  }

  // La comprobación se realiza antes de buscar la cuenta para que el estado 503
  // no revele si el identificador pertenece a un usuario concreto.
  if (!correoConfigurado()) {
    return res.status(503).json({
      code: 'CORREO_NO_CONFIGURADO',
      error: 'El servicio de correo no está configurado en el servidor.',
    });
  }

  const secreto = obtenerSecretoJWT();
  if (!secreto) {
    return res.status(503).json({
      code: 'AUTENTICACION_NO_CONFIGURADA',
      error: 'El servicio de recuperación no está configurado correctamente.',
    });
  }

  const identificadorLower = identificador.toLowerCase();

  try {
    const [usuarios] = await pool.query(
      `SELECT
         u.IdUsuario,
         u.CodigoUsuario,
         u.DNI,
         u.Nombres,
         u.ApellidoPaterno,
         u.CorreoElectronico,
         u.Clave
       FROM Usuario u
       WHERE u.EstadoRegistro = 1
         AND (
           LOWER(TRIM(COALESCE(u.CorreoElectronico, ''))) = ?
           OR LOWER(TRIM(COALESCE(u.CodigoUsuario, ''))) = ?
           OR TRIM(COALESCE(u.DNI, '')) = ?
           OR (
             LOWER(SUBSTRING_INDEX(TRIM(COALESCE(u.CorreoElectronico, '')), '@', 1)) = ?
             AND (
               SELECT COUNT(*)
               FROM Usuario ux
               WHERE ux.EstadoRegistro = 1
                 AND LOWER(SUBSTRING_INDEX(TRIM(COALESCE(ux.CorreoElectronico, '')), '@', 1)) = ?
             ) = 1
           )
         )
       LIMIT 2`,
      [
        identificadorLower,
        identificadorLower,
        identificador,
        identificadorLower,
        identificadorLower,
      ],
    );

    // Respuesta uniforme para cuenta inexistente o identificador ambiguo.
    if (usuarios.length !== 1) {
      return res.status(200).json({ exito: true, mensaje: MENSAJE_PUBLICO });
    }

    const usuario = usuarios[0];
    const correo = normalizarCorreo(usuario.CorreoElectronico);
    if (!correo || correo.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      return res.status(200).json({ exito: true, mensaje: MENSAJE_PUBLICO });
    }

    const token = jwt.sign(
      {
        idUsuario: Number(usuario.IdUsuario),
        correo,
        proposito: PROPOSITO_RECUPERACION,
        claveVersion: huellaClave(usuario.Clave),
      },
      secreto,
      { algorithm: 'HS256', expiresIn: TOKEN_TTL },
    );

    const enlace = crearEnlaceRestablecimiento(token);
    const nombre = [usuario.Nombres, usuario.ApellidoPaterno].filter(Boolean).join(' ').trim();
    const htmlBody = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:600px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;">
        <h2 style="color:#0f766e;">Recuperar acceso a AcadeSys</h2>
        <p>Hola${nombre ? ` ${escaparHtml(nombre)}` : ''},</p>
        <p>Recibimos una solicitud para cambiar la contraseña de tu cuenta de AcadeSys.</p>
        <p style="margin:24px 0;"><a href="${escaparHtml(enlace)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold;">Crear nueva contraseña</a></p>
        <p>El enlace vence en 15 minutos y solo puede utilizarse una vez.</p>
        <p>Si no solicitaste este cambio, ignora este mensaje. Tu contraseña seguirá igual.</p>
      </div>`;

    try {
      await enviarCorreoHtml(correo, 'Recuperación de contraseña - AcadeSys', htmlBody);
    } catch (errorCorreo) {
      // No se devuelve un error distinto por cuenta existente/no existente, para
      // evitar usar este endpoint para enumerar usuarios. La causa queda en logs.
      console.error('[Recuperación] El proveedor de correo no confirmó el envío:', errorCorreo.message);
    }

    return res.status(200).json({ exito: true, mensaje: MENSAJE_PUBLICO });
  } catch (error) {
    console.error('[Recuperación] No se pudo procesar la solicitud:', error.message);
    return res.status(500).json({
      code: 'ERROR_RECUPERACION',
      error: 'No se pudo procesar la solicitud. Inténtalo nuevamente más tarde.',
    });
  }
});

/**
 * POST /api/auth/restablecer-password
 * Público: el JWT de propósito especial sustituye a una sesión Bearer normal.
 */
router.post('/restablecer-password', limitarSolicitudes('restablecer', 10), async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const nuevaClave = req.body?.nuevaClave ?? req.body?.password;

  if (!token || token.length > 4096) return mensajeTokenInvalido(res);

  if (typeof nuevaClave !== 'string') {
    return res.status(400).json({ error: 'La nueva contraseña es obligatoria.' });
  }
  const bytesClave = Buffer.byteLength(nuevaClave, 'utf8');
  if (bytesClave < 8 || bytesClave > 72) {
    return res.status(400).json({
      error: 'La contraseña debe tener entre 8 y 72 bytes en UTF-8.',
    });
  }

  const secreto = obtenerSecretoJWT();
  if (!secreto) {
    return res.status(503).json({ error: 'El servicio de recuperación no está configurado.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, secreto, { algorithms: ['HS256'] });
  } catch {
    return mensajeTokenInvalido(res);
  }

  if (
    payload?.proposito !== PROPOSITO_RECUPERACION ||
    !Number.isSafeInteger(Number(payload.idUsuario)) ||
    Number(payload.idUsuario) <= 0 ||
    typeof payload.correo !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(String(payload.claveVersion || ''))
  ) {
    return mensajeTokenInvalido(res);
  }

  let connection;
  let enTransaccion = false;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    enTransaccion = true;

    const [[usuario]] = await connection.query(
      `SELECT IdUsuario, CorreoElectronico, Clave
       FROM Usuario
       WHERE IdUsuario = ? AND EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [Number(payload.idUsuario)],
    );

    if (
      !usuario ||
      normalizarCorreo(usuario.CorreoElectronico) !== normalizarCorreo(payload.correo) ||
      !huellasIguales(huellaClave(usuario?.Clave), String(payload.claveVersion))
    ) {
      await connection.rollback();
      enTransaccion = false;
      return mensajeTokenInvalido(res);
    }

    const claveHasheada = await bcrypt.hash(nuevaClave, 10);
    const [actualizacion] = await connection.query(
      'UPDATE Usuario SET Clave = ? WHERE IdUsuario = ? AND EstadoRegistro = 1',
      [claveHasheada, Number(usuario.IdUsuario)],
    );

    if (actualizacion.affectedRows !== 1) {
      await connection.rollback();
      enTransaccion = false;
      return mensajeTokenInvalido(res);
    }

    await connection.commit();
    enTransaccion = false;

    return res.status(200).json({
      exito: true,
      mensaje: 'Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión.',
    });
  } catch (error) {
    if (enTransaccion && connection) {
      try { await connection.rollback(); } catch { /* se preserva el error original */ }
    }
    console.error('[Recuperación] Error al guardar la nueva contraseña:', error.message);
    return res.status(500).json({ error: 'No se pudo actualizar la contraseña. Inténtalo más tarde.' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
