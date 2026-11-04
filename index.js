require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { UPLOADS_DIR } = require("./config/storage");

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

if (String(process.env.JWT_SECRET || "").length < 32) {
  console.error(
    "❌ JWT_SECRET debe tener al menos 32 caracteres. Configura un secreto largo y único en el entorno.",
  );
  process.exit(1);
}

// ============================================================
// 2. CONFIGURACIÓN GENERAL DE EXPRESS
// ============================================================

// Whitelist CORS explícita y centralizada (ver config/cors.js).
app.set("trust proxy", 1);

const { corsOptions } = require("./config/cors");
app.use(cors(corsOptions));
app.use(express.json({ limit: "15mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

// ============================================================
// 3. IMPORTACIÓN DEL MIDDLEWARE JWT
// ============================================================

const verificarToken = require("./middlewares/auth.middleware");

// ============================================================
// 4. IMPORTACIÓN DE RUTAS PÚBLICAS
// ============================================================

const authRoutes = require("./routes/auth.routes");
const recuperacionRoutes = require("./routes/recuperacion.routes");
const matriculasRoutes = require("./routes/matriculas.routes");

// ciclos.routes.js exporta un router o un objeto que contiene .router.
const ciclosRoutesModule = require("./routes/ciclos.routes");
const ciclosRoutes = ciclosRoutesModule.router || ciclosRoutesModule;

// ============================================================
// 5. RUTAS PÚBLICAS
// ============================================================

app.use("/api", authRoutes);
app.use("/api/auth", recuperacionRoutes);
app.use("/api/ciclos", ciclosRoutes);
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
// Todas las rutas /api declaradas después de este punto requieren JWT.
app.use("/api", verificarToken);

// ============================================================
// 8. RUTAS PRIVADAS ADMINISTRATIVAS
// ============================================================

app.use("/api/admin/ciclos", require("./routes/admin-ciclos.routes"));
app.use("/api/admin", require("./routes/dashboard.routes"));

// ============================================================
// 9. RUTAS PRIVADAS EXISTENTES
// ============================================================

app.use("/api", require("./routes/academico.routes"));
app.use("/api", require("./routes/perfil.routes"));
app.use("/api", require("./routes/menu.routes"));
app.use("/api", require("./routes/usuario.routes"));
app.use("/api/notas", require("./routes/notas.routes"));
app.use("/api", require("./routes/actas.routes"));
app.use("/api", require("./routes/pagos.routes"));
app.use("/api", require("./routes/ia.routes"));

// Intranet y pagos manuales del alumno (rutas existentes).
app.use("/api/alumno", require("./routes/alumno.routes"));

// NUEVO: checkout online de mensualidades (responsabilidad Morgan).
// Debe permanecer después del middleware JWT porque exige sesión de alumno.
app.use("/api/alumno", require("./routes/alumno-checkout.routes"));

app.use("/api/materiales", require("./routes/materiales.routes"));
app.use("/api", require("./routes/comunicados.routes"));

// ============================================================
// 10. RUTA API NO ENCONTRADA
// ============================================================

app.use("/api", (req, res) => {
  res.status(404).json({
    error: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
});

// ============================================================
// 11. MANEJO GLOBAL DE ERRORES
// ============================================================

app.use(require("./middlewares/error.middleware"));

// ============================================================
// 12. ARRANQUE DEL SERVIDOR
// ============================================================

const server = app.listen(port, () => {
  console.log(`🚀 AcadeSys API corriendo en el puerto ${port}`);
  console.log("📚 Catálogo público:", "/api/ciclos/publicos");
  console.log("📝 Matrículas:", "/api/matriculas/checkout");
  console.log("🔐 Administración de ciclos:", "/api/admin/ciclos");
  console.log("📊 Dashboard:", "/api/admin/dashboard/overview");
});

module.exports = { app, server };
