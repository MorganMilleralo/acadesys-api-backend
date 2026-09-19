// controllers/auth.controller.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

async function login(req, res) {
  try {
    const { correo, Clave } = req.body;

    const [filas] = await pool.query('SELECT * FROM usuarios WHERE correo = ?', [correo]);
    const user = filas[0];
    if (!user) return res.status(401).json({ mensaje: 'Credenciales inválidas' });

    const claveValida = await bcrypt.compare(Clave, user.Clave); // reemplaza tu if (!==)
    if (!claveValida) return res.status(401).json({ mensaje: 'Credenciales inválidas' });

    const token = jwt.sign(
      { id: user.id, correo: user.correo, rol: user.rol }, // deja solo los campos que ya usas
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({ mensaje: 'Login exitoso', token, usuario: { id: user.id, nombre: user.nombre } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ mensaje: 'Error en el login' });
  }
}

module.exports = { login };