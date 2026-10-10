const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const URL_GOOGLE_SCRIPT =
  process.env.GOOGLE_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbwYym4iIz1mW0qjrmoVa6WI_qSY9Z3xdVx5hI8_k8tnZ7eKkSSiE7UKB6Zk0v3dw9SC/exec';
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || 'https://acadesys-api.onrender.com').replace(/\/+$/, '');
const PROPOSITO_RESET = 'reinscripcion-password-reset';

const UNIVERSIDADES = new Set(['UNMSM', 'UNI', 'PUCP', 'UNFV', 'UNAC', 'UNT', 'Preuniversitario']);

function normalizarCorreo(correo = '') {
  return String(correo).trim().toLowerCase();
}

function correoValido(correo = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
}

function textoNombreValido(texto = '') {
  const limpio = String(texto).trim().replace(/\s+/g, ' ');
  return limpio.length >= 2 && limpio.length <= 100 && /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü .'-]+$/.test(limpio);
}

function generarClaveTemporal() {
  // Contraseña temporal aleatoria con suficiente longitud para el acceso.
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

function huellaClave(claveHash) {
  // Permite invalidar el enlace después del primer cambio sin guardar el token.
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(String(claveHash || ''))
    .digest('hex');
}

async function enviarCorreoHtml(to, subject, htmlBody) {
  const response = await fetch(URL_GOOGLE_SCRIPT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, htmlBody }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.status !== 'success') {
    throw new Error(data?.message || 'El servicio de correo no confirmó el envío.');
  }
  return data;
}

function generarCodigo(prefix) {
  const base = String(prefix || 'ACAD')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 10) || 'ACAD';
  const aleatorio = Math.floor(1000 + Math.random() * 9000);
  return `${base}-${aleatorio}`;
}

function universidadDesdeNombre(nombre = '') {
  const n = String(nombre).toLowerCase();
  if (n.includes('san marcos') || n.includes('unmsm')) return 'UNMSM';
  if (/\buni\b/.test(n) || n.includes('ingenier')) return 'UNI';
  if (n.includes('pucp') || n.includes('católica') || n.includes('catolica')) return 'PUCP';
  if (n.includes('villarreal') || n.includes('unfv')) return 'UNFV';
  if (n.includes('callao') || n.includes('unac')) return 'UNAC';
  if (n.includes('trujillo') || n.includes('unt')) return 'UNT';
  return 'Preuniversitario';
}

function obtenerEstadoCicloValido(ciclo) {
  if (!ciclo) return 'NO_EXISTE';
  if (Number(ciclo.EstadoRegistro) !== 1) return 'CERRADO';

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  if (ciclo.FechaFin) {
    const fin = new Date(`${ciclo.FechaFin}T23:59:59`);
    if (fin < hoy) return 'FINALIZADO';
  }

  if (ciclo.FechaInicio) {
    const inicio = new Date(`${ciclo.FechaInicio}T00:00:00`);
    // Un ciclo futuro sigue siendo inscribible si está visible y no está lleno.
    if (inicio < new Date('2000-01-01T00:00:00')) return 'INVALIDO';
  }

  return 'ABIERTO';
}

async function obtenerCicloDisponible(idCiclo, connection = pool, bloquear = false) {
  const lock = bloquear ? ' FOR UPDATE' : '';
  const [rows] = await connection.query(`
    SELECT
      c.IdCiclo,
      c.IdAcademia,
      c.Nombre,
      c.PrefijoCodigo,
      c.UniversidadObjetivo,
      c.Turno,
      c.Horario,
      c.DiasClase,
      c.FechaInicio,
      c.FechaFin,
      c.Precio,
      c.Capacidad,
      c.EstadoRegistro,
      (
        SELECT COUNT(*)
        FROM Matricula m
        INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
        WHERE m.IdCiclo = c.IdCiclo
          AND m.EstadoRegistro = 1
          AND u.EstadoRegistro = 1
      ) AS TotalAlumnos
    FROM Ciclo c
    WHERE c.IdCiclo = ?
    LIMIT 1${lock}
  `, [idCiclo]);

  return rows[0] || null;
}

async function buscarAlumnoActivoPorCorreo(correo, idAcademia, connection = pool, bloquear = false) {
  const lock = bloquear ? ' FOR UPDATE' : '';
  const [rows] = await connection.query(`
    SELECT
      u.IdUsuario,
      u.CodigoUsuario,
      u.Nombres,
      u.ApellidoPaterno,
      u.ApellidoMaterno,
      u.CorreoElectronico,
      u.IdAcademia,
      u.EstadoRegistro,
      up.IdPerfil,
      p.Nombre AS NombrePerfil
    FROM Usuario u
    INNER JOIN Usuario_Perfiles up
      ON up.IdUsuario = u.IdUsuario
     AND up.EstadoRegistro = 1
    INNER JOIN perfil p
      ON p.IdPerfil = up.IdPerfil
     AND p.EstadoRegistro = 1
    WHERE LOWER(TRIM(u.CorreoElectronico)) = ?
      AND u.EstadoRegistro = 1
    ORDER BY CASE WHEN LOWER(TRIM(p.Nombre)) = 'alumno' THEN 0 ELSE 1 END
    LIMIT 1${lock}
  `, [correo, idAcademia]);

  if (rows.length === 0) return null;
  return rows[0];
}

/* ============================================================
   POST /api/matriculas/verificar
   Verifica identidad existente y ciclos actuales.
   ============================================================ */
router.post('/verificar', async (req, res) => {
  const correo = normalizarCorreo(req.body?.correo);
  const idCiclo = Number(req.body?.idCiclo);

  if (!correo || !correoValido(correo)) {
    return res.status(400).json({ error: 'Debes proporcionar un correo electrónico válido.' });
  }
  if (!Number.isInteger(idCiclo) || idCiclo <= 0) {
    return res.status(400).json({ error: 'Debes proporcionar un IdCiclo válido.' });
  }

  try {
    const ciclo = await obtenerCicloDisponible(idCiclo);
    if (!ciclo) return res.status(404).json({ error: 'El ciclo seleccionado no existe.' });

    const estadoCiclo = obtenerEstadoCicloValido(ciclo);
    if (estadoCiclo !== 'ABIERTO') {
      return res.status(409).json({
        existe: false,
        error: estadoCiclo === 'CERRADO'
          ? 'El ciclo seleccionado se encuentra cerrado o no está publicado.'
          : 'El ciclo seleccionado ya no admite nuevas inscripciones.',
      });
    }

    if (Number(ciclo.Capacidad || 0) > 0 && Number(ciclo.TotalAlumnos || 0) >= Number(ciclo.Capacidad)) {
      return res.status(409).json({ existe: false, error: 'El ciclo seleccionado ya alcanzó su capacidad máxima.' });
    }

    const alumno = await buscarAlumnoActivoPorCorreo(correo, ciclo.IdAcademia);

    if (!alumno) {
      return res.status(200).json({
        existe: false,
        esAlumno: false,
        idCiclo,
      });
    }

    const esAlumno = String(alumno.NombrePerfil || '').trim().toLowerCase() === 'alumno';

    if (!esAlumno) {
      return res.status(200).json({
        existe: true,
        esAlumno: false,
        idUsuario: alumno.IdUsuario,
        mensaje: 'El correo ya pertenece a una cuenta del sistema, pero no corresponde a un alumno.',
        puedeReinscribirse: false,
        idCiclo,
      });
    }

    const [ciclosActuales] = await pool.query(`
      SELECT
        c.IdCiclo,
        c.Nombre,
        c.Turno,
        c.FechaInicio,
        c.FechaFin,
        m.IdMatricula
      FROM Matricula m
      INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
      WHERE m.IdUsuario = ?
        AND m.EstadoRegistro = 1
        AND c.EstadoRegistro = 1
      ORDER BY c.FechaInicio DESC, c.IdCiclo DESC
    `, [alumno.IdUsuario]);

    const yaMatriculadoEnCiclo = ciclosActuales.some((c) => Number(c.IdCiclo) === idCiclo);

    res.status(200).json({
      existe: true,
      esAlumno: true,
      idUsuario: alumno.IdUsuario,
      codigoUsuario: alumno.CodigoUsuario,
      nombreCompleto: `${alumno.Nombres} ${alumno.ApellidoPaterno}`.trim(),
      mensaje: yaMatriculadoEnCiclo
        ? `Ya estás matriculado en ${ciclo.Nombre}.`
        : `Ya estás registrado en el sistema y actualmente tienes ${ciclosActuales.length} ciclo(s) activo(s).`,
      puedeReinscribirse: !yaMatriculadoEnCiclo,
      yaInscritoEnCiclo: yaMatriculadoEnCiclo,
      cicloSeleccionado: {
        idCiclo,
        nombre: ciclo.Nombre,
      },
      ciclos: ciclosActuales.map((c) => ({
        idCiclo: c.IdCiclo,
        nombre: c.Nombre,
        turno: c.Turno,
        fechaInicio: c.FechaInicio,
        fechaFin: c.FechaFin,
        idMatricula: c.IdMatricula,
      })),
    });
  } catch (error) {
    console.error('Error en POST /api/matriculas/verificar:', error);
    res.status(500).json({ error: 'No se pudo verificar el correo del alumno.' });
  }
});

/* ============================================================
   POST /api/matriculas/checkout
   Inscripción/reinscripción transaccional.
   ============================================================ */
router.post('/checkout', async (req, res) => {
  const nombre = String(req.body?.Nombres ?? req.body?.nombres ?? '').trim().replace(/\s+/g, ' ');
  const apellidos = String(req.body?.Apellidos ?? req.body?.apellidos ?? '').trim().replace(/\s+/g, ' ');
  const correo = normalizarCorreo(req.body?.Correo ?? req.body?.correo);
  const idCiclo = Number(req.body?.IdCiclo ?? req.body?.idCiclo);

  if (!textoNombreValido(nombre)) {
    return res.status(400).json({ error: 'Los nombres no tienen un formato válido.' });
  }
  if (!textoNombreValido(apellidos)) {
    return res.status(400).json({ error: 'Los apellidos no tienen un formato válido.' });
  }
  if (!correoValido(correo)) {
    return res.status(400).json({ error: 'El correo electrónico no tiene un formato válido.' });
  }
  if (!Number.isInteger(idCiclo) || idCiclo <= 0) {
    return res.status(400).json({ error: 'El IdCiclo no es válido.' });
  }

  const connection = await pool.getConnection();
  let correoParaEnviar = null;
  let datosCorreo = null;

  try {
    await connection.beginTransaction();

    /* 1. Bloqueamos el ciclo para impedir sobreventa/concurrencia. */
    const ciclo = await obtenerCicloDisponible(idCiclo, connection, true);

    if (!ciclo) {
      await connection.rollback();
      return res.status(404).json({ error: 'El ciclo seleccionado no existe.' });
    }

    const estadoCiclo = obtenerEstadoCicloValido(ciclo);
    if (estadoCiclo !== 'ABIERTO') {
      await connection.rollback();
      return res.status(409).json({
        error: estadoCiclo === 'CERRADO'
          ? 'El ciclo está cerrado y no admite nuevas matrículas.'
          : 'El ciclo ya no admite nuevas matrículas.',
      });
    }

    const totalAlumnos = Number(ciclo.TotalAlumnos || 0);
    const capacidad = Number(ciclo.Capacidad || 0);
    if (capacidad > 0 && totalAlumnos >= capacidad) {
      await connection.rollback();
      return res.status(409).json({ error: 'El ciclo seleccionado ya alcanzó su capacidad máxima.' });
    }

    /* 2. Precio real desde BD. Nunca confiar en monto enviado por frontend. */
    const precioReal = Number(ciclo.Precio || 0);
    const montoReportado = req.body?.monto ?? req.body?.Monto;
    if (montoReportado !== undefined && montoReportado !== null && montoReportado !== '') {
      const montoCliente = Number(montoReportado);
      if (!Number.isFinite(montoCliente) || montoCliente < 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'El monto enviado no es válido.' });
      }
    }

    /* 3. Si existe usuario, bloqueamos su fila antes de revisar duplicados. */
    const [usuarios] = await connection.query(`
      SELECT
        u.IdUsuario,
        u.CodigoUsuario,
        u.Nombres,
        u.ApellidoPaterno,
        u.Clave AS ClaveHash,
        u.CorreoElectronico,
        u.IdAcademia,
        u.EstadoRegistro,
        up.IdPerfil,
        p.Nombre AS NombrePerfil
      FROM Usuario u
      INNER JOIN Usuario_Perfiles up
        ON up.IdUsuario = u.IdUsuario
       AND up.EstadoRegistro = 1
      INNER JOIN perfil p
        ON p.IdPerfil = up.IdPerfil
       AND p.EstadoRegistro = 1
      WHERE LOWER(TRIM(u.CorreoElectronico)) = ?
        AND u.EstadoRegistro = 1
      ORDER BY CASE WHEN LOWER(TRIM(p.Nombre)) = 'alumno' THEN 0 ELSE 1 END
      LIMIT 1
      FOR UPDATE
    `, [correo]);

    let idAlumnoFinal = null;
    let codigoUsuarioFinal = null;
    let esReinscripcion = false;
    let claveSinEncriptar = null;
    let claveVersion = null;

    if (usuarios.length > 0) {
      const existente = usuarios[0];
      const esAlumno = String(existente.NombrePerfil || '').trim().toLowerCase() === 'alumno';

      if (!esAlumno) {
        await connection.rollback();
        return res.status(409).json({
          error: 'El correo ya pertenece a una cuenta que no tiene el perfil Alumno. No se puede reutilizar para una matrícula pública.',
        });
      }

      if (Number(existente.IdAcademia) !== Number(ciclo.IdAcademia)) {
        await connection.rollback();
        return res.status(409).json({
          error: 'El correo pertenece a otra academia y no puede reutilizarse en este ciclo.',
        });
      }

      idAlumnoFinal = existente.IdUsuario;
      codigoUsuarioFinal = existente.CodigoUsuario;
      esReinscripcion = true;
      // La clave actual se mantiene. El alumno podrá solicitar una temporal
      // nueva mediante un enlace verificado enviado a su correo.
      claveVersion = huellaClave(existente.ClaveHash);

      const [yaMatriculado] = await connection.query(`
        SELECT IdMatricula
        FROM Matricula
        WHERE IdUsuario = ?
          AND IdCiclo = ?
          AND EstadoRegistro = 1
        LIMIT 1
        FOR UPDATE
      `, [idAlumnoFinal, idCiclo]);

      if (yaMatriculado.length > 0) {
        await connection.rollback();
        return res.status(409).json({
          error: `Ya te encuentras matriculado en el ciclo "${ciclo.Nombre}".`,
          yaInscritoEnCiclo: true,
          idCiclo,
          idUsuario: idAlumnoFinal,
        });
      }

      await connection.query(`
        UPDATE Usuario
        SET Nombres = ?, ApellidoPaterno = ?
        WHERE IdUsuario = ?
          AND IdAcademia = ?
      `, [nombre, apellidos, idAlumnoFinal, ciclo.IdAcademia]);
    } else {
      /* 4. Alumno nuevo. */
      const [perfilesAlumno] = await connection.query(`
        SELECT IdPerfil
        FROM perfil
        WHERE EstadoRegistro = 1
          AND LOWER(TRIM(Nombre)) = 'alumno'
        LIMIT 1
      `);

      if (perfilesAlumno.length === 0) {
        await connection.rollback();
        return res.status(500).json({ error: 'No está configurado el perfil Alumno en la base de datos.' });
      }

      let codigoUsuario = '';
      for (let intento = 0; intento < 15; intento += 1) {
        const candidato = generarCodigo(ciclo.PrefijoCodigo || universidadDesdeNombre(ciclo.Nombre));
        const [codigoExistente] = await connection.query(
          'SELECT IdUsuario FROM Usuario WHERE CodigoUsuario = ? LIMIT 1',
          [candidato]
        );
        if (codigoExistente.length === 0) {
          codigoUsuario = candidato;
          break;
        }
      }

      if (!codigoUsuario) {
        await connection.rollback();
        return res.status(500).json({ error: 'No se pudo generar un código de alumno disponible.' });
      }

      claveSinEncriptar = generarClaveTemporal();
      const claveHasheada = await bcrypt.hash(claveSinEncriptar, 10);

      const [resultUsuario] = await connection.query(`
        INSERT INTO Usuario
          (CodigoUsuario, DNI, Nombres, ApellidoPaterno, ApellidoMaterno,
           Celular, CorreoElectronico, Clave, FechaCreacion,
           EstadoRegistro, IdAcademia)
        VALUES (?, NULL, ?, ?, '', '', ?, ?, NOW(), 1, ?)
      `, [
        codigoUsuario,
        nombre,
        apellidos,
        correo,
        claveHasheada,
        ciclo.IdAcademia,
      ]);

      idAlumnoFinal = resultUsuario.insertId;
      codigoUsuarioFinal = codigoUsuario;

      await connection.query(`
        INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro)
        VALUES (?, ?, 1)
      `, [idAlumnoFinal, perfilesAlumno[0].IdPerfil]);
    }

    /* 5. Matrícula nueva. El IdUsuario puede repetirse en distintos ciclos. */
    const [insertMatricula] = await connection.query(`
      INSERT INTO Matricula (IdUsuario, IdCiclo, EstadoRegistro)
      VALUES (?, ?, 1)
    `, [idAlumnoFinal, idCiclo]);

    /* 6. Pago real según Precio del ciclo. */
    await connection.query(`
      INSERT INTO PagosMensualidad
        (IdUsuario, IdCiclo, Mes, Monto, Estado, FechaPago, EstadoRegistro)
      VALUES (?, ?, 'Inscripcion', ?, 'Pagado', NOW(), 1)
    `, [idAlumnoFinal, idCiclo, precioReal]);

    const [nuevoConteo] = await connection.query(`
      SELECT COUNT(*) AS TotalAlumnos
      FROM Matricula m
      INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
      WHERE m.IdCiclo = ?
        AND m.EstadoRegistro = 1
        AND u.EstadoRegistro = 1
    `, [idCiclo]);

    await connection.commit();

    const totalFinal = Number(nuevoConteo[0]?.TotalAlumnos || 0);

    correoParaEnviar = correo;
    datosCorreo = {
      nombre,
      idUsuario: idAlumnoFinal,
      codigoUsuario: codigoUsuarioFinal,
      claveSinEncriptar,
      claveVersion,
      cicloNombre: ciclo.Nombre,
      precio: precioReal,
      esReinscripcion,
    };

    res.status(201).json({
      exito: true,
      esReinscripcion,
      idUsuario: idAlumnoFinal,
      idMatricula: insertMatricula.insertId,
      codigoUsuario: codigoUsuarioFinal,
      correo,
      idCiclo,
      ciclo: ciclo.Nombre,
      precio: precioReal,
      totalAlumnos: totalFinal,
      vacantesDisponibles: capacidad > 0 ? Math.max(capacidad - totalFinal, 0) : null,
      mensaje: esReinscripcion
        ? 'Reinscripción procesada correctamente usando la cuenta existente.'
        : 'Inscripción procesada correctamente. Se generó una cuenta de alumno.',
    });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    console.error('Error en POST /api/matriculas/checkout:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error: 'La operación generó un registro duplicado. Vuelve a consultar el estado de la matrícula antes de intentarlo nuevamente.',
      });
    }

    return res.status(500).json({ error: 'Hubo un problema procesando la inscripción.' });
  } finally {
    connection.release();

    /* El correo nunca provoca rollback de una matrícula ya confirmada. */
    if (correoParaEnviar && datosCorreo && URL_GOOGLE_SCRIPT) {
      const asunto = datosCorreo.esReinscripcion
        ? `Reinscripción exitosa - ${datosCorreo.cicloNombre}`
        : `Bienvenido a AcadeSys - ${datosCorreo.cicloNombre}`;

      let bloqueClave;
      if (datosCorreo.esReinscripcion) {
        const tokenRecuperacion = jwt.sign({
          idUsuario: datosCorreo.idUsuario,
          correo: correoParaEnviar,
          proposito: PROPOSITO_RESET,
          claveVersion: datosCorreo.claveVersion,
          codigoUsuario: datosCorreo.codigoUsuario,
        }, process.env.JWT_SECRET, { expiresIn: '15m' });
        const enlaceRecuperacion = `${API_PUBLIC_URL}/api/matriculas/restablecer-clave?token=${encodeURIComponent(tokenRecuperacion)}`;
        bloqueClave = `
          <p>Tu cuenta y código de usuario se conservaron. Para recibir una contraseña temporal nueva, confirma que tienes acceso a este correo.</p>
          <p style="margin:24px 0;"><a href="${enlaceRecuperacion}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;font-weight:bold;">Generar contraseña temporal</a></p>
          <p>Este enlace vence en 15 minutos y solo puede utilizarse una vez.</p>
        `;
      } else {
        bloqueClave = `<p><strong>Contraseña temporal:</strong> <span style="font-family: monospace;">${datosCorreo.claveSinEncriptar}</span></p><p>Guarda esta contraseña en un lugar seguro.</p>`;
      }

      const cuerpoHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px; max-width: 600px;">
          <h2 style="color: #2563eb;">¡Hola, ${datosCorreo.nombre}!</h2>
          <p>Tu ${datosCorreo.esReinscripcion ? 'reinscripción' : 'inscripción'} al <strong>${datosCorreo.cicloNombre}</strong> fue procesada correctamente.</p>
          <p><strong>Monto registrado:</strong> S/ ${Number(datosCorreo.precio || 0).toFixed(2)}</p>
          <p><strong>Código de usuario:</strong> <span style="font-family: monospace;">${datosCorreo.codigoUsuario}</span></p>
          ${bloqueClave}
          <p>Gracias por confiar en AcadeSys.</p>
        </div>`;

      fetch(URL_GOOGLE_SCRIPT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: correoParaEnviar,
          subject: asunto,
          htmlBody: cuerpoHtml,
        }),
      })
        .then((response) => response.json().catch(() => ({})))
        .then((data) => {
          if (data?.status === 'success') {
            console.log('✅ Correo de matrícula enviado a:', correoParaEnviar);
          } else {
            console.warn('⚠️ El servicio de correo no confirmó éxito para:', correoParaEnviar, data);
          }
        })
        .catch((err) => {
          console.error('❌ Error enviando correo post-matrícula:', err.message);
        });
    }
  }
});

/* ============================================================
   RESTABLECIMIENTO SEGURO DE CLAVE PARA REINSCRIPCIONES
   GET muestra confirmación; POST cambia la clave después del clic.
   El token queda invalidado al cambiar el hash de la contraseña.
   ============================================================ */
router.get('/restablecer-clave', (req, res) => {
  const token = String(req.query?.token || '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.proposito !== PROPOSITO_RESET || !payload.claveVersion) {
      return res.status(400).type('html').send('<h2>Enlace no válido</h2><p>Solicita un nuevo enlace desde tu reinscripción.</p>');
    }

    return res.type('html').send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recuperar acceso | AcadeSys</title>
<style>body{font-family:Arial,sans-serif;background:#0a192f;color:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}.card{max-width:480px;background:#11243d;border:1px solid #29415f;border-radius:16px;padding:28px;text-align:center}button{background:#2563eb;color:white;border:0;border-radius:9px;padding:13px 18px;font-weight:bold;cursor:pointer}button:disabled{opacity:.6}p{line-height:1.6;color:#cbd5e1}</style></head>
<body><main class="card"><h1>AcadeSys</h1><h2>Recuperar acceso</h2><p>Al continuar, generaremos una contraseña temporal nueva y la enviaremos al correo con el que te reinscribiste. Tu código de usuario y tus matrículas se conservarán.</p><button id="generar">Generar y enviar contraseña</button><p id="resultado" aria-live="polite"></p></main>
<script>
const token = ${JSON.stringify(token)};
const boton = document.getElementById('generar');
const resultado = document.getElementById('resultado');
boton.addEventListener('click', async () => {
  boton.disabled = true;
  resultado.textContent = 'Procesando solicitud...';
  try {
    const response = await fetch('/api/matriculas/restablecer-clave', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
    resultado.textContent = data.mensaje || 'Listo. Revisa tu correo electrónico.';
    boton.textContent = 'Solicitud completada';
  } catch (error) {
    resultado.textContent = error.message || 'Ocurrió un error.';
    boton.disabled = false;
  }
});
</script></body></html>`);
  } catch (_) {
    return res.status(400).type('html').send('<!doctype html><html lang="es"><meta charset="utf-8"><title>Enlace vencido</title><body style="font-family:Arial;padding:32px"><h2>El enlace venció o no es válido</h2><p>Vuelve a solicitar la recuperación desde tu correo de reinscripción.</p></body></html>');
  }
});

router.post('/restablecer-clave', async (req, res) => {
  const token = String(req.body?.token || '');
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    return res.status(400).json({ error: 'El enlace venció o no es válido. Solicita uno nuevo.' });
  }

  if (payload.proposito !== PROPOSITO_RESET || !payload.claveVersion || !payload.idUsuario || !payload.correo) {
    return res.status(400).json({ error: 'El enlace de recuperación no es válido.' });
  }

  const connection = await pool.getConnection();
  let claveTemporal;
  try {
    await connection.beginTransaction();
    const [[usuario]] = await connection.query(`
      SELECT IdUsuario, CorreoElectronico, Clave
      FROM Usuario
      WHERE IdUsuario = ? AND LOWER(TRIM(CorreoElectronico)) = ? AND EstadoRegistro = 1
      LIMIT 1 FOR UPDATE
    `, [payload.idUsuario, normalizarCorreo(payload.correo)]);

    if (!usuario || huellaClave(usuario.Clave) !== payload.claveVersion) {
      await connection.rollback();
      return res.status(400).json({ error: 'Este enlace ya se utilizó o dejó de ser válido. Solicita otro enlace.' });
    }

    claveTemporal = generarClaveTemporal();
    const claveHasheada = await bcrypt.hash(claveTemporal, 10);
    await connection.query('UPDATE Usuario SET Clave = ? WHERE IdUsuario = ?', [claveHasheada, usuario.IdUsuario]);

    // Enviamos primero el correo dentro de la transacción: si el proveedor falla,
    // hacemos rollback y el alumno conserva la contraseña con la que ingresaba.
    const html = `
      <div style="font-family:Arial,sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:10px;max-width:600px;">
        <h2 style="color:#2563eb;">Tu contraseña temporal de AcadeSys</h2>
        <p><strong>Código de usuario:</strong> ${String(payload.codigoUsuario || '') || 'Usa el código indicado en tu correo de reinscripción.'}</p>
        <p><strong>Contraseña temporal:</strong> <span style="font-family:monospace;font-size:18px;">${claveTemporal}</span></p>
        <p>Ingresa a AcadeSys con tu código de usuario o correo electrónico y esta contraseña temporal. No compartas estas credenciales.</p>
      </div>`;

    await enviarCorreoHtml(usuario.CorreoElectronico, 'Tu contraseña temporal de AcadeSys', html);
    await connection.commit();
    return res.json({ exito: true, mensaje: 'Listo: enviamos tu contraseña temporal al correo registrado. Puedes cerrar esta ventana.' });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    console.error('Error en POST /api/matriculas/restablecer-clave:', error.message);
    return res.status(502).json({ error: 'No se pudo enviar el correo. No se cambió tu contraseña; vuelve a intentarlo.' });
  } finally {
    connection.release();
  }
});

module.exports = router;
