const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Controlador maestro de inicio de sesión
const loginHandler = async (req, res) => {
    try {
        // 1. ADAPTABILIDAD DE ENTRADA: Captura cualquier variante enviada por el front
        const usuarioInput = req.body.usuario || 
                             req.body.codigo_usuario || 
                             req.body.codigoUsuario || 
                             req.body.correo || 
                             req.body.email || 
                             req.body.dni;

        const passwordInput = req.body.password || 
                              req.body.Clave || 
                              req.body.clave || 
                              req.body.contrasena;

        if (!usuarioInput || !passwordInput) {
            return res.status(400).json({ 
                error: 'Debes enviar credenciales válidas (usuario/código/correo y contraseña).' 
            });
        }

        const termino = String(usuarioInput).trim();
        const clave = String(passwordInput).trim();

        // 2. CONSULTA FLEXIBLE: Busca en Usuario por Correo, DNI o Código (insensible a mayúsculas/minúsculas)
        const [rows] = await pool.query(
            `SELECT u.IdUsuario, 
                    CONCAT(u.Nombres, ' ', COALESCE(u.ApellidoPaterno, '')) AS nombreCompleto,
                    u.Nombres, u.ApellidoPaterno, u.CorreoElectronico, u.Clave, 
                    u.EstadoRegistro, u.CodigoUsuario, u.IdAcademia,
                    p.IdPerfil, COALESCE(p.Nombre, 'Sin Rol') AS rol,
                    a.NombreAcademia, a.ColorTema, a.LogoUrl
             FROM Usuario u
             LEFT JOIN Usuario_Perfiles up ON u.IdUsuario = up.IdUsuario AND up.EstadoRegistro = 1
             LEFT JOIN perfil p ON up.IdPerfil = p.IdPerfil
             LEFT JOIN Academia a ON u.IdAcademia = a.IdAcademia
             WHERE LOWER(TRIM(u.CorreoElectronico)) = LOWER(?) 
                OR TRIM(u.DNI) = ? 
                OR LOWER(TRIM(u.CodigoUsuario)) = LOWER(?)
             LIMIT 1`,
            [termino, termino, termino]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Usuario, código o correo no encontrado.' });
        }

        const user = rows[0];

        // 3. VALIDACIÓN DE ESTADO
        if (user.EstadoRegistro !== 1) {
            return res.status(403).json({ error: 'La cuenta se encuentra inactiva o bloqueada.' });
        }

        // 4. ADAPTABILIDAD DE CONTRASEÑA: Valida tanto Hashes de Bcrypt como texto plano heredado
        let claveValida = false;
        const claveEnBD = String(user.Clave);

        if (claveEnBD.startsWith('$2a$') || claveEnBD.startsWith('$2b$') || claveEnBD.startsWith('$2y$')) {
            claveValida = await bcrypt.compare(clave, claveEnBD);
        } else {
            claveValida = (clave === claveEnBD);
        }

        if (!claveValida) {
            return res.status(401).json({ error: 'Contraseña incorrecta.' });
        }

        // 5. FIRMA DE TOKEN MULTI-TENANT
        const token = jwt.sign(
            {
                id: user.IdUsuario,
                idUsuario: user.IdUsuario,
                rol: user.rol,
                idPerfil: user.IdPerfil,
                idAcademia: user.IdAcademia
            },
            process.env.JWT_SECRET || 'super_secreto_seguro_acadesys_2026',
            { expiresIn: '8h' }
        );

        // 6. ADAPTABILIDAD DE RESPUESTA: Entrega los datos en formato plano y en objetos anidados
        return res.status(200).json({
            mensaje: 'Autenticación exitosa',
            token,
            idUsuario: user.IdUsuario,
            usuario: user.nombreCompleto || user.Nombres,
            nombre: user.nombreCompleto || user.Nombres,
            correo: user.CorreoElectronico,
            codigoUsuario: user.CodigoUsuario,
            idAcademia: user.IdAcademia,
            rol: user.rol,
            idPerfil: user.IdPerfil,
            academia: {
                nombre: user.NombreAcademia || 'AcadeSys SaaS',
                colorTema: user.ColorTema || '#4f46e5',
                logoUrl: user.LogoUrl || ''
            },
            user: {
                id: user.IdUsuario,
                nombre: user.nombreCompleto,
                correo: user.CorreoElectronico,
                rol: user.rol,
                idAcademia: user.IdAcademia
            }
        });

    } catch (error) {
        console.error('Error en autenticación:', error);
        return res.status(500).json({ error: 'Error interno en el servidor de autenticación.' });
    }
};

// 7. MULTI-RUTA: Atiende ambas rutas simultáneamente para evitar desincronizaciones con el Frontend
router.post('/login', loginHandler);
router.post('/auth/login', loginHandler);

module.exports = router;