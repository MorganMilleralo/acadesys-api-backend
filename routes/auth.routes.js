const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');

// POST: Autenticación de usuarios
router.post('/auth/login', async (req, res) => {
    try {
        const { usuario, password } = req.body;

        // Buscar al usuario por correo o DNI cruzando tablas para obtener su Rol
        const [rows] = await pool.query(`
            SELECT u.IdUsuario, CONCAT(u.Nombres, ' ', u.ApellidoPaterno) AS nombreCompleto, 
                   u.CorreoElectronico, u.Clave, u.EstadoRegistro, 
                   p.IdPerfil, p.Nombre AS rol
            FROM Usuario u
            LEFT JOIN Usuario_Perfiles up ON u.IdUsuario = up.IdUsuario
            LEFT JOIN perfil p ON up.IdPerfil = p.IdPerfil
            WHERE (u.CorreoElectronico = ? OR u.DNI = ?)
        `, [usuario, usuario]);

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        const user = rows[0];

        // Validar Estado Activo y Contraseña
        if (user.EstadoRegistro !== 1) {
            return res.status(403).json({ error: 'La cuenta se encuentra inactiva' });
        }
        if (user.Clave !== password) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        // Generar Token
        const token = jwt.sign(
            { id: user.IdUsuario, rol: user.rol }, 
            process.env.JWT_SECRET || 'acadesys_secreto', 
            { expiresIn: '8h' }
        );

        // Respuesta exacta solicitada por el frontend
        res.status(200).json({
            idUsuario: user.IdUsuario,
            usuario: user.nombreCompleto,
            correo: user.CorreoElectronico,
            rol: user.rol || 'Sin Asignar',
            idPerfil: user.IdPerfil,
            token: token
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;