const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 1. LISTAR PERFILES (GET)
router.get('/perfiles', async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM perfil WHERE EstadoRegistro = 'Activo'");
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. INSERTAR PERFIL (POST)
router.post('/perfiles', async (req, res) => {
    try {
        const { NombrePerfil, Descripcion } = req.body;
        const [result] = await pool.query(
            "INSERT INTO perfil (NombrePerfil, Descripcion, EstadoRegistro) VALUES (?, ?, 'Activo')",
            [NombrePerfil, Descripcion]
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
            "UPDATE perfil SET NombrePerfil = ?, Descripcion = ? WHERE IdPerfil = ?",
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
            "UPDATE perfil SET EstadoRegistro = 'Inactivo' WHERE IdPerfil = ?",
            [id]
        );
        res.json({ message: 'Perfil eliminado lógicamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;