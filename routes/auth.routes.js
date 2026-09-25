const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// ==========================================
// 1. REGISTRO PÚBLICO (Sin pedir Token)
// ==========================================
const registerHandler = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      DNI, dni,
      Nombres, nombre, nombreUsuario, usuario,
      ApellidoPaterno, apellido,
      ApellidoMaterno, apellidoMaterno,
      Celular, celular,
      CorreoElectronico, correo,
      Clave, contrasena, password,
      IdPerfil, perfiles,
      IdAcademia, idAcademia
    } = req.body;

    const docIdentidad = String(DNI || dni || '').trim().slice(0, 8);
    const apodoUsuario = String(nombreUsuario || usuario || '').trim();
    const nom = String(Nombres || nombre || apodoUsuario || 'Usuario').trim();
    const apeP = String(ApellidoPaterno || apellido || 'General').trim();
    const apeM = String(ApellidoMaterno || apellidoMaterno || '').trim();
    const tel = String(Celular || celular || '').trim();
    const email = String(CorreoElectronico || correo || `${nom.toLowerCase().replace(/\s+/g, '')}@acadesys.edu.pe`).trim();
    const rawClave = String(Clave || contrasena || password || '123456').trim();
    const perfilFinal = Number(IdPerfil || (Array.isArray(perfiles) ? perfiles[0] : 1)) || 1;
    const academiaFinal = Number(IdAcademia || idAcademia || 1);

    // Asignamos el apodo (ej. FrancoEsca) como CodigoUsuario para permitir login directo
    const codigoGenerado = apodoUsuario || `USR-${Math.floor(1000 + Math.random() * 9000)}`;

    // Validar duplicados básicos
    const [existentes] = await connection.query(
      `SELECT IdUsuario FROM Usuario WHERE CorreoElectronico = ? OR (DNI = ? AND DNI != '') LIMIT 1`,
      [email, docIdentidad]
    );

    if (existentes.length > 0) {
      return res.status(409).json({ error: 'El correo electrónico o DNI ya se encuentra registrado.' });
    }

    const claveHasheada = await bcrypt.hash(rawClave, 10);

    await connection.beginTransaction();

    // NOTA: UsuarioCreacion se define con el entero 1 (Usuario Administrador/Sistema)
    const [resUser] = await connection.query(
      `INSERT INTO Usuario 
       (CodigoUsuario, DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, UsuarioCreacion, FechaCreacion, EstadoRegistro, IdAcademia)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), 1, ?)`,
      [codigoGenerado, docIdentidad, nom, apeP, apeM, tel, email, claveHasheada, academiaFinal]
    );

    const nuevoIdUsuario = resUser.insertId;

    // Asignación de rol en tabla intermedia
    await connection.query(
      `INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, 1)`,
      [nuevoIdUsuario, perfilFinal]
    );

    await connection.commit();

    return res.status(201).json({
      mensaje: 'Usuario registrado exitosamente en la base de datos.',
      idUsuario: nuevoIdUsuario,
      id: nuevoIdUsuario,
      codigoUsuario: codigoGenerado,
      correo: email,
      usuario: apodoUsuario || nom
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error en registro de usuario:', error);
    return res.status(500).json({ error: 'Error al registrar usuario: ' + error.message });
  } finally {
    connection.release();
  }
};

// ==========================================
// 2. INICIO DE SESIÓN FLEXIBLE
// ==========================================
const loginHandler = async (req, res) => {
  try {
    const usuarioInput = req.body.usuario || 
                         req.body.codigo_usuario || 
                         req.body.codigoUsuario || 
                         req.body.correo || 
                         req.body.email || 
                         req.body.dni;

    const passwordInput = req.body.password || 
                          req.body.Clave || 
                          req.body.clave || 
                          req.body.contrasena;

    if (!usuarioInput || !passwordInput) {
      return res.status(400).json({ error: 'Debes enviar usuario y contraseña.' });
    }

    const termino = String(usuarioInput).trim();
    const clave = String(passwordInput).trim();

    // Busca por Correo, DNI, Código de Usuario o Nombres
    const [rows] = await pool.query(
      `SELECT u.IdUsuario, 
              CONCAT(u.Nombres, ' ', COALESCE(u.ApellidoPaterno, '')) AS nombreCompleto,
              u.Nombres, u.ApellidoPaterno, u.CorreoElectronico, u.Clave, 
              u.EstadoRegistro, u.CodigoUsuario, u.IdAcademia,
              p.IdPerfil, COALESCE(p.Nombre, 'Sin Rol') AS rol,
              a.NombreAcademia, a.ColorTema, a.LogoUrl
       FROM Usuario u
       LEFT JOIN Usuario_Perfiles up ON u.IdUsuario = up.IdUsuario AND up.EstadoRegistro = 1
       LEFT JOIN perfil p ON up.IdPerfil = p.IdPerfil
       LEFT JOIN Academia a ON u.IdAcademia = a.IdAcademia
       WHERE LOWER(TRIM(u.CorreoElectronico)) = LOWER(?) 
          OR TRIM(u.DNI) = ? 
          OR LOWER(TRIM(u.CodigoUsuario)) = LOWER(?)
          OR LOWER(TRIM(u.Nombres)) = LOWER(?)
       LIMIT 1`,
      [termino, termino, termino, termino]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Usuario, código o correo no encontrado.' });
    }

    const user = rows[0];

    if (user.EstadoRegistro !== 1) {
      return res.status(403).json({ error: 'La cuenta se encuentra inactiva o bloqueada.' });
    }

    // Validación Bcrypt vs Texto Plano heredado
    let claveValida = false;
    const claveEnBD = String(user.Clave);

    if (claveEnBD.startsWith('$2a$') || claveEnBD.startsWith('$2b$') || claveEnBD.startsWith('$2y$')) {
      claveValida = await bcrypt.compare(clave, claveEnBD);
    } else {
      claveValida = (clave === claveEnBD);
    }

    if (!claveValida) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    const token = jwt.sign(
      {
        id: user.IdUsuario,
        idUsuario: user.IdUsuario,
        rol: user.rol,
        idPerfil: user.IdPerfil,
        idAcademia: user.IdAcademia
      },
      process.env.JWT_SECRET || 'super_secreto_seguro_acadesys_2026',
      { expiresIn: '8h' }
    );

    return res.status(200).json({
      mensaje: 'Autenticación exitosa',
      token,
      idUsuario: user.IdUsuario,
      usuario: user.nombreCompleto || user.Nombres,
      nombre: user.nombreCompleto || user.Nombres,
      correo: user.CorreoElectronico,
      codigoUsuario: user.CodigoUsuario,
      idAcademia: user.IdAcademia,
      rol: user.rol,
      idPerfil: user.IdPerfil,
      academia: {
        nombre: user.NombreAcademia || 'AcadeSys SaaS',
        colorTema: user.ColorTema || '#4f46e5',
        logoUrl: user.LogoUrl || ''
      },
      user: {
        id: user.IdUsuario,
        nombre: user.nombreCompleto || user.Nombres,
        correo: user.CorreoElectronico,
        rol: user.rol,
        idAcademia: user.IdAcademia
      }
    });

  } catch (error) {
    console.error('Error en autenticación:', error);
    return res.status(500).json({ error: 'Error interno en el servidor.' });
  }
};

// ==========================================
// 3. DECLARACIÓN DE ENDPOINTS
// ==========================================
router.post('/login', loginHandler);
router.post('/auth/login', loginHandler);

// Endpoints de registro público (ubicados antes del middleware JWT de index.js)
router.post('/usuarios', registerHandler);
router.post('/auth/register', registerHandler);
router.post('/register', registerHandler);

module.exports = router;