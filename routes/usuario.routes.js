const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcrypt'); // <-- Agregado para encriptar

// 1. POST: Crear un nuevo Usuario con su Perfil asignado
router.post('/usuarios', async (req, res) => {
    const fechaActual = new Date();
    const fechaCreacion = fechaActual.toISOString().slice(0, 19).replace('T', ' '); 

    const { 
        DNI, Nombres, ApellidoPaterno, ApellidoMaterno, 
        Celular, CorreoElectronico, Clave, 
        UsuarioCreacion, EstadoRegistro, IdPerfil 
    } = req.body;

    const estadoFinal = EstadoRegistro ?? 1;
    
    // Encriptamos la clave ANTES de abrir la conexión a la BD
    const claveHasheada = await bcrypt.hash(Clave, 10);
    
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [resultUsuario] = await connection.query(
            "INSERT INTO Usuario (DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, UsuarioCreacion, FechaCreacion, EstadoRegistro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, claveHasheada, UsuarioCreacion, fechaCreacion, estadoFinal]
        );

        const idGenerado = resultUsuario.insertId;

        await connection.query(
            "INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, ?)",
            [idGenerado, IdPerfil, estadoFinal]
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

// 2. LISTAR USUARIOS (GET)
router.get('/usuarios', async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM Usuario WHERE EstadoRegistro IN (0, 1)");
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. MODIFICAR USUARIO (PUT)
router.put('/usuarios/:id', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const { DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, EstadoRegistro, IdPerfil } = req.body;
        
        let queryUsuario = "UPDATE Usuario SET DNI=?, Nombres=?, ApellidoPaterno=?, ApellidoMaterno=?, Celular=?, CorreoElectronico=?";
        let paramsUsuario = [DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico];

        // Si envían una nueva clave, la encriptamos antes de guardarla
        if (Clave) {
            const claveHasheada = await bcrypt.hash(Clave, 10);
            queryUsuario += ", Clave=?";
            paramsUsuario.push(claveHasheada);
        }
        if (EstadoRegistro !== undefined) {
            queryUsuario += ", EstadoRegistro=?";
            paramsUsuario.push(EstadoRegistro);
        }
        queryUsuario += " WHERE IdUsuario=?";
        paramsUsuario.push(id);

        await connection.query(queryUsuario, paramsUsuario);

        if (IdPerfil) {
            await connection.query(
                "UPDATE Usuario_Perfiles SET IdPerfil=? WHERE IdUsuario=?",
                [IdPerfil, id]
            );
        }

        await connection.commit();
        res.json({ message: 'Usuario actualizado con éxito en todas las tablas' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

// 4. ELIMINACIÓN LÓGICA (DELETE)
router.delete('/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query(
            "UPDATE Usuario SET EstadoRegistro = -1 WHERE IdUsuario = ?",
            [id]
        );
        res.json({ message: 'Usuario eliminado lógicamente con estado -1' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;