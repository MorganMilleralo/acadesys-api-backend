// middlewares/auth.middleware.js
const jwt = require('jsonwebtoken');

function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ mensaje: 'Acceso denegado. Token no proporcionado.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    // Usamos la variable de entorno, o el fallback si Render aún no la ha cargado
    const secreto = process.env.JWT_SECRET || 'acadesys_secreto';
    const decoded = jwt.verify(token, secreto);
    
    req.usuario = decoded; // disponible en cualquier controlador protegido
    next();
  } catch (error) {
    return res.status(403).json({ mensaje: 'Token inválido o expirado.' });
  }
}

module.exports = verificarToken;