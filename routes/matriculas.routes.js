const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

// Configuración global del transportador de correos
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Función auxiliar para generar clave de 6 caracteres alfanuméricos
function generarClaveTemporal() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// POST /api/matriculas/checkout - Flujo E-commerce (PÚBLICO)
router.post('/checkout', async (req, res) => {
    const { Nombres, Apellidos, Correo, IdCiclo, PrefijoCiclo } = req.body;
    
    if (!Nombres || !Apellidos || !Correo || !IdCiclo) {
        return res.status(400).json({ error: 'Faltan datos obligatorios para procesar el pago.' });
    }

    const idAcademia = 1; 
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const hashAleatorio = Math.floor(1000 + Math.random() * 9000);
        const codigoUsuario = `${PrefijoCiclo || 'ACAD'}-${hashAleatorio}`;
        const claveSinEncriptar = generarClaveTemporal();
        const claveHasheada = await bcrypt.hash(claveSinEncriptar, 10);

        const [insertUser] = await connection.query(
            `INSERT INTO Usuario 
            (CodigoUsuario, Nombres, ApellidoPaterno, CorreoElectronico, Clave, EstadoRegistro, IdAcademia) 
            VALUES (?, ?, ?, ?, ?, 1, ?)`,
            [codigoUsuario, Nombres, Apellidos, Correo, claveHasheada, idAcademia]
        );
        const idNuevoAlumno = insertUser.insertId;

        await connection.query(
            `INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, 4, 1)`,
            [idNuevoAlumno]
        );

        await connection.query(
            `INSERT INTO Matricula (IdUsuario, IdCiclo, EstadoRegistro) VALUES (?, ?, 1)`,
            [idNuevoAlumno, IdCiclo]
        );

        await connection.query(
            `INSERT INTO PagosMensualidad (IdUsuario, IdCiclo, Mes, Monto, Estado, FechaPago, EstadoRegistro) 
             VALUES (?, ?, 'Inscripcion', 1.00, 'Pagado', NOW(), 1)`,
            [idNuevoAlumno, IdCiclo]
        );

        const mailOptions = {
            from: `"Admisión AcadeSys" <${process.env.EMAIL_USER}>`,
            to: Correo,
            subject: '¡Inscripción Exitosa! Tus accesos a la Intranet',
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px; max-width: 600px;">
                    <h2 style="color: #4f46e5;">¡Bienvenido a AcadeSys, ${Nombres}!</h2>
                    <p>Hemos procesado tu pago correctamente y tu matrícula ya está oficializada.</p>
                    <p>A partir de este momento, puedes ingresar a tu Intranet para ver tus horarios, simulacros y material de estudio.</p>
                    <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <h3 style="margin-top: 0; color: #1e293b;">Tus Credenciales de Acceso:</h3>
                        <p><strong>Código de Usuario:</strong> <span style="font-family: monospace; font-size: 16px; color: #4f46e5;">${codigoUsuario}</span></p>
                        <p><strong>Contraseña:</strong> <span style="font-family: monospace; font-size: 16px; color: #4f46e5;">${claveSinEncriptar}</span></p>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        await connection.commit();

        res.status(201).json({ 
            exito: true,
            mensaje: 'Pago e inscripción procesados con éxito. Revisa tu bandeja de entrada.' 
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error crítico en Checkout:', error);
        res.status(500).json({ error: 'Hubo un problema procesando tu inscripción. El cargo no se ha realizado.' });
    } finally {
        connection.release();
    }
});

module.exports = router;