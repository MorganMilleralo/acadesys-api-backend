const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const requiereRol = require("../middlewares/roles.middleware");
const { bloquearIdentidades, rollbackSeguro } = require('../utils/validaciones');
const { consultar, ejecutar } = require('../config/procedimientos');

// ============================================================
// UTILIDADES
// ============================================================

// Mismo criterio que roles.middleware: el perfil administrativo se reconoce
// por nombre normalizado (Recursos Humanos opera como Administrador).
// Nunca se usa un IdPerfil fijo.
const esPerfilAdministrativo = requiereRol.esAdministrativo;

const idPerfilValido = (valor) => {
  if (!["string", "number"].includes(typeof valor)) return null;
  if (!/^\d+$/.test(String(valor))) return null;
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
};

// ¿Queda algún perfil administrativo activo distinto del indicado?
const existeOtroAdministradorActivo = async (idPerfilExcluido, connection = pool) => {
  const [rows] = await consultar(connection, 'sp_perfil_listar_activos', []);
  return rows.some(
    (p) =>
      Number(p.IdPerfil) !== Number(idPerfilExcluido) &&
      esPerfilAdministrativo(p.Nombre),
  );
};

// Usuarios ACTIVOS vinculados al perfil (los que quedarían sin perfil válido).
const contarUsuariosActivosDePerfil = async (idPerfil, connection = pool) => {
  const [rows] = await consultar(connection, 'sp_perfil_contar_usuario_perfil', [idPerfil]);
  return Number(rows[0]?.total || 0);
};

// 1. LISTAR PERFILES (GET)
// Activos (1) e Inactivos (0); se ocultan los Eliminados (-1).
router.get("/perfiles", requiereRol("Administrador"), async (req, res) => {
  try {
    const [rows] = await consultar(pool, 'sp_perfil_listar_todos', []);
    res.json(rows);
  } catch (error) {
    console.error("Error en GET /perfiles:", error.message);
    res.status(500).json({ error: "No se pudieron obtener los perfiles." });
  }
});

// 2. INSERTAR PERFIL (POST)
router.post("/perfiles", requiereRol("Administrador"), async (req, res) => {
  const { NombrePerfil, Descripcion = "", EstadoRegistro = 1 } = req.body || {};

  if (
    typeof NombrePerfil !== "string" ||
    !NombrePerfil.trim() ||
    NombrePerfil.trim().length > 100
  ) {
    return res
      .status(400)
      .json({ error: "El nombre del perfil es obligatorio (máx. 100 caracteres)." });
  }
  if (typeof Descripcion !== "string" || Descripcion.length > 255) {
    return res
      .status(400)
      .json({ error: "La descripción no puede superar 255 caracteres." });
  }
  const estado = Number(EstadoRegistro);
  if (![0, 1].includes(estado)) {
    return res
      .status(400)
      .json({ error: "El estado del perfil debe ser 0 (inactivo) o 1 (activo)." });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await bloquearIdentidades(connection);
    const [duplicados] = await consultar(connection, 'sp_perfil_bloquear_perfil_por_nombre_perfil', [NombrePerfil.trim()]);
    if (duplicados.length) { await connection.rollback(); return res.status(409).json({ error: 'Ya existe un perfil con ese nombre.' }); }
    const [result] = await ejecutar(connection, 'sp_perfil_registrar_perfil', [NombrePerfil.trim(), Descripcion.trim(), estado]);
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return res
        .status(500)
        .json({ error: "No se confirmó la creación del perfil." });
    }
    await connection.commit();
    res.status(201).json({ message: "Perfil creado con éxito", id: result.insertId });
  } catch (error) {
    await rollbackSeguro(connection);
    console.error("Error en POST /perfiles:", error.message);
    res.status(500).json({ error: "No se pudo crear el perfil." });
  } finally {
    if (connection) connection.release();
  }
});

// 3. MODIFICAR PERFIL (PUT)
// Permite actualizar Nombre, Descripción y/o EstadoRegistro (activar/desactivar).
router.put("/perfiles/:id", requiereRol("Administrador"), async (req, res) => {
  const idPerfil = idPerfilValido(req.params.id);
  if (!idPerfil) {
    return res
      .status(400)
      .json({ error: "El identificador del perfil no es válido." });
  }

  const { NombrePerfil, Descripcion, EstadoRegistro } = req.body || {};

  const nombre =
    NombrePerfil === undefined
      ? undefined
      : typeof NombrePerfil === "string"
        ? NombrePerfil.trim()
        : null;
  if (nombre !== undefined && (!nombre || nombre.length > 100)) {
    return res
      .status(400)
      .json({ error: "El nombre del perfil es obligatorio (máx. 100 caracteres)." });
  }

  const descripcion =
    Descripcion === undefined
      ? undefined
      : typeof Descripcion === "string"
        ? Descripcion.trim()
        : null;
  if (descripcion !== undefined && (descripcion === null || descripcion.length > 255)) {
    return res
      .status(400)
      .json({ error: "La descripción no puede superar 255 caracteres." });
  }

  let estado;
  if (EstadoRegistro !== undefined) {
    estado = Number(EstadoRegistro);
    if (![0, 1].includes(estado)) {
      return res
        .status(400)
        .json({ error: "El estado del perfil debe ser 0 (inactivo) o 1 (activo)." });
    }
  }

  if (nombre === undefined && descripcion === undefined && estado === undefined) {
    return res.status(400).json({ error: "No se enviaron cambios para el perfil." });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await bloquearIdentidades(connection);
    const [actuales] = await consultar(connection, 'sp_perfil_listar_perfil_por_id_perfil', [idPerfil]);
    if (!actuales.length) {
      await connection.rollback();
      return res.status(404).json({ error: "El perfil no existe o fue eliminado." });
    }

    const actual = actuales[0];
    const nombreFinal = nombre === undefined ? actual.Nombre : nombre;
    const estadoFinal = estado === undefined ? Number(actual.EstadoRegistro) : estado;
    if (nombre !== undefined) {
      const [duplicados] = await consultar(connection, 'sp_perfil_bloquear_perfil_por_nombre', [nombre, idPerfil]);
      if (duplicados.length) { await connection.rollback(); return res.status(409).json({ error: 'Ya existe otro perfil con ese nombre.' }); }
    }

    // Protección: no dejar el sistema sin perfil administrativo utilizable.
    const eraAdministrativo = esPerfilAdministrativo(actual.Nombre);
    const seguiaAdministrando =
      estadoFinal === 1 && esPerfilAdministrativo(nombreFinal);
    if (eraAdministrativo && !seguiaAdministrando) {
      if (!(await existeOtroAdministradorActivo(idPerfil, connection))) {
        await connection.rollback();
        return res.status(409).json({
          error:
            "No puedes desactivar ni renombrar el único perfil administrativo activo.",
        });
      }
      // Renombrar o desactivar un perfil con usuarios activos deja a esos
      // usuarios sin un perfil válido: se exige reasignarlos antes.
      const usuarios = await contarUsuariosActivosDePerfil(idPerfil, connection);
      if (usuarios > 0) {
        await connection.rollback();
        return res.status(409).json({
          error: `El perfil tiene ${usuarios} usuario(s) activo(s). Reasígnalos antes de desactivarlo o renombrarlo.`,
        });
      }
    }

    // Política: no desactivar un perfil con usuarios activos asignados.
    if (estado === 0 && Number(actual.EstadoRegistro) === 1) {
      const usuarios = await contarUsuariosActivosDePerfil(idPerfil, connection);
      if (usuarios > 0) {
        await connection.rollback();
        return res.status(409).json({
          error: `El perfil tiene ${usuarios} usuario(s) activo(s). Reasígnalos antes de desactivarlo.`,
        });
      }
    }

    const [result] = await ejecutar(connection, 'sp_perfil_actualizar', [
      idPerfil,
      nombre ?? null,
      descripcion ?? null,
      estado ?? null,
    ]);

    await connection.commit();
    if (result.affectedRows === 0) {
      return res
        .status(200)
        .json({ message: "El perfil ya tenía esos datos; no hubo cambios." });
    }

    res.json({ message: "Perfil actualizado con éxito" });
  } catch (error) {
    await rollbackSeguro(connection);
    console.error("Error en PUT /perfiles/:id:", error.message);
    res.status(500).json({ error: "No se pudo actualizar el perfil." });
  } finally {
    if (connection) connection.release();
  }
});

// 4. ELIMINACIÓN LÓGICA (DELETE)
router.delete("/perfiles/:id", requiereRol("Administrador"), async (req, res) => {
  const idPerfil = idPerfilValido(req.params.id);
  if (!idPerfil) {
    return res
      .status(400)
      .json({ error: "El identificador del perfil no es válido." });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await bloquearIdentidades(connection);
    const [actuales] = await consultar(connection, 'sp_perfil_listar_perfil_por_id_perfil', [idPerfil]);
    if (!actuales.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: "El perfil no existe o ya fue eliminado." });
    }

    if (
      esPerfilAdministrativo(actuales[0].Nombre) &&
      !(await existeOtroAdministradorActivo(idPerfil, connection))
    ) {
      await connection.rollback();
      return res
        .status(409)
        .json({ error: "No puedes eliminar el único perfil administrativo activo." });
    }

    // Política: los usuarios no se reasignan automáticamente. Si hay usuarios
    // activos vinculados, se impide eliminar/desactivar el perfil.
    const usuarios = await contarUsuariosActivosDePerfil(idPerfil, connection);
    if (usuarios > 0) {
      await connection.rollback();
      return res.status(409).json({
        error: `El perfil tiene ${usuarios} usuario(s) activo(s). Reasígnalos antes de eliminarlo.`,
      });
    }

    const [result] = await ejecutar(connection, 'sp_perfil_cambiar_estado_perfil', [idPerfil]);
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: "El perfil no existe o ya fue eliminado." });
    }

    await connection.commit();
    res.json({ message: "Perfil eliminado lógicamente con estado -1" });
  } catch (error) {
    await rollbackSeguro(connection);
    console.error("Error en DELETE /perfiles/:id:", error.message);
    res.status(500).json({ error: "No se pudo eliminar el perfil." });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;


