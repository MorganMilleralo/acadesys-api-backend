// ============================================================
// POLÍTICA CORS CENTRALIZADA (whitelist explícita)
// ============================================================
// La API usa autenticación con JWT, por lo que NUNCA se usa "*".
// Solo se autorizan los orígenes de esta lista cerrada.
//
// Prioridad de configuración:
//   1. Orígenes de producción conocidos (abajo).
//   2. Orígenes de desarrollo local (frontend Vite en 5173/5174).
//   3. Orígenes extra aportados por la variable de entorno CORS_ORIGINS
//      (lista separada por comas), para no tener que tocar código en Render.
//
// Variable de entorno:
//   NOMBRE : CORS_ORIGINS
//   FORMATO: lista separada por comas, con esquema y puerto
//   EJEMPLO: CORS_ORIGINS=https://midominio.com,https://otro-frontend.com
// ============================================================

// Frontend de producción ya configurado en el proyecto (se conserva).
const ORIGENES_PRODUCCION = [
  'https://acadesys-web-frontend.vercel.app',
];

// Frontend local (Vite). Permite que un frontend en desarrollo hable con
// esta API (local o desplegada) sin abrir la CORS globalmente.
const ORIGENES_DESARROLLO = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];

// Construye la whitelist combinando producción + desarrollo + CORS_ORIGINS.
function construirOrigenesPermitidos(env = process.env) {
  const desdeEntorno = String(env.CORS_ORIGINS || '')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean);

  return new Set([...ORIGENES_PRODUCCION, ...ORIGENES_DESARROLLO, ...desdeEntorno]);
}

const origenesPermitidos = construirOrigenesPermitidos();

// ¿El origen recibido está autorizado? (sin Origin = servidor a servidor).
function origenPermitido(origen) {
  return !origen || origenesPermitidos.has(origen);
}

// Opciones listas para `cors(...)`.
const corsOptions = {
  origin(origen, callback) {
    // Requests sin Origin (curl, health checks, servidor a servidor) se
    // atienden normalmente. Con Origin, solo si está en la whitelist.
    if (origenPermitido(origen)) return callback(null, true);

    // Origen NO permitido: se omite el encabezado Access-Control-Allow-Origin
    // (el navegador bloquea la lectura), pero NO se lanza un error. Así un
    // rechazo de CORS no se convierte en un 500 del servidor.
    return callback(null, false);
  },
  // Encabezados que realmente usa la aplicación.
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

module.exports = {
  corsOptions,
  origenesPermitidos,
  construirOrigenesPermitidos,
  origenPermitido,
  ORIGENES_PRODUCCION,
  ORIGENES_DESARROLLO,
};


