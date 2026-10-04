const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const universidadDesdeNombre = (nombre = '') => {
  const n = String(nombre).toLowerCase();
  if (n.includes('san marcos') || n.includes('unmsm')) return 'UNMSM';
  if (/\buni\b/.test(n) || n.includes('ingenier')) return 'UNI';
  if (n.includes('católica') || n.includes('catolica') || n.includes('pucp')) return 'PUCP';
  if (n.includes('villarreal') || n.includes('unfv')) return 'UNFV';
  if (n.includes('unt') || n.includes('trujillo')) return 'UNT';
  if (n.includes('callao') || n.includes('unac')) return 'UNAC';
  return 'Preuniversitario';
};

const horarioDesdeTurno = (turno = '') => {
  const t = String(turno).toLowerCase();
  if (t.includes('mañana') || t.includes('manana')) return '08:00 - 13:00';
  if (t.includes('tarde')) return '14:00 - 19:00';
  if (t.includes('noche')) return '18:00 - 22:00';
  return '08:00 - 13:00';
};

const obtenerPerfilPorNombre = async (connection, nombre) => {
  const [rows] = await connection.query(
    `SELECT IdPerfil,
            COALESCE(NULLIF(Nombre, ''), 'Sin Rol') AS Nombre
       FROM perfil
      WHERE EstadoRegistro = 1
        AND LOWER(COALESCE(NULLIF(Nombre, ''), '')) = LOWER(?)
      LIMIT 1`,
    [nombre]
  );
  return rows[0]?.IdPerfil || null;
};

// ==========================================
// REGISTRO PÚBLICO: SOLO ALUMNO
// ==========================================
const registerHandler = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const {
      DNI,
      dni,
      Nombres,
      nombre,
      ApellidoPaterno,
      apellido,
      ApellidoMaterno,
      apellidoMaterno,
      Celular,
      celular,
      CorreoElectronico,
      correo,
      Clave,
      contrasena,
      password
    } = req.body || {};

    const docIdentidad = String(DNI || dni || '').trim().slice(0, 8) || null;
    const nom = String(Nombres || nombre || '').trim();
    const apeP = String(ApellidoPaterno || apellido || '').trim();
    const apeM = String(ApellidoMaterno || apellidoMaterno || '').trim();
    const tel = String(Celular || celular || '').trim();
    const email = String(CorreoElectronico || correo || '').trim().toLowerCase();
    const rawClave = String(Clave || contrasena || password || '').trim();

    if (!nom || !apeP || !email || !rawClave) {
      return res.status(400).json({
        error: 'Nombres, apellido, correo y contraseña son obligatorios.'
      });
    }

    const [existentes] = await connection.query(
      `SELECT IdUsuario
         FROM Usuario
        WHERE LOWER(CorreoElectronico) = ?
           OR (? IS NOT NULL AND DNI = ?)
        LIMIT 1`,
      [email, docIdentidad, docIdentidad]
    );

    if (existentes.length > 0) {
      return res.status(409).json({
        error: 'El correo electrónico o DNI ya se encuentra registrado.'
      });
    }

    const idPerfilAlumno = await obtenerPerfilPorNombre(connection, 'Alumno');
    if (!idPerfilAlumno) {
      return res.status(500).json({
        error: 'No existe el perfil Alumno en la base de datos.'
      });
    }

    const claveHasheada = await bcrypt.hash(rawClave, 10);
    const baseCodigo = `${nom.replace(/\s+/g, '')}${apeP.replace(/\s+/g, '')}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 28) || 'ALUMNO';

    await connection.beginTransaction();

    let codigoUsuario = '';
    for (let intento = 0; intento < 10; intento += 1) {
      const sufijo = String(Math.floor(1000 + Math.random() * 9000));
      const candidato = `${baseCodigo}-${sufijo}`;
      const [existenteCodigo] = await connection.query(
        'SELECT IdUsuario FROM Usuario WHERE CodigoUsuario = ? LIMIT 1',
        [candidato]
      );
      if (existenteCodigo.length === 0) {
        codigoUsuario = candidato;
        break;
      }
    }

    if (!codigoUsuario) {
      await connection.rollback();
      return res.status(500).json({ error: 'No se pudo generar un código de alumno disponible.' });
    }

    const [resUser] = await connection.query(
      `INSERT INTO Usuario
        (CodigoUsuario, DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular,
         CorreoElectronico, Clave, FechaCreacion, EstadoRegistro, IdAcademia)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 1, 1)`,
      [codigoUsuario, docIdentidad, nom, apeP, apeM, tel, email, claveHasheada]
    );

    const nuevoIdUsuario = resUser.insertId;

    await connection.query(
      `INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro)
       VALUES (?, ?, 1)`,
      [nuevoIdUsuario, idPerfilAlumno]
    );

    await connection.commit();

    res.status(201).json({
      mensaje: 'Alumno registrado exitosamente.',
      idUsuario: nuevoIdUsuario,
      id: nuevoIdUsuario,
      codigoUsuario,
      correo: email,
      usuario: `${nom} ${apeP}`
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error en registro público:', error.message);
    res.status(500).json({ error: 'Error al registrar el alumno: ' + error.message });
  } finally {
    connection.release();
  }
};

// ==========================================
// LOGIN
// ==========================================
const loginHandler = async (req, res) => {
  try {
    const usuarioInput =
      req.body?.usuario ||
      req.body?.codigo_usuario ||
      req.body?.codigoUsuario ||
      req.body?.correo ||
      req.body?.email ||
      req.body?.dni;

    const passwordInput =
      req.body?.password ||
      req.body?.Clave ||
      req.body?.clave ||
      req.body?.contrasena;

    if (!usuarioInput || !passwordInput) {
      return res.status(400).json({
        error: 'Debes enviar usuario/código/correo/DNI y contraseña.'
      });
    }

    const termino = String(usuarioInput).trim();
    const clave = String(passwordInput).trim();
    const termLower = termino.toLowerCase();

    const [rows] = await pool.query(
      `SELECT
        u.IdUsuario,
        u.DNI,
        u.Nombres,
        u.ApellidoPaterno,
        u.ApellidoMaterno,
        CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno) AS NombreCompleto,
        u.CorreoElectronico,
        u.Clave,
        u.EstadoRegistro,
        u.CodigoUsuario,
        u.IdAcademia,
        up.IdPerfil,
        COALESCE(NULLIF(p.Nombre, ''), 'Sin Rol') AS Rol,
        a.NombreAcademia,
        a.ColorTema,
        a.LogoUrl
      FROM Usuario u
      LEFT JOIN Usuario_Perfiles up
        ON u.IdUsuario = up.IdUsuario
       AND up.EstadoRegistro = 1
      LEFT JOIN perfil p
        ON up.IdPerfil = p.IdPerfil
      LEFT JOIN Academia a
        ON u.IdAcademia = a.IdAcademia
      WHERE u.EstadoRegistro = 1
        AND (
          LOWER(TRIM(u.CorreoElectronico)) = ?
          OR LOWER(TRIM(u.CodigoUsuario)) = ?
          OR TRIM(COALESCE(u.DNI, '')) = ?
          OR (
            LOWER(SUBSTRING_INDEX(u.CorreoElectronico, '@', 1)) = ?
            AND (
              SELECT COUNT(*)
              FROM Usuario ux
              WHERE ux.EstadoRegistro = 1
                AND LOWER(SUBSTRING_INDEX(ux.CorreoElectronico, '@', 1)) = ?
            ) = 1
          )
        )
      ORDER BY CASE
        WHEN LOWER(TRIM(u.CorreoElectronico)) = ? THEN 1
        WHEN LOWER(TRIM(u.CodigoUsuario)) = ? THEN 2
        WHEN TRIM(COALESCE(u.DNI, '')) = ? THEN 3
        ELSE 4
      END
      LIMIT 1`,
      [termLower, termLower, termino, termLower, termLower, termLower, termLower, termLower, termino]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        error: 'Usuario, código, correo o DNI no encontrado.'
      });
    }

    const user = rows[0];
    const claveEnBD = String(user.Clave || '');
    let claveValida = false;

    if (/^\$2[aby]\$/.test(claveEnBD)) {
      claveValida = await bcrypt.compare(clave, claveEnBD);
    } else {
      // Compatibilidad temporal con cuentas antiguas. Se recomienda migrarlas a bcrypt.
      claveValida = clave === claveEnBD;
    }

    if (!claveValida) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    const rol = user.Rol || 'Sin Rol';

    const token = jwt.sign(
      {
        id: user.IdUsuario,
        idUsuario: user.IdUsuario,
        rol,
        idPerfil: user.IdPerfil,
        idAcademia: user.IdAcademia
      },
      process.env.JWT_SECRET || 'super_secreto_seguro_acadesys_2026',
      { expiresIn: '8h' }
    );

    let matricula = null;

    const esAlumno =
      String(rol).toLowerCase().includes('alumno') ||
      String(rol).toLowerCase().includes('estudiante');

    if (esAlumno) {
      const [matriculas] = await pool.query(
        `SELECT
          m.IdMatricula,
          c.IdCiclo,
          c.Nombre AS NombreCiclo,
          c.Turno,
          c.Horario,
          c.DiasClase,
          c.UniversidadObjetivo,
          c.FechaInicio,
          c.FechaFin,
          (
            SELECT COUNT(*)
            FROM Matricula m2
            WHERE m2.IdCiclo = c.IdCiclo
              AND m2.EstadoRegistro = 1
          ) AS TotalAlumnos
        FROM Matricula m
        INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
        WHERE m.IdUsuario = ?
          AND m.EstadoRegistro = 1
          AND c.EstadoRegistro = 1
        ORDER BY m.IdMatricula DESC
        LIMIT 1`,
        [user.IdUsuario]
      );

      if (matriculas.length > 0) {
        const m = matriculas[0];
        matricula = {
          idMatricula: m.IdMatricula,
          idCiclo: m.IdCiclo,
          nombreCiclo: m.NombreCiclo,
          turno: m.Turno || '',
          horario: m.Horario || horarioDesdeTurno(m.Turno),
          diasClase: m.DiasClase || 'Lunes a Sábado',
          universidadObjetivo: (!m.UniversidadObjetivo || m.UniversidadObjetivo === 'Preuniversitario') ? universidadDesdeNombre(m.NombreCiclo) : m.UniversidadObjetivo,
          fechaInicio: m.FechaInicio,
          fechaFin: m.FechaFin,
          totalAlumnos: Number(m.TotalAlumnos || 0)
        };
      }
    }

    res.status(200).json({
      mensaje: 'Autenticación exitosa',
      token,
      idUsuario: user.IdUsuario,
      usuario: user.NombreCompleto,
      nombre: user.NombreCompleto,
      correo: user.CorreoElectronico,
      dni: user.DNI,
      codigoUsuario: user.CodigoUsuario,
      idAcademia: user.IdAcademia,
      rol,
      idPerfil: user.IdPerfil,
      matricula,
      academia: {
        idAcademia: user.IdAcademia,
        nombreAcademia: user.NombreAcademia || 'AcadeSys Pre-U',
        colorTema: user.ColorTema || '#2563eb',
        logoUrl: user.LogoUrl || ''
      },
      user: {
        id: user.IdUsuario,
        idUsuario: user.IdUsuario,
        nombre: user.NombreCompleto,
        correo: user.CorreoElectronico,
        dni: user.DNI,
        codigoUsuario: user.CodigoUsuario,
        rol,
        idAcademia: user.IdAcademia
      }
    });
  } catch (error) {
    console.error('Error en autenticación:', error);
    res.status(500).json({ error: 'Error interno en el servidor.' });
  }
};

router.post('/login', loginHandler);
router.post('/auth/login', loginHandler);

// Registro público compatible, pero siempre como Alumno.
router.post('/auth/register', registerHandler);
router.post('/register', registerHandler);

module.exports = router;
