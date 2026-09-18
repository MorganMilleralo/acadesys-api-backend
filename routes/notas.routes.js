const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verificarToken = require('../middlewares/auth.middleware');
const verificarDocente = require('../middlewares/docente.middleware'); // <-- Tu nuevo filtro

// 1. Middleware global: Todo aquel que entre a /api/notas debe tener un token válido
router.use(verificarToken);

// GET: Obtener notas (Preparatorio, puedes ajustarlo cuando Toris pase el SQL)
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM Evaluacion WHERE EstadoRegistro = 1");
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST: Registrar un arreglo de notas (SOLO DOCENTES)
// Fíjate que inyectamos verificarDocente justo antes de la función
router.post('/', verificarDocente, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { notas } = req.body; // El frontend (Luis/Dante) te enviará un array de objetos
        const idUsuario = req.usuario.id; // Capturamos quién es el docente logueado

        // Iteramos el arreglo e insertamos nota por nota dentro de la misma transacción
        for (const nota of notas) {
            const { IdMatricula, Calificacion, TipoEvaluacion } = nota;
            await connection.query(
                "INSERT INTO Evaluacion (IdMatricula, Calificacion, TipoEvaluacion, UsuarioCreacion, FechaCreacion, EstadoRegistro) VALUES (?, ?, ?, ?, NOW(), 1)",
                [IdMatricula, Calificacion, TipoEvaluacion, idUsuario]
            );
        }

        await connection.commit();
        res.status(201).json({ message: 'Calificaciones registradas con éxito en bloque' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

// PUT: Modificar una nota específica (SOLO DOCENTES)
router.put('/:id', verificarDocente, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const { Calificacion } = req.body;
        const idUsuario = req.usuario.id;

        // Actualizamos la nota y usamos la función NOW() de MySQL para la auditoría
        await connection.query(
            "UPDATE Evaluacion SET Calificacion = ?, UsuarioModificacion = ?, FechaModificacion = NOW() WHERE IdEvaluacion = ?",
            [Calificacion, idUsuario, id]
        );

        await connection.commit();
        res.json({ message: 'Calificación actualizada con éxito' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

module.exports = router;