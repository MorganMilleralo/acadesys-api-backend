const express = require('express');
require('./config/db'); 
const app = express();
const port = process.env.PORT || 3000;

// Middleware IMPORTANTÍSIMO para leer JSON
app.use(express.json());

// Importar rutas del REQ 1
const perfilRoutes = require('./routes/perfil.routes');
app.use('/api', perfilRoutes);

app.get('/ping', (req, res) => {
    res.send('¡Hola Mundo! El backend de AcadeSys en Node.js está vivo y listo para el Frontend.');
});

app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});