// middlewares/docente.middleware.js

const verificarDocente = (req, res, next) => {
    // Extraemos los datos que el auth.middleware inyectó en la petición
    const { rol, idPerfil } = req.usuario;

    // Validamos estrictamente que sea Docente (Ya sea por nombre o IdPerfil = 2)
    if (rol === 'Docente' || idPerfil === 2) {
        next(); // Es docente, lo dejamos pasar a la ruta de notas
    } else {
        return res.status(403).json({ 
            error: 'Acceso denegado: Solo los docentes autorizados pueden registrar o modificar calificaciones.' 
        });
    }
};

module.exports = verificarDocente;