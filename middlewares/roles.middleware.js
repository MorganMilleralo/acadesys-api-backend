
/*
 * ACADESYS - AUTORIZACION POR ROLES
 *
 * Administrador y Recursos Humanos comparten permisos.
 * Los demas perfiles mantienen sus permisos especificos.
 *
 * No se permite autorizar por coincidencias parciales
 * ni por identificadores numericos fijos.
 */

const normalizarRol = (valor) => {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
};

const ROLES_ADMINISTRATIVOS = new Set([
  "administrador",
  "recursos humanos",
]);

const requiereRol = (...rolesPermitidos) => {
  const permitidos = rolesPermitidos.map(normalizarRol);

  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({
        error: "Debes iniciar sesión para continuar.",
      });
    }

    const rolUsuario = normalizarRol(req.usuario.rol);

    if (!rolUsuario) {
      return res.status(403).json({
        error: "El usuario no tiene un perfil válido.",
      });
    }

    const tienePermiso = permitidos.some((rolPermitido) => {
      if (rolUsuario === rolPermitido) {
        return true;
      }

      return (
        ROLES_ADMINISTRATIVOS.has(rolUsuario) &&
        ROLES_ADMINISTRATIVOS.has(rolPermitido)
      );
    });

    if (!tienePermiso) {
      return res.status(403).json({
        error: "No tienes permisos para esta operación.",
      });
    }

    return next();
  };
};

module.exports = requiereRol;
module.exports.normalizarRol = normalizarRol;
module.exports.esAdministrativo = (rol) => ROLES_ADMINISTRATIVOS.has(normalizarRol(rol));
