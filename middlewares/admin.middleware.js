const esAdmin = (req, res, next) => {
    // Verificamos que el token ya haya sido decodificado y el IdPerfil sea 1 (Administrador)
    if (req.usuario && req.usuario.idPerfil === 1) {
        next();
    } else {
        return res.status(403).json({ error: 'Acceso bloqueado: Se requieren permisos de Administrador institucional' });
    }
};

module.exports = esAdmin;