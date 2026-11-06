'use strict';

/**
 * Permite rutas públicas a usuarios nuevos, pero valida el Bearer si viene presente.
 * La carga de auth.middleware es diferida para no forzar conexión/secretos en rutas
 * públicas y pruebas que no envían token.
 */
function autenticacionOpcional(req, res, next) {
  const authorization = req?.headers?.authorization;

  if (typeof authorization !== 'string' || authorization.trim() === '') {
    return next();
  }

  try {
    const verificarToken = require('./auth.middleware');
    return verificarToken(req, res, next);
  } catch (error) {
    console.error('[Auth] No se pudo inicializar la validación opcional de sesión.');
    return res.status(500).json({
      code: 'ERROR_VERIFICACION_SESION',
      error: 'No se pudo verificar la sesión. Inténtalo nuevamente.',
    });
  }
}

module.exports = autenticacionOpcional;
