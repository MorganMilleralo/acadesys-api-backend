const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verificarToken = require('../middlewares/auth.middleware');
const verificarDocente = require('../middlewares/docente.middleware'); // <-- Tu nuevo filtro
const verificarPeriodoAbierto = require('../middlewares/cierre.middleware'); // <-- Valida que el periodo esté abierto

// 1. Middleware global: Todo aquel que entre a /api/notas debe tener un token válido
router.use(verificarToken);

// ============================================================
// GET: Obtener notas (Preparatorio, puedes ajustarlo cuando Toris pase el SQL)
// ============================================================
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM Evaluacion WHERE EstadoRegistro = 1");
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// GET: Panel de rendimiento de un alumno específico (HU-02)
// NOTA: No le ponemos el verificarDocente porque el Alumno (o el Padre)
// debe poder entrar a esta ruta
// ============================================================
router.get('/alumno/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Consulta SQL con INNER JOIN y filtro EstadoRegistro = 1
        const query = `
            SELECT 
                c.Nombre AS Curso, 
                e.TipoEvaluacion, 
                e.Calificacion, 
                e.FechaCreacion
            FROM Evaluacion e
            INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
            INNER JOIN Curso c ON m.IdCurso = c.IdCurso
            INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
            WHERE u.IdUsuario = ? AND e.EstadoRegistro = 1
        `;

        const [notas] = await pool.query(query, [id]); // Ejecutamos el query de lectura

        // 2. Lógica matemática en Node.js para calcular el promedio
        let promedio = 0;

        if (notas.length > 0) {
            // Usamos .reduce() para sumar todas las calificaciones del arreglo
            const sumaCalificaciones = notas.reduce((acumulador, nota) => {
                return acumulador + Number(nota.Calificacion);
            }, 0);

            // Calculamos el promedio exacto
            promedio = sumaCalificaciones / notas.length;
        }

        // 3. Devolvemos el JSON estructurado al Frontend
        res.json({
            idAlumno: id,
            promedioGeneral: parseFloat(promedio.toFixed(2)), // Redondeado a 2 decimales
            totalCursosEvaluados: notas.length,
            historialNotas: notas
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// POST: Registrar un arreglo de notas (SOLO DOCENTES + PERIODO ABIERTO)
// Inyectamos verificarDocente y verificarPeriodoAbierto antes de la función
// ============================================================
router.post('/', verificarDocente, verificarPeriodoAbierto, async (req, res) => {
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

// ============================================================
// PUT: Modificar una nota específica (SOLO DOCENTES + PERIODO ABIERTO)
// ============================================================
router.put('/:id', verificarDocente, verificarPeriodoAbierto, async (req, res) => {
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