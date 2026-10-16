
const ROLES_GESTION_NOTAS = ['docente', 'tutor de aula', 'administrador'];

function normalizarTexto(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function idPositivo(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
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
  const rol = normalizarRol(req);
  // Nunca conceder permisos elevados solo por un IdPerfil fijo; el nombre del
  // perfil vigente es la fuente de autorización que usa roles.middleware.js.
  return (
    rol.includes('administrador') ||
    rol.includes('recursos humanos') ||
    rol === 'rrhh'
  );
}

function esPersonalAcademico(req) {
  const rol = normalizarRol(req);
  return (
    esAdministrador(req) ||
    rol === 'docente' ||
    rol === 'tutor de aula'
  );
}

/**
 * Autoriza las rutas de consulta que exponen listados académicos de una academia.
 * Requiere JWT (inyectado en req.usuario), academia válida y rol de gestión.
 */
function requiereGestionNotas(req, res, next) {
  if (!req.usuario) {
    return res.status(401).json({ error: 'Debes iniciar sesión para consultar las notas.' });
  }

  if (!obtenerIdAcademia(req)) {
    return res.status(401).json({ error: 'El usuario autenticado no tiene una academia válida.' });
  }

  const rol = normalizarRol(req);
  const autorizado = ROLES_GESTION_NOTAS.includes(rol) || esAdministrador(req);

  if (!autorizado) {
    return res.status(403).json({
      error: `Acceso denegado: se requiere el rol ${'Docente, Tutor de Aula o Administrador'}.`,
    });
  }

  return next();
}

/**
 * Permite consultar el historial de un alumno al personal académico autorizado
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

  if (esPersonalAcademico(req)) {
    return next();
  }

  const rol = normalizarRol(req);
  const esAlumno = rol.includes('alumno') || rol.includes('estudiante');

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
