
const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const bcrypt = require("bcrypt");
const requiereRol = require("../middlewares/roles.middleware");
const { validarDatosUsuario, usuarioDuplicado, bloquearIdentidades, rollbackSeguro } = require('../utils/validaciones');
const { enteroPositivo } = require("../utils/evaluaciones");

async function perfilActivo(connection, idPerfil) {
  if (!enteroPositivo(idPerfil)) return false;
  const [perfiles] = await connection.query(
    "SELECT IdPerfil FROM perfil WHERE IdPerfil = ? AND EstadoRegistro = 1 LIMIT 1 FOR SHARE",
    [Number(idPerfil)]
  );
  return perfiles.length === 1;
}

const idPerfilValido = (valor) => {
  if (!["string", "number"].includes(typeof valor)) return null;
  if (!/^\d+$/.test(String(valor))) return null;
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
};

// Un perfil es administrativo por su NOMBRE (igual criterio que roles.middleware).
// Nunca por un IdPerfil/IdUsuario fijo.
const esPerfilAdministrativo = requiereRol.esAdministrativo;

// ¿Existe OTRO usuario administrativo ACTIVO (con perfil activo) en la academia?
const existeOtroAdminActivo = async (
  connection,
  idAcademia,
  idUsuarioExcluido,
) => {
  const [rows] = await connection.query(
    `SELECT u.IdUsuario, p.Nombre AS NombrePerfil
       FROM Usuario u
       INNER JOIN Usuario_Perfiles up
         ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
       INNER JOIN perfil p
         ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
      WHERE u.IdAcademia = ? AND u.EstadoRegistro = 1 AND u.IdUsuario <> ?`,
    [idAcademia, idUsuarioExcluido],
  );
  const administradores = new Set();
  for (const fila of rows) {
    if (esPerfilAdministrativo(fila.NombrePerfil)) {
      administradores.add(Number(fila.IdUsuario));
    }
  }
  return administradores.size > 0;
};

// Respuesta de error homogénea. Nunca expone detalles de SQL al cliente.
const responderError = (res, error, contexto) => {
  if (error && error.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      error: "Ya existe un usuario con ese DNI o correo electrónico.",
    });
  }
  console.error(`Error en ${contexto}:`, error.message);
  return res
    .status(500)
    .json({ error: "No se pudo completar la operación de usuarios." });
};

// Proyección común del usuario con su perfil ACTIVO (si existe).
const SELECT_USUARIO = `
  SELECT
    u.IdUsuario, u.DNI, u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno,
    CONCAT(u.Nombres, ' ', COALESCE(u.ApellidoPaterno, ''), ' ', COALESCE(u.ApellidoMaterno, '')) AS NombreCompleto,
    u.CorreoElectronico, u.CorreoElectronico AS Correo, u.Celular, u.CodigoUsuario, u.EstadoRegistro,
    up.IdPerfil, p.Nombre AS NombrePerfil, p.Nombre AS Perfil, p.EstadoRegistro AS EstadoPerfil
  FROM Usuario u
  LEFT JOIN Usuario_Perfiles up ON u.IdUsuario = up.IdUsuario AND up.EstadoRegistro = 1
  LEFT JOIN perfil p ON up.IdPerfil = p.IdPerfil`;

// 1. CREAR USUARIO STAFF (Docente / Tutor de Aula)
router.post("/usuarios", requiereRol("Administrador"), async (req, res) => {
  const validado = validarDatosUsuario(req.body || {}, { crear: true });
  if (validado.error) return res.status(400).json({ error: validado.error });
  const {
    DNI,
    Nombres,
    ApellidoPaterno,
    ApellidoMaterno,
    Celular,
    CorreoElectronico,
    Clave,
  } = validado.datos;
  const IdPerfil = req.body?.IdPerfil;

  if (!Nombres || !ApellidoPaterno || !Clave || !IdPerfil) {
    return res.status(400).json({
      error:
        "Nombres, ApellidoPaterno, Clave e IdPerfil son campos obligatorios.",
    });
  }

  const idPerfilSolicitado = idPerfilValido(IdPerfil);
  if (!idPerfilSolicitado) {
    return res
      .status(400)
      .json({ error: "El IdPerfil enviado no es un identificador válido." });
  }

  const idAcademia = req.usuario.idAcademia;
  let connection;
  try {
    const claveHasheada = await bcrypt.hash(Clave, 10);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await bloquearIdentidades(connection);
    const [[academia]] = await connection.query('SELECT IdAcademia FROM Academia WHERE IdAcademia = ?', [idAcademia]);
    if (!academia) { await connection.rollback(); return res.status(401).json({ error: 'Academia de sesión inválida.' }); }
    if (await usuarioDuplicado(connection, validado.datos)) {
      await connection.rollback();
      return res.status(409).json({ error: 'Ya existe un usuario con ese DNI o correo electrónico.' });
    }

    if (!await perfilActivo(connection, IdPerfil)) {
      await connection.rollback();
      return res.status(400).json({ error: "El perfil debe existir y estar activo." });
    }

    const baseCodigo = String(
      req.body.CodigoUsuario ||
      req.body.codigoUsuario ||
      `${Nombres}${ApellidoPaterno}`
    )
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase()
      .slice(0, 20) || "USR";

    let codigoUsuario = `${baseCodigo}-${String(Date.now()).slice(-6)}`;
    for (let intento = 0; intento < 10; intento += 1) {
      const candidato = intento === 0
        ? codigoUsuario
        : `${baseCodigo}-${String(Date.now() + intento).slice(-6)}`;
      const [existeCodigo] = await connection.query(
        "SELECT IdUsuario FROM Usuario WHERE CodigoUsuario = ? LIMIT 1",
        [candidato]
      );
      if (existeCodigo.length === 0) {
        codigoUsuario = candidato;
        break;
      }
    }

    const [resultUsuario] = await connection.query(
      `INSERT INTO Usuario
                (CodigoUsuario, DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, IdAcademia, FechaCreacion, EstadoRegistro)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 1)`,
      [
        codigoUsuario,
        DNI || null,
        Nombres,
        ApellidoPaterno,
        ApellidoMaterno || "",
        Celular || "",
        CorreoElectronico || null,
        claveHasheada,
        idAcademia,
      ],
    );

    const idGenerado = resultUsuario.insertId;

    await connection.query(
      "INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, 1)",
      [idGenerado, idPerfilSolicitado],
    );

    await connection.commit();
    res.status(201).json({
      message: "Usuario creado y perfil asignado con éxito",
      id: idGenerado,
      codigoUsuario,
    });
  } catch (error) {
    await rollbackSeguro(connection);
    responderError(res, error, "POST /usuarios");
  } finally {
    if (connection) connection.release();
  }
});

// 2. LISTAR USUARIOS (SOLO Administrador; filtra por academia; sin hashes)
router.get("/usuarios", requiereRol("Administrador"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${SELECT_USUARIO}
             WHERE u.EstadoRegistro IN (0, 1) AND u.IdAcademia = ?
             ORDER BY u.IdUsuario DESC`,
      [req.usuario.idAcademia],
    );
    res.json(rows);
  } catch (error) {
    console.error("Error en GET /usuarios:", error.message);
    res.status(500).json({ error: "No se pudieron obtener los usuarios." });
  }
});

// 2a. DIRECTORIO MÍNIMO NO SENSIBLE.
// Los administradores consultan su academia. Docente/tutor solo ven su propia
// entrada hasta acreditar una relacion verificable con los demas usuarios.
// No expone DNI, correo, celular ni hashes; conserva la URL y el array de React.
router.get(
  "/usuarios/directorio",
  requiereRol("Administrador", "Docente", "Tutor de Aula", "Tutor"),
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT
             u.IdUsuario,
             CONCAT(u.Nombres, ' ', COALESCE(u.ApellidoPaterno, ''), ' ', COALESCE(u.ApellidoMaterno, '')) AS NombreCompleto,
             p.Nombre AS Perfil
           FROM Usuario u
           INNER JOIN Usuario_Perfiles up
             ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
           INNER JOIN perfil p
             ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
           WHERE u.EstadoRegistro = 1 AND u.IdAcademia = ?
             AND (? = 1 OR u.IdUsuario = ?)
           ORDER BY u.Nombres ASC, u.ApellidoPaterno ASC`,
        [req.usuario.idAcademia, esPerfilAdministrativo(req.usuario.rol) ? 1 : 0, req.usuario.id],
      );
      res.json(rows);
    } catch (error) {
      console.error("Error en GET /usuarios/directorio:", error.message);
      res.status(500).json({ error: "No se pudo obtener el directorio." });
    }
  },
);

// 2b. DATOS DEL USUARIO AUTENTICADO (Mi Perfil).
// Nunca acepta un IdUsuario arbitrario: siempre usa el de la sesión.
router.get("/usuarios/me", async (req, res) => {
  try {
    const idUsuario = Number(req.usuario?.idUsuario ?? req.usuario?.id);
    if (!Number.isSafeInteger(idUsuario) || idUsuario <= 0) {
      return res
        .status(401)
        .json({ error: "Sesión inválida. Inicia sesión nuevamente." });
    }

    const [rows] = await pool.query(
      `${SELECT_USUARIO}
             WHERE u.IdUsuario = ? AND u.EstadoRegistro = 1
             LIMIT 1`,
      [idUsuario],
    );

    if (!rows.length) {
      return res.status(404).json({ error: "No se encontró tu usuario." });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Error en GET /usuarios/me:", error.message);
    res.status(500).json({ error: "No se pudieron obtener tus datos." });
  }
});

// 2c. AUTOSERVICIO DE DATOS PERSONALES (Mi Perfil).
// Allowlist ESTRICTA: solo Nombres, DNI, CorreoElectronico y Celular.
// Ignora por completo cualquier intento de tocar IdPerfil, rol, EstadoRegistro,
// IdAcademia, CodigoUsuario, Clave, permisos u otro IdUsuario: la identidad
// siempre se toma de req.usuario (sesión validada contra BD).
router.put("/usuarios/me", async (req, res) => {
  let connection;
  try {
    const idUsuario = Number(req.usuario?.idUsuario ?? req.usuario?.id);
    if (!Number.isSafeInteger(idUsuario) || idUsuario <= 0) {
      return res
        .status(401)
        .json({ error: "Sesión inválida. Inicia sesión nuevamente." });
    }

    const validado = validarDatosUsuario(Object.fromEntries(
      ['Nombres', 'DNI', 'CorreoElectronico', 'Celular'].filter((campo) => req.body?.[campo] !== undefined).map((campo) => [campo, req.body[campo]]),
    ));
    if (validado.error) return res.status(400).json({ error: validado.error });
    const { Nombres, DNI, CorreoElectronico, Celular } = validado.datos;

    const campos = [];
    const params = [];
    const asignar = (columna, valor) => {
      campos.push(`${columna}=?`);
      params.push(valor);
    };

    if (Nombres !== undefined) {
      const nombresLimpios = String(Nombres).trim();
      if (!nombresLimpios) {
        return res
          .status(400)
          .json({ error: "El nombre no puede quedar vacío." });
      }
      asignar("Nombres", nombresLimpios);
    }
    if (DNI !== undefined) {
      const dniLimpio = String(DNI ?? "").trim();
      if (dniLimpio && !/^\d{8}$/.test(dniLimpio)) {
        return res.status(400).json({ error: "El DNI debe tener 8 dígitos." });
      }
      asignar("DNI", dniLimpio || null);
    }
    if (CorreoElectronico !== undefined) {
      const correoLimpio = String(CorreoElectronico ?? "").trim();
      if (correoLimpio && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoLimpio)) {
        return res
          .status(400)
          .json({ error: "El correo electrónico no es válido." });
      }
      asignar("CorreoElectronico", correoLimpio || null);
    }
    if (Celular !== undefined) {
      asignar("Celular", String(Celular ?? "").trim());
    }

    if (campos.length === 0) {
      return res
        .status(400)
        .json({ error: "No se enviaron cambios para tu perfil." });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    await bloquearIdentidades(connection);
    const [[actual]] = await connection.query('SELECT DNI, CorreoElectronico FROM Usuario WHERE IdUsuario = ? AND IdAcademia = ? AND EstadoRegistro = 1 FOR UPDATE', [idUsuario, req.usuario.idAcademia]);
    if (!actual) { await connection.rollback(); return res.status(404).json({ error: 'No se encontró tu usuario.' }); }
    if (await usuarioDuplicado(connection, validado.datos, idUsuario, actual)) {
      await connection.rollback();
      return res.status(409).json({ error: 'Ya existe un usuario con ese DNI o correo electrónico.' });
    }
    params.push(idUsuario, req.usuario.idAcademia);
    await connection.query(
      `UPDATE Usuario SET ${campos.join(", ")} WHERE IdUsuario = ? AND IdAcademia = ? AND EstadoRegistro = 1`,
      params,
    );

    const [rows] = await connection.query(
      `${SELECT_USUARIO}
             WHERE u.IdUsuario = ? AND u.EstadoRegistro = 1
             LIMIT 1`,
      [idUsuario],
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: "No se encontró tu usuario." });
    }

    await connection.commit();
    res.json({
      message: "Tus datos se actualizaron con éxito.",
      usuario: rows[0],
    });
  } catch (error) {
    await rollbackSeguro(connection);
    return responderError(res, error, "PUT /usuarios/me");
  } finally {
    if (connection) connection.release();
  }
});

// 3. MODIFICAR USUARIO (actualización PARCIAL; protege al último administrador)
router.put("/usuarios/:id", requiereRol("Administrador"), async (req, res) => {
  const validado = validarDatosUsuario(req.body || {});
  if (validado.error) return res.status(400).json({ error: validado.error });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await bloquearIdentidades(connection);

    const idUsuarioObjetivo = Number(req.params.id);
    if (!Number.isSafeInteger(idUsuarioObjetivo) || idUsuarioObjetivo <= 0) {
      await connection.rollback();
      return res
        .status(400)
        .json({ error: "El identificador de usuario no es válido." });
    }

    const {
      DNI,
      Nombres,
      ApellidoPaterno,
      ApellidoMaterno,
      Celular,
      CorreoElectronico,
      Clave,
    } = validado.datos;
    const { EstadoRegistro, IdPerfil } = req.body || {};

    // El usuario objetivo debe pertenecer a la academia del administrador.
    const [objetivoRows] = await connection.query(
      "SELECT IdUsuario, EstadoRegistro, DNI, CorreoElectronico FROM Usuario WHERE IdUsuario = ? AND IdAcademia = ? AND EstadoRegistro IN (0, 1) FOR UPDATE",
      [idUsuarioObjetivo, req.usuario.idAcademia],
    );
    if (!objetivoRows.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: "Usuario no encontrado en tu academia." });
    }
    const estadoActual = Number(objetivoRows[0].EstadoRegistro);
    if (await usuarioDuplicado(connection, validado.datos, idUsuarioObjetivo, objetivoRows[0])) {
      await connection.rollback();
      return res.status(409).json({ error: 'Ya existe un usuario con ese DNI o correo electrónico.' });
    }

    // ¿El usuario objetivo es administrador ACTIVO actualmente?
    const [perfilActualRows] = await connection.query(
      `SELECT p.Nombre AS NombrePerfil
         FROM Usuario_Perfiles up
         INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
        WHERE up.IdUsuario = ? AND up.EstadoRegistro = 1
        FOR SHARE`,
      [idUsuarioObjetivo],
    );
    const esAdminActual = perfilActualRows.some((perfil) => esPerfilAdministrativo(perfil.NombrePerfil));

    // Validar IdPerfil (existente y activo) antes de tocar al usuario.
    let idPerfilNuevo = null;
    if (IdPerfil !== undefined) {
      idPerfilNuevo = idPerfilValido(IdPerfil);
      if (!idPerfilNuevo) {
        await connection.rollback();
        return res
          .status(400)
          .json({ error: "El IdPerfil enviado no es un identificador válido." });
      }
      const [perfilValido] = await connection.query(
        "SELECT IdPerfil, Nombre FROM perfil WHERE IdPerfil = ? AND EstadoRegistro = 1 LIMIT 1 FOR SHARE",
        [idPerfilNuevo],
      );
      if (!perfilValido.length) {
        await connection.rollback();
        return res
          .status(400)
          .json({ error: "El perfil seleccionado no existe o está inactivo." });
      }

      // No dejar al sistema sin administrador: si el usuario era admin y el
      // nuevo perfil NO es administrativo, debe quedar otro admin activo.
      if (esAdminActual && !esPerfilAdministrativo(perfilValido[0].Nombre)) {
        const hayOtro = await existeOtroAdminActivo(
          connection,
          req.usuario.idAcademia,
          idUsuarioObjetivo,
        );
        if (!hayOtro) {
          await connection.rollback();
          return res.status(409).json({
            error:
              "No puedes quitar el perfil administrativo al último administrador activo.",
          });
        }
      }
    }

    // Validar el estado de acceso (solo 0/1).
    let estadoNum;
    if (EstadoRegistro !== undefined && EstadoRegistro !== null) {
      estadoNum = Number(EstadoRegistro);
      if (![0, 1].includes(estadoNum)) {
        await connection.rollback();
        return res.status(400).json({
          error: "El estado del usuario debe ser 0 (inactivo) o 1 (activo).",
        });
      }

      // No desactivar al último administrador activo.
      if (esAdminActual && estadoActual === 1 && estadoNum === 0) {
        const hayOtro = await existeOtroAdminActivo(
          connection,
          req.usuario.idAcademia,
          idUsuarioObjetivo,
        );
        if (!hayOtro) {
          await connection.rollback();
          return res.status(409).json({
            error: "No puedes desactivar al último administrador activo.",
          });
        }
      }
    }

    // UPDATE PARCIAL: solo se modifican los campos realmente enviados.
    const campos = [];
    const params = [];
    const asignar = (columna, valor) => {
      campos.push(`${columna}=?`);
      params.push(valor);
    };

    if (DNI !== undefined) {
      const dniLimpio = String(DNI ?? "").trim();
      asignar("DNI", dniLimpio || null);
    }
    if (Nombres !== undefined) {
      const nombresLimpios = String(Nombres).trim();
      if (!nombresLimpios) {
        await connection.rollback();
        return res
          .status(400)
          .json({ error: "El nombre no puede quedar vacío." });
      }
      asignar("Nombres", nombresLimpios);
    }
    if (ApellidoPaterno !== undefined) {
      asignar("ApellidoPaterno", String(ApellidoPaterno ?? "").trim());
    }
    if (ApellidoMaterno !== undefined) {
      asignar("ApellidoMaterno", String(ApellidoMaterno ?? ""));
    }
    if (Celular !== undefined) {
      asignar("Celular", String(Celular ?? ""));
    }
    if (CorreoElectronico !== undefined) {
      const correoLimpio = String(CorreoElectronico ?? "").trim();
      asignar("CorreoElectronico", correoLimpio || null);
    }
    if (Clave !== undefined) {
      asignar("Clave", await bcrypt.hash(Clave, 10));
    }
    if (estadoNum !== undefined) {
      asignar("EstadoRegistro", estadoNum);
    }

    if (campos.length === 0 && !idPerfilNuevo) {
      await connection.rollback();
      return res
        .status(400)
        .json({ error: "No se enviaron cambios para el usuario." });
    }

    if (campos.length > 0) {
      params.push(idUsuarioObjetivo, req.usuario.idAcademia);
      // La existencia ya fue verificada; affectedRows=0 solo significa que los
      // valores enviados eran idénticos (no es un error).
      await connection.query(
        `UPDATE Usuario SET ${campos.join(", ")} WHERE IdUsuario = ? AND IdAcademia = ?`,
        params,
      );
    }

    if (idPerfilNuevo) {
      const [existentes] = await connection.query(
        "SELECT IdUsuarioPerfil FROM Usuario_Perfiles WHERE IdUsuario = ? AND IdPerfil = ? ORDER BY IdUsuarioPerfil LIMIT 1 FOR UPDATE",
        [idUsuarioObjetivo, idPerfilNuevo],
      );
      // El usuario esta bloqueado desde el inicio de la transaccion. Se conserva
      // el historial y se reactiva una sola relacion, nunca todas las anteriores.
      await connection.query(
        "UPDATE Usuario_Perfiles SET EstadoRegistro = 0 WHERE IdUsuario = ?",
        [idUsuarioObjetivo],
      );
      if (existentes.length > 0) {
        await connection.query(
          "UPDATE Usuario_Perfiles SET EstadoRegistro = 1 WHERE IdUsuarioPerfil = ?",
          [existentes[0].IdUsuarioPerfil],
        );
      } else {
        await connection.query(
          "INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, 1)",
          [idUsuarioObjetivo, idPerfilNuevo],
        );
      }
    }

    await connection.commit();
    res.json({ message: "Usuario y perfil actualizados con éxito" });
  } catch (error) {
    await rollbackSeguro(connection);
    responderError(res, error, "PUT /usuarios/:id");
  } finally {
    if (connection) connection.release();
  }
});

// 4. ELIMINACIÓN LÓGICA (protege al último administrador)
router.delete(
  "/usuarios/:id",
  requiereRol("Administrador"),
  async (req, res) => {
    let connection;
    try {
      connection = await pool.getConnection();
      const idUsuarioObjetivo = Number(req.params.id);
      if (!Number.isSafeInteger(idUsuarioObjetivo) || idUsuarioObjetivo <= 0) {
        return res
          .status(400)
          .json({ error: "El identificador de usuario no es válido." });
      }

      await connection.beginTransaction();
      await bloquearIdentidades(connection);

      const [objetivoRows] = await connection.query(
        `SELECT u.IdUsuario, u.EstadoRegistro, p.Nombre AS NombrePerfil
           FROM Usuario u
           LEFT JOIN Usuario_Perfiles up ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
           LEFT JOIN perfil p ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
          WHERE u.IdUsuario = ? AND u.IdAcademia = ?
          LIMIT 1`,
        [idUsuarioObjetivo, req.usuario.idAcademia],
      );
      if (!objetivoRows.length) {
        await connection.rollback();
        return res
          .status(404)
          .json({ error: "Usuario no encontrado en tu academia." });
      }

      // No eliminar al último administrador activo.
      if (
        esPerfilAdministrativo(objetivoRows[0].NombrePerfil) &&
        !(await existeOtroAdminActivo(
          connection,
          req.usuario.idAcademia,
          idUsuarioObjetivo,
        ))
      ) {
        await connection.rollback();
        return res
          .status(409)
          .json({ error: "No puedes eliminar al último administrador activo." });
      }

      const [result] = await connection.query(
        "UPDATE Usuario SET EstadoRegistro = -1 WHERE IdUsuario = ? AND IdAcademia = ? AND EstadoRegistro IN (0, 1)",
        [idUsuarioObjetivo, req.usuario.idAcademia],
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ error: "Usuario no encontrado o ya eliminado." });
      }

      await connection.query(
        "UPDATE Usuario_Perfiles SET EstadoRegistro = -1 WHERE IdUsuario = ?",
        [idUsuarioObjetivo],
      );

      await connection.commit();
      res.json({ message: "Usuario eliminado lógicamente con éxito (-1)" });
    } catch (error) {
      await rollbackSeguro(connection);
      responderError(res, error, "DELETE /usuarios/:id");
    } finally {
      if (connection) connection.release();
    }
  },
);

module.exports = router;
