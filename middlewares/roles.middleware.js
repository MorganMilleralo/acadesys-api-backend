// middlewares/roles.middleware.js
// Middleware dinámico de autorización por rol (Reemplaza a admin.middleware y docente.middleware)
//
// El rol y el IdPerfil provistos en req.usuario ya vienen refrescados desde la
// base de datos por auth.middleware (no desde el JWT), por lo que un cambio o
// desactivación de perfil surte efecto de inmediato.

const normalizar = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const requiereRol = (...rolesPermitidos) => {
  return (req, res, next) => {
    const rolUsuario = req.usuario?.rol;
    const idPerfil = req.usuario?.idPerfil;

    if (!rolUsuario && !idPerfil) {
      return res.status(401).json({
        error: "No se pudo determinar el rol o perfil del usuario autenticado.",
      });
    }

    // El perfil administrativo se reconoce por nombre normalizado (incluye
    // Recursos Humanos, que opera como Administrador), nunca por un IdPerfil fijo.
    const rolNormalizado = normalizar(rolUsuario);
    const permitidos = rolesPermitidos.map(normalizar);

    const esAdmin =
      permitidos.includes("administrador") &&
      (rolNormalizado.includes("administrador") ||
        rolNormalizado.includes("recursos humanos") ||
        rolNormalizado === "rrhh");

    const tieneRolValido = permitidos.includes(rolNormalizado);

    if (!tieneRolValido && !esAdmin) {
      return res.status(403).json({
        error: `Acceso denegado: se requiere el rol ${rolesPermitidos.join(" o ")}.`,
      });
    }

    next();
  };
};

module.exports = requiereRol;
