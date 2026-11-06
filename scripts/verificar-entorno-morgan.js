'use strict';

// Revisión local del entorno. No imprime valores secretos ni se conecta a MySQL.
// Ejecutar desde la raíz del backend después de configurar un .env local.
require('dotenv').config({ quiet: true });

const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
const text = (value) => typeof value === 'string' ? value.trim() : '';

const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
for (const key of required) {
  add(key, Boolean(text(process.env[key])), text(process.env[key]) ? 'configurado' : 'FALTA');
}

const jwtSecret = text(process.env.JWT_SECRET);
add('JWT_SECRET', jwtSecret.length >= 32,
  jwtSecret.length >= 32 ? 'longitud mínima cumplida' : 'FALTA o tiene menos de 32 caracteres');

const mailValue = text(process.env.GOOGLE_SCRIPT_URL);
let mailOk = false;
if (mailValue) {
  try {
    const u = new URL(mailValue);
    mailOk = u.protocol === 'https:';
  } catch {
    mailOk = false;
  }
}
add('GOOGLE_SCRIPT_URL', mailOk,
  mailOk ? 'configurada con HTTPS (el valor no se muestra)' : 'FALTA o no es una URL HTTPS válida');

const publicApi = text(process.env.API_PUBLIC_URL);
let publicApiOk = false;
try {
  const u = new URL(publicApi);
  publicApiOk = u.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(u.hostname));
} catch {
  publicApiOk = false;
}
add('API_PUBLIC_URL', publicApiOk,
  publicApiOk ? 'URL válida para el entorno declarado' : 'FALTA o no corresponde al entorno');

const academyId = Number(process.env.PUBLIC_REGISTRATION_ACADEMY_ID);
add('PUBLIC_REGISTRATION_ACADEMY_ID', Number.isSafeInteger(academyId) && academyId > 0,
  Number.isSafeInteger(academyId) && academyId > 0 ? 'entero positivo' : 'FALTA o no es un entero positivo');

console.log('\nAcadeSys - comprobación de entorno de Morgan');
console.log('No se muestran contraseñas, tokens ni URLs secretas.');
for (const c of checks) console.log(`${c.ok ? 'OK ' : 'REV'} ${c.name}: ${c.detail}`);
const failed = checks.filter(c => !c.ok);
console.log(`\nResultado: ${checks.length - failed.length}/${checks.length} comprobaciones aprobadas.`);
if (failed.length) {
  console.error('No continúes con la demostración hasta resolver los elementos marcados REV.');
  process.exitCode = 1;
} else {
  console.log('La configuración básica está completa. Esto NO prueba conexión a DB, entrega de correo ni funcionamiento E2E.');
}
