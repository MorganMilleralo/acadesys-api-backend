const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// POST: Crear un nuevo Usuario con su Perfil asignado
router.post('/usuarios', async (req, res) => {
    
    // 1. TU TAREA: Capturar la fecha de creación automáticamente desde Node.js
    const fechaActual = new Date();
    // Lo convertimos al formato que le gusta a MySQL: YYYY-MM-DD HH:mm:ss
    const fechaCreacion = fechaActual.toISOString().slice(0, 19).replace('T', ' '); 

    // 2. Extraemos los datos que enviará el Integrador Frontend (Dante/Luis)
    const { Nombres, Apellidos, Correo, Clave, IdPerfil } = req.body;

    try {
        // -------------------------------------------------------------
        // AQUÍ INYECTAREMOS LA TRANSACCIÓN SQL QUE DISEÑE TORIS
        // -------------------------------------------------------------

        res.json({ message: 'Estructura base lista. Esperando lógica de Toris.' });
        
    } catch (error) {
        // Si Toris programa el ROLLBACK y falla, Node.js lo atrapará aquí
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;