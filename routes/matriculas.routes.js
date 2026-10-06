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

/* ============================================================
   PASO A: Verificación previa del alumno por correo
   POST /api/matriculas/verificar
   ============================================================ */
router.post('/verificar', async (req, res) => {
  const { correo } = req.body || {};

  if (!correo) {
    return res.status(400).json({ error: 'Correo obligatorio.' });
  }

  const correoFinal = String(correo).trim().toLowerCase();

  try {
    // 1. ¿Existe el usuario?
    const [usuarios] = await pool.query(
      `SELECT IdUsuario, Nombres, ApellidoPaterno
       FROM Usuario
       WHERE LOWER(CorreoElectronico) = ?
       LIMIT 1`,
      [correoFinal]
    );

    if (usuarios.length === 0) {
      // Alumno nuevo -> Yan puede continuar normal
      return res.status(200).json({ existe: false });
    }

    const alumno = usuarios[0];

    // 2. ¿En qué ciclos está matriculado actualmente?
    const [ciclosActuales] = await pool.query(
      `SELECT c.IdCiclo, c.Nombre
       FROM Matricula m
       INNER JOIN Ciclo c ON m.IdCiclo = c.IdCiclo
       WHERE m.IdUsuario = ?
         AND m.EstadoRegistro = 1
         AND c.EstadoRegistro = 1`,
      [alumno.IdUsuario]
    );

    const ciclosInscritos = ciclosActuales.map((c) => c.Nombre);
    const idsCiclosInscritos = ciclosActuales.map((c) => c.IdCiclo);

    // Yan dispara el SweetAlert2 con esta data
    return res.status(200).json({
      existe: true,
      idUsuario: alumno.IdUsuario,
      mensaje: `Hola ${alumno.Nombres}, ya estás registrado en el sistema.`,
      ciclosInscritos,
      idsCiclosInscritos
    });
  } catch (error) {
    console.error('Error verificando correo:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

/* ============================================================
   PASO B: Checkout con soporte de reinscripción
   POST /api/matriculas/checkout
   ============================================================ */
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

    /* ---------- 1. Validar ciclo y capacidad ---------- */
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

    /* ---------- 2. ¿Existe el alumno? ---------- */
    const [existentes] = await connection.query(
      `SELECT IdUsuario, CodigoUsuario
       FROM Usuario
       WHERE LOWER(CorreoElectronico) = ?
       LIMIT 1`,
      [correoFinal]
    );

    let idAlumnoFinal;
    let codigoUsuarioFinal;
    let esReinscripcion = false;
    let claveSinEncriptar = null;

    if (existentes.length > 0) {
      /* =====================================================
         ✅ REINSCRIPCIÓN
         ===================================================== */
      idAlumnoFinal = existentes[0].IdUsuario;
      codigoUsuarioFinal = existentes[0].CodigoUsuario;
      esReinscripcion = true;

      // Verificamos que no se matricule al MISMO ciclo otra vez
      const [yaMatriculado] = await connection.query(
        `SELECT IdMatricula
         FROM Matricula
         WHERE IdUsuario = ?
           AND IdCiclo = ?
           AND EstadoRegistro = 1
         LIMIT 1`,
        [idAlumnoFinal, idCicloFinal]
      );

      if (yaMatriculado.length > 0) {
        await connection.rollback();
        return res.status(409).json({
          error: 'Ya te encuentras matriculado en este ciclo específico.'
        });
      }

      // Actualizamos sus datos por si los cambió (opcional pero recomendado)
      await connection.query(
        `UPDATE Usuario
         SET Nombres = ?, ApellidoPaterno = ?
         WHERE IdUsuario = ?`,
        [nombreFinal, apellidosFinal, idAlumnoFinal]
      );
    } else {
      /* =====================================================
         ✅ ALUMNO NUEVO
         ===================================================== */
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

      // Generar código único
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

      claveSinEncriptar = generarClaveTemporal();
      const claveHasheada = await bcrypt.hash(claveSinEncriptar, 10);

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

      idAlumnoFinal = insertUser.insertId;
      codigoUsuarioFinal = codigoUsuario;

      await connection.query(
        `INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro)
         VALUES (?, ?, 1)`,
        [idAlumnoFinal, perfilesAlumno[0].IdPerfil]
      );
    }

    /* ---------- 3. Insertar matrícula + pago ---------- */
    const [insertMatricula] = await connection.query(
      `INSERT INTO Matricula (IdUsuario, IdCiclo, EstadoRegistro)
       VALUES (?, ?, 1)`,
      [idAlumnoFinal, idCicloFinal]
    );

    await connection.query(
      `INSERT INTO PagosMensualidad
        (IdUsuario, IdCiclo, Mes, Monto, Estado, FechaPago, EstadoRegistro)
       VALUES (?, ?, 'Inscripcion', 1.00, 'Pagado', NOW(), 1)`,
      [idAlumnoFinal, idCicloFinal]
    );

    /* ---------- 4. Conteo final ---------- */
    const [nuevoConteo] = await connection.query(
      `SELECT COUNT(*) AS TotalAlumnos
       FROM Matricula
       WHERE IdCiclo = ? AND EstadoRegistro = 1`,
      [idCicloFinal]
    );

    await connection.commit();

    const totalAlumnos = Number(nuevoConteo[0]?.TotalAlumnos || 0);

    /* ---------- 5. Respuesta ---------- */
    res.status(201).json({
      exito: true,
      esReinscripcion,
      idUsuario: idAlumnoFinal,
      idMatricula: insertMatricula.insertId,
      codigoUsuario: codigoUsuarioFinal,
      correo: correoFinal,
      idCiclo: idCicloFinal,
      ciclo: ciclo.Nombre,
      totalAlumnos,
      mensaje: esReinscripcion
        ? 'Reinscripción procesada correctamente.'
        : 'Inscripción procesada correctamente. Las credenciales se enviarán al correo registrado.'
    });

    /* ---------- 6. Correo (solo a nuevos / o ambos según quieras) ---------- */
    const asuntoCorreo = esReinscripcion
      ? `¡Reinscripción Exitosa al ${ciclo.Nombre}!`
      : '¡Inscripción Exitosa! Tus accesos a la Intranet AcadeSys';

    const cuerpoHtml = esReinscripcion
      ? `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px; max-width: 600px;">
        <h2 style="color: #2563eb;">¡Hola de nuevo, ${nombreFinal}!</h2>
        <p>Tu <strong>reinscripción al ${ciclo.Nombre}</strong> fue procesada correctamente.</p>
        <p>Puedes ingresar a la intranet con tu usuario habitual:</p>
        <p><strong>Usuario / código:</strong> <span style="font-family: monospace;">${codigoUsuarioFinal}</span></p>
      </div>`
      : `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px; max-width: 600px;">
        <h2 style="color: #2563eb;">¡Bienvenido a AcadeSys, ${nombreFinal}!</h2>
        <p>Tu inscripción al <strong>${ciclo.Nombre}</strong> fue procesada correctamente.</p>
        <p><strong>Usuario / código:</strong> <span style="font-family: monospace;">${codigoUsuarioFinal}</span></p>
        <p><strong>Contraseña temporal:</strong> <span style="font-family: monospace;">${claveSinEncriptar}</span></p>
        <p>Ingresa a la plataforma y luego cambia tu contraseña.</p>
      </div>`;

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
            console.log('✅ Correo enviado a:', correoFinal);
          } else {
            console.warn('⚠️ El servicio de correo respondió sin éxito:', data);
          }
        })
        .catch((err) => {
          console.error('❌ Error enviando correo:', err.message);
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