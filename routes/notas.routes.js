const express = require('express');
const router = express.Router();
const verificarToken = require('../middlewares/auth.middleware');
const notasController = require('../controllers/notas.controller');

router.use(verificarToken); // bloquea TODO lo de este router sin token válido

router.get('/', notasController.obtenerNotas);
// ...resto de tus rutas de notas

module.exports = router;