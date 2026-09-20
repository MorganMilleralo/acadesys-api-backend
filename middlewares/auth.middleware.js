const jwt = require('jsonwebtoken');

const verificarToken = (req, res, next) => {
    // Extraer el token del header: "Bearer <token>"
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) {
        return res.status(403).json({ error: 'Acceso denegado: Un token de acceso es requerido' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto_temporal');
        // Inyectamos los datos del usuario (incluyendo IdAcademia) en la petición
        req.usuario = decoded; 
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Token inválido o expirado. Inicie sesión nuevamente.' });
    }
};

module.exports = verificarToken;