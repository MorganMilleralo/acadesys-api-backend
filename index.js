require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

require("./config/db");

const app = express();
const port = process.env.PORT || 3000;

// ============================================================
// 1. VALIDACIÓN DE VARIABLES DE ENTORNO
// ============================================================

const variablesRequeridas = [
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "JWT_SECRET",
];

const faltantes = variablesRequeridas.filter(
  (variable) => !process.env[variable],
);

if (faltantes.length > 0) {
  console.error(
    `❌ Faltan variables de entorno obligatorias: ${faltantes.join(", ")}`,
  );

  process.exit(1);
}

// ============================================================
// 2. CONFIGURACIÓN GENERAL DE EXPRESS
// ============================================================

app.set("trust proxy", 1);

app.use(
  cors({
    origin: true,
  }),
);

app.use(
  express.json({
    limit: "15mb",
  }),
);

// Carpeta pública de archivos
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ============================================================
// 3. IMPORTACIÓN DE MIDDLEWARE JWT
// ============================================================

// IMPORTANTE:
// Este middleware NO se modifica.
// Su función es validar el Bearer Token.
const verificarToken = require("./middlewares/auth.middleware");

// ============================================================
// 4. IMPORTACIÓN DE RUTAS PÚBLICAS
// ============================================================

const authRoutes = require("./routes/auth.routes");

const matriculasRoutes = require("./routes/matriculas.routes");

// ------------------------------------------------------------
// CICLOS
// ------------------------------------------------------------
// El nuevo ciclos.routes.js de Morgan exporta un OBJETO:
//
// {
//    router,
//    validarNombreCiclo,
//    ...
// }
//
// Por eso obtenemos específicamente .router.
//
// El "|| ciclosRoutesModule" mantiene compatibilidad por si
// posteriormente volvemos a exportar solo el router.
// ------------------------------------------------------------

const ciclosRoutesModule = require("./routes/ciclos.routes");

const ciclosRoutes = ciclosRoutesModule.router || ciclosRoutesModule;

// ============================================================
// 5. RUTAS PÚBLICAS
// ============================================================
//
// Estas rutas se montan ANTES del middleware JWT.
//
// Eso permite que:
// - visitantes consulten ciclos;
// - visitantes consulten detalles;
// - visitantes verifiquen su correo;
// - visitantes puedan iniciar checkout;
//
// SIN iniciar sesión.
// ============================================================

// Autenticación
app.use("/api", authRoutes);

// Catálogo público de ciclos
app.use("/api/ciclos", ciclosRoutes);

// Matrículas / reinscripción / checkout
app.use("/api/matriculas", matriculasRoutes);

// ============================================================
// 6. HEALTH CHECK
// ============================================================

app.get("/ping", (req, res) => {
  res.status(200).json({
    ok: true,
    servicio: "AcadeSys API",
    mensaje: "API en línea.",
    fecha: new Date().toISOString(),
  });
});

// ============================================================
// 7. CANDADO GLOBAL JWT
// ============================================================
//
// Desde aquí hacia abajo:
// TODA petición /api requiere:
//
// Authorization: Bearer <TOKEN>
//
// Excepto las rutas públicas declaradas anteriormente.
// ============================================================

app.use("/api", verificarToken);

// ============================================================
// 8. RUTAS PRIVADAS ADMINISTRATIVAS
// ============================================================

// ------------------------------------------------------------
// GESTIÓN DE CICLOS
// ------------------------------------------------------------
// Incluye:
//
// GET    /api/admin/ciclos
// GET    /api/admin/ciclos/:id
// POST   /api/admin/ciclos
// PUT    /api/admin/ciclos/:id
// PATCH  /api/admin/ciclos/:id/estado
// DELETE /api/admin/ciclos/:id
//
// El propio archivo admin-ciclos.routes.js valida:
//
// requiereRol('Administrador')
//
// Por eso NO agregamos otro middleware de rol aquí.
// ------------------------------------------------------------

app.use("/api/admin/ciclos", require("./routes/admin-ciclos.routes"));

// ------------------------------------------------------------
// DASHBOARD ADMINISTRATIVO
// ------------------------------------------------------------
//
// El endpoint final será:
//
// GET /api/admin/dashboard/overview
//
// También queda protegido por:
// 1. auth.middleware.js
// 2. roles.middleware.js dentro de dashboard.routes.js
// ------------------------------------------------------------

app.use("/api/admin", require("./routes/dashboard.routes"));

// ============================================================
// 9. RUTAS PRIVADAS EXISTENTES
// ============================================================

// Aulas, cursos, asignaciones y asistencia (rutas privadas protegidas por JWT)
app.use("/api", require("./routes/academico.routes"));

// Perfiles y permisos
app.use("/api", require("./routes/perfil.routes"));

// Menús
app.use("/api", require("./routes/menu.routes"));

// Usuarios
app.use("/api", require("./routes/usuario.routes"));

// Notas
app.use("/api/notas", require("./routes/notas.routes"));

// Actas
app.use("/api", require("./routes/actas.routes"));

// Pagos
app.use("/api", require("./routes/pagos.routes"));

// Tutor IA
app.use("/api", require("./routes/ia.routes"));

// Intranet del alumno
app.use("/api/alumno", require("./routes/alumno.routes"));

// Materiales académicos
app.use("/api/materiales", require("./routes/materiales.routes"));

// Comunicados institucionales
app.use("/api", require("./routes/comunicados.routes"));

// ============================================================
// 10. RUTA API NO ENCONTRADA
// ============================================================
//
// Si ninguna ruta anterior coincide, respondemos 404.
// ============================================================

app.use("/api", (req, res) => {
  res.status(404).json({
    error: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
});

// ============================================================
// 11. MANEJO GLOBAL DE ERRORES
// ============================================================

app.use((err, req, res, next) => {
  console.error("❌ Error no controlado:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(err.status || 500).json({
    error: err.message || "Error interno del servidor.",
  });
});

// ============================================================
// 12. ARRANQUE DEL SERVIDOR
// ============================================================

app.listen(port, () => {
  console.log(`🚀 AcadeSys API corriendo en el puerto ${port}`);

  console.log("📚 Catálogo público:", `/api/ciclos/publicos`);

  console.log("📝 Matrículas:", `/api/matriculas/checkout`);

  console.log("🔐 Administración de ciclos:", `/api/admin/ciclos`);

  console.log("📊 Dashboard:", `/api/admin/dashboard/overview`);
});
