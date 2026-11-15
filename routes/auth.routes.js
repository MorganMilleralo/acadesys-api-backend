const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { validarDatosUsuario, usuarioDuplicado, bloquearIdentidades, rollbackSeguro, idPositivo } = require('../utils/validaciones');
const { consultar, ejecutar } = require('../config/procedimientos');

const universidadDesdeNombre = (nombre = "") => {
  const n = String(nombre).toLowerCase();
  if (n.includes("san marcos") || n.includes("unmsm")) return "UNMSM";
  if (/\buni\b/.test(n) || n.includes("ingenier")) return "UNI";
  if (n.includes("católica") || n.includes("catolica") || n.includes("pucp"))
    return "PUCP";
  if (n.includes("villarreal") || n.includes("unfv")) return "UNFV";
  if (n.includes("unt") || n.includes("trujillo")) return "UNT";
  if (n.includes("callao") || n.includes("unac")) return "UNAC";
  return "Preuniversitario";
};

const horarioDesdeTurno = (turno = "") => {
  const t = String(turno).toLowerCase();
  if (t.includes("mañana") || t.includes("manana")) return "08:00 - 13:00";
  if (t.includes("tarde")) return "14:00 - 19:00";
  if (t.includes("noche")) return "18:00 - 22:00";
  return "08:00 - 13:00";
};

const obtenerPerfilPorNombre = async (connection, nombre) => {
  const [rows] = await consultar(connection, 'sp_auth_obtener_perfil', [nombre]);
  return rows[0]?.IdPerfil || null;
};

// ==========================================
// REGISTRO PÚBLICO: SOLO ALUMNO
// ==========================================
const registerHandler = async (req, res) => {
  let connection;
  let enTransaccion = false;

  try {
    const {
      DNI,
      dni,
      Nombres,
      nombre,
      ApellidoPaterno,
      apellido,
      ApellidoMaterno,
      apellidoMaterno,
      Celular,
      celular,
      CorreoElectronico,
      correo,
      Clave,
      contrasena,
      password,
    } = req.body || {};

    const validado = validarDatosUsuario({ DNI: DNI ?? dni, Nombres: Nombres ?? nombre,
      ApellidoPaterno: ApellidoPaterno ?? apellido, ApellidoMaterno: ApellidoMaterno ?? apellidoMaterno,
      Celular: Celular ?? celular, CorreoElectronico: CorreoElectronico ?? correo, Clave: Clave ?? contrasena ?? password }, { crear: true });
    if (validado.error) return res.status(400).json({ error: validado.error });
    const { DNI: docIdentidad, Nombres: nom, ApellidoPaterno: apeP, ApellidoMaterno: apeM,
      Celular: tel, CorreoElectronico: email, Clave: rawClave } = validado.datos;
    const idAcademia = idPositivo(process.env.PUBLIC_REGISTRATION_ACADEMY_ID || 1);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    enTransaccion = true;
    await bloquearIdentidades(connection);
    const [[academia]] = await consultar(connection, 'sp_auth_listar_academia', [idAcademia]);
    if (!academia) { await connection.rollback(); return res.status(503).json({ error: 'El registro no está disponible temporalmente.' }); }

    if (await usuarioDuplicado(connection, validado.datos)) {
      await connection.rollback();
      return res.status(409).json({
        error: "El correo electrónico o DNI ya se encuentra registrado.",
      });
    }

    const idPerfilAlumno = await obtenerPerfilPorNombre(connection, "Alumno");
    if (!idPerfilAlumno) {
      await connection.rollback();
      console.error('Registro público: perfil Alumno no configurado.');
      return res.status(503).json({ error: 'El registro no está disponible temporalmente.' });
    }

    const claveHasheada = await bcrypt.hash(rawClave, 10);
    const baseCodigo =
      `${nom.replace(/\s+/g, "")}${apeP.replace(/\s+/g, "")}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 28) || "ALUMNO";

    let codigoUsuario = "";
    for (let intento = 0; intento < 10; intento += 1) {
      const sufijo = String(Math.floor(1000 + Math.random() * 9000));
      const candidato = `${baseCodigo}-${sufijo}`;
      const [existenteCodigo] = await consultar(connection, 'sp_auth_obtener_usuario', [candidato]);
      if (existenteCodigo.length === 0) {
        codigoUsuario = candidato;
        break;
      }
    }

    if (!codigoUsuario) {
      await connection.rollback();
      return res
        .status(500)
        .json({ error: "No se pudo generar un código de alumno disponible." });
    }

    const [resUser] = await ejecutar(connection, 'sp_auth_registrar_usuario', [
        codigoUsuario,
        docIdentidad,
        nom,
        apeP,
        apeM,
        tel,
        email,
        claveHasheada,
        idAcademia,
      ]);

    const nuevoIdUsuario = resUser.insertId;

    await ejecutar(connection, 'sp_auth_registrar_usuario_perfil', [nuevoIdUsuario, idPerfilAlumno]);

    await connection.commit();
    enTransaccion = false;

    res.status(201).json({
      mensaje: "Alumno registrado exitosamente.",
      idUsuario: nuevoIdUsuario,
      id: nuevoIdUsuario,
      codigoUsuario,
      correo: email,
      usuario: `${nom} ${apeP}`,
    });
  } catch (error) {
    if (enTransaccion) await rollbackSeguro(connection);
    console.error("Error en registro público:", error.message);
    res
      .status(500)
      .json({ error: 'No se pudo registrar el alumno.' });
  } finally {
    if (connection) connection.release();
  }
};

// ==========================================
// LOGIN
// ==========================================
const loginHandler = async (req, res) => {
  try {
    const usuarioInput =
      req.body?.usuario ||
      req.body?.codigo_usuario ||
      req.body?.codigoUsuario ||
      req.body?.correo ||
      req.body?.email ||
      req.body?.dni;

    const passwordInput =
      req.body?.password ||
      req.body?.Clave ||
      req.body?.clave ||
      req.body?.contrasena;

    if (!usuarioInput || !passwordInput || typeof passwordInput !== 'string' || !['string', 'number'].includes(typeof usuarioInput)) {
      return res.status(400).json({
        error: "Debes enviar usuario/código/correo/DNI y contraseña.",
      });
    }

    const termino = String(usuarioInput).trim();
    const clave = String(passwordInput);
    const termLower = termino.toLowerCase();

    const [rows] = await consultar(pool, 'sp_auth_buscar_usuario_login', [termLower, termino]);

    if (rows.length === 0) {
      return res.status(401).json({
        error: "Credenciales incorrectas.",
      });
    }

    const user = rows[0];
    const claveEnBD = String(user.Clave || "");
    let claveValida = false;
    let claveLegadaEnTextoPlano = false;

    if (/^\$2[aby]\$/.test(claveEnBD)) {
      claveValida = await bcrypt.compare(clave, claveEnBD);
    } else {
      // Migración gradual: si una contraseña antigua coincide, se convierte a
      // bcrypt inmediatamente después de validar las credenciales.
      claveValida = clave === claveEnBD;
      claveLegadaEnTextoPlano = claveValida;
    }

    if (!claveValida) {
      return res.status(401).json({ error: "Credenciales incorrectas." });
    }

    if (rows.length !== 1) {
      return res.status(403).json({ error: "Identidad ambigua o multiples perfiles activos." });
    }

    const rol = user.Rol || "Sin Rol";

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret.trim().length < 32) {
      console.error('[Auth] JWT_SECRET no está configurado o es demasiado corto.');
      return res.status(503).json({ error: 'La autenticación no está configurada correctamente.' });
    }

    if (claveLegadaEnTextoPlano) {
      const claveHash = await bcrypt.hash(clave, 10);
      // No sobrescribir una clave cambiada por recuperacion mientras se calcula
      // el hash. La comparacion binaria evita la collation insensible a mayusculas.
      const [actualizacion] = await ejecutar(pool, 'sp_auth_actualizar_usuario', [claveHash, user.IdUsuario, claveEnBD]);
      if (actualizacion.affectedRows !== 1) {
        return res.status(401).json({ error: 'Las credenciales cambiaron. Inicia sesion nuevamente.' });
      }
    }

    const token = jwt.sign(
      {
        id: user.IdUsuario,
        idUsuario: user.IdUsuario,
        rol,
        idPerfil: user.IdPerfil,
        idAcademia: user.IdAcademia,
      },
      jwtSecret,
      { expiresIn: "8h" },
    );

    let matricula = null;

    const esAlumno =
      ["alumno", "estudiante"].includes(String(rol).trim().toLowerCase());
    if (esAlumno) {
      const [matriculas] = await consultar(pool, 'sp_auth_obtener_matricula', [user.IdUsuario, user.IdAcademia]);

      if (matriculas.length > 0) {
        const m = matriculas[0];
        matricula = {
          idMatricula: m.IdMatricula,
          idCiclo: m.IdCiclo,
          nombreCiclo: m.NombreCiclo,
          turno: m.Turno || "",
          horario: m.Horario || horarioDesdeTurno(m.Turno),
          diasClase: m.DiasClase || "Lunes a Sábado",
          universidadObjetivo:
            !m.UniversidadObjetivo ||
            m.UniversidadObjetivo === "Preuniversitario"
              ? universidadDesdeNombre(m.NombreCiclo)
              : m.UniversidadObjetivo,
          fechaInicio: m.FechaInicio,
          fechaFin: m.FechaFin,
          totalAlumnos: Number(m.TotalAlumnos || 0),
        };
      }
    }

    res.status(200).json({
      mensaje: "Autenticación exitosa",
      token,
      idUsuario: user.IdUsuario,
      usuario: user.NombreCompleto,
      nombre: user.NombreCompleto,
      correo: user.CorreoElectronico,
      dni: user.DNI,
      codigoUsuario: user.CodigoUsuario,
      idAcademia: user.IdAcademia,
      rol,
      idPerfil: user.IdPerfil,
      matricula,
      academia: {
        idAcademia: user.IdAcademia,
        nombreAcademia: user.NombreAcademia || "AcadeSys Pre-U",
        colorTema: user.ColorTema || "#2563eb",
        logoUrl: user.LogoUrl || "",
      },
      user: {
        id: user.IdUsuario,
        idUsuario: user.IdUsuario,
        nombre: user.NombreCompleto,
        correo: user.CorreoElectronico,
        dni: user.DNI,
        codigoUsuario: user.CodigoUsuario,
        rol,
        idAcademia: user.IdAcademia,
      },
    });
  } catch (error) {
    console.error("Error en autenticación:", error);
    res.status(500).json({ error: "Error interno en el servidor." });
  }
};

router.post("/login", loginHandler);
router.post("/auth/login", loginHandler);

// Registro público compatible, pero siempre como Alumno.
router.post("/auth/register", registerHandler);
router.post("/register", registerHandler);

module.exports = router;


