const fs = require('node:fs');
const path = require('node:path');

const ruta = path.join(process.cwd(), 'routes', 'notas.routes.js');
if (!fs.existsSync(ruta)) {
  console.error('No se encontró routes/notas.routes.js. Ejecuta este script desde la raíz del backend.');
  process.exit(1);
}

let codigo = fs.readFileSync(ruta, 'utf8');
const importOriginal = 'const verificarPeriodoAbierto = require("../middlewares/cierre.middleware");';
const importNuevo = `${importOriginal}\nconst { requiereGestionNotas, autorizarHistorialAlumno } = require("../middlewares/notas-acceso.middleware");`;

if (codigo.includes('notas-acceso.middleware')) {
  console.error('Parece que el control de acceso ya está integrado. No se modificó ningún archivo.');
  process.exit(1);
}

const reemplazos = [
  [importOriginal, importNuevo, 'importación del middleware'],
  ['router.get("/", async (req, res) => {', 'router.get("/", requiereGestionNotas, async (req, res) => {', 'GET /api/notas'],
  ['router.get("/contexto/:idCiclo", async (req, res) => {', 'router.get("/contexto/:idCiclo", requiereGestionNotas, async (req, res) => {', 'GET contexto de ciclo'],
  ['router.get("/matriculas/:idCiclo", async (req, res) => {', 'router.get("/matriculas/:idCiclo", requiereGestionNotas, async (req, res) => {', 'GET matrículas por ciclo'],
  ['router.get("/alumno/:id", async (req, res) => {', 'router.get("/alumno/:id", autorizarHistorialAlumno, async (req, res) => {', 'GET historial individual'],
];

for (const [antes, despues, nombre] of reemplazos) {
  const coincidencias = codigo.split(antes).length - 1;
  if (coincidencias !== 1) {
    console.error(`No se pudo aplicar el cambio de forma segura: ${nombre}. Coincidencias encontradas: ${coincidencias}. No se modificó ningún archivo.`);
    process.exit(1);
  }
  codigo = codigo.replace(antes, despues);
}

const fecha = new Date().toISOString().replace(/[:.]/g, '-');
const respaldo = `${ruta}.bak-${fecha}`;
fs.copyFileSync(ruta, respaldo);
fs.writeFileSync(ruta, codigo, 'utf8');
console.log('Avance RBAC aplicado correctamente a routes/notas.routes.js.');
console.log(`Respaldo creado: ${respaldo}`);
console.log('Verifica los endpoints con las pruebas documentadas antes de hacer commit o desplegar.');
