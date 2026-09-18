// controllers/usuarios.controller.js
const bcrypt = require('bcrypt');
const pool = require('../config/db'); // ajusta al nombre real de tu pool mysql2

async function registrarUsuario(req, res) {
  try {
    const { nombre, correo, Clave } = req.body; // agrega los demás campos que ya tengas

    const [existentes] = await pool.query('SELECT id FROM usuarios WHERE correo = ?', [correo]);
    if (existentes.length > 0) {
      return res.status(409).json({ mensaje: 'Ese correo ya está registrado.' });
    }

    const claveEncriptada = await bcrypt.hash(Clave, 10); // 10 = saltRounds, estándar

    const [resultado] = await pool.query(
      'INSERT INTO usuarios (nombre, correo, Clave) VALUES (?, ?, ?)',
      [nombre, correo, claveEncriptada]
    );

    return res.status(201).json({ mensaje: 'Usuario registrado correctamente', id: resultado.insertId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ mensaje: 'Error al registrar usuario' });
  }
}

module.exports = { registrarUsuario /*, ...tus otros exports */ };