const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

router.post("/auth/login", async (req, res) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({
        error: "Debes enviar usuario (código, correo o DNI) y password.",
      });
    }

    const [rows] = await pool.query(
      `SELECT u.IdUsuario, CONCAT(u.Nombres, ' ', u.ApellidoPaterno) AS nombreCompleto,
                    u.CorreoElectronico, u.Clave, u.EstadoRegistro, u.CodigoUsuario, u.IdAcademia,
                    p.IdPerfil, p.Nombre AS rol,
                    a.NombreAcademia, a.ColorTema, a.LogoUrl
             FROM Usuario u
             LEFT JOIN Usuario_Perfiles up ON u.IdUsuario = up.IdUsuario AND up.EstadoRegistro = 1
             LEFT JOIN perfil p ON up.IdPerfil = p.IdPerfil
             LEFT JOIN Academia a ON u.IdAcademia = a.IdAcademia
             WHERE (u.CorreoElectronico = ? OR u.DNI = ? OR u.CodigoUsuario = ?)`,
      [usuario, usuario, usuario],
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Usuario o código no encontrado" });
    }

    const user = rows[0];

    if (user.EstadoRegistro !== 1) {
      return res.status(403).json({ error: "La cuenta se encuentra inactiva" });
    }

    const claveValida = await bcrypt.compare(password, user.Clave);
    if (!claveValida) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    const token = jwt.sign(
      {
        id: user.IdUsuario,
        rol: user.rol,
        idPerfil: user.IdPerfil,
        idAcademia: user.IdAcademia,
      },
      process.env.JWT_SECRET || "secreto_temporal",
      { expiresIn: "8h" },
    );

    res.status(200).json({
      idUsuario: user.IdUsuario,
      usuario: user.nombreCompleto,
      codigoUsuario: user.CodigoUsuario,
      idAcademia: user.IdAcademia,
      academia: {
        nombre: user.NombreAcademia,
        colorTema: user.ColorTema,
        logoUrl: user.LogoUrl,
      },
      rol: user.rol || "Sin Asignar",
      idPerfil: user.IdPerfil,
      token,
    });
  } catch (error) {
    console.error("Error en /auth/login:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
