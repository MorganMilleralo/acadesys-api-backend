// Ejecución explícita: node tests/smoke-readonly.js
// Arranca una instancia local y solo realiza GET/OPTIONS; nunca login, POST ni DDL.
const { spawn } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  const root = path.join(__dirname, '..');
  const child = spawn(process.execPath, ['-e', `const {server} = require('./index'); server.once('listening', () => process.send({port: server.address().port}));`], {
    cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let timer;
  try {
    const port = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('El servidor no inició en 15 segundos.')), 15000);
      child.once('message', (mensaje) => resolve(mensaje.port));
      child.once('error', () => reject(new Error('No se pudo arrancar la instancia local.')));
      child.once('exit', (code) => reject(new Error(`El servidor terminó antes del smoke (código ${code}).`)));
    });
    clearTimeout(timer);
    const base = `http://127.0.0.1:${port}`;
    async function get(ruta, esperado = 200) {
      const res = await fetch(base + ruta, { signal: AbortSignal.timeout(15000) });
      console.log(`GET ${ruta.replace(/\/\d+/g, '/:id')} -> ${res.status}`);
      assert.equal(res.status, esperado);
      return res.json();
    }
    assert.equal((await get('/ping')).ok, true);
    const ciclos = await get('/api/ciclos/publicos');
    const lista = Array.isArray(ciclos) ? ciclos : ciclos.ciclos || ciclos.data || [];
    console.log(`Catálogo público leído: ${lista.length} ciclo(s); sin mostrar datos personales.`);
    const id = lista[0]?.idCiclo ?? lista[0]?.IdCiclo;
    if (id) {
      await get(`/api/ciclos/publicos/${Number(id)}/detalle`);
      await get(`/api/ciclos/${Number(id)}/cursos`);
    }
    for (const ruta of ['/api/admin/ciclos', '/api/materiales/admin', '/api/notas']) await get(ruta, 401);
    const cors = await fetch(base + '/api/auth/login', { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type',
    }, signal: AbortSignal.timeout(5000) });
    assert.equal(cors.status, 204);
    assert.equal(cors.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    console.log('OPTIONS CORS localhost:5173 -> 204. Smoke de solo lectura correcto.');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) {
      const terminado = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await terminado;
    }
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});


