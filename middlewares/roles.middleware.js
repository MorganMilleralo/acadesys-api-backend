// middlewares/roles.middleware.js
// Middleware dinámico de autorización por rol (Reemplaza a admin.middleware y docente.middleware)

const requiereRol = (...rolesPermitidos) => {
  return (req, res, next) => {
    const rolUsuario = req.usuario?.rol;
    const idPerfil = req.usuario?.idPerfil;

    if (!rolUsuario && !idPerfil) {
      return res.status(401).json({
        error: "No se pudo determinar el rol o perfil del usuario autenticado.",
      });
    }

    // Validación por nombre de rol o por ID directo (Administrador = 1)
    const esAdmin =
      rolesPermitidos.includes("Administrador") &&
      (rolUsuario === "Administrador" || idPerfil === 1);
    const tieneRolValido = rolesPermitidos.includes(rolUsuario);

    if (!tieneRolValido && !esAdmin) {
      return res.status(403).json({
        error: `Acceso denegado: se requiere el rol ${rolesPermitidos.join(" o ")}.`,
      });
    }

    next();
  };
};

module.exports = requiereRol;
