const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { readdirSync } = require('node:fs');
const root = path.resolve(__dirname, '..');
const suites = readdirSync(path.join(root, 'tests')).filter((file) => file.endsWith('.test.js'))
  .sort().map((file) => 'tests/' + file);
const casos = [
  ['--test', '--test-concurrency=1', ...suites],
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


