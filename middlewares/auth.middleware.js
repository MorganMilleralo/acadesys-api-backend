const jwt = require("jsonwebtoken");
const pool = require("../config/db");

// ============================================================
// VERIFICACIÓN DE SESIÓN (JWT + ESTADO REAL EN BD)
// ============================================================
//
// Antes solo se verificaba la firma del token y se confiaba en el rol
// guardado dentro del JWT. Eso permitía que un token emitido con un perfil
// activo siguiera otorgando permisos aunque el usuario fuera desactivado,
// se le cambiara el perfil o el perfil se desactivara/eliminara.
//
// Ahora, tras validar la firma, se consulta el estado vigente en la base de
// datos y se reemplaza el rol del token por el rol actual. Así:
//
//   - usuario desactivado       -> 401
//   - sin relación de perfil     -> 401
//   - perfil inactivo/eliminado  -> 401
//   - perfil cambiado            -> se aplican los permisos nuevos
//
// El token ya no es fuente de autorización: solo identifica al usuario.
// El formato del JWT no cambia.
const verificarToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res
      .status(403)
      .json({ error: "Acceso denegado: Un token de acceso es requerido" });
  }

  let decoded;
  try {
    decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "super_secreto_seguro_acadesys_2026",
    );
  } catch (error) {
    return res
      .status(401)
      .json({ error: "Token inválido o expirado. Inicie sesión nuevamente." });
  }

  const idUsuario = decoded?.idUsuario || decoded?.id;
  if (!idUsuario) {
    return res
      .status(401)
      .json({ error: "Sesión inválida. Inicie sesión nuevamente." });
  }

  try {
    const [rows] = await pool.query(
      `SELECT
          u.IdUsuario,
          u.EstadoRegistro AS EstadoUsuario,
          u.IdAcademia,
          up.IdPerfil,
          COALESCE(NULLIF(p.Nombre, ''), '') AS Rol,
          p.EstadoRegistro AS EstadoPerfil
        FROM Usuario u
        LEFT JOIN Usuario_Perfiles up
          ON up.IdUsuario = u.IdUsuario
         AND up.EstadoRegistro = 1
        LEFT JOIN perfil p
          ON p.IdPerfil = up.IdPerfil
         AND p.EstadoRegistro = 1
       WHERE u.IdUsuario = ?
       ORDER BY CASE WHEN p.IdPerfil IS NULL THEN 1 ELSE 0 END ASC,
                up.IdUsuarioPerfil ASC
       LIMIT 1`,
      [idUsuario],
    );

    const usuario = rows[0];

    if (!usuario || Number(usuario.EstadoUsuario) !== 1) {
      return res.status(401).json({
        error: "Tu sesión ya no es válida. Vuelve a iniciar sesión.",
      });
    }

    if (
      usuario.IdPerfil == null ||
      Number(usuario.EstadoPerfil) !== 1 ||
      !usuario.Rol
    ) {
      return res.status(401).json({
        error: "Tu perfil ya no está disponible. Contacta al administrador.",
      });
    }

    // Datos vigentes: se ignora el rol almacenado en el token.
    req.usuario = {
      id: usuario.IdUsuario,
      idUsuario: usuario.IdUsuario,
      idAcademia: usuario.IdAcademia,
      idPerfil: usuario.IdPerfil,
      rol: usuario.Rol,
    };

    return next();
  } catch (error) {
    console.error("[Auth] Error al validar la sesión:", error.message);
    return res
      .status(500)
      .json({ error: "No se pudo validar la sesión. Inténtalo nuevamente." });
  }
};

module.exports = verificarToken;
