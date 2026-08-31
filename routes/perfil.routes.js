const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 1. LISTAR PERFILES (GET)
router.get('/perfiles', async (req, res) => {
    try {
        // ¡ELIMINAMOS EL WHERE! Ahora trae activos (1) e inactivos (0)
        const [rows] = await pool.query("SELECT * FROM perfil");
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// 2. INSERTAR PERFIL (POST)
router.post('/perfiles', async (req, res) => {
    try {
        const { NombrePerfil, Descripcion, EstadoRegistro } = req.body;
        
        // EL PARCHE DE LUIS: Usamos ?? para respetar el 0
        const estadoFinal = EstadoRegistro ?? 1;

        const [result] = await pool.query(
            "INSERT INTO perfil (Nombre, Descripcion, EstadoRegistro) VALUES (?, ?, ?)",
            [NombrePerfil, Descripcion, estadoFinal]
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