const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const casos = [
  ['--test', '--test-concurrency=1', 'tests/seguridad.test.js', 'tests/notas.test.js'],
  ['prueba-auth-local.js'],
  ['prueba-cierre-local.js'],
  ['prueba-notas-actas-local.js'],
];
for (const args of casos) {
  const resultado = spawnSync(process.execPath, ['--require', './tests/aislamiento.js', ...args], {
    cwd: root, stdio: 'inherit', shell: false,
  });
  if (resultado.error || resultado.status !== 0) {
    console.error(resultado.error || 'Fallo en ' + args.join(' '));
    process.exitCode = 1;
    break;
  }
}
