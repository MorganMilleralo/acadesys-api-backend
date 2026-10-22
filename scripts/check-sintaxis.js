// Verificación de sintaxis de los archivos JS versionados (uso interno).
// Ejecutar con: node scripts/check-sintaxis.js
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
// Se listan los archivos versionados (no solo los modificados) para que la
// comprobación siga siendo útil con el árbol de trabajo limpio.
const salida = execFileSync('git', ['ls-files', '*.js'], { cwd: raiz, encoding: 'utf8' });
const archivos = salida
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((archivo) => archivo.endsWith('.js') && !archivo.includes('node_modules'));

let fallos = 0;
for (const archivo of archivos) {
  const resultado = spawnSync(process.execPath, ['--check', path.join(raiz, archivo)], { encoding: 'utf8' });
  if (resultado.status !== 0) {
    console.error(`Fallo de sintaxis en ${archivo}:\n${resultado.stderr}`);
    fallos += 1;
  }
}
console.log(fallos === 0 ? `node --check correcto en ${archivos.length} archivo(s) JS.` : `Fallos de sintaxis: ${fallos}`);
process.exitCode = fallos === 0 ? 0 : 1;


