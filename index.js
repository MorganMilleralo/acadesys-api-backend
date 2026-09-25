const express = require('express');
const cors = require('cors'); 
require('./config/db'); 

const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); // Habilita peticiones desde cualquier origen (Vite en localhost:5173)
app.use(express.json());

// Importar rutas
const perfilRoutes = require('./routes/perfil.routes');
const menuRoutes = require('./routes/menu.routes');
const usuarioRoutes = require('./routes/usuario.routes');
const authRoutes = require('./routes/auth.routes');
const iaRoutes = require('./routes/ia.routes');
const apoderadosRoutes = require('./routes/apoderados.routes');
const actasRoutes = require('./routes/actas.routes');
const notasRoutes = require('./routes/notas.routes'); // <-- Agregado desde tu carpeta routes

// Usar rutas bajo el prefijo /api
app.use('/api', perfilRoutes);
app.use('/api', menuRoutes);
app.use('/api', usuarioRoutes);
app.use('/api', authRoutes);
app.use('/api', apoderadosRoutes);
app.use('/api', actasRoutes);
app.use('/api', notasRoutes);

// Tutor IA / Gemini: montado tanto en /api/tutor-ia como en /api para compatibilidad total
app.use('/api/tutor-ia', iaRoutes);
app.use('/api', iaRoutes);

app.get('/ping', (req, res) => {
    res.send('¡Hola Mundo! El backend de AcadeSys en Node.js está vivo y listo para el Frontend.');
});

app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});