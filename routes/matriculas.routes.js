const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcrypt');

const URL_GOOGLE_SCRIPT = "https://script.google.com/macros/s/AKfycbwYym4iIz1mW0qjrmoVa6WI_qSY9Z3xdVx5hI8_k8tnZ7eKkSSiE7UKB6Zk0v3dw9SC/exec"; 

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

        const asuntoCorreo = '¡Inscripción Exitosa! Tus accesos a la Intranet AcadeSys';
        const cuerpoHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px; max-width: 600px;">
                <h2 style="color: #4f46e5;">¡Bienvenido a AcadeSys, ${Nombres}!</h2>
                <p>Hemos procesado tu pago correctamente y tu matrícula ya está oficializada.</p>
                <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Código de Usuario:</strong> <span style="font-family: monospace; font-size: 16px; color: #4f46e5;">${codigoUsuario}</span></p>
                    <p><strong>Contraseña:</strong> <span style="font-family: monospace; font-size: 16px; color: #4f46e5;">${claveSinEncriptar}</span></p>
                </div>
                <p>Ya puedes ingresar a la plataforma con estos accesos.</p>
            </div>
        `;

        // EL BYPASS MAESTRO: Enviar usando HTTP (Puerto 443) hacia tu script de Google
        fetch(URL_GOOGLE_SCRIPT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: Correo,
                subject: asuntoCorreo,
                htmlBody: cuerpoHtml
            })
        })
        .then(response => response.json())
        .then(data => {
            if(data.status === 'success') {
                console.log('✅ Correo enviado AUTOMÁTICAMENTE vía Google Web API a:', Correo);
            } else {
                throw new Error(data.message || 'Error desconocido en Apps Script');
            }
        })
        .catch(async (err) => {
            console.error('❌ Error en Google API. Guardando en BD...', err);
            try {
                const connRespaldo = await pool.getConnection();
                await connRespaldo.query(
                    `INSERT INTO CorreosPendientes (IdUsuario, Destinatario, Asunto, CuerpoHtml, CodigoUsuario, ClaveTemporal, Estado) VALUES (?, ?, ?, ?, ?, ?, 'Pendiente')`,
                    [idNuevoAlumno, Correo, asuntoCorreo, cuerpoHtml, codigoUsuario, claveSinEncriptar]
                );
                connRespaldo.release();
            } catch (dbErr) {
                console.error('Error guardando en BD:', dbErr);
            }
        });

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