const express = require('express');
const cors = require('cors'); 
require('./config/db'); 
const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); // (Le da permiso a todos los dominios)
app.use(express.json());

// Importar rutas
const perfilRoutes = require('./routes/perfil.routes');
const menuRoutes = require('./routes/menu.routes');
const usuarioRoutes = require('./routes/usuario.routes'); 
const authRoutes = require('./routes/auth.routes'); // <-- NUEVO: Rutas de Login
const iaRoutes = require('./routes/ia.routes');     // <-- NUEVO: Rutas del Tutor IA

app.use('/api', perfilRoutes);
app.use('/api', menuRoutes);
app.use('/api', usuarioRoutes); 
app.use('/api', authRoutes); // <-- NUEVO: Activa el endpoint de Login
app.use('/api', iaRoutes);   // <-- NUEVO: Activa el endpoint de Gemini

app.get('/ping', (req, res) => {
    res.send('¡Hola Mundo! El backend de AcadeSys en Node.js está vivo y listo para el Frontend.');
});

app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});