const express = require("express");
const router = express.Router();
const pool = require("../config/db");
// La autenticación ya se aplica globalmente en index.js (app.use("/api", verificarToken)),
// por lo que este router NO debe volver a ejecutarla.
const requiereRol = require("../middlewares/roles.middleware");

function idPositivo(valor) {
  if (!['string', 'number'].includes(typeof valor) || !/^\d+$/.test(String(valor))) return null;
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function responderError(res, error) {
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(404).json({ error: 'El menú o perfil indicado ya no existe.' });
  }
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(400).json({ error: 'La asignación ya existe.' });
  }
  console.error('[Menús]', error.message);
  return res.status(500).json({ error: 'No se pudo completar la operación de menús.' });
}

// 1. Listar los menús principales activos (GET)
router.get("/menus", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT IdOpcionMenu, Nombre, UrlMenu, Descripcion, IdPadre, EstadoRegistro FROM OpcionesMenu WHERE IdPadre IS NULL AND EstadoRegistro = 1 ORDER BY IdOpcionMenu",
    );
    res.json(rows);
  } catch (error) {
    responderError(res, error);
  }
});

// 2. Listar submenús activos de un menú específico (GET)
router.get("/menus/:idPadre/submenus", async (req, res) => {
  const idPadre = idPositivo(req.params.idPadre);
  if (!idPadre) return res.status(400).json({ error: 'IdPadre debe ser un entero positivo válido.' });
  try {
    const [padres] = await pool.query(
      'SELECT IdOpcionMenu FROM OpcionesMenu WHERE IdOpcionMenu = ? AND EstadoRegistro = 1',
      [idPadre],
    );
    if (!padres.length) return res.status(404).json({ error: 'El menú padre no existe o no está activo.' });
    const [rows] = await pool.query(
      "SELECT IdOpcionMenu, Nombre, UrlMenu, Descripcion, IdPadre, EstadoRegistro FROM OpcionesMenu WHERE IdPadre = ? AND EstadoRegistro = 1 ORDER BY IdOpcionMenu",
      [idPadre],
    );
    res.json(rows);
  } catch (error) {
    responderError(res, error);
  }
});

// Lectura autenticada de asignaciones explícitas. No concede autorización de acciones.
router.get('/menus/perfil/:idPerfil', async (req, res) => {
  const idPerfil = idPositivo(req.params.idPerfil);
  if (!idPerfil) return res.status(400).json({ error: 'IdPerfil debe ser un entero positivo válido.' });
  try {
    const [perfiles] = await pool.query(
      'SELECT IdPerfil, Nombre, EstadoRegistro FROM perfil WHERE IdPerfil = ? AND EstadoRegistro = 1',
      [idPerfil],
    );
    if (!perfiles.length) return res.status(404).json({ error: 'El perfil no existe o no está activo.' });
    const [rows] = await pool.query(
      `SELECT m.IdOpcionMenu, m.Nombre, m.UrlMenu, m.Descripcion, m.IdPadre,
              m.EstadoRegistro, MIN(mp.Orden) AS Orden
       FROM OpcionesMenu m
       INNER JOIN OpcionesMenu_Perfiles mp ON mp.IdOpcionMenu = m.IdOpcionMenu
       WHERE mp.IdPerfil = ? AND mp.EstadoRegistro = 1 AND m.EstadoRegistro = 1
       GROUP BY m.IdOpcionMenu, m.Nombre, m.UrlMenu, m.Descripcion, m.IdPadre, m.EstadoRegistro
       ORDER BY Orden, m.IdOpcionMenu`,
      [idPerfil],
    );
    // Descarta huérfanos/ciclos y descendientes de padres inactivos, sin dar permiso a sus hermanos.
    const [activos] = await pool.query(
      'SELECT IdOpcionMenu, IdPadre FROM OpcionesMenu WHERE EstadoRegistro = 1',
    );
    const padres = new Map(activos.map((m) => [Number(m.IdOpcionMenu), m.IdPadre]));
    const jerarquiaActiva = (id) => {
      const visitados = new Set();
      while (id !== null) {
        if (visitados.has(id) || !padres.has(id)) return false;
        visitados.add(id);
        const padre = padres.get(id);
        id = padre == null ? null : Number(padre);
      }
      return true;
    };
    res.json({ perfil: perfiles[0], menus: rows.filter((m) => jerarquiaActiva(Number(m.IdOpcionMenu))) });
  } catch (error) {
    responderError(res, error);
  }
});

router.post("/menus", requiereRol('Administrador'), async (req, res) => {
  const { Nombre, UrlMenu, Descripcion = '', IdPadre, EstadoRegistro = 1 } = req.body || {};
  if (typeof Nombre !== 'string' || !Nombre.trim() || Nombre.trim().length > 100 ||
      typeof UrlMenu !== 'string' || UrlMenu.length > 255 || !/^\/?[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(UrlMenu.trim()) ||
      typeof Descripcion !== 'string' || Descripcion.length > 255 ||
      ![0, 1].includes(EstadoRegistro)) {
    return res.status(400).json({ error: 'Revisa nombre, ruta interna, descripción y estado del menú.' });
  }
  const padre = IdPadre == null || IdPadre === '' ? null : idPositivo(IdPadre);
  if (IdPadre != null && IdPadre !== '' && !padre) {
    return res.status(400).json({ error: 'IdPadre debe ser un entero positivo válido o null.' });
  }
  try {
    if (padre) {
      const [padres] = await pool.query(
        'SELECT IdOpcionMenu FROM OpcionesMenu WHERE IdOpcionMenu = ? AND EstadoRegistro = 1', [padre],
      );
      if (!padres.length) return res.status(404).json({ error: 'El menú padre no existe o no está activo.' });
    }

    const [result] = await pool.query(
      "INSERT INTO OpcionesMenu (Nombre, UrlMenu, Descripcion, IdPadre, EstadoRegistro) VALUES (?, ?, ?, ?, ?)",
      [Nombre.trim(), UrlMenu.trim(), Descripcion.trim(), padre, EstadoRegistro],
    );
    if (result.affectedRows !== 1) return res.status(500).json({ error: 'No se confirmó la creación del menú.' });
    res.status(201).json({ message: "Menú creado con éxito", id: result.insertId });
  } catch (error) {
    responderError(res, error);
  }
});

// 4. Asignar un Menú a un Perfil (POST)
router.post("/menus/asignar", requiereRol('Administrador'), async (req, res) => {
  const { IdOpcionMenu, IdPerfil, Orden = 1, EstadoRegistro = 1 } = req.body || {};
  const idMenu = idPositivo(IdOpcionMenu);
  const idPerfil = idPositivo(IdPerfil);
  const orden = idPositivo(Orden);
  if (!idMenu || !idPerfil || !orden || ![0, 1].includes(EstadoRegistro)) {
    return res.status(400).json({ error: 'Menú, perfil y orden deben ser enteros positivos válidos; el estado debe ser 0 o 1.' });
  }
  try {
    const [menus] = await pool.query(
      'SELECT IdOpcionMenu FROM OpcionesMenu WHERE IdOpcionMenu = ? AND EstadoRegistro = 1', [idMenu],
    );
    if (!menus.length) return res.status(404).json({ error: 'El menú no existe o no está activo.' });
    const [perfiles] = await pool.query(
      'SELECT IdPerfil FROM perfil WHERE IdPerfil = ? AND EstadoRegistro = 1', [idPerfil],
    );
    if (!perfiles.length) return res.status(404).json({ error: 'El perfil no existe o no está activo.' });
    // Reintentar la misma asignación confirmada no crea otra fila.
    const [existentes] = await pool.query(
      'SELECT IdMenuPerfil FROM OpcionesMenu_Perfiles WHERE IdOpcionMenu = ? AND IdPerfil = ? AND EstadoRegistro = ? ORDER BY IdMenuPerfil LIMIT 1',
      [idMenu, idPerfil, EstadoRegistro],
    );
    if (existentes.length) return res.json({ message: 'La asignación ya existe', id: existentes[0].IdMenuPerfil });

    const [result] = await pool.query(
      "INSERT INTO OpcionesMenu_Perfiles (IdOpcionMenu, IdPerfil, Orden, EstadoRegistro) VALUES (?, ?, ?, ?)",
      [idMenu, idPerfil, orden, EstadoRegistro],
    );
    if (result.affectedRows !== 1) return res.status(500).json({ error: 'No se confirmó la asignación.' });
    res.status(201).json({
      message: "Menú asignado al perfil correctamente",
      id: result.insertId,
    });
  } catch (error) {
    responderError(res, error);
  }
});

module.exports = router;
