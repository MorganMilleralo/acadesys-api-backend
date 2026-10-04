const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcrypt');

const URL_GOOGLE_SCRIPT =
  process.env.GOOGLE_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbwYym4iIz1mW0qjrmoVa6WI_qSY9Z3xdVx5hI8_k8tnZ7eKkSSiE7UKB6Zk0v3dw9SC/exec';

function generarClaveTemporal() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generarCodigo(prefix) {
  const base = String(prefix || 'ACAD').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const aleatorio = Math.floor(1000 + Math.random() * 9000);
  return `${base}-${aleatorio}`;
}

router.post('/checkout', async (req, res) => {
  const {
    Nombres,
    Apellidos,
    Correo,
    IdCiclo,
    PrefijoCiclo,
    nombres,
    apellidos,
    correo,
    idCiclo,
    prefijoCiclo
  } = req.body || {};

  const nombreFinal = String(Nombres || nombres || '').trim();
  const apellidosFinal = String(Apellidos || apellidos || '').trim();
  const correoFinal = String(Correo || correo || '').trim().toLowerCase();
  const idCicloFinal = Number(IdCiclo || idCiclo);
  let prefijoFinal = PrefijoCiclo || prefijoCiclo || '';

  if (!nombreFinal || !apellidosFinal || !correoFinal || !idCicloFinal) {
    return res.status(400).json({
      error: 'Faltan datos obligatorios para procesar la inscripción.'
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [ciclos] = await connection.query(
      `SELECT
        c.IdCiclo,
        c.Nombre,
        c.PrefijoCodigo,
        c.Capacidad,
        (
          SELECT COUNT(*)
          FROM Matricula m
          WHERE m.IdCiclo = c.IdCiclo
            AND m.EstadoRegistro = 1
        ) AS TotalAlumnos
      FROM Ciclo c
      WHERE c.IdCiclo = ?
        AND c.EstadoRegistro = 1
      FOR UPDATE`,
      [idCicloFinal]
    );

    if (ciclos.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'El ciclo seleccionado no existe o no está disponible.' });
    }

    const ciclo = ciclos[0];
    prefijoFinal = ciclo.PrefijoCodigo || prefijoFinal || 'ACAD';

    if (Number(ciclo.Capacidad || 0) > 0 && Number(ciclo.TotalAlumnos || 0) >= Number(ciclo.Capacidad)) {
      await connection.rollback();
      return res.status(409).json({
        error: 'El ciclo seleccionado ya alcanzó su capacidad máxima.'
      });
    }

    const [existentes] = await connection.query(
      `SELECT u.IdUsuario
       FROM Usuario u
       WHERE LOWER(u.CorreoElectronico) = ?
       LIMIT 1`,
      [correoFinal]
    );

    if (existentes.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        error: 'El correo ya está registrado. Ingresa con tu cuenta o utiliza otro correo.'
      });
    }

    const [perfilesAlumno] = await connection.query(`
      SELECT IdPerfil
      FROM perfil
      WHERE EstadoRegistro = 1
        AND LOWER(COALESCE(NULLIF(Nombre, ''), '')) = 'alumno'
      LIMIT 1
    `);

    if (perfilesAlumno.length === 0) {
      await connection.rollback();
      return res.status(500).json({
        error: 'No está configurado el perfil Alumno en la base de datos.'
      });
    }

    let codigoUsuario = '';
    for (let intento = 0; intento < 10; intento += 1) {
      const candidato = generarCodigo(prefijoFinal);
      const [existeCodigo] = await connection.query(
        'SELECT IdUsuario FROM Usuario WHERE CodigoUsuario = ? LIMIT 1',
        [candidato]
      );
      if (existeCodigo.length === 0) {
        codigoUsuario = candidato;
        break;
      }
    }

    if (!codigoUsuario) {
      await connection.rollback();
      return res.status(500).json({
        error: 'No se pudo generar un código de alumno disponible.'
      });
    }

    const claveSinEncriptar = generarClaveTemporal();
    const claveHasheada = await bcrypt.hash(claveSinEncriptar, 10);
    const nombreCompleto = `${nombreFinal} ${apellidosFinal}`.trim();

    const [insertUser] = await connection.query(
      `INSERT INTO Usuario
        (CodigoUsuario, DNI, Nombres, ApellidoPaterno, ApellidoMaterno,
         Celular, CorreoElectronico, Clave, FechaCreacion,
         EstadoRegistro, IdAcademia)
       VALUES (?, NULL, ?, ?, '', '', ?, ?, NOW(), 1, 1)`,
      [
        codigoUsuario,
        nombreFinal,
        apellidosFinal,
        correoFinal,
        claveHasheada
      ]
    );

    const idNuevoAlumno = insertUser.insertId;

    await connection.query(
      `INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro)
       VALUES (?, ?, 1)`,
      [idNuevoAlumno, perfilesAlumno[0].IdPerfil]
    );

    const [insertMatricula] = await connection.query(
      `INSERT INTO Matricula (IdUsuario, IdCiclo, EstadoRegistro)
       VALUES (?, ?, 1)`,
      [idNuevoAlumno, idCicloFinal]
    );

    await connection.query(
      `INSERT INTO PagosMensualidad
        (IdUsuario, IdCiclo, Mes, Monto, Estado, FechaPago, EstadoRegistro)
       VALUES (?, ?, 'Inscripcion', 1.00, 'Pagado', NOW(), 1)`,
      [idNuevoAlumno, idCicloFinal]
    );

    const [nuevoConteo] = await connection.query(
      `SELECT COUNT(*) AS TotalAlumnos
       FROM Matricula
       WHERE IdCiclo = ? AND EstadoRegistro = 1`,
      [idCicloFinal]
    );

    await connection.commit();

    const totalAlumnos = Number(nuevoConteo[0]?.TotalAlumnos || 0);

    res.status(201).json({
      exito: true,
      idUsuario: idNuevoAlumno,
      idMatricula: insertMatricula.insertId,
      codigoUsuario,
      correo: correoFinal,
      idCiclo: idCicloFinal,
      ciclo: ciclo.Nombre,
      totalAlumnos,
      mensaje: 'Inscripción procesada correctamente. Las credenciales se enviarán al correo registrado.'
    });

    const asuntoCorreo = '¡Inscripción Exitosa! Tus accesos a la Intranet AcadeSys';
    const cuerpoHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px; max-width: 600px;">
        <h2 style="color: #2563eb;">¡Bienvenido a AcadeSys, ${nombreFinal}!</h2>
        <p>Tu inscripción al <strong>${ciclo.Nombre}</strong> fue procesada correctamente.</p>
        <p><strong>Usuario / código:</strong> <span style="font-family: monospace;">${codigoUsuario}</span></p>
        <p><strong>Contraseña temporal:</strong> <span style="font-family: monospace;">${claveSinEncriptar}</span></p>
        <p>Ingresa a la plataforma y luego cambia tu contraseña.</p>
      </div>
    `;

    if (URL_GOOGLE_SCRIPT) {
      fetch(URL_GOOGLE_SCRIPT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: correoFinal,
          subject: asuntoCorreo,
          htmlBody: cuerpoHtml
        })
      })
        .then((response) => response.json())
        .then((data) => {
          if (data?.status === 'success') {
            console.log('✅ Correo de inscripción enviado a:', correoFinal);
          } else {
            console.warn('⚠️ El servicio de correo respondió sin éxito:', data);
          }
        })
        .catch((err) => {
          console.error('❌ Error enviando correo de bienvenida:', err.message);
        });
    }
  } catch (error) {
    await connection.rollback();
    console.error('Error en Checkout:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Hubo un problema procesando la inscripción: ' + error.message
      });
    }
  } finally {
    connection.release();
  }
});

module.exports = router;
