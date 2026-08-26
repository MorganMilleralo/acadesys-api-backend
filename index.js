const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Endpoint de prueba para Fase 1
app.get('/ping', (req, res) => {
    res.send('¡Hola Mundo! El backend de AcadeSys en Node.js está vivo y listo para el Frontend.');
});

app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});