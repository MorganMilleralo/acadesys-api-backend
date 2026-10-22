const { normalizarRol: normalizarTexto, esAdministrativo } = require('./roles.middleware');
const { enteroPositivo } = require('../utils/evaluaciones');

function idPositivo(valor) {
  return enteroPositivo(valor) ? Number(valor) : null;
}

function obtenerIdUsuario(req) {
  return idPositivo(req.usuario?.idUsuario ?? req.usuario?.id);
}

function obtenerIdAcademia(req) {
  return idPositivo(req.usuario?.idAcademia);
}

function normalizarRol(req) {
  return normalizarTexto(req.usuario?.rol);
}

function esAdministrador(req) {
  // Nunca conceder permisos elevados solo por un IdPerfil fijo; el nombre del
  // perfil vigente es la fuente de autorización que usa roles.middleware.js.
  return esAdministrativo(req.usuario?.rol);
}

/**
 * Autoriza las rutas de consulta que exponen listados académicos de una academia.
 * Requiere JWT (inyectado en req.usuario), academia válida y rol administrativo.
 * Docente/tutor requieren una relacion verificable con los alumnos. El rol y
 * la academia por si solos no acreditan ese alcance.
 */
function requiereGestionNotas(req, res, next) {
  if (!req.usuario) {
    return res.status(401).json({ error: 'Debes iniciar sesión para consultar las notas.' });
  }

  if (!obtenerIdAcademia(req)) {
    return res.status(401).json({ error: 'El usuario autenticado no tiene una academia válida.' });
  }

  if (!esAdministrador(req)) {
    return res.status(403).json({
      error: 'La gestion de notas requiere permisos administrativos o una asignacion verificable.',
    });
  }

  return next();
}

/**
 * Permite consultar el historial de un alumno al personal administrativo
 * de su academia, o al propio alumno si su rol e identidad coinciden.
 */
function autorizarHistorialAlumno(req, res, next) {
  if (!req.usuario) {
    return res.status(401).json({ error: 'Debes iniciar sesión para consultar el historial.' });
  }

  const idSolicitado = idPositivo(req.params?.id);
  if (!idSolicitado) {
    return res.status(400).json({ error: 'El identificador del alumno no es válido.' });
  }

  const idUsuarioAutenticado = obtenerIdUsuario(req);
  const idAcademia = obtenerIdAcademia(req);

  if (!idUsuarioAutenticado || !idAcademia) {
    return res.status(401).json({ error: 'No fue posible validar la identidad o academia del usuario.' });
  }

  if (esAdministrador(req)) {
    return next();
  }

  const rol = normalizarRol(req);
  const esAlumno = ['alumno', 'estudiante'].includes(rol);

  if (esAlumno && idSolicitado === idUsuarioAutenticado) {
    return next();
  }

  return res.status(403).json({
    error: 'No tienes permiso para consultar el historial académico solicitado.',
  });
}

module.exports = {
  requiereGestionNotas,
  autorizarHistorialAlumno,
};


