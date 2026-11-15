const express = require("express");
const router = express.Router();
const pool = require("../config/db");
// La autenticación ya se aplica globalmente en index.js (app.use("/api", verificarToken)),
// por lo que este router NO debe volver a ejecutarla.
const requiereRol = require("../middlewares/roles.middleware");
const { bloquearIdentidades, rollbackSeguro } = require('../utils/validaciones');
const { consultar, ejecutar } = require('../config/procedimientos');

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
    return res.status(409).json({ error: 'La asignación ya existe.' });
  }
  console.error('[Menús]', error.message);
  return res.status(500).json({ error: 'No se pudo completar la operación de menús.' });
}

// 1. Listar los menús principales activos (GET)
router.get("/menus", async (req, res) => {
  try {
    const [rows] = await consultar(pool, 'sp_menu_listar_menus_principales', []);
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
    const [padres] = await consultar(pool, 'sp_menu_listar_menu_por_id_opcion_menu', [idPadre]);
    if (!padres.length) return res.status(404).json({ error: 'El menú padre no existe o no está activo.' });
    const [rows] = await consultar(pool, 'sp_menu_listar_menu_por_id_padre', [idPadre]);
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
    const [perfiles] = await consultar(pool, 'sp_menu_obtener_perfil', [idPerfil]);
    if (!perfiles.length) return res.status(404).json({ error: 'El perfil no existe o no está activo.' });
    const [rows] = await consultar(pool, 'sp_menu_listar_menu_por_id_perfil', [idPerfil]);
    // Descarta huérfanos/ciclos y descendientes de padres inactivos, sin dar permiso a sus hermanos.
    const [activos] = await consultar(pool, 'sp_menu_listar_jerarquia', []);
    const padres = new Map(activos.map((m) => [Number(m.IdOpcionMenu), m.IdPadre]));
    const jerarquiaActiva = (id) => {
      const visitados = new Set();
      while (id !== null) {
        if (visitados.has(id) || !padres.has(id)) return false;
        visitados.add(id);
        const padre = padres.get(id);
        id = padre == null || Number(padre) === 0 ? null : Number(padre);
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
  const esRaiz = IdPadre == null || IdPadre === '' || IdPadre === 0 || IdPadre === '0';
  const padre = esRaiz ? null : idPositivo(IdPadre);
  if (!esRaiz && !padre) {
    return res.status(400).json({ error: 'IdPadre debe ser un entero positivo válido o null.' });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await bloquearIdentidades(connection);
    if (padre) {
      const [padres] = await consultar(connection, 'sp_menu_listar_menu_por_id_opcion_menu', [padre]);
      if (!padres.length) { await connection.rollback(); return res.status(404).json({ error: 'El menú padre no existe o no está activo.' }); }
    }
    const [duplicados] = await consultar(connection, 'sp_menu_bloquear_menu', [UrlMenu.trim(), padre]);
    if (duplicados.length) { await connection.rollback(); return res.status(409).json({ error: 'Ya existe un menú con esa ruta y padre.' }); }

    const [result] = await ejecutar(connection, 'sp_menu_registrar_menu', [
        Nombre.trim(),
        UrlMenu.trim(),
        Descripcion.trim(),
        padre,
        EstadoRegistro,
      ]);
    if (result.affectedRows !== 1) { await connection.rollback(); return res.status(500).json({ error: 'No se confirmó la creación del menú.' }); }
    await connection.commit();
    res.status(201).json({ message: "Menú creado con éxito", id: result.insertId });
  } catch (error) {
    await rollbackSeguro(connection);
    responderError(res, error);
  } finally {
    if (connection) connection.release();
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
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await bloquearIdentidades(connection);
    const [menus] = await consultar(connection, 'sp_menu_listar_menu_por_id_opcion_menu', [idMenu]);
    if (!menus.length) { await connection.rollback(); return res.status(404).json({ error: 'El menú no existe o no está activo.' }); }
    const [perfiles] = await consultar(connection, 'sp_menu_verificar_perfil', [idPerfil]);
    if (!perfiles.length) { await connection.rollback(); return res.status(404).json({ error: 'El perfil no existe o no está activo.' }); }
    // Reintentar la misma asignación confirmada no crea otra fila.
    const [existentes] = await consultar(connection, 'sp_menu_obtener_menu_perfil', [idMenu, idPerfil, EstadoRegistro]);
    if (existentes.length) { await connection.commit(); return res.json({ message: 'La asignación ya existe', id: existentes[0].IdOpcionMenu }); }

    const [result] = await ejecutar(connection, 'sp_menu_registrar_menu_perfil', [idMenu, idPerfil, orden, EstadoRegistro]);
    if (result.affectedRows !== 1) { await connection.rollback(); return res.status(500).json({ error: 'No se confirmó la asignación.' }); }
    await connection.commit();
    res.status(201).json({
      message: "Menú asignado al perfil correctamente",
      id: result.insertId,
    });
  } catch (error) {
    await rollbackSeguro(connection);
    responderError(res, error);
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;


