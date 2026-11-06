const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const {
  usuarioDuplicado,
  bloquearIdentidades,
  rollbackSeguro,
} = require("../utils/validaciones");
const {
  obtenerEstadoCicloValido,
  obtenerPrecioCiclo,
  capacidadPermiteMatricula,
  obtenerIdAcademiaPublica,
} = require("../utils/reglas-matricula");
const { obtenerPrecioInscripcion } = require("../utils/pagos");
const autenticacionOpcional = require("../middlewares/autenticacion-opcional.middleware");
const {
  validarAutorizacionReinscripcion,
} = require("../utils/autorizacion-reinscripcion");
const {
  crearTokenVerificacionMatricula,
  verificarTokenVerificacionMatricula,
} = require("../utils/token-verificacion-matricula");

const URL_GOOGLE_SCRIPT = String(process.env.GOOGLE_SCRIPT_URL || "").trim();
const GOOGLE_SCRIPT_TOKEN = String(process.env.GOOGLE_SCRIPT_TOKEN || "").trim();
const API_PUBLIC_URL = (
  process.env.API_PUBLIC_URL || "https://acadesys-api.onrender.com"
).replace(/\/+$/, "");
const PROPOSITO_RESET = "reinscripcion-password-reset";

const UNIVERSIDADES = new Set([
  "UNMSM",
  "UNI",
  "PUCP",
  "UNFV",
  "UNAC",
  "UNT",
  "UNALM",
  "UPCH",
  "ULIMA",
  "UPC",
  "USMP",
  "UTP",
  "Preuniversitario",
]);

function normalizarCorreo(correo = "") {
  return String(correo).trim().toLowerCase();
}

function correoValido(correo = "") {
  return correo.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
}

function textoNombreValido(texto = "") {
  const limpio = String(texto).trim().replace(/\s+/g, " ");
  return (
    limpio.length >= 2 &&
    limpio.length <= 100 &&
    /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü .'-]+$/.test(limpio)
  );
}

function generarClaveTemporal() {
  // Contraseña temporal aleatoria con suficiente longitud para el acceso.
  return crypto.randomBytes(8).toString("hex").toUpperCase();
}

function huellaClave(claveHash) {
  // Permite invalidar el enlace después del primer cambio sin guardar el token.
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(String(claveHash || ""))
    .digest("hex");
}

async function enviarCorreoHtml(to, subject, htmlBody) {
  if (!URL_GOOGLE_SCRIPT || !GOOGLE_SCRIPT_TOKEN || GOOGLE_SCRIPT_TOKEN.length < 32) {
    throw new Error("Servicio de correo no configurado correctamente.");
  }

  const response = await fetch(URL_GOOGLE_SCRIPT, {
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, htmlBody, token: GOOGLE_SCRIPT_TOKEN }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.status !== "success") {
    throw new Error(
      data?.message || "El servicio de correo no confirmó el envío.",
    );
  }
  return data;
}

function escaparHtml(valor) {
  return String(valor ?? "").replace(
    /[&<>"']/g,
    (caracter) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[caracter],
  );
}

async function enviarCorreoCheckout(correoParaEnviar, datosCorreo) {
  const asunto = datosCorreo.esReinscripcion
    ? `Reinscripción exitosa - ${datosCorreo.cicloNombre}`
    : `Bienvenido a AcadeSys - ${datosCorreo.cicloNombre}`;

  let bloqueClave;
  if (datosCorreo.esReinscripcion) {
    const tokenRecuperacion = jwt.sign(
      {
        idUsuario: datosCorreo.idUsuario,
        correo: correoParaEnviar,
        proposito: PROPOSITO_RESET,
        claveVersion: datosCorreo.claveVersion,
        codigoUsuario: datosCorreo.codigoUsuario,
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );
    const enlaceRecuperacion = `${API_PUBLIC_URL}/api/matriculas/restablecer-clave?token=${encodeURIComponent(tokenRecuperacion)}`;
    bloqueClave = `
      <p>Tu cuenta y código de usuario se conservaron. Para recibir una contraseña temporal nueva, confirma que tienes acceso a este correo.</p>
      <p style="margin:24px 0;"><a href="${escaparHtml(enlaceRecuperacion)}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;font-weight:bold;">Generar contraseña temporal</a></p>
      <p>Este enlace vence en 15 minutos y solo puede utilizarse una vez.</p>
    `;
  } else {
    bloqueClave = `<p><strong>Contraseña temporal:</strong> <span style="font-family: monospace;">${escaparHtml(datosCorreo.claveSinEncriptar)}</span></p><p>Guarda esta contraseña en un lugar seguro.</p>`;
  }

  const cuerpoHtml = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px; max-width: 600px;">
      <h2 style="color: #2563eb;">¡Hola, ${escaparHtml(datosCorreo.nombre)}!</h2>
      <p>Tu ${datosCorreo.esReinscripcion ? "reinscripción" : "inscripción"} al <strong>${escaparHtml(datosCorreo.cicloNombre)}</strong> fue procesada correctamente.</p>
      <p><strong>Monto de inscripción:</strong> S/ ${Number(datosCorreo.precio || 0).toFixed(2)}</p>
      <p><strong>Estado del pago:</strong> ${escaparHtml(datosCorreo.estadoPago || "Pendiente")}.</p>
      ${String(datosCorreo.estadoPago || "Pendiente").toLowerCase() === "pagado" ? "<p>Se conservó el registro de pago existente; no se creó un cobro duplicado.</p>" : "<p>AcadeSys no ha confirmado un cobro real. Registra el comprobante o completa el método de pago habilitado por la academia.</p>"}
      <p><strong>Código de usuario:</strong> <span style="font-family: monospace;">${escaparHtml(datosCorreo.codigoUsuario)}</span></p>
      ${bloqueClave}
      <p>Gracias por confiar en AcadeSys.</p>
    </div>`;

  return enviarCorreoHtml(correoParaEnviar, asunto, cuerpoHtml);
}

/**
 * En el checkout público, primero se comprueba el control del buzón. No consulta
 * si el correo ya pertenece a una cuenta y no escribe Usuario/Matricula/Pagos.
 */
async function enviarCorreoVerificacionMatricula(correo, datos, token) {
  const enlace = `${API_PUBLIC_URL}/api/matriculas/confirmar-correo-matricula?token=${encodeURIComponent(token)}`;
  const cuerpoHtml = `
    <div style="font-family:Arial,sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:10px;max-width:600px;">
      <h2 style="color:#0f766e;">Confirma tu correo para continuar</h2>
      <p>Hola, ${escaparHtml(datos.nombre)}.</p>
      <p>Recibimos una solicitud para continuar con una matrícula en AcadeSys. Para demostrar que puedes recibir mensajes en este correo y continuar, abre el enlace de confirmación.</p>
      <p style="margin:24px 0;"><a href="${escaparHtml(enlace)}" style="background:#0d9488;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;font-weight:bold;">Confirmar correo y continuar</a></p>
      <p>El enlace vence en 15 minutos. Por ahora <strong>no se ha creado una cuenta, matrícula ni pago</strong>.</p>
      <p>Si ya tienes cuenta de alumno, el sistema te indicará que debes iniciar sesión. Si tú no iniciaste esta solicitud, ignora este mensaje.</p>
      <p>La selección es para el ciclo: <strong>${escaparHtml(datos.cicloNombre)}</strong>.</p>
      <p>AcadeSys - Academia preuniversitaria</p>
    </div>`;
  return enviarCorreoHtml(
    correo,
    "Confirma tu correo para continuar con AcadeSys",
    cuerpoHtml,
  );
}

async function iniciarVerificacionMatricula(res, datos) {
  const idAcademiaPublica = obtenerIdAcademiaPublica();
  if (!idAcademiaPublica) {
    return res.status(503).json({
      code: "CONFIGURACION_ACADEMIA_PUBLICA_INVALIDA",
      error:
        "La oferta pública no está configurada correctamente. Contacta a la academia.",
    });
  }

  let ciclo;
  try {
    ciclo = await obtenerCicloDisponible(datos.idCiclo);
  } catch (error) {
    console.error(
      "No se pudo consultar el ciclo antes de verificar el correo:",
      error?.name || "Error",
    );
    return res
      .status(500)
      .json({ error: "No se pudo comprobar el ciclo. Inténtalo nuevamente." });
  }

  if (!ciclo || Number(ciclo.IdAcademia) !== idAcademiaPublica) {
    return res
      .status(404)
      .json({ error: "El ciclo seleccionado no está disponible." });
  }

  const estadoCiclo = obtenerEstadoCicloValido(ciclo);
  if (estadoCiclo !== "ABIERTO") {
    return res.status(409).json({
      code: "CICLO_NO_DISPONIBLE",
      error: "El ciclo seleccionado ya no admite nuevas matrículas.",
    });
  }
  if (!capacidadPermiteMatricula(ciclo.TotalAlumnos, ciclo.Capacidad)) {
    return res
      .status(409)
      .json({
        code: "CICLO_SIN_VACANTES",
        error: "El ciclo seleccionado ya alcanzó su capacidad máxima.",
      });
  }
  if (obtenerPrecioInscripcion(ciclo) === null) {
    return res
      .status(409)
      .json({
        code: "CICLO_PRECIO_NO_CONFIGURADO",
        error: "El ciclo todavía no tiene un precio válido publicado.",
      });
  }

  let token;
  try {
    token = crearTokenVerificacionMatricula({
      nombres: datos.nombre,
      apellidos: datos.apellidos,
      correo: datos.correo,
      idCiclo: datos.idCiclo,
    });
  } catch (error) {
    console.error(
      "No se pudo preparar la verificación de correo:",
      error?.name || "Error",
    );
    return res
      .status(503)
      .json({
        code: "CONFIGURACION_TOKEN_INVALIDA",
        error: "No se pudo preparar la verificación. Contacta a la academia.",
      });
  }

  try {
    await enviarCorreoVerificacionMatricula(
      datos.correo,
      { nombre: datos.nombre, cicloNombre: ciclo.Nombre },
      token,
    );
  } catch (error) {
    // No se escribe nada en la BD antes de confirmar que el proveedor aceptó el mensaje.
    console.error(
      "No se pudo enviar el correo de verificación de matrícula:",
      error?.name || "Error",
    );
    return res
      .status(502)
      .json({
        code: "VERIFICACION_CORREO_NO_ENVIADA",
        error:
          "No se pudo enviar el correo de verificación. No se creó matrícula ni se realizó un cobro.",
      });
  }

  // Mismo contrato tanto si el buzón ya existe como si aún no tiene cuenta.
  return res.status(202).json({
    aceptada: true,
    verificacionRequerida: true,
    matriculaRegistrada: false,
    correo: { estado: "enviado" },
    mensaje:
      "Te enviamos un enlace para continuar. Aún no se ha creado una cuenta ni una matrícula y no se ha realizado ningún cobro.",
  });
}

function generarCodigo(prefix) {
  const base =
    String(prefix || "ACAD")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 10) || "ACAD";
  const aleatorio = Math.floor(1000 + Math.random() * 9000);
  return `${base}-${aleatorio}`;
}

function universidadDesdeNombre(nombre = "") {
  const n = String(nombre).toLowerCase();
  if (n.includes("san marcos") || n.includes("unmsm")) return "UNMSM";
  if (/\buni\b/.test(n) || n.includes("ingenier")) return "UNI";
  if (n.includes("pucp") || n.includes("católica") || n.includes("catolica"))
    return "PUCP";
  if (n.includes("villarreal") || n.includes("unfv")) return "UNFV";
  if (n.includes("callao") || n.includes("unac")) return "UNAC";
  if (n.includes("trujillo") || n.includes("unt")) return "UNT";
  return "Preuniversitario";
}

async function obtenerCicloDisponible(
  idCiclo,
  connection = pool,
  bloquear = false,
) {
  const lock = bloquear ? " FOR UPDATE" : "";
  const [rows] = await connection.query(
    `
    SELECT
      c.IdCiclo,
      c.IdAcademia,
      c.Nombre,
      c.PrefijoCodigo,
      c.UniversidadObjetivo,
      c.Turno,
      c.Horario,
      c.DiasClase,
      c.FechaInicio,
      c.FechaFin,
      c.PrecioInscripcion,
      c.PrecioMensual,
      c.Precio,
      c.Capacidad,
      c.EstadoRegistro,
      (
        SELECT COUNT(*)
        FROM Matricula m
        INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
        WHERE m.IdCiclo = c.IdCiclo
          AND m.EstadoRegistro = 1
          AND u.EstadoRegistro = 1
          AND u.IdAcademia = c.IdAcademia
      ) AS TotalAlumnos
    FROM Ciclo c
    WHERE c.IdCiclo = ?
    LIMIT 1${lock}
  `,
    [idCiclo],
  );

  return rows[0] || null;
}

async function buscarAlumnoActivoPorCorreo(
  correo,
  idAcademia,
  connection = pool,
  bloquear = false,
) {
  const lock = bloquear ? " FOR UPDATE" : "";
  const [rows] = await connection.query(
    `
    SELECT
      u.IdUsuario,
      u.CodigoUsuario,
      u.Nombres,
      u.ApellidoPaterno,
      u.ApellidoMaterno,
      u.CorreoElectronico,
      u.IdAcademia,
      u.EstadoRegistro,
      up.IdPerfil,
      p.Nombre AS NombrePerfil
    FROM Usuario u
    INNER JOIN Usuario_Perfiles up
      ON up.IdUsuario = u.IdUsuario
     AND up.EstadoRegistro = 1
    INNER JOIN perfil p
      ON p.IdPerfil = up.IdPerfil
     AND p.EstadoRegistro = 1
    WHERE LOWER(TRIM(u.CorreoElectronico)) = ?
      AND u.EstadoRegistro = 1
    ORDER BY CASE WHEN u.IdAcademia = ? THEN 0 ELSE 1 END,
             CASE WHEN LOWER(TRIM(p.Nombre)) = 'alumno' THEN 0 ELSE 1 END
    LIMIT 1${lock}
  `,
    [correo, idAcademia],
  );

  if (rows.length === 0) return null;
  return rows[0];
}

/* ============================================================
   POST /api/matriculas/verificar
   Verifica identidad existente y ciclos actuales.
   ============================================================ */
router.post("/verificar", async (req, res) => {
  const correo = normalizarCorreo(req.body?.correo);
  const idCiclo = Number(req.body?.idCiclo);

  if (!correo || !correoValido(correo)) {
    return res
      .status(400)
      .json({ error: "Debes proporcionar un correo electrónico válido." });
  }
  if (!Number.isSafeInteger(idCiclo) || idCiclo <= 0) {
    return res
      .status(400)
      .json({ error: "Debes proporcionar un IdCiclo válido." });
  }

  try {
    const idAcademiaPublica = obtenerIdAcademiaPublica();
    if (!idAcademiaPublica) {
      return res.status(503).json({
        code: "CONFIGURACION_ACADEMIA_PUBLICA_INVALIDA",
        error:
          "La oferta pública no está configurada correctamente. Contacta a la academia.",
      });
    }

    const ciclo = await obtenerCicloDisponible(idCiclo);
    // Respuesta genérica: este endpoint NO consulta ni devuelve si una cuenta
    // existe. La autorización de cualquier reinscripción se valida en checkout.
    if (!ciclo || Number(ciclo.IdAcademia) !== idAcademiaPublica) {
      return res
        .status(404)
        .json({ error: "El ciclo seleccionado no está disponible." });
    }

    const estadoCiclo = obtenerEstadoCicloValido(ciclo);
    if (estadoCiclo !== "ABIERTO") {
      return res.status(409).json({
        code: "CICLO_NO_DISPONIBLE",
        error:
          estadoCiclo === "CERRADO"
            ? "El ciclo seleccionado se encuentra cerrado o no está publicado."
            : "El ciclo seleccionado ya no admite nuevas inscripciones.",
      });
    }

    if (!capacidadPermiteMatricula(ciclo.TotalAlumnos, ciclo.Capacidad)) {
      return res.status(409).json({
        code: "CICLO_SIN_VACANTES",
        error: "El ciclo seleccionado ya alcanzó su capacidad máxima.",
      });
    }

    return res.status(200).json({
      disponible: true,
      idCiclo,
      mensaje:
        "El ciclo está disponible para continuar. La validación final se realizará al registrar la matrícula.",
    });
  } catch (error) {
    console.error(
      "No se pudo validar la disponibilidad del ciclo:",
      error?.name || "Error",
    );
    return res
      .status(500)
      .json({
        error: "No se pudo comprobar la disponibilidad. Inténtalo nuevamente.",
      });
  }
});

/* ============================================================
   POST /api/matriculas/checkout
   Inscripción/reinscripción transaccional.
   ============================================================ */
async function procesarCheckout(req, res, { correoVerificado = false } = {}) {
  const nombre = String(req.body?.Nombres ?? req.body?.nombres ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const apellidos = String(req.body?.Apellidos ?? req.body?.apellidos ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const correo = normalizarCorreo(req.body?.Correo ?? req.body?.correo);
  const idCiclo = Number(req.body?.IdCiclo ?? req.body?.idCiclo);

  if (!textoNombreValido(nombre)) {
    return res
      .status(400)
      .json({ error: "Los nombres no tienen un formato válido." });
  }
  if (!textoNombreValido(apellidos)) {
    return res
      .status(400)
      .json({ error: "Los apellidos no tienen un formato válido." });
  }
  if (!correoValido(correo)) {
    return res
      .status(400)
      .json({ error: "El correo electrónico no tiene un formato válido." });
  }
  if (!Number.isInteger(idCiclo) || idCiclo <= 0) {
    return res.status(400).json({ error: "El IdCiclo no es válido." });
  }

  // Si no existe proveedor de correo, no se crea una cuenta/matrícula que el
  // usuario no pueda recibir por email. Esta respuesta ocurre antes de abrir
  // una transacción o modificar datos.
  if (!URL_GOOGLE_SCRIPT) {
    return res.status(503).json({
      code: "CORREO_NO_CONFIGURADO",
      error:
        "No se registró la matrícula porque el servicio de correo no está configurado. Inténtalo más tarde o contacta a la academia.",
    });
  }

  // Visitantes públicos primero deben demostrar que controlan el correo. En este
  // paso no se busca por email ni se crean registros; así no se enumera cuentas.
  if (!req.usuario && !correoVerificado) {
    return iniciarVerificacionMatricula(res, {
      nombre,
      apellidos,
      correo,
      idCiclo,
    });
  }

  let connection;
  let enTransaccion = false;
  let correoParaEnviar = null;
  let datosCorreo = null;
  let pagoCheckout = null;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    enTransaccion = true;
    await bloquearIdentidades(connection);

    /* 1. Bloqueamos el ciclo para impedir sobreventa/concurrencia. */
    const ciclo = await obtenerCicloDisponible(idCiclo, connection, true);

    if (!ciclo) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: "El ciclo seleccionado no existe." });
    }

    const idAcademiaPublica = obtenerIdAcademiaPublica();
    if (!idAcademiaPublica) {
      await connection.rollback();
      return res.status(503).json({
        code: "CONFIGURACION_ACADEMIA_PUBLICA_INVALIDA",
        error: "La matrícula pública no está configurada correctamente.",
      });
    }
    if (!req.usuario && Number(ciclo.IdAcademia) !== idAcademiaPublica) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: "El ciclo seleccionado no está disponible." });
    }

    const estadoCiclo = obtenerEstadoCicloValido(ciclo);
    if (estadoCiclo !== "ABIERTO") {
      await connection.rollback();
      return res.status(409).json({
        error:
          estadoCiclo === "CERRADO"
            ? "El ciclo está cerrado y no admite nuevas matrículas."
            : "El ciclo ya no admite nuevas matrículas.",
      });
    }

    // Count active registrations after the cycle row is locked. Every checkout
    // locks the same cycle row first, so concurrent requests cannot oversell seats.
    const [matriculasActivasCiclo] = await connection.query(
      `SELECT m.IdMatricula
       FROM Matricula m
       INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
       WHERE m.IdCiclo = ?
         AND m.EstadoRegistro = 1
         AND u.EstadoRegistro = 1
         AND u.IdAcademia = ?
       FOR UPDATE`,
      [idCiclo, ciclo.IdAcademia],
    );
    const totalAlumnos = matriculasActivasCiclo.length;
    // Capacidad real del ciclo (0/null => sin límite definido).
    const capacidad = Number(ciclo.Capacidad || 0);
    if (!capacidadPermiteMatricula(totalAlumnos, ciclo.Capacidad)) {
      await connection.rollback();
      return res
        .status(409)
        .json({
          error: "El ciclo seleccionado ya alcanzó su capacidad máxima.",
        });
    }

    /* 2. Precio real desde BD. Nunca confiar en monto enviado por frontend. */
    const precioConfigurado = obtenerPrecioInscripcion(ciclo);
    if (precioConfigurado === null) {
      await connection.rollback();
      return res.status(409).json({
        code: "CICLO_PRECIO_NO_CONFIGURADO",
        error:
          "El ciclo no tiene un precio válido configurado. Contacta a la academia.",
      });
    }
    const precioReal = precioConfigurado;
    const montoReportado = req.body?.monto ?? req.body?.Monto;
    if (
      montoReportado !== undefined &&
      montoReportado !== null &&
      montoReportado !== ""
    ) {
      const montoCliente = Number(montoReportado);
      if (!Number.isFinite(montoCliente) || montoCliente < 0) {
        await connection.rollback();
        return res
          .status(400)
          .json({ error: "El monto enviado no es válido." });
      }
    }

    /* 3. Si existe usuario, bloqueamos su fila antes de revisar duplicados. */
    const [usuarios] = await connection.query(
      `
      SELECT
        u.IdUsuario,
        u.CodigoUsuario,
        u.Nombres,
        u.ApellidoPaterno,
        u.Clave AS ClaveHash,
        u.CorreoElectronico,
        u.IdAcademia,
        u.EstadoRegistro,
        up.IdPerfil,
        p.Nombre AS NombrePerfil
      FROM Usuario u
      INNER JOIN Usuario_Perfiles up
        ON up.IdUsuario = u.IdUsuario
       AND up.EstadoRegistro = 1
      INNER JOIN perfil p
        ON p.IdPerfil = up.IdPerfil
       AND p.EstadoRegistro = 1
      WHERE LOWER(TRIM(u.CorreoElectronico)) = ?
        AND u.EstadoRegistro = 1
      ORDER BY CASE WHEN LOWER(TRIM(p.Nombre)) = 'alumno' THEN 0 ELSE 1 END
      LIMIT 2
      FOR UPDATE
    `,
      [correo],
    );

    if (usuarios.length > 1) {
      await connection.rollback();
      return res.status(409).json({
        code: "CORREO_ASOCIADO_A_VARIAS_CUENTAS",
        error:
          "Este correo está asociado a más de una cuenta activa. La administración debe revisar los datos antes de continuar.",
      });
    }

    let idAlumnoFinal = null;
    let codigoUsuarioFinal = null;
    let esReinscripcion = false;
    let claveSinEncriptar = null;
    let claveVersion = null;

    if (usuarios.length > 0) {
      const existente = usuarios[0];
      const rechazoReinscripcion = validarAutorizacionReinscripcion({
        usuarioSesion: req.usuario,
        usuarioExistente: existente,
        ciclo,
      });
      if (rechazoReinscripcion) {
        await connection.rollback();
        return res
          .status(rechazoReinscripcion.status)
          .json(rechazoReinscripcion.body);
      }

      const esAlumno = ["alumno", "estudiante"].includes(
        String(existente.NombrePerfil || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toLowerCase(),
      );

      if (!esAlumno) {
        await connection.rollback();
        return res.status(409).json({
          error:
            "El correo ya pertenece a una cuenta que no tiene el perfil Alumno. No se puede reutilizar para una matrícula pública.",
        });
      }

      if (Number(existente.IdAcademia) !== Number(ciclo.IdAcademia)) {
        await connection.rollback();
        return res.status(409).json({
          error:
            "El correo pertenece a otra academia y no puede reutilizarse en este ciclo.",
        });
      }

      idAlumnoFinal = existente.IdUsuario;
      codigoUsuarioFinal = existente.CodigoUsuario;
      esReinscripcion = true;
      // La clave actual se mantiene. El alumno podrá solicitar una temporal
      // nueva mediante un enlace verificado enviado a su correo.
      claveVersion = huellaClave(existente.ClaveHash);

      const [yaMatriculado] = await connection.query(
        `
        SELECT IdMatricula
        FROM Matricula
        WHERE IdUsuario = ?
          AND IdCiclo = ?
          AND EstadoRegistro = 1
        LIMIT 1
        FOR UPDATE
      `,
        [idAlumnoFinal, idCiclo],
      );

      if (yaMatriculado.length > 0) {
        await connection.rollback();
        return res.status(409).json({
          error: `Ya te encuentras matriculado en el ciclo "${ciclo.Nombre}".`,
          yaInscritoEnCiclo: true,
          idCiclo,
        });
      }

      // Conocer un correo no autoriza a cambiar los datos de su propietario.
    } else {
      // El endpoint público crea cuentas nuevas solo para visitantes. Una sesión
      // administrativa/ajena no debe poder usar checkout como alta de usuario.
      if (req.usuario) {
        await connection.rollback();
        return res.status(403).json({
          code: "ALTA_PUBLICA_REQUIERE_SESION_CERRADA",
          error:
            "Cierra sesión para iniciar una matrícula nueva o usa la cuenta del alumno para reinscribirte.",
        });
      }

      if (await usuarioDuplicado(connection, { CorreoElectronico: correo })) {
        await connection.rollback();
        return res.status(409).json({
          error:
            "Este correo ya está registrado en el sistema. Vuelve a iniciar sesión o solicita a la administración la reactivación de tu cuenta.",
        });
      }
      /* 4. Alumno nuevo. */
      const [perfilesAlumno] = await connection.query(`
        SELECT IdPerfil
        FROM perfil
        WHERE EstadoRegistro = 1
          AND LOWER(TRIM(Nombre)) = 'alumno'
        LIMIT 1
      `);

      if (perfilesAlumno.length === 0) {
        await connection.rollback();
        return res
          .status(500)
          .json({
            error: "No está configurado el perfil Alumno en la base de datos.",
          });
      }

      let codigoUsuario = "";
      for (let intento = 0; intento < 15; intento += 1) {
        const candidato = generarCodigo(
          ciclo.PrefijoCodigo || universidadDesdeNombre(ciclo.Nombre),
        );
        const [codigoExistente] = await connection.query(
          "SELECT IdUsuario FROM Usuario WHERE CodigoUsuario = ? LIMIT 1",
          [candidato],
        );
        if (codigoExistente.length === 0) {
          codigoUsuario = candidato;
          break;
        }
      }

      if (!codigoUsuario) {
        await connection.rollback();
        return res
          .status(500)
          .json({
            error: "No se pudo generar un código de alumno disponible.",
          });
      }

      claveSinEncriptar = generarClaveTemporal();
      const claveHasheada = await bcrypt.hash(claveSinEncriptar, 10);

      const [resultUsuario] = await connection.query(
        `
        INSERT INTO Usuario
          (CodigoUsuario, DNI, Nombres, ApellidoPaterno, ApellidoMaterno,
           Celular, CorreoElectronico, Clave, FechaCreacion,
           EstadoRegistro, IdAcademia)
        VALUES (?, NULL, ?, ?, '', '', ?, ?, NOW(), 1, ?)
      `,
        [
          codigoUsuario,
          nombre,
          apellidos,
          correo,
          claveHasheada,
          ciclo.IdAcademia,
        ],
      );

      idAlumnoFinal = resultUsuario.insertId;
      codigoUsuarioFinal = codigoUsuario;

      await connection.query(
        `
        INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro)
        VALUES (?, ?, 1)
      `,
        [idAlumnoFinal, perfilesAlumno[0].IdPerfil],
      );
    }

    /* 5. Matrícula nueva. El IdUsuario puede repetirse en distintos ciclos. */
    const [insertMatricula] = await connection.query(
      `
      INSERT INTO Matricula (IdUsuario, IdCiclo, EstadoRegistro)
      VALUES (?, ?, 1)
    `,
      [idAlumnoFinal, idCiclo],
    );

    /* 6. Una sola cuota de inscripción por alumno/ciclo. El precio procede del servidor. */
    const [pagosInscripcion] = await connection.query(
      `SELECT IdPago, Monto, Estado
       FROM PagosMensualidad
       WHERE IdUsuario = ? AND IdCiclo = ?
         AND LOWER(TRIM(Mes)) = 'inscripcion' AND EstadoRegistro = 1
       ORDER BY IdPago ASC LIMIT 1 FOR UPDATE`,
      [idAlumnoFinal, idCiclo],
    );

    if (pagosInscripcion.length > 0) {
      const pagoExistente = pagosInscripcion[0];
      pagoCheckout = {
        idPago: Number(pagoExistente.IdPago),
        monto: obtenerPrecioCiclo(pagoExistente.Monto) ?? precioReal,
        estado: String(pagoExistente.Estado || 'Pendiente'),
        creadoAhora: false,
      };
    } else {
      const [insertPago] = await connection.query(
        `INSERT INTO PagosMensualidad
          (IdUsuario, IdCiclo, Mes, Monto, Estado, FechaPago, FechaVencimiento, EstadoRegistro)
         VALUES (?, ?, 'Inscripcion', ?, 'Pendiente', NULL, NULL, 1)`,
        [idAlumnoFinal, idCiclo, precioReal],
      );
      pagoCheckout = {
        idPago: Number(insertPago.insertId),
        monto: precioReal,
        estado: 'Pendiente',
        creadoAhora: true,
      };
      await connection.query(
        `INSERT INTO PagoAuditoria
          (IdPago, IdComprobante, IdUsuarioActor, IdAcademia, Evento,
           EstadoAnterior, EstadoNuevo, MontoAnterior, MontoNuevo, Motivo, FechaCreacion)
         VALUES (?, NULL, ?, ?, 'INSCRIPCION_CREADA', NULL, 'Pendiente', NULL, ?, ?, NOW())`,
        [pagoCheckout.idPago, idAlumnoFinal, ciclo.IdAcademia, precioReal, 'Cuota de inscripción generada por checkout.'],
      );
    }

    const [nuevoConteo] = await connection.query(
      `
      SELECT COUNT(*) AS TotalAlumnos
      FROM Matricula m
      INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
      WHERE m.IdCiclo = ?
        AND m.EstadoRegistro = 1
        AND u.EstadoRegistro = 1
        AND u.IdAcademia = ?
    `,
      [idCiclo, ciclo.IdAcademia],
    );

    await connection.commit();
    enTransaccion = false;

    const totalFinal = Number(nuevoConteo[0]?.TotalAlumnos || 0);

    correoParaEnviar = correo;
    datosCorreo = {
      nombre,
      idUsuario: idAlumnoFinal,
      codigoUsuario: codigoUsuarioFinal,
      claveSinEncriptar,
      claveVersion,
      cicloNombre: ciclo.Nombre,
      precio: pagoCheckout?.monto ?? precioReal,
      estadoPago: pagoCheckout?.estado ?? 'Pendiente',
      esReinscripcion,
    };

    // La transacción ya está confirmada: liberar la conexión antes de esperar
    // al proveedor externo. El fallo de correo no debe inducir al usuario a
    // repetir el checkout como si nada se hubiera guardado.
    if (connection) {
      connection.release();
      connection = null;
    }

    let estadoCorreo = "fallido";
    try {
      await enviarCorreoCheckout(correoParaEnviar, datosCorreo);
      estadoCorreo = "enviado";
    } catch (errorCorreo) {
      // No registrar destinatario, cuerpo HTML, token ni URL secreta.
      console.error(
        "No se pudo confirmar el correo posterior al checkout:",
        errorCorreo?.name || "Error",
      );
    }

    const mensajeCorreoFallido =
      `La matrícula quedó registrada y la cuota de inscripción figura como ${pagoCheckout?.estado || 'Pendiente'}, pero no se pudo confirmar el envío del correo. No vuelvas a enviar el formulario; contacta a la academia para recuperar el acceso.`;

    res.status(201).json({
      exito: true,
      esReinscripcion,
      idCiclo,
      ciclo: ciclo.Nombre,
      precio: precioReal,
      totalAlumnos: totalFinal,
      vacantesDisponibles:
        capacidad > 0 ? Math.max(capacidad - totalFinal, 0) : null,
      correo: { estado: estadoCorreo },
      mensaje:
        estadoCorreo !== "enviado"
          ? mensajeCorreoFallido
          : pagoCheckout?.estado?.toLowerCase() === 'pagado'
            ? `${esReinscripcion ? 'Reinscripción' : 'Matrícula'} registrada. Se conservó el registro de inscripción que ya figuraba como pagado y no se duplicó la cuota.`
            : `${esReinscripcion ? 'Reinscripción' : 'Matrícula'} registrada. La cuota de inscripción figura como ${pagoCheckout?.estado || 'Pendiente'}; el navegador no ha confirmado ningún cobro real.`,
      pago: {
        idPago: pagoCheckout?.idPago ?? null,
        modo: pagoCheckout?.creadoAhora ? "sin_pasarela" : "registro_existente",
        estado: pagoCheckout?.estado ?? "Pendiente",
        monto: pagoCheckout?.monto ?? precioReal,
        confirmadoPorPasarela: false,
        requiereRevision: String(pagoCheckout?.estado || '').toLowerCase() !== 'pagado',
      },
    });
  } catch (error) {
    if (enTransaccion) await rollbackSeguro(connection);
    console.error("Error en POST /api/matriculas/checkout:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error:
          "La operación generó un registro duplicado. Vuelve a consultar el estado de la matrícula antes de intentarlo nuevamente.",
      });
    }

    return res
      .status(500)
      .json({ error: "Hubo un problema procesando la inscripción." });
  } finally {
    if (connection) connection.release();
  }
}

router.post("/checkout", autenticacionOpcional, (req, res) =>
  procesarCheckout(req, res),
);

/* El GET solo muestra confirmación; no escribe nada por visitas automáticas de escáneres de correo. */
router.get("/confirmar-correo-matricula", (req, res) => {
  const token = String(req.query?.token || "");
  const datos = verificarTokenVerificacionMatricula(token);
  if (!datos) {
    return res
      .status(400)
      .type("html")
      .send(
        '<!doctype html><html lang="es"><meta charset="utf-8"><title>Enlace inválido</title><body style="font-family:Arial,sans-serif;padding:32px"><h2>El enlace venció o no es válido</h2><p>Vuelve a iniciar la solicitud de matrícula desde AcadeSys.</p></body></html>',
      );
  }

  res.set("Referrer-Policy", "no-referrer");
  res.set("Cache-Control", "no-store");
  return res.type("html").send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Confirmar correo | AcadeSys</title>
<style>body{font-family:Arial,sans-serif;background:#f1f5f9;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}.card{max-width:520px;background:white;border:1px solid #cbd5e1;border-radius:16px;padding:28px;box-shadow:0 15px 45px #0f172a14}button{background:#0d9488;color:white;border:0;border-radius:9px;padding:13px 18px;font-weight:bold;cursor:pointer}button:disabled{opacity:.6}p{line-height:1.6;color:#475569}</style></head>
<body><main class="card"><h1>AcadeSys</h1><h2>Confirma tu correo</h2><p>Al continuar, comprobaremos la disponibilidad del ciclo. Si el correo no está asociado a una cuenta, se podrá crear la matrícula. Si ya hay una cuenta, tendrás que iniciar sesión. Hasta completar este paso no se ha creado una matrícula ni se ha realizado un cobro.</p><button id="confirmar">Confirmar y continuar</button><p id="resultado" aria-live="polite"></p></main>
<script>
const token = ${JSON.stringify(token)};
const boton = document.getElementById('confirmar');
const resultado = document.getElementById('resultado');
boton.addEventListener('click', async () => {
  if (boton.disabled) return;
  boton.disabled = true;
  resultado.textContent = 'Procesando solicitud...';
  try {
    const response = await fetch('/api/matriculas/confirmar-correo-matricula', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && data.code === 'REINSCRIPCION_REQUIERE_SESION') {
      resultado.textContent = 'Este correo ya está vinculado a una cuenta. No se creó otra matrícula. Inicia sesión en AcadeSys y realiza la reinscripción desde tu panel.';
      boton.remove();
      return;
    }
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
    resultado.textContent = data.mensaje || 'Solicitud procesada.';
    boton.textContent = 'Solicitud procesada';
  } catch (error) {
    resultado.textContent = error.message || 'Ocurrió un error. Vuelve a solicitar la verificación.';
    boton.disabled = false;
  }
});
</script></body></html>`);
});

router.post("/confirmar-correo-matricula", (req, res) => {
  const token = String(req.body?.token || "");
  const datos = verificarTokenVerificacionMatricula(token);
  if (!datos) {
    return res
      .status(400)
      .json({
        error:
          "El enlace venció o no es válido. Inicia de nuevo la solicitud de matrícula.",
      });
  }
  // La identidad sale del token cifrado emitido por el servidor, no del cuerpo del navegador.
  req.usuario = undefined;
  req.body = {
    Nombres: datos.nombres,
    Apellidos: datos.apellidos,
    Correo: datos.correo,
    IdCiclo: datos.idCiclo,
  };
  return procesarCheckout(req, res, { correoVerificado: true });
});

/* ============================================================
   RESTABLECIMIENTO SEGURO DE CLAVE PARA REINSCRIPCIONES
   GET muestra confirmación; POST cambia la clave después del clic.
   El token queda invalidado al cambiar el hash de la contraseña.
   ============================================================ */
router.get("/restablecer-clave", (req, res) => {
  const token = String(req.query?.token || "");
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.proposito !== PROPOSITO_RESET || !payload.claveVersion) {
      return res
        .status(400)
        .type("html")
        .send(
          "<h2>Enlace no válido</h2><p>Solicita un nuevo enlace desde tu reinscripción.</p>",
        );
    }

    return res.type("html").send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recuperar acceso | AcadeSys</title>
<style>body{font-family:Arial,sans-serif;background:#0a192f;color:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}.card{max-width:480px;background:#11243d;border:1px solid #29415f;border-radius:16px;padding:28px;text-align:center}button{background:#2563eb;color:white;border:0;border-radius:9px;padding:13px 18px;font-weight:bold;cursor:pointer}button:disabled{opacity:.6}p{line-height:1.6;color:#cbd5e1}</style></head>
<body><main class="card"><h1>AcadeSys</h1><h2>Recuperar acceso</h2><p>Al continuar, generaremos una contraseña temporal nueva y la enviaremos al correo con el que te reinscribiste. Tu código de usuario y tus matrículas se conservarán.</p><button id="generar">Generar y enviar contraseña</button><p id="resultado" aria-live="polite"></p></main>
<script>
const token = ${JSON.stringify(token)};
const boton = document.getElementById('generar');
const resultado = document.getElementById('resultado');
boton.addEventListener('click', async () => {
  boton.disabled = true;
  resultado.textContent = 'Procesando solicitud...';
  try {
    const response = await fetch('/api/matriculas/restablecer-clave', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
    resultado.textContent = data.mensaje || 'Listo. Revisa tu correo electrónico.';
    boton.textContent = 'Solicitud completada';
  } catch (error) {
    resultado.textContent = error.message || 'Ocurrió un error.';
    boton.disabled = false;
  }
});
</script></body></html>`);
  } catch (_) {
    return res
      .status(400)
      .type("html")
      .send(
        '<!doctype html><html lang="es"><meta charset="utf-8"><title>Enlace vencido</title><body style="font-family:Arial;padding:32px"><h2>El enlace venció o no es válido</h2><p>Vuelve a solicitar la recuperación desde tu correo de reinscripción.</p></body></html>',
      );
  }
});

router.post("/restablecer-clave", async (req, res) => {
  const token = String(req.body?.token || "");
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    return res
      .status(400)
      .json({ error: "El enlace venció o no es válido. Solicita uno nuevo." });
  }

  if (
    payload.proposito !== PROPOSITO_RESET ||
    !payload.claveVersion ||
    !payload.idUsuario ||
    !payload.correo
  ) {
    return res
      .status(400)
      .json({ error: "El enlace de recuperación no es válido." });
  }

  let connection;
  let claveTemporal;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[usuario]] = await connection.query(
      `
      SELECT IdUsuario, CorreoElectronico, Clave
      FROM Usuario
      WHERE IdUsuario = ? AND LOWER(TRIM(CorreoElectronico)) = ? AND EstadoRegistro = 1
      LIMIT 1 FOR UPDATE
    `,
      [payload.idUsuario, normalizarCorreo(payload.correo)],
    );

    if (!usuario || huellaClave(usuario.Clave) !== payload.claveVersion) {
      await connection.rollback();
      return res
        .status(400)
        .json({
          error:
            "Este enlace ya se utilizó o dejó de ser válido. Solicita otro enlace.",
        });
    }

    claveTemporal = generarClaveTemporal();
    const claveHasheada = await bcrypt.hash(claveTemporal, 10);
    await connection.query("UPDATE Usuario SET Clave = ? WHERE IdUsuario = ?", [
      claveHasheada,
      usuario.IdUsuario,
    ]);

    // Enviamos primero el correo dentro de la transacción: si el proveedor falla,
    // hacemos rollback y el alumno conserva la contraseña con la que ingresaba.
    const html = `
      <div style="font-family:Arial,sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:10px;max-width:600px;">
        <h2 style="color:#2563eb;">Tu contraseña temporal de AcadeSys</h2>
        <p><strong>Código de usuario:</strong> ${String(payload.codigoUsuario || "") || "Usa el código indicado en tu correo de reinscripción."}</p>
        <p><strong>Contraseña temporal:</strong> <span style="font-family:monospace;font-size:18px;">${claveTemporal}</span></p>
        <p>Ingresa a AcadeSys con tu código de usuario o correo electrónico y esta contraseña temporal. No compartas estas credenciales.</p>
      </div>`;

    await enviarCorreoHtml(
      usuario.CorreoElectronico,
      "Tu contraseña temporal de AcadeSys",
      html,
    );
    await connection.commit();
    return res.json({
      exito: true,
      mensaje:
        "Listo: enviamos tu contraseña temporal al correo registrado. Puedes cerrar esta ventana.",
    });
  } catch (error) {
    await rollbackSeguro(connection);
    console.error(
      "Error en POST /api/matriculas/restablecer-clave:",
      error.message,
    );
    return res
      .status(502)
      .json({
        error:
          "No se pudo enviar el correo. No se cambió tu contraseña; vuelve a intentarlo.",
      });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
