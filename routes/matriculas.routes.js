const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcrypt');

router.post('/matriculas', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Recibimos los datos sin exigir correo obligatorio
        const { Nombres, ApellidoPaterno, ApellidoMaterno, Clave, IdAcademia, prefijoCiclo, IdPerfil } = req.body;

        // 1. Lógica autogeneradora del código SaaS
        const hash = Math.random().toString(36).substring(2, 8).toUpperCase();
        const codigoUsuario = `${prefijoCiclo}-${hash}`; // Ej: SEM-A4F9X1

        // 2. Encriptar la contraseña
        const claveHasheada = await bcrypt.hash(Clave, 10);

        // 3. Insertar el Usuario con su Código y aislarlo por IdAcademia
        const [result] = await connection.query(
            "INSERT INTO Usuario (CodigoUsuario, IdAcademia, Nombres, ApellidoPaterno, ApellidoMaterno, Clave, FechaCreacion, EstadoRegistro) VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)",
            [codigoUsuario, IdAcademia, Nombres, ApellidoPaterno, ApellidoMaterno, claveHasheada]
        );

        const idGenerado = result.insertId;

        // 4. Asignarle el perfil en la tabla intermedia (Si no envían IdPerfil, asume 4 = Alumno)
        const perfilAsignado = IdPerfil ? IdPerfil : 4; 
        await connection.query(
            "INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, 1)",
            [idGenerado, perfilAsignado]
        );

        await connection.commit();
        
        // Devolvemos el "Ticket" para que Dante y Luis lo pinten en pantalla
        res.status(201).json({
            mensaje: "Matrícula SaaS exitosa",
            ticketAcceso: {
                codigoUsuario: codigoUsuario,
                claveTemporal: Clave
            }
        });

    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

module.exports = router;