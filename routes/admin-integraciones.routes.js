'use strict';

// Administración de las claves de la API de integración: /api/admin/integraciones
// Solo administradores, y siempre dentro de su propia academia.

const express = require('express');
const requiereRol = require('../middlewares/roles.middleware');
const { idPositivo } = require('../utils/validaciones');
const integracion = require('../services/integracion-clientes.service');

const router = express.Router();
router.use(requiereRol('Administrador'));

function sesion(req) {
  return { idAcademia: idPositivo(req.usuario?.idAcademia), idUsuario: idPositivo(req.usuario?.idUsuario) };
}

function responderError(res, error, contexto) {
  if (error instanceof integracion.ErrorIntegracion) {
    return res.status(error.status).json({ code: error.codigo, error: error.message });
  }
  console.error(`Error en ${contexto}:`, error?.code || error?.name || 'Error');
  return res.status(500).json({ error: 'No se pudo completar la operación de integración.' });
}

// POST /api/admin/integraciones — crea un aplicativo y devuelve su clave UNA sola vez.
router.post('/', async (req, res) => {
  const actor = sesion(req);
  if (!actor.idAcademia) return res.status(401).json({ error: 'La sesión administrativa no es válida.' });
  try {
    const creado = await integracion.crearConsumidor(actor, req.body);
    return res.status(201).json({
      ...creado,
      aviso: 'Guarda esta clave ahora: no se vuelve a mostrar. Si se pierde, revócala y crea otra.',
    });
  } catch (error) {
    return responderError(res, error, 'POST /api/admin/integraciones');
  }
});

router.get('/', async (req, res) => {
  const { idAcademia } = sesion(req);
  if (!idAcademia) return res.status(401).json({ error: 'La sesión administrativa no es válida.' });
  try {
    return res.json({ consumidores: await integracion.listarConsumidores(idAcademia) });
  } catch (error) {
    return responderError(res, error, 'GET /api/admin/integraciones');
  }
});

router.delete('/:id', async (req, res) => {
  const { idAcademia } = sesion(req);
  const id = idPositivo(req.params.id);
  if (!idAcademia) return res.status(401).json({ error: 'La sesión administrativa no es válida.' });
  if (!id) return res.status(400).json({ error: 'El id no es válido.' });
  try {
    const revocado = await integracion.revocarConsumidor(idAcademia, id);
    if (!revocado) return res.status(404).json({ error: 'No existe un aplicativo activo con ese id en tu academia.' });
    return res.json({ exito: true, mensaje: 'Clave revocada. El aplicativo ya no puede acceder.' });
  } catch (error) {
    return responderError(res, error, 'DELETE /api/admin/integraciones/:id');
  }
});

module.exports = router;
