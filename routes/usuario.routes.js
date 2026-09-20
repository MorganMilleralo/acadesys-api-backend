const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcrypt'); 

// ==================================================
// 1. CREAR USUARIO CON PERFIL (POST /api/usuarios)
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

    // Encriptamos la clave ANTES de guardarla
    const claveHasheada = await bcrypt.hash(Clave, 10);

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Insertar en tabla Usuario
        const [resultUsuario] = await connection.query(
            `INSERT INTO Usuario 
             (DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, UsuarioCreacion, FechaCreacion, EstadoRegistro) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                DNI, Nombres, ApellidoPaterno, ApellidoMaterno || '', Celular || '', 
                CorreoElectronico, claveHasheada, UsuarioCreacion || 'sistema', fechaCreacion, estadoFinal
            ]
        );

        const idGenerado = resultUsuario.insertId;

        // Insertar en Usuario_Perfiles
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
// 2. LISTAR USUARIOS CON PERFILES (GET /api/usuarios)
// ==================================================
router.get('/usuarios', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                u.IdUsuario, u.DNI, u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno,
                CONCAT(u.Nombres, ' ', COALESCE(u.ApellidoPaterno, ''), ' ', COALESCE(u.ApellidoMaterno, '')) AS NombreCompleto,
                u.CorreoElectronico, u.CorreoElectronico AS Correo, u.Celular, u.Clave, u.EstadoRegistro,
                up.IdPerfil, p.NombrePerfil, p.NombrePerfil AS Perfil
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
// 3. MODIFICAR USUARIO (PUT /api/usuarios/:id)
// ==================================================
router.put('/usuarios/:id', async (req, res) => {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const {
            DNI, Nombres, ApellidoPaterno, ApellidoMaterno,
            Celular, CorreoElectronico, Clave, EstadoRegistro, IdPerfil
        } = req.body;

        let queryUpdate = "UPDATE Usuario SET DNI=?, Nombres=?, ApellidoPaterno=?, ApellidoMaterno=?, Celular=?, CorreoElectronico=?";
        const paramsUpdate = [DNI, Nombres, ApellidoPaterno, ApellidoMaterno || '', Celular || '', CorreoElectronico];

        if (Clave && String(Clave).trim() !== '') {
            const claveHasheada = await bcrypt.hash(String(Clave).trim(), 10);
            queryUpdate += ", Clave=?";
            paramsUpdate.push(claveHasheada);
        }

        if (EstadoRegistro !== undefined && EstadoRegistro !== null) {
            queryUpdate += ", EstadoRegistro=?";
            paramsUpdate.push(Number(EstadoRegistro));
        }

        queryUpdate += " WHERE IdUsuario=?";
        paramsUpdate.push(id);

        await connection.query(queryUpdate, paramsUpdate);

        if (IdPerfil) {
            const [existePerfil] = await connection.query("SELECT * FROM Usuario_Perfiles WHERE IdUsuario = ?", [id]);

            if (existePerfil.length > 0) {
                await connection.query("UPDATE Usuario_Perfiles SET IdPerfil = ?, EstadoRegistro = 1 WHERE IdUsuario = ?", [Number(IdPerfil), id]);
            } else {
                await connection.query("INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, 1)", [id, Number(IdPerfil)]);
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
// 4. ELIMINACIÓN LÓGICA (DELETE /api/usuarios/:id)
// ==================================================
router.delete('/usuarios/:id', async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const { id } = req.params;
        await connection.beginTransaction();

        await connection.query("UPDATE Usuario SET EstadoRegistro = -1 WHERE IdUsuario = ?", [id]);
        await connection.query("UPDATE Usuario_Perfiles SET EstadoRegistro = -1 WHERE IdUsuario = ?", [id]);

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