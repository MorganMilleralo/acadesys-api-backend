const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const bcrypt = require("bcrypt");
const requiereRol = require("../middlewares/roles.middleware");
const { validarDatosUsuario, usuarioDuplicado, bloquearIdentidades, rollbackSeguro } = require('../utils/validaciones');
const { enteroPositivo } = require("../utils/evaluaciones");
const path = require("path");
const fs = require("fs");
const { validarTipoArchivo, generarNombreSeguro } = require("../utils/validar-foto");
const { PROFILE_UPLOADS_DIR } = require("../config/storage");
const { consultar, ejecutar } = require('../config/procedimientos');

async function perfilActivo(connection, idPerfil) {
  if (!enteroPositivo(idPerfil)) return false;
  const [perfiles] = await consultar(connection, 'sp_usuario_verificar_perfil', [Number(idPerfil)]);
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
  const [rows] = await consultar(connection, 'sp_usuario_listar_perfiles_usuario', [idAcademia, idUsuarioExcluido]);
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

// Orden de los campos que acepta sp_usuario_actualizar_datos.
const CAMPOS_ACTUALIZABLES = [
  "DNI", "Nombres", "ApellidoPaterno", "ApellidoMaterno", "Celular",
  "CorreoElectronico", "Clave", "EstadoRegistro", "FotoUrl",
];

// Convierte { campo: valor } en los parámetros de sp_usuario_actualizar_datos:
// por cada campo, un indicador (1 = cambiar) y su valor.
function parametrosActualizacion(idUsuario, idAcademia, soloActivos, cambios) {
  const params = [idUsuario, idAcademia, soloActivos ? 1 : 0];
  for (const campo of CAMPOS_ACTUALIZABLES) {
    const presente = Object.prototype.hasOwnProperty.call(cambios, campo);
    params.push(presente ? 1 : 0, presente ? cambios[campo] : null);
  }
  return params;
}

// La columna Usuario.FotoUrl es opcional: puede no existir todavía en una BD
// sin la migración 03_usuario_fotourl.sql. Se detecta una sola vez y se
// cachea para que GET/PUT/DELETE sigan funcionando (sin 500) antes de migrar.
let fotoUrlDisponibleCache = null;
async function columnaFotoUrlDisponible() {
  if (fotoUrlDisponibleCache !== null) return fotoUrlDisponibleCache;
  try {
    const [rows] = await consultar(pool, 'sp_usuario_verificar_columna_foto', []);
    fotoUrlDisponibleCache = rows.length === 1;
  } catch {
    // No cachear el fallo: un error transitorio no debe deshabilitar la foto
    // durante toda la vida del proceso.
    return false;
  }
  return fotoUrlDisponibleCache;
}

async function leerFotoUrl(idUsuario) {
  if (!(await columnaFotoUrlDisponible())) return null;
  const [[fila]] = await consultar(pool, 'sp_usuario_obtener_foto', [idUsuario]);
  return fila?.FotoUrl ?? null;
}

function rutaArchivoFoto(fotoUrl) {
  // Nunca se admite una ruta aportada por el usuario: solo el nombre base.
  return path.join(PROFILE_UPLOADS_DIR, path.basename(String(fotoUrl || "")));
}

function borrarArchivoFoto(fotoUrl) {
  if (!fotoUrl) return;
  try {
    const ruta = rutaArchivoFoto(fotoUrl);
    if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
  } catch (error) {
    console.error("No se pudo eliminar el archivo de foto:", error.message);
  }
}

const TIPOS_FOTO = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

// Borra la foto anterior de MySQL y, si era antigua, también del disco.
// Nunca falla la petición: la foto nueva ya quedó guardada.
async function borrarFotoGuardada(fotoUrl) {
  if (!fotoUrl) return;
  try {
    await ejecutar(pool, 'sp_usuario_eliminar_foto', [path.basename(String(fotoUrl))]);
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") console.error("No se pudo eliminar la foto guardada:", error.message);
  }
  borrarArchivoFoto(fotoUrl);
}

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
    const [[academia]] = await consultar(connection, 'sp_usuario_listar_academia', [idAcademia]);
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
      const [existeCodigo] = await consultar(connection, 'sp_usuario_obtener_usuario_por_codigo_usuario', [candidato]);
      if (existeCodigo.length === 0) {
        codigoUsuario = candidato;
        break;
      }
    }

    const [resultUsuario] = await ejecutar(connection, 'sp_usuario_registrar_usuario', [
        codigoUsuario,
        DNI || null,
        Nombres,
        ApellidoPaterno,
        ApellidoMaterno || "",
        Celular || "",
        CorreoElectronico || null,
        claveHasheada,
        idAcademia,
      ]);

    const idGenerado = resultUsuario.insertId;

    await ejecutar(connection, 'sp_usuario_registrar_usuario_perfil', [idGenerado, idPerfilSolicitado]);

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
    const [rows] = await consultar(pool, 'sp_usuario_listar_usuario_todos', [req.usuario.idAcademia]);
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
      const [rows] = await consultar(pool, 'sp_usuario_listar_usuario_por_rol', [
          req.usuario.idAcademia,
          esPerfilAdministrativo(req.usuario.rol) ? 1 : 0,
          req.usuario.id,
        ]);
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

    const [rows] = await consultar(pool, 'sp_usuario_obtener_detalle', [idUsuario]);

    if (!rows.length) {
      return res.status(404).json({ error: "No se encontró tu usuario." });
    }

    const fotoUrl = await leerFotoUrl(idUsuario).catch((error) => {
      // La foto es complementaria: un fallo al leerla no debe impedir que el
      // usuario vea su perfil. El error queda registrado para diagnóstico.
      console.error("No se pudo leer FotoUrl del perfil:", error.message);
      return null;
    });
    res.json({ ...rows[0], FotoUrl: fotoUrl });
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
  // Deben vivir fuera del try para poder limpiar el archivo en el catch.
  let fotoUrl = null;
  let fotoAnteriorUrl = null;
  let fotoPersistida = false;
  let fotoNueva = null;
  try {
    const idUsuario = Number(req.usuario?.idUsuario ?? req.usuario?.id);
    if (!Number.isSafeInteger(idUsuario) || idUsuario <= 0) {
      return res
        .status(401)
        .json({ error: "Sesión inválida. Inicia sesión nuevamente." });
    }

    // --- Procesar foto de perfil (opcional) ---
    if (req.body?.fotoBase64 !== undefined) {
      if (!(await columnaFotoUrlDisponible())) {
        return res.status(409).json({
          error:
            "La foto de perfil no está disponible: falta aplicar la migración database/migraciones/03_usuario_fotourl.sql.",
        });
      }

      // Construir objeto de archivo para validación. El tamaño real se toma
      // del buffer decodificado, no del valor declarado por el cliente.
      const fileData = {
        mimetype: req.body?.tipoMime || 'image/jpeg',
        size: req.body?.tamanoBytes ? Number(req.body.tamanoBytes) : 0,
        buffer: Buffer.from(String(req.body.fotoBase64), 'base64'),
      };

      const validacion = validarTipoArchivo(fileData);
      if (validacion.error) {
        return res.status(400).json({ error: validacion.error });
      }

      // Generar nombre seguro (nunca usar el nombre original). La imagen se
      // guarda en MySQL (FotoPerfil) dentro de la transacción: el disco de
      // Render se borra en cada despliegue.
      const nombreArchivo = generarNombreSeguro(idUsuario, validacion.formato);
      fotoNueva = { nombreArchivo, buffer: fileData.buffer, tipoMime: TIPOS_FOTO[validacion.formato] };

      // Construir la URL relativa para devolver al cliente
      fotoUrl = `/uploads/perfiles/${nombreArchivo}`;
    }

    const validado = validarDatosUsuario(Object.fromEntries(
      ['Nombres', 'DNI', 'CorreoElectronico', 'Celular'].filter((campo) => req.body?.[campo] !== undefined).map((campo) => [campo, req.body[campo]]),
    ));
    if (validado.error) {
      borrarArchivoFoto(fotoUrl);
      return res.status(400).json({ error: validado.error });
    }
    const { Nombres, DNI, CorreoElectronico, Celular } = validado.datos;

    const cambios = {};
    const asignar = (columna, valor) => {
      cambios[columna] = valor;
    };

    // Persistir la nueva foto junto con los datos personales (misma transacción).
    if (fotoUrl) asignar("FotoUrl", fotoUrl);

    if (Nombres !== undefined) {
      const nombresLimpios = String(Nombres).trim();
      if (!nombresLimpios) {
        // Si falla la validación de nombre, intentar limpiar el archivo subido
        borrarArchivoFoto(fotoUrl);
        return res.status(400).json({ error: "El nombre no puede quedar vacío." });
      }
      asignar("Nombres", nombresLimpios);
    }
    if (DNI !== undefined) {
      const dniLimpio = String(DNI ?? "").trim();
      if (dniLimpio && !/^\d{8}$/.test(dniLimpio)) {
        // Si falla la validación de DNI, intentar limpiar el archivo subido
        borrarArchivoFoto(fotoUrl);
        return res.status(400).json({ error: "El DNI debe tener 8 dígitos." });
      }
      asignar("DNI", dniLimpio || null);
    }
    if (CorreoElectronico !== undefined) {
      const correoLimpio = String(CorreoElectronico ?? "").trim();
      if (correoLimpio && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoLimpio)) {
        // Si falla la validación de correo, intentar limpiar el archivo subido
        borrarArchivoFoto(fotoUrl);
        return res.status(400).json({ error: "El correo electrónico no es válido." });
      }
      asignar("CorreoElectronico", correoLimpio || null);
    }
    if (Celular !== undefined) {
      asignar("Celular", String(Celular ?? "").trim());
    }

    // Verificar que al menos haya un cambio (datos o foto)
    const hayCambios = Object.keys(cambios).length > 0 || req.body?.fotoBase64 !== undefined;
    if (!hayCambios) {
      return res
        .status(400)
        .json({ error: "No se enviaron cambios para tu perfil." });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    await bloquearIdentidades(connection);
    const [[actual]] = await consultar(connection, 'sp_usuario_bloquear_datos_actuales', [idUsuario, req.usuario.idAcademia]);
    if (!actual) { await connection.rollback(); borrarArchivoFoto(fotoUrl); return res.status(404).json({ error: 'No se encontró tu usuario.' }); }
    fotoAnteriorUrl = actual.FotoUrl || null;
    if (await usuarioDuplicado(connection, validado.datos, idUsuario, actual)) {
      await connection.rollback();
      borrarArchivoFoto(fotoUrl);
      return res.status(409).json({ error: 'Ya existe un usuario con ese DNI o correo electrónico.' });
    }
    await ejecutar(
      connection,
      'sp_usuario_actualizar_datos',
      parametrosActualizacion(idUsuario, req.usuario.idAcademia, true, cambios),
    );
    if (fotoNueva) {
      await ejecutar(connection, 'sp_usuario_registrar_foto', [
          fotoNueva.nombreArchivo,
          idUsuario,
          fotoNueva.buffer,
          fotoNueva.tipoMime,
          fotoNueva.buffer.length,
        ]);
    }

    const [rows] = await consultar(connection, 'sp_usuario_obtener_detalle', [idUsuario]);
    if (!rows.length) {
      await connection.rollback();
      borrarArchivoFoto(fotoUrl);
      return res.status(404).json({ error: "No se encontró tu usuario." });
    }

    await connection.commit();
    fotoPersistida = true;
    // Solo se elimina la foto anterior DESPUÉS de confirmar la transacción.
    // Si el commit falla, el archivo al que apunta la BD no se pierde.
    if (fotoUrl && fotoAnteriorUrl && fotoAnteriorUrl !== fotoUrl) {
      await borrarFotoGuardada(fotoAnteriorUrl);
    }
    let fotoActual = fotoUrl;
    try {
      fotoActual = (await leerFotoUrl(idUsuario)) ?? fotoUrl;
    } catch {
      // La foto ya quedó persistida: no convertir un fallo de lectura en un
      // falso error de guardado. Se devuelve la URL recién generada.
    }
    res.json({
      message: "Tus datos se actualizaron con éxito.",
      usuario: { ...rows[0], FotoUrl: fotoActual },
    });
  } catch (error) {
    await rollbackSeguro(connection);
    if (!fotoPersistida) borrarArchivoFoto(fotoUrl);
    if (error?.code === "ER_NO_SUCH_TABLE") {
      console.error("Falta la tabla FotoPerfil (database/migraciones/07_foto_perfil_y_cuotas.sql).");
      return res.status(503).json({ code: "ALMACEN_NO_CONFIGURADO", error: "El almacenamiento de fotos no está configurado. Avisa al administrador del sistema." });
    }
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
    const [objetivoRows] = await consultar(connection, 'sp_usuario_bloquear_usuario', [idUsuarioObjetivo, req.usuario.idAcademia]);
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
    const [perfilActualRows] = await consultar(connection, 'sp_usuario_listar_usuario_perfil', [idUsuarioObjetivo]);
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
      const [perfilValido] = await consultar(connection, 'sp_usuario_obtener_perfil', [idPerfilNuevo]);
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

    // Actualización parcial: solo se modifican los campos realmente enviados.
    const cambios = {};
    const asignar = (columna, valor) => {
      cambios[columna] = valor;
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

    const hayCambios = Object.keys(cambios).length > 0;
    if (!hayCambios && !idPerfilNuevo) {
      await connection.rollback();
      return res
        .status(400)
        .json({ error: "No se enviaron cambios para el usuario." });
    }

    if (hayCambios) {
      // La existencia ya fue verificada; affectedRows = 0 solo significa que los
      // valores enviados eran idénticos (no es un error).
      await ejecutar(
        connection,
        'sp_usuario_actualizar_datos',
        parametrosActualizacion(idUsuarioObjetivo, req.usuario.idAcademia, false, cambios),
      );
    }

    if (idPerfilNuevo) {
      // Se conserva el historial: se desactivan los perfiles anteriores y se
      // reactiva (o crea) solo el perfil indicado.
      await ejecutar(connection, 'sp_usuario_asignar_perfil', [idUsuarioObjetivo, idPerfilNuevo]);
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

      const [objetivoRows] = await consultar(connection, 'sp_usuario_obtener_estado_perfil', [idUsuarioObjetivo, req.usuario.idAcademia]);
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

      const [result] = await ejecutar(connection, 'sp_usuario_cambiar_estado_usuario', [idUsuarioObjetivo, req.usuario.idAcademia]);

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ error: "Usuario no encontrado o ya eliminado." });
      }

      await ejecutar(connection, 'sp_usuario_cambiar_estado_usuario_perfil', [idUsuarioObjetivo]);

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

  // 2d. ELIMINAR FOTO DE PERFIL (Mi Perfil)
  // Elimina la foto del usuario autenticado: pone FotoUrl = NULL en BD
  // y elimina el archivo físico si existe en uploads/perfiles/.
  // Nunca acepta IdUsuario del cliente: la identidad viene del JWT.
  router.delete("/usuarios/me/foto", async (req, res) => {
    let connection;
    try {
      const idUsuario = Number(req.usuario?.idUsuario ?? req.usuario?.id);
      if (!Number.isSafeInteger(idUsuario) || idUsuario <= 0) {
        return res
          .status(401)
          .json({ error: "Sesión inválida. Inicia sesión nuevamente." });
      }

      if (!(await columnaFotoUrlDisponible())) {
        return res.status(409).json({
          error:
            "La foto de perfil no está disponible: falta aplicar la migración database/migraciones/03_usuario_fotourl.sql.",
        });
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Verificar que el usuario existe
      const [[usuario]] = await consultar(connection, 'sp_usuario_listar_foto_activa', [idUsuario]);
      if (!usuario) {
        await connection.rollback();
        return res.status(404).json({ error: 'No se encontró tu usuario.' });
      }

      // Quitar referencia de foto en la BD (poner NULL)
      await ejecutar(connection, 'sp_usuario_actualizar_usuario', [idUsuario]);

      await connection.commit();

      // Eliminar el archivo físico DESPUÉS del commit para no dejar FotoUrl
      // apuntando a un archivo borrado si la transacción pudiera revertirse.
      if (usuario.FotoUrl) await borrarFotoGuardada(usuario.FotoUrl);
      res.json({ message: "Foto de perfil eliminada con éxito." });
    } catch (error) {
      await rollbackSeguro(connection);
      console.error('Error en DELETE /usuarios/me/foto:', error.message);
      res.status(500).json({ error: 'No se pudo completar la operación.' });
    } finally {
      if (connection) connection.release();
    }
  });

module.exports = router;


