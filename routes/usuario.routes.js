const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// POST: Crear un nuevo Usuario con su Perfil asignado
router.post('/usuarios', async (req, res) => {
    
    // 1. Capturamos la fecha de creación automáticamente desde Node.js
    const fechaActual = new Date();
    const fechaCreacion = fechaActual.toISOString().slice(0, 19).replace('T', ' '); 

    // 2. Extraemos todos los datos dinámicos del frontend
    const { 
        DNI, Nombres, ApellidoPaterno, ApellidoMaterno, 
        Celular, CorreoElectronico, Clave, 
        UsuarioCreacion, EstadoRegistro, IdPerfil 
    } = req.body;

    // EL PARCHE DE LUIS: Usamos ?? para respetar el 0 (Inactivo)
    const estadoFinal = EstadoRegistro ?? 1;

    // 3. Pedimos una conexión exclusiva al pool para nuestra transacción
    const connection = await pool.getConnection();

    try {
        // INICIAMOS LA TRANSACCIÓN (START TRANSACTION)
        await connection.beginTransaction();

        // 4. Insertar en tabla Usuario 
        // (Usamos estadoFinal al final del array)
        const [resultUsuario] = await connection.query(
            "INSERT INTO Usuario (DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, UsuarioCreacion, FechaCreacion, EstadoRegistro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, UsuarioCreacion, fechaCreacion, estadoFinal]
        );

        // Capturamos el ID autogenerado
        const idGenerado = resultUsuario.insertId;

        // 5. Insertar en la tabla intermedia Usuario_Perfiles
        // (Usamos estadoFinal al final del array)
        await connection.query(
            "INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, ?)",
            [idGenerado, IdPerfil, estadoFinal]
        );

        // CONFIRMAR CAMBIOS (COMMIT)
        await connection.commit();
        res.json({ message: 'Usuario creado y perfil asignado con éxito', id: idGenerado });

    } catch (error) {
        // SI ALGO FALLA, DESHACEMOS TODO (ROLLBACK)
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        // SIEMPRE soltamos la conexión de vuelta al pool
        connection.release();
    }
});

// 2. LISTAR USUARIOS ACTIVOS (GET)
router.get('/usuarios', async (req, res) => {
    try {
        // Filtrando estrictamente con EstadoRegistro = 1
        const [rows] = await pool.query("SELECT * FROM Usuario WHERE EstadoRegistro = 1");
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. MODIFICAR USUARIO (PUT)
router.put('/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico } = req.body;
        
        await pool.query(
            "UPDATE Usuario SET DNI=?, Nombres=?, ApellidoPaterno=?, ApellidoMaterno=?, Celular=?, CorreoElectronico=? WHERE IdUsuario=?",
            [DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, id]
        );
        res.json({ message: 'Usuario actualizado con éxito' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. ELIMINACIÓN LÓGICA (DELETE)
router.delete('/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // El borrado debe ser un UPDATE EstadoRegistro = 0
        await pool.query(
            "UPDATE Usuario SET EstadoRegistro = 0 WHERE IdUsuario = ?",
            [id]
        );
        res.json({ message: 'Usuario eliminado lógicamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;