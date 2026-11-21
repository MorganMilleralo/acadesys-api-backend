'use strict';

// API pública de integración: /api/integracion/v1
// Pensada para que el aplicativo de otro equipo lea los clientes (alumnos) de
// AcadeSys y confirme cuáles guardó, sin duplicados aunque sincronice varias veces.
// Autenticación por clave (X-API-Key), límite de solicitudes, validación
// estricta, errores uniformes y bitácora de cada solicitud.

const crypto = require('node:crypto');
const express = require('express');
const integracion = require('../services/integracion-clientes.service');
const { ErrorIntegracion } = integracion;
const { LimitadorSolicitudes } = require('../utils/limitador-solicitudes');

const router = express.Router();
const limitePorClave = new LimitadorSolicitudes();
const fallosPorIp = new LimitadorSolicitudes({ ventanaMs: 15 * 60_000 });
const FALLOS_MAXIMOS_POR_IP = 10;

function enviarError(res, status, codigo, mensaje, detalles) {
  res.locals.codigoError = codigo;
  return res.status(status).json({
    error: { codigo, mensaje, ...(detalles ? { detalles } : {}) },
    meta: { idSolicitud: res.locals.idSolicitud },
  });
}

function responderError(res, error) {
  if (error instanceof ErrorIntegracion) {
    return enviarError(res, error.status, error.codigo, error.message, error.detalles);
  }
  // Fallas de base de datos o inesperadas: sin detalles internos.
  console.error(`Integración ${res.locals.idSolicitud}:`, error?.code || error?.name || 'Error');
  return enviarError(res, 503, 'SERVICIO_NO_DISPONIBLE', 'El servicio no está disponible en este momento. Reintenta en unos segundos.');
}

// Identificador, cabeceras de seguridad y bitácora de cada solicitud.
router.use((req, res, next) => {
  const inicio = process.hrtime.bigint();
  res.locals.idSolicitud = crypto.randomUUID();
  res.set({
    'X-Request-Id': res.locals.idSolicitud,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  });
  res.on('finish', () => {
    const duracionMs = Number(process.hrtime.bigint() - inicio) / 1e6;
    integracion.registrarAuditoria({
      idConsumidor: res.locals.consumidor?.idConsumidor,
      idSolicitud: res.locals.idSolicitud,
      metodo: req.method,
      ruta: req.originalUrl.split('?')[0],
      estadoHttp: res.statusCode,
      codigo: res.locals.codigoError,
      registros: res.locals.registros,
      ip: req.ip,
      duracionMs,
    }).catch(() => {});
  });
  next();
});

// Estado del servicio: no requiere clave ni toca la base de datos.
router.get('/estado', (req, res) => {
  res.json({ servicio: 'AcadeSys API de integración', version: 'v1', estado: 'ok', fecha: new Date().toISOString() });
});

// Autenticación por clave de API.
router.use(async (req, res, next) => {
  const ip = req.ip || 'desconocida';
  if (fallosPorIp.agotado(ip, FALLOS_MAXIMOS_POR_IP)) {
    res.set('Retry-After', '900');
    return enviarError(res, 429, 'DEMASIADOS_INTENTOS', 'Demasiadas claves inválidas desde esta dirección. Espera 15 minutos.');
  }
  const encabezado = req.get('authorization');
  const clave = req.get('x-api-key') || (encabezado?.startsWith('Bearer ') ? encabezado.slice(7).trim() : '');
  if (!clave) {
    return enviarError(res, 401, 'CLAVE_REQUERIDA', 'Envía la clave de acceso en el encabezado X-API-Key.');
  }
  try {
    const consumidor = await integracion.autenticar(clave);
    if (!consumidor) {
      fallosPorIp.consumir(ip, FALLOS_MAXIMOS_POR_IP);
      return enviarError(res, 401, 'CLAVE_INVALIDA', 'La clave de acceso no es válida o fue revocada.');
    }
    res.locals.consumidor = consumidor;
  } catch (error) {
    return responderError(res, error);
  }

  const cuota = limitePorClave.consumir(`c${res.locals.consumidor.idConsumidor}`, res.locals.consumidor.limitePorMinuto);
  res.set({
    'X-RateLimit-Limit': String(cuota.limite),
    'X-RateLimit-Remaining': String(cuota.restantes),
    'X-RateLimit-Reset': String(cuota.reinicioSegundos),
  });
  if (!cuota.permitido) {
    res.set('Retry-After', String(cuota.reinicioSegundos));
    return enviarError(res, 429, 'LIMITE_EXCEDIDO', `Se superó el límite de ${cuota.limite} solicitudes por minuto.`);
  }
  return next();
});

function meta(res, extra = {}) {
  return {
    idSolicitud: res.locals.idSolicitud,
    generadoEn: new Date().toISOString(),
    consumidor: res.locals.consumidor.nombre,
    ...extra,
  };
}

// GET /clientes — todos los clientes, paginados con cursor.
router.get('/clientes', async (req, res) => {
  try {
    const consulta = integracion.validarConsulta(req.query, ['limite', 'cursor']);
    const resultado = await integracion.listarClientes(res.locals.consumidor, { ...consulta, soloPendientes: false });
    res.locals.registros = resultado.datos.length;
    return res.json({ ...resultado, meta: meta(res) });
  } catch (error) {
    return responderError(res, error);
  }
});

// GET /clientes/pendientes — solo los que este aplicativo aún no confirmó o que
// cambiaron desde su última confirmación. Es el endpoint para sincronizar.
router.get('/clientes/pendientes', async (req, res) => {
  try {
    const consulta = integracion.validarConsulta(req.query, ['limite', 'cursor']);
    const resultado = await integracion.listarClientes(res.locals.consumidor, { ...consulta, soloPendientes: true });
    res.locals.registros = resultado.datos.length;
    return res.json({ ...resultado, meta: meta(res) });
  } catch (error) {
    return responderError(res, error);
  }
});

// GET /clientes/:idCliente — un cliente.
router.get('/clientes/:idCliente', async (req, res) => {
  try {
    integracion.validarConsulta(req.query, []);
    const cliente = await integracion.obtenerCliente(res.locals.consumidor, req.params.idCliente);
    res.locals.registros = 1;
    return res.json({ datos: cliente, meta: meta(res) });
  } catch (error) {
    return responderError(res, error);
  }
});

// POST /clientes/confirmaciones — el aplicativo indica qué versiones guardó.
// Idempotente: repetir la misma confirmación no duplica nada.
router.post('/clientes/confirmaciones',
  (req, res, next) => (req.is('application/json')
    ? next()
    : enviarError(res, 415, 'TIPO_NO_SOPORTADO', 'El cuerpo debe enviarse como application/json.')),
  express.json({ limit: '32kb', strict: true }),
  async (req, res) => {
    try {
      const resultado = await integracion.confirmarClientes(res.locals.consumidor, req.body);
      res.locals.registros = resultado.resultados.length;
      return res.json({ ...resultado, meta: meta(res) });
    } catch (error) {
      return responderError(res, error);
    }
  });

router.use((req, res) => enviarError(res, 404, 'RUTA_NO_ENCONTRADA', `No existe ${req.method} ${req.baseUrl}${req.path}.`));

// JSON mal formado o demasiado grande.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return enviarError(res, 413, 'CUERPO_DEMASIADO_GRANDE', 'El cuerpo supera los 32 KB permitidos.');
  if (err?.type === 'entity.parse.failed') return enviarError(res, 400, 'JSON_INVALIDO', 'El cuerpo no es un JSON válido.');
  return responderError(res, err);
});

module.exports = router;
module.exports._limitadores = { limitePorClave, fallosPorIp };
