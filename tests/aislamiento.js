// Se precarga en TODOS los procesos de pruebas. Impide cargar .env o MySQL real,
// incluso si una prueba olvida instalar su doble antes de importar una ruta.
const Module = require('node:module');
const cargar = Module._load;
Module._load = function (nombre, ...args) {
  if (/^(mysql2|dotenv)(\/|$)/.test(nombre)) {
    throw new Error('Pruebas aisladas: esta prohibido cargar ' + nombre);
  }
  return cargar.call(this, nombre, ...args);
};
process.env.JWT_SECRET = 'secreto-ficticio-exclusivo-pruebas-locales';

// Configuración ficticia y exclusiva de las pruebas. Nunca sustituye .env ni
// se utiliza al ejecutar index.js; scripts/probar-local.js precarga este archivo.
const entornoPagosTest = {
  PAYMENT_PROVIDER: 'MERCADOPAGO',
  PAYMENT_ENVIRONMENT: 'TEST',
  PAYMENT_CURRENCY: 'PEN',
  PAYMENT_REFERENCE_PREFIX: 'ACS',
  PAYMENT_CHECKOUT_RESERVATION_TIMEOUT_SECONDS: '120',
  PAYMENT_RECONCILIATION_INTERVAL_MS: '30000',
  MERCADOPAGO_API_BASE_URL: 'https://api.mercadopago.com',
  MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-FAKE-ACCESS-TOKEN-FOR-ISOLATED-TESTS',
  MERCADOPAGO_WEBHOOK_SECRET: 'test-webhook-secret-only-for-unit-tests',
  MERCADOPAGO_ITEM_TITLE_PREFIX: 'AcadeSys',
  MERCADOPAGO_CHECKOUT_ALLOWED_HOSTS: 'www.mercadopago.com.pe',
  MERCADOPAGO_REQUEST_TIMEOUT_MS: '5000',
  MERCADOPAGO_WEBHOOK_TOLERANCE_SECONDS: '300',
  FRONTEND_PUBLIC_URL: 'https://acadesys-web-frontend.vercel.app',
  MERCADOPAGO_SUCCESS_RETURN_PATH: '/?payment_status=success',
  MERCADOPAGO_FAILURE_RETURN_PATH: '/?payment_status=failure',
  MERCADOPAGO_PENDING_RETURN_PATH: '/?payment_status=pending',
};
for (const [key, value] of Object.entries(entornoPagosTest)) {
  if (!process.env[key]) process.env[key] = value;
}

// Las pruebas no usan MySQL: los procedimientos almacenados se traducen a su
// sentencia SQL para que los dobles de cada prueba puedan verificarla.
const rutaProcedimientos = require.resolve('../config/procedimientos');
require.cache[rutaProcedimientos] = {
  id: rutaProcedimientos, filename: rutaProcedimientos, loaded: true,
  exports: require('./procedimientos-prueba'),
};
