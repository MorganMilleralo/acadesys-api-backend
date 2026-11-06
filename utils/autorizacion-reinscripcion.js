'use strict';

const { normalizarRol } = require('../middlewares/roles.middleware');

function idPositivoEstrictamente(valor) {
  if (typeof valor === 'number') {
    return Number.isSafeInteger(valor) && valor > 0 ? valor : null;
  }
  if (typeof valor !== 'string' || !/^\d+$/.test(valor.trim())) return null;
  const numero = Number(valor.trim());
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

/**
 * Devuelve null cuando el checkout puede reinscribir al usuario existente.
 * Devuelve un objeto { status, body } si debe rechazarse.
 * No mira IDs enviados en el body: la identidad válida proviene del JWT.
 */
function validarAutorizacionReinscripcion({ usuarioSesion, usuarioExistente, ciclo }) {
  if (!usuarioSesion) {
    return {
      status: 401,
      body: {
        code: 'REINSCRIPCION_REQUIERE_SESION',
        error: 'Ya existe una cuenta asociada. Inicia sesión con esa cuenta para reinscribirte.',
      },
    };
  }

  const idSesion = idPositivoEstrictamente(usuarioSesion.idUsuario ?? usuarioSesion.id);
  const idExistente = idPositivoEstrictamente(usuarioExistente?.IdUsuario);
  const academiaSesion = idPositivoEstrictamente(usuarioSesion.idAcademia);
  const academiaExistente = idPositivoEstrictamente(usuarioExistente?.IdAcademia);
  const academiaCiclo = idPositivoEstrictamente(ciclo?.IdAcademia);

  if (!idSesion || !idExistente || !academiaSesion || !academiaExistente || !academiaCiclo) {
    return {
      status: 401,
      body: {
        code: 'SESION_NO_VALIDADA',
        error: 'No se pudo validar la sesión para la reinscripción. Inicia sesión nuevamente.',
      },
    };
  }

  if (idSesion !== idExistente) {
    return {
      status: 403,
      body: {
        code: 'CUENTA_NO_COINCIDE',
        error: 'La sesión no corresponde a la cuenta con la que se intenta reinscribir.',
      },
    };
  }

  const rol = normalizarRol(usuarioSesion.rol);
  if (!['alumno', 'estudiante'].includes(rol)) {
    return {
      status: 403,
      body: {
        code: 'ROL_NO_PERMITIDO',
        error: 'Solo una cuenta de alumno puede reinscribirse desde este flujo.',
      },
    };
  }

  if (academiaSesion !== academiaExistente || academiaExistente !== academiaCiclo) {
    return {
      status: 403,
      body: {
        code: 'ACADEMIA_NO_COINCIDE',
        error: 'La cuenta no está autorizada para matricularse en el ciclo seleccionado.',
      },
    };
  }

  return null;
}

module.exports = {
  idPositivoEstrictamente,
  validarAutorizacionReinscripcion,
};
