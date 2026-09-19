// routes/actas.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verificarToken = require('../middlewares/auth.middleware');
const verificarAdmin = require('../middlewares/admin.middleware');

router.use(verificarToken);

// PUT: Cierre masivo de actas (Protegido estrictamente para Admin)
router.put('/actas/cierre', verificarAdmin, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const idAdmin = req.usuario.id;

        // 1. Bloqueo Masivo: Pasamos todas las notas de 1 (Activo) a 2 (Bloqueado)
        const [result] = await connection.query(
            "UPDATE Evaluacion SET EstadoRegistro = 2 WHERE EstadoRegistro = 1"
        );

        // 2. Insertamos la evidencia en la tabla de Auditoria
        await connection.query(
            "INSERT INTO Auditoria_Cierres (IdAdministrador, FechaCierre, RegistrosAfectados) VALUES (?, NOW(), ?)",
            [idAdmin, result.affectedRows]
        );

        await connection.commit();
        res.json({ 
            message: 'Actas cerradas oficial y legalmente.', 
            notasBloqueadas: result.affectedRows 
        });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

module.exports = router;