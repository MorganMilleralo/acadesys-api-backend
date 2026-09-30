require('dotenv').config();
const express = require('express');
const cors = require('cors');
require('./config/db');

const app = express();
const port = process.env.PORT || 3000;

// Validación de arranque: variables de entorno críticas
const variablesRequeridas = [
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
    'JWT_SECRET'
];
const faltantes = variablesRequeridas.filter((v) => !process.env[v]);
if (faltantes.length > 0) {
    console.error(`❌ Faltan variables de entorno obligatorias: ${faltantes.join(', ')}`);
    process.exit(1);
}

app.use(cors());
app.use(express.json());

// ==========================================
// 1. RUTAS PÚBLICAS (Sin Token / Cero Fricción)
// Deben ir SIEMPRE arriba del candado JWT
// ==========================================
const authRoutes = require('./routes/auth.routes');
const ciclosRoutes = require('./routes/ciclos.routes');
const matriculasRoutes = require('./routes/matriculas.routes');

app.use('/api', authRoutes);
app.use('/api/ciclos', ciclosRoutes);           // GET /api/ciclos/publicos
app.use('/api/matriculas', matriculasRoutes);   // POST /api/matriculas/checkout

app.get('/ping', (req, res) => {
    res.send('AcadeSys API E-commerce en línea.');
});

// ==========================================
// 2. CANDADO GLOBAL JWT (Protege todo lo que esté abajo)
// ==========================================
const verificarToken = require('./middlewares/auth.middleware');
app.use('/api', verificarToken);

// ==========================================
// 3. RUTAS PRIVADAS (Requieren Token Bearer)
// ==========================================
app.use('/api', require('./routes/perfil.routes'));
app.use('/api', require('./routes/menu.routes'));
app.use('/api', require('./routes/usuario.routes'));
app.use('/api/notas', require('./routes/notas.routes'));
app.use('/api', require('./routes/actas.routes'));
app.use('/api', require('./routes/pagos.routes'));
app.use('/api', require('./routes/ia.routes'));

app.listen(port, () => {
    console.log(`🚀 AcadeSys E-commerce corriendo en el puerto ${port}`);
});