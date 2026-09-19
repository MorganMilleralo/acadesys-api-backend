// middlewares/admin.middleware.js
const verificarAdmin = (req, res, next) => {
    const { rol, idPerfil } = req.usuario; // Datos desencriptados del token[cite: 7]

    // Solo dejamos pasar si su IdPerfil es 1 (Administrador)
    if (rol === 'Administrador' || idPerfil === 1) {
        next();
    } else {
        return res.status(403).json({ error: 'Acceso denegado: Solo el Administrador puede realizar el cierre de actas.' });
    }
};

module.exports = verificarAdmin;