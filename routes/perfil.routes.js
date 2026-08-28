const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 1. LISTAR PERFILES (GET)
router.get('/perfiles', async (req, res) => {
    try {
        // Cambiamos 'Activo' por 1
        const [rows] = await pool.query("SELECT * FROM perfil WHERE EstadoRegistro = 1");
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. INSERTAR PERFIL (POST)
router.post('/perfiles', async (req, res) => {
    try {
        // Agregamos EstadoRegistro para capturarlo del frontend
        const { NombrePerfil, Descripcion, EstadoRegistro } = req.body; 
        const [result] = await pool.query(
            // Reemplazamos el 1 por un ? al final
            "INSERT INTO perfil (Nombre, Descripcion, EstadoRegistro) VALUES (?, ?, ?)",
            [NombrePerfil, Descripcion, EstadoRegistro] // Lo inyectamos aquí
        );
        res.json({ message: 'Perfil creado con éxito', id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. MODIFICAR PERFIL (PUT)
router.put('/perfiles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { NombrePerfil, Descripcion } = req.body;
        await pool.query(
            "UPDATE perfil SET Nombre = ?, Descripcion = ? WHERE IdPerfil = ?",
            [NombrePerfil, Descripcion, id]
        );
        res.json({ message: 'Perfil actualizado con éxito' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. ELIMINACIÓN LÓGICA (DELETE)
router.delete('/perfiles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query(
            // Cambiamos 'Inactivo' por 0
            "UPDATE perfil SET EstadoRegistro = 0 WHERE IdPerfil = ?",
            [id]
        );
        res.json({ message: 'Perfil eliminado lógicamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;