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
const apoderadosRoutes = require('./routes/apoderados.routes'); // <-- NUEVO: Rutas de Apoderados
const actasRoutes = require('./routes/actas.routes');           // <-- NUEVO: Rutas de Actas

app.use('/api', perfilRoutes);
app.use('/api', menuRoutes);
app.use('/api', usuarioRoutes); 
app.use('/api', authRoutes); // <-- NUEVO: Activa el endpoint de Login
app.use('/api', iaRoutes);   // <-- NUEVO: Activa el endpoint de Gemini
app.use('/api', apoderadosRoutes); // <-- NUEVO: Activa el endpoint de Apoderados
app.use('/api', actasRoutes);      // <-- NUEVO: Activa el endpoint de Actas

app.get('/ping', (req, res) => {
    res.send('¡Hola Mundo! El backend de AcadeSys en Node.js está vivo y listo para el Frontend.');
});

app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});