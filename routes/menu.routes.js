const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 1. Listar los menús principales activos (GET)
router.get('/menus', async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT IdOpcionMenu, Nombre, UrlMenu, Descripcion FROM OpcionesMenu WHERE IdPadre IS NULL AND EstadoRegistro = 1"
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Listar submenús activos de un menú específico (GET)
router.get('/menus/:idPadre/submenus', async (req, res) => {
    try {
        const { idPadre } = req.params;
        const [rows] = await pool.query(
            "SELECT IdOpcionMenu, Nombre, UrlMenu FROM OpcionesMenu WHERE IdPadre = ? AND EstadoRegistro = 1",
            [idPadre]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/menus', async (req, res) => {
    try {
        const { Nombre, UrlMenu, Descripcion, IdPadre, EstadoRegistro } = req.body; 
        const padre = IdPadre ? IdPadre : null; 
        
        const estadoFinal = EstadoRegistro ?? 1; // PARCHE

        const [result] = await pool.query(
            "INSERT INTO OpcionesMenu (Nombre, UrlMenu, Descripcion, IdPadre, EstadoRegistro) VALUES (?, ?, ?, ?, ?)",
            [Nombre, UrlMenu, Descripcion, padre, estadoFinal]
        );
        res.json({ message: 'Menú creado con éxito', id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Asignar un Menú a un Perfil (POST)
router.post('/menus/asignar', async (req, res) => {
    try {
        const { IdOpcionMenu, IdPerfil, Orden, EstadoRegistro } = req.body;
        
        const estadoFinal = EstadoRegistro ?? 1; // PARCHE

        const [result] = await pool.query(
            "INSERT INTO OpcionesMenu_Perfiles (IdOpcionMenu, IdPerfil, Orden, EstadoRegistro) VALUES (?, ?, ?, ?)",
            [IdOpcionMenu, IdPerfil, Orden, estadoFinal]
        );
        res.json({ message: 'Menú asignado al perfil correctamente', id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;