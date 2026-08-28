const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// POST: Crear un nuevo Usuario con su Perfil asignado
router.post('/usuarios', async (req, res) => {
    
    // 1. Capturamos la fecha de creación automáticamente desde Node.js
    const fechaActual = new Date();
    const fechaCreacion = fechaActual.toISOString().slice(0, 19).replace('T', ' '); 

    // 2. Extraemos todos los datos dinámicos del frontend (Luis/Dante)
    const { 
        DNI, Nombres, ApellidoPaterno, ApellidoMaterno, 
        Celular, CorreoElectronico, Clave, 
        UsuarioCreacion, EstadoRegistro, IdPerfil 
    } = req.body;

    // 3. Pedimos una conexión exclusiva al pool para nuestra transacción
    const connection = await pool.getConnection();

    try {
        // INICIAMOS LA TRANSACCIÓN (START TRANSACTION)
        await connection.beginTransaction();

        // 4. Insertar en tabla Usuario 
        // (Agregamos FechaCreacion y parametrizamos EstadoRegistro con '?')
        const [resultUsuario] = await connection.query(
            "INSERT INTO Usuario (DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, UsuarioCreacion, FechaCreacion, EstadoRegistro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, UsuarioCreacion, fechaCreacion, EstadoRegistro]
        );

        // Capturamos el ID autogenerado
        const idGenerado = resultUsuario.insertId;

        // 5. Insertar en la tabla intermedia Usuario_Perfiles
        // (Usamos el idGenerado y también parametrizamos el EstadoRegistro)
        await connection.query(
            "INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, ?)",
            [idGenerado, IdPerfil, EstadoRegistro]
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

module.exports = router;