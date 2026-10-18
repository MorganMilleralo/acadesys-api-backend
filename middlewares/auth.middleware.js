
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { enteroPositivo } = require("../utils/evaluaciones");

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.trim().length < 32) {
  throw new Error(
    "JWT_SECRET debe tener al menos 32 caracteres para iniciar AcadeSys."
  );
}

const verificarToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (
    typeof authHeader !== "string" ||
    !/^Bearer\s+\S+$/i.test(authHeader.trim())
  ) {
    return res.status(401).json({
      error: "Se requiere un token Bearer válido.",
    });
  }

  const token = authHeader.trim().split(/\s+/)[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (
      !decoded ||
      typeof decoded !== "object" ||
      decoded.proposito !== undefined ||
      !enteroPositivo(decoded.id) ||
      !enteroPositivo(decoded.idAcademia)
    ) {
      return res.status(401).json({
        error: "El token no contiene una identidad válida.",
      });
    }

    let usuarios;

    try {
      [usuarios] = await pool.query(
        `SELECT
            u.IdUsuario,
            u.IdAcademia,
            up.IdPerfil,
            p.Nombre AS Rol
         FROM Usuario u
         INNER JOIN Usuario_Perfiles up
           ON up.IdUsuario = u.IdUsuario
           AND up.EstadoRegistro = 1
         INNER JOIN perfil p
           ON p.IdPerfil = up.IdPerfil
           AND p.EstadoRegistro = 1
         WHERE u.IdUsuario = ?
           AND u.EstadoRegistro = 1
         LIMIT 2`,
        [Number(decoded.id)]
      );
    } catch (dbError) {
      console.error("Error al verificar permisos:", dbError);

      return res.status(503).json({
        error: "No se pudo verificar la sesion.",
      });
    }

    if (usuarios.length === 0) {
      return res.status(401).json({
        error: "Usuario inactivo o sin perfil activo.",
      });
    }

    if (usuarios.length > 1) {
      return res.status(403).json({
        error: "El usuario tiene multiples perfiles activos.",
      });
    }

    const usuarioActual = usuarios[0];

    if (
      Number(usuarioActual.IdAcademia) !==
      Number(decoded.idAcademia)
    ) {
      return res.status(401).json({
        error: "La academia del usuario ha cambiado.",
      });
    }

    req.usuario = {
      ...decoded,
      id: usuarioActual.IdUsuario,
      idUsuario: usuarioActual.IdUsuario,
      idAcademia: usuarioActual.IdAcademia,
      idPerfil: usuarioActual.IdPerfil,
      rol: usuarioActual.Rol,
    };

    return next();


  } catch (error) {
    return res.status(401).json({
      error: "Token inválido o expirado. Inicie sesión nuevamente.",
    });
  }

};

module.exports = verificarToken;
