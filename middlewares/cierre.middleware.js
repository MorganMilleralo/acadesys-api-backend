// middlewares/cierre.middleware.js
const pool = require('../config/db');

const verificarPeriodoAbierto = async (req, res, next) => {
    try {
        // Truco de Arquitecto: Si existen notas con EstadoRegistro = 2 (Bloqueadas),
        // significa que el Administrador ya selló el ciclo.
        const [notasBloqueadas] = await pool.query(
            "SELECT COUNT(*) AS total FROM Evaluacion WHERE EstadoRegistro = 2"
        );
        
        if (notasBloqueadas[0].total > 0) {
            return res.status(403).json({ 
                error: 'Periodo Cerrado: Las actas oficiales ya fueron selladas por Administración. Edición bloqueada.' 
            });
        }

        next(); // Si no hay notas bloqueadas, el docente puede seguir guardando
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

module.exports = verificarPeriodoAbierto;