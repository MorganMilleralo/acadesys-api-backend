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
const tutorRoutes = require('./routes/tutor.routes');       // Tutor IA (versión de Yan)
const authRoutes = require('./routes/auth.routes');         // Login Cero Fricción y Multi-tenant (Tu parte)
const iaRoutes = require('./routes/ia.routes');             // Tutor IA (Tu versión)
const apoderadosRoutes = require('./routes/apoderados.routes'); 
const actasRoutes = require('./routes/actas.routes');            
const matriculasRoutes = require('./routes/matriculas.routes'); // <-- NUEVO: Tu endpoint SaaS autogenerador

// Usar rutas
app.use('/api', perfilRoutes);
app.use('/api', menuRoutes);
app.use('/api', usuarioRoutes);
app.use('/api', tutorRoutes);      
app.use('/api', authRoutes);       
app.use('/api', iaRoutes);         
app.use('/api', apoderadosRoutes); 
app.use('/api', actasRoutes);      
app.use('/api', matriculasRoutes); // <-- NUEVO: Activado para el frontend

app.get('/ping', (req, res) => {
    res.send('¡Hola Mundo! El backend de AcadeSys en Node.js está vivo y listo para el Frontend.');
});

app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});