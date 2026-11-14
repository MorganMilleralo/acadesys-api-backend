require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { PROFILE_UPLOADS_DIR } = require("./config/storage");

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
  console.error("❌ JWT_SECRET debe tener al menos 32 caracteres.");

  process.exit(1);
}

// ============================================================
// 2. CONFIGURACIÓN GENERAL DE EXPRESS
// ============================================================

app.set("trust proxy", 1);

// CORS centralizado
const { corsOptions } = require("./config/cors");

app.use(cors(corsOptions));

// ============================================================
// 3. WEBHOOK CULQI
// ============================================================

// IMPORTANTE:
// - Es público, no utiliza JWT de alumnos.
// - Utiliza autenticación Basic configurada en CulqiPanel.
// - Se monta antes del parser JSON general.
// - Su ruta final será POST /api/webhooks/culqi.

const culqiWebhook = require("./routes/culqi-webhook.routes");

app.use("/api/webhooks", express.json({ limit: "32kb" }), culqiWebhook);

// ============================================================
// 4. PARSERS Y ARCHIVOS ESTÁTICOS
// ============================================================

// Parser general para el resto de endpoints.
app.use(express.json({ limit: "15mb" }));
// Solo las fotos de perfil son públicas. Materiales y comprobantes NO se
// sirven como estáticos: los materiales se descargan con sesión y permisos
// en GET /api/materiales/:id/descargar (HU-19).
app.use("/uploads/perfiles", require("./routes/foto-perfil.routes"), express.static(PROFILE_UPLOADS_DIR));

// ============================================================
// 5. MIDDLEWARE DE AUTENTICACIÓN
// ============================================================

const verificarToken = require("./middlewares/auth.middleware");

// ============================================================
// 6. IMPORTACIÓN DE RUTAS
// ============================================================

// Autenticación
const authRoutes = require("./routes/auth.routes");
const recuperacionRoutes = require("./routes/recuperacion.routes");

// Matrículas y ciclos
const matriculasRoutes = require("./routes/matriculas.routes");

const ciclosRoutesModule = require("./routes/ciclos.routes");
const ciclosRoutes = ciclosRoutesModule.router || ciclosRoutesModule;

// ============================================================
// 7. RUTAS PÚBLICAS
// ============================================================

// Login y autenticación
app.use("/api", authRoutes);

// Recuperación de contraseña
app.use("/api/auth", recuperacionRoutes);

// Consulta pública de ciclos
app.use("/api/ciclos", ciclosRoutes);

// Inscripciones y matrículas públicas.
// Las operaciones privadas deben conservar sus validaciones
// de sesión y permisos dentro del propio router.
app.use("/api/matriculas", matriculasRoutes);

// ============================================================
// 8. HEALTH CHECK
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
// 9. CANDADO GLOBAL JWT
// ============================================================

// Todas las rutas /api declaradas después de este punto
// requieren autenticación JWT.

app.use("/api", verificarToken);

// ============================================================
// 10. RUTAS PRIVADAS ADMINISTRATIVAS
// ============================================================

// Gestión de ciclos
app.use("/api/admin/ciclos", require("./routes/admin-ciclos.routes"));
// Panel de transacciones online, auditoría y conciliación (antes del router general /api/admin).
app.use("/api/admin/pagos", require("./routes/admin-pagos.routes"));

// Dashboard administrativo
app.use("/api/admin", require("./routes/dashboard.routes"));

// ============================================================
// 11. RUTAS PRIVADAS GENERALES
// ============================================================

// Gestión académica
app.use("/api", require("./routes/academico.routes"));

// Perfil
app.use("/api", require("./routes/perfil.routes"));

// Menús y navegación
app.use("/api", require("./routes/menu.routes"));

// Usuarios
app.use("/api", require("./routes/usuario.routes"));

// Calificaciones
app.use("/api/notas", require("./routes/notas.routes"));

// Actas académicas
app.use("/api", require("./routes/actas.routes"));

// Pagos y comprobantes
app.use("/api", require("./routes/pagos.routes"));

// Tutor pedagógico IA
app.use("/api", require("./routes/ia.routes"));

// ============================================================
// 12. RUTAS PRIVADAS DEL ALUMNO
// ============================================================

// Intranet del alumno
app.use("/api/alumno", require("./routes/alumno.routes"));

// Checkout de cuotas mediante Culqi.
// Se registra UNA SOLA VEZ y después del JWT.
app.use("/api/alumno", require("./routes/alumno-checkout.routes"));

// Materiales académicos
app.use("/api/materiales", require("./routes/materiales.routes"));

// Comunicados y avisos
app.use("/api", require("./routes/comunicados.routes"));

// ============================================================
// 13. RUTA API NO ENCONTRADA
// ============================================================

app.use("/api", (req, res) => {
  res.status(404).json({
    error: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
});

// ============================================================
// 14. MANEJO GLOBAL DE ERRORES
// ============================================================

app.use(require("./middlewares/error.middleware"));

// ============================================================
// 15. ARRANQUE DEL SERVIDOR
// ============================================================

const server = app.listen(port, () => {
  console.log("------------------------------------------");
  console.log("🚀 AcadeSys API iniciada correctamente");
  console.log("------------------------------------------");

  console.log("📚 Catálogo público:", "/api/ciclos/publicos");
  console.log("📝 Matrículas:", "/api/matriculas/checkout");
  console.log("🔐 Administración:", "/api/admin");
  console.log("📊 Dashboard:", "/api/admin/dashboard/overview");
  console.log("💳 Proveedor de pagos: CULQI");
  console.log("🔔 Webhook Culqi:", "/api/webhooks/culqi");
  console.log("🎓 Intranet:", "/api/alumno");

  console.log("------------------------------------------");
});

module.exports = {
  app,
  server,
};

