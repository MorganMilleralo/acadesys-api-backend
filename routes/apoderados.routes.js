// routes/apoderados.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verificarToken = require('../middlewares/auth.middleware');

// Todo debe estar protegido por el token
router.use(verificarToken);

// GET: Obtener los estudiantes vinculados al apoderado logueado
router.get('/apoderados/estudiantes', async (req, res) => {
    try {
        const idApoderado = req.usuario.id; // Extraemos el ID del token[cite: 7]

        // Consulta SQL con INNER JOIN a la nueva tabla intermedia Apoderado_Estudiante
        const query = `
            SELECT 
                u.IdUsuario AS IdEstudiante,
                u.DNI,
                CONCAT(u.Nombres, ' ', u.ApellidoPaterno, ' ', u.ApellidoMaterno) AS NombreCompleto,
                u.CorreoElectronico
            FROM Usuario u
            INNER JOIN Apoderado_Estudiante ae ON u.IdUsuario = ae.IdEstudiante
            WHERE ae.IdApoderado = ? AND u.EstadoRegistro = 1
        `;

        const [estudiantes] = await pool.query(query, [idApoderado]);

        res.json(estudiantes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;