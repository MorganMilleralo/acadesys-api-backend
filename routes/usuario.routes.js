const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ==================================================
// 1. AUTENTICACIÓN (LOGIN) - POST /api/auth/login
// ==================================================
router.post('/auth/login', async (req, res) => {
    try {
        const { usuario, password } = req.body;

        if (!usuario || !password) {
            return res.status(400).json({ error: 'Usuario/correo y contraseña son obligatorios' });
        }

        const inputUsuario = String(usuario).trim().toLowerCase();
        const inputPass = String(password).trim();

        // Buscar por Correo o DNI coincidente (estado activo: 1)
        const [rows] = await pool.query(
            `SELECT u.IdUsuario, u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno, 
                    u.CorreoElectronico, u.DNI, u.Clave, u.EstadoRegistro,
                    p.IdPerfil, p.NombrePerfil
             FROM Usuario u
             LEFT JOIN Usuario_Perfiles up ON u.IdUsuario = up.IdUsuario AND up.EstadoRegistro = 1
             LEFT JOIN Perfil p ON up.IdPerfil = p.IdPerfil
             WHERE (LOWER(u.CorreoElectronico) = ? OR u.DNI = ?)
               AND u.EstadoRegistro = 1
             LIMIT 1`,
            [inputUsuario, inputUsuario]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo' });
        }

        const user = rows[0];

        // Comparación de contraseña
        if (user.Clave !== inputPass) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        const nombreCompleto = `${user.Nombres} ${user.ApellidoPaterno || ''}`.trim();

        res.json({
            message: 'Autenticación exitosa',
            idUsuario: user.IdUsuario,
            usuario: nombreCompleto,
            correo: user.CorreoElectronico,
            rol: user.NombrePerfil || 'Administrador',
            idPerfil: user.IdPerfil || 1,
            token: `jwt-simulated-${user.IdUsuario}-${Date.now()}`
        });

    } catch (error) {
        console.error('Error en /auth/login:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================================================
// 2. CREAR USUARIO CON PERFIL (POST /api/usuarios)
// ==================================================
router.post('/usuarios', async (req, res) => {
    const fechaActual = new Date();
    const fechaCreacion = fechaActual.toISOString().slice(0, 19).replace('T', ' '); 

    const { 
        DNI, Nombres, ApellidoPaterno, ApellidoMaterno, 
        Celular, CorreoElectronico, Clave, 
        UsuarioCreacion, EstadoRegistro, IdPerfil 
    } = req.body;

    const estadoFinal = EstadoRegistro ?? 1;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Insertar en tabla Usuario
        const [resultUsuario] = await connection.query(
            `INSERT INTO Usuario 
             (DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, UsuarioCreacion, FechaCreacion, EstadoRegistro) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                DNI, 
                Nombres, 
                ApellidoPaterno, 
                ApellidoMaterno || '', 
                Celular || '', 
                CorreoElectronico, 
                Clave, 
                UsuarioCreacion || 'sistema', 
                fechaCreacion, 
                estadoFinal
            ]
        );

        const idGenerado = resultUsuario.insertId;

        // 2. Insertar en Usuario_Perfiles si se especificó IdPerfil
        const perfilAsignar = IdPerfil || 1;
        await connection.query(
            "INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, ?)",
            [idGenerado, perfilAsignar, estadoFinal]
        );

        await connection.commit();
        res.json({ message: 'Usuario creado y perfil asignado con éxito', id: idGenerado });

    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

// ==================================================
// 3. LISTAR USUARIOS CON PERFILES (GET /api/usuarios)
// ==================================================
router.get('/usuarios', async (req, res) => {
    try {
        // Obtenemos los datos del usuario junto con su perfil asociado
        const [rows] = await pool.query(`
            SELECT 
                u.IdUsuario,
                u.DNI,
                u.Nombres,
                u.ApellidoPaterno,
                u.ApellidoMaterno,
                CONCAT(u.Nombres, ' ', COALESCE(u.ApellidoPaterno, ''), ' ', COALESCE(u.ApellidoMaterno, '')) AS NombreCompleto,
                u.CorreoElectronico,
                u.CorreoElectronico AS Correo,
                u.Celular,
                u.Clave,
                u.EstadoRegistro,
                up.IdPerfil,
                p.NombrePerfil,
                p.NombrePerfil AS Perfil
            FROM Usuario u
            LEFT JOIN Usuario_Perfiles up ON u.IdUsuario = up.IdUsuario AND up.EstadoRegistro = 1
            LEFT JOIN Perfil p ON up.IdPerfil = p.IdPerfil
            WHERE u.EstadoRegistro IN (0, 1)
            ORDER BY u.IdUsuario DESC
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================================================
// 4. MODIFICAR USUARIO (PUT /api/usuarios/:id)
// ==================================================
router.put('/usuarios/:id', async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const { id } = req.params;
        const { 
            DNI, 
            Nombres, 
            ApellidoPaterno, 
            ApellidoMaterno, 
            Celular, 
            CorreoElectronico, 
            Clave,
            EstadoRegistro,
            IdPerfil 
        } = req.body;

        await connection.beginTransaction();

        // 1. Construir query dinámica para actualizar datos personales y opcionalmente Clave / EstadoRegistro
        let queryUpdate = "UPDATE Usuario SET DNI=?, Nombres=?, ApellidoPaterno=?, ApellidoMaterno=?, Celular=?, CorreoElectronico=?";
        const paramsUpdate = [DNI, Nombres, ApellidoPaterno, ApellidoMaterno || '', Celular || '', CorreoElectronico];

        if (Clave && String(Clave).trim() !== '') {
            queryUpdate += ", Clave=?";
            paramsUpdate.push(String(Clave).trim());
        }

        if (EstadoRegistro !== undefined && EstadoRegistro !== null) {
            queryUpdate += ", EstadoRegistro=?";
            paramsUpdate.push(Number(EstadoRegistro));
        }

        queryUpdate += " WHERE IdUsuario=?";
        paramsUpdate.push(id);

        await connection.query(queryUpdate, paramsUpdate);

        // 2. Si se envía IdPerfil, actualizar el perfil en Usuario_Perfiles
        if (IdPerfil) {
            // Verificar si ya existe registro en la tabla intermedia
            const [existePerfil] = await connection.query(
                "SELECT * FROM Usuario_Perfiles WHERE IdUsuario = ?",
                [id]
            );

            if (existePerfil.length > 0) {
                await connection.query(
                    "UPDATE Usuario_Perfiles SET IdPerfil = ?, EstadoRegistro = 1 WHERE IdUsuario = ?",
                    [Number(IdPerfil), id]
                );
            } else {
                await connection.query(
                    "INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, 1)",
                    [id, Number(IdPerfil)]
                );
            }
        }

        await connection.commit();
        res.json({ message: 'Usuario y perfil actualizados con éxito' });

    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

// ==================================================
// 5. ELIMINACIÓN LÓGICA (DELETE /api/usuarios/:id)
// ==================================================
router.delete('/usuarios/:id', async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const { id } = req.params;
        await connection.beginTransaction();

        // Desactivar usuario
        await connection.query(
            "UPDATE Usuario SET EstadoRegistro = -1 WHERE IdUsuario = ?",
            [id]
        );

        // Desactivar su asignación en perfiles
        await connection.query(
            "UPDATE Usuario_Perfiles SET EstadoRegistro = -1 WHERE IdUsuario = ?",
            [id]
        );

        await connection.commit();
        res.json({ message: 'Usuario eliminado lógicamente con éxito (-1)' });

    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

module.exports = router;