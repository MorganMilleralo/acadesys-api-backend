const express = require('express');
const cors = require('cors'); 
require('./config/db'); 

const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); // Permiso a todos los dominios
app.use(express.json());

// Importar rutas (Limpias y sin duplicados)
const perfilRoutes = require('./routes/perfil.routes');
const menuRoutes = require('./routes/menu.routes');
const usuarioRoutes = require('./routes/usuario.routes');
const authRoutes = require('./routes/auth.routes'); 
const iaRoutes = require('./routes/ia.routes'); // <-- Única ruta de IA (Tu versión)
const apoderadosRoutes = require('./routes/apoderados.routes'); 
const actasRoutes = require('./routes/actas.routes');            
const matriculasRoutes = require('./routes/matriculas.routes'); 

// Usar rutas
app.use('/api', perfilRoutes);
app.use('/api', menuRoutes);
app.use('/api', usuarioRoutes);
app.use('/api', authRoutes); 
app.use('/api', iaRoutes); // <-- Enlace único a Gemini
app.use('/api', apoderadosRoutes); 
app.use('/api', actasRoutes);      
app.use('/api', matriculasRoutes); 

app.get('/ping', (req, res) => {
    res.send('¡Hola Mundo! El backend SaaS de AcadeSys está vivo y listo.');
});

app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});