const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, 
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    family: 4, // <-- LA MAGIA: Fuerza la red IPv4 para evitar el bloqueo de Render
    connectionTimeout: 10000 
});

function generarClaveTemporal() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

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
            `INSERT INTO Usuario (CodigoUsuario, Nombres, ApellidoPaterno, CorreoElectronico, Clave, EstadoRegistro, IdAcademia) VALUES (?, ?, ?, ?, ?, 1, ?)`,
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
            `INSERT INTO PagosMensualidad (IdUsuario, IdCiclo, Mes, Monto, Estado, FechaPago, EstadoRegistro) VALUES (?, ?, 'Inscripcion', 1.00, 'Pagado', NOW(), 1)`,
            [idNuevoAlumno, IdCiclo]
        );

        await connection.commit();

        res.status(201).json({ 
            exito: true,
            mensaje: 'Pago e inscripción procesados con éxito. Las credenciales llegarán a tu correo en breve.' 
        });

        const mailOptions = {
            from: `"Admisión AcadeSys" <${process.env.EMAIL_USER}>`,
            to: Correo,
            subject: '¡Inscripción Exitosa! Tus accesos a la Intranet',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #4f46e5;">¡Bienvenido a AcadeSys, ${Nombres}!</h2>
                    <p>Hemos procesado tu pago correctamente y tu matrícula ya está oficializada.</p>
                    <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px;">
                        <p><strong>Código de Usuario:</strong> ${codigoUsuario}</p>
                        <p><strong>Contraseña:</strong> ${claveSinEncriptar}</p>
                    </div>
                </div>
            `
        };

        transporter.sendMail(mailOptions)
            .then(info => console.log('Correo enviado con éxito:', info.response))
            .catch(err => console.error('Error enviando correo SMTP:', err));

    } catch (error) {
        await connection.rollback();
        console.error('Error en Checkout:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Hubo un problema procesando tu inscripción.' });
        }
    } finally {
        connection.release();
    }
});

module.exports = router;