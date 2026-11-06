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


