const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET /api/ciclos/publicos - Ruta abierta (SIN TOKEN) para la Landing Page
router.get('/publicos', async (req, res) => {
    try {
        const [ciclos] = await pool.query(`
            SELECT 
                c.IdCiclo, 
                c.Nombre, 
                c.PrefijoCodigo,
                c.Turno, 
                c.Horario,
                c.FechaInicio,
                c.FechaFin,
                (SELECT COUNT(*) FROM Matricula m WHERE m.IdCiclo = c.IdCiclo AND m.EstadoRegistro = 1) AS TotalAlumnos
            FROM Ciclo c
            WHERE c.EstadoRegistro = 1
        `);
        
        res.status(200).json(ciclos);
    } catch (error) {
        console.error('Error al cargar la vitrina de ciclos:', error);
        res.status(500).json({ error: 'Error interno del servidor al cargar los ciclos.' });
    }
});

module.exports = router;