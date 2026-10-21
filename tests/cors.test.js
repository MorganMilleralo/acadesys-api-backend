// ============================================================
// Pruebas de la política CORS (config/cors.js)
// Runner nativo de Node (node --test), sin dependencias extra.
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');

const {
  corsOptions,
  construirOrigenesPermitidos,
  origenPermitido,
  ORIGENES_PRODUCCION,
} = require('../config/cors');

const ORIGEN_LOCAL_5173 = 'http://localhost:5173';
const ORIGEN_LOCAL_5174 = 'http://localhost:5174';
const ORIGEN_LOCAL_127_5174 = 'http://127.0.0.1:5174';
const ORIGEN_MALICIOSO = 'https://sitio-malicioso.example';

// App mínima que reutiliza EXACTAMENTE la misma configuración CORS del backend.
function crearApp() {
  const app = express();
  app.use(cors(corsOptions));
  app.get('/api/ciclos/publicos', (req, res) => res.status(200).json([{ idCiclo: 1 }]));
  app.post('/api/auth/login', (req, res) => res.status(200).json({ ok: true }));
  return app;
}

async function conServidor(fn) {
  const server = crearApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const acao = (res) => res.headers.get('access-control-allow-origin');

// ---------- Lógica de la whitelist ----------

test('whitelist: incluye desarrollo, producción y CORS_ORIGINS', () => {
  const permitidos = construirOrigenesPermitidos({
    CORS_ORIGINS: 'https://extra.example.com',
  });
  assert.ok(permitidos.has(ORIGEN_LOCAL_5173));
  assert.ok(permitidos.has(ORIGEN_LOCAL_5174));
  assert.ok(permitidos.has(ORIGEN_LOCAL_127_5174));
  assert.ok(permitidos.has('https://extra.example.com'));
  for (const prod of ORIGENES_PRODUCCION) assert.ok(permitidos.has(prod));
  assert.equal(permitidos.has(ORIGEN_MALICIOSO), false);
});

test('origenPermitido: sin Origin se permite; desconocido se rechaza', () => {
  assert.equal(origenPermitido(undefined), true);
  assert.equal(origenPermitido(''), true);
  assert.equal(origenPermitido(ORIGEN_LOCAL_5173), true);
  assert.equal(origenPermitido(ORIGEN_LOCAL_5174), true);
  assert.equal(origenPermitido(ORIGEN_MALICIOSO), false);
});

// ---------- Orígenes permitidos ----------

test('CORS GET /api/ciclos/publicos: permite 5173', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/ciclos/publicos`, {
      headers: { Origin: ORIGEN_LOCAL_5173 },
    });
    assert.equal(res.status, 200);
    assert.equal(acao(res), ORIGEN_LOCAL_5173);
  });
});

test('CORS GET /api/ciclos/publicos: permite 5174', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/ciclos/publicos`, {
      headers: { Origin: ORIGEN_LOCAL_5174 },
    });
    assert.equal(res.status, 200);
    assert.equal(acao(res), ORIGEN_LOCAL_5174);
  });
});

test('CORS GET /api/ciclos/publicos: permite 127.0.0.1:5174', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/ciclos/publicos`, {
      headers: { Origin: ORIGEN_LOCAL_127_5174 },
    });
    assert.equal(res.status, 200);
    assert.equal(acao(res), ORIGEN_LOCAL_127_5174);
  });
});

test('CORS: conserva el origen de producción', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/ciclos/publicos`, {
      headers: { Origin: ORIGENES_PRODUCCION[0] },
    });
    assert.equal(res.status, 200);
    assert.equal(acao(res), ORIGENES_PRODUCCION[0]);
  });
});

// ---------- Origen NO permitido ----------

test('CORS: un origen no permitido NO recibe autorización ni provoca 500', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/ciclos/publicos`, {
      headers: { Origin: ORIGEN_MALICIOSO },
    });
    assert.equal(acao(res), null);
    assert.notEqual(res.status, 500);
  });
});

// ---------- Preflight / OPTIONS ----------

test('preflight OPTIONS /api/auth/login: aceptado para 5174 con cabeceras CORS', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGEN_LOCAL_5174,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(acao(res), ORIGEN_LOCAL_5174);
    assert.match(res.headers.get('access-control-allow-methods') || '', /POST/i);
    const headers = (res.headers.get('access-control-allow-headers') || '').toLowerCase();
    assert.match(headers, /content-type/);
    assert.match(headers, /authorization/);
  });
});

test('preflight OPTIONS: un origen no permitido no recibe CORS ni 500', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGEN_MALICIOSO,
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(acao(res), null);
    assert.notEqual(res.status, 500);
  });
});

// ---------- Requests sin Origin ----------

test('requests sin Origin (servidor a servidor) funcionan', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/ciclos/publicos`);
    assert.equal(res.status, 200);
  });
});
