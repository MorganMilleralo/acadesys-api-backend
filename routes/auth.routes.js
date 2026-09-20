const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt'); 

router.post('/auth/login', async (req, res) => {
    try {
        const { usuario, password } = req.body;

        // Añadimos CodigoUsuario e IdAcademia al SELECT, y buscamos por CodigoUsuario en el WHERE
        const [rows] = await pool.query(`
            SELECT u.IdUsuario, CONCAT(u.Nombres, ' ', u.ApellidoPaterno) AS nombreCompleto, 
                   u.CorreoElectronico, u.Clave, u.EstadoRegistro, u.CodigoUsuario, u.IdAcademia, 
                   p.IdPerfil, p.Nombre AS rol
            FROM Usuario u
            LEFT JOIN Usuario_Perfiles up ON u.IdUsuario = up.IdUsuario
            LEFT JOIN perfil p ON up.IdPerfil = p.IdPerfil
            WHERE (u.CorreoElectronico = ? OR u.DNI = ? OR u.CodigoUsuario = ?)
        `, [usuario, usuario, usuario]);

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Usuario o código no encontrado' });
        }

        const user = rows[0];

        if (user.EstadoRegistro !== 1) {
            return res.status(403).json({ error: 'La cuenta se encuentra inactiva' });
        }

        const claveValida = await bcrypt.compare(password, user.Clave);
        if (!claveValida) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        // Inyectamos el IdAcademia (Multi-tenant) y el idPerfil (Middleware) en el Payload
        const token = jwt.sign(
            { 
                id: user.IdUsuario, 
                rol: user.rol,
                idPerfil: user.IdPerfil,
                idAcademia: user.IdAcademia 
            }, 
            process.env.JWT_SECRET, 
            { expiresIn: '8h' }
        );

        res.status(200).json({
            idUsuario: user.IdUsuario,
            usuario: user.nombreCompleto,
            codigoUsuario: user.CodigoUsuario,
            idAcademia: user.IdAcademia,
            rol: user.rol || 'Sin Asignar',
            idPerfil: user.IdPerfil,
            token: token
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;