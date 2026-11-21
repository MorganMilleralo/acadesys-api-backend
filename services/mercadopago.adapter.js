'use strict';

const crypto = require('node:crypto');
const {
  ErrorPago,
  aCentimos,
  importeDecimal,
  idOrdenMercadoPago,
  idempotencyKeyValida,
} = require('../utils/pagos-proveedor');
const { obtenerConfiguracionPagos, obtenerConfiguracionMercadoPago, validarUrlCheckout } = require('../config/pagos');

function verificarConfiguracion({ requerirWebhook = false } = {}) {
  obtenerConfiguracionMercadoPago({ requerirWebhook });
}

function mapearErrorProveedor(status, body = {}) {
  const detail = String(body?.message || body?.error || body?.cause?.[0]?.description || '').trim().slice(0, 180);
  if (status === 401 || status === 403) {
    return new ErrorPago(503, 'MERCADOPAGO_CREDENCIALES_INVALIDAS', 'Mercado Pago no aceptó el Access Token de prueba.', false);
  }
  if (status === 400 || status === 422) {
    return new ErrorPago(422, 'MERCADOPAGO_SOLICITUD_RECHAZADA', detail || 'Mercado Pago rechazó los datos de la orden.', true);
  }
  if (status === 429) {
    return new ErrorPago(503, 'MERCADOPAGO_LIMITE_SOLICITUDES', 'Mercado Pago recibió demasiadas solicitudes. Inténtalo más tarde.', false);
  }
  return new ErrorPago(502, 'MERCADOPAGO_NO_DISPONIBLE', 'Mercado Pago no está disponible. La reserva se conserva para un reintento idempotente.', false);
}

async function solicitudMercadoPago(path, { method = 'GET', body, idempotencyKey } = {}) {
  const config = obtenerConfiguracionMercadoPago();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers = {
      Authorization: `Bearer ${config.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw mapearErrorProveedor(response.status, data);
    return data;
  } catch (error) {
    if (error instanceof ErrorPago) throw error;
    if (error?.name === 'AbortError') {
      throw new ErrorPago(502, 'MERCADOPAGO_TIMEOUT', 'Mercado Pago tardó demasiado. Reintenta usando la misma reserva; no se generará otra clave de idempotencia.', false);
    }
    throw new ErrorPago(502, 'MERCADOPAGO_RED_NO_DISPONIBLE', 'No se pudo contactar con Mercado Pago. La reserva se conserva para un reintento idempotente.', false);
  } finally {
    clearTimeout(timer);
  }
}

function normalizarTitulo(reserva = {}, config = obtenerConfiguracionPagos()) {
  const partes = [reserva.concepto, reserva.ciclo]
    .map((valor) => String(valor || '').trim())
    .filter(Boolean);
  const titulo = [config.itemTitlePrefix, ...partes].join(' - ').replace(/\s+/g, ' ').slice(0, 120);
  return titulo;
}

function escaparRegex(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validarReferenciaInterna(valor, prefix = obtenerConfiguracionPagos().referencePrefix) {
  const expresion = new RegExp(`^${escaparRegex(prefix)}-[1-9]\\d{0,14}-[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`, 'i');
  return typeof valor === 'string' && expresion.test(valor);
}

function validarOrdenBasica(order, { orderId, referenciaInterna, monto, moneda } = {}, config = obtenerConfiguracionPagos()) {
  if (!idOrdenMercadoPago(order?.id)
      || (orderId && order.id !== orderId)
      || order.type !== 'online'
      || order.processing_mode !== 'manual'
      || !validarReferenciaInterna(order.external_reference, config.referencePrefix)
      || (referenciaInterna && order.external_reference !== referenciaInterna)
      || aCentimos(order.total_amount) === null
      || (monto !== undefined && aCentimos(order.total_amount) !== aCentimos(monto))
      || (moneda && order.currency !== moneda)) {
    throw new ErrorPago(502, 'MERCADOPAGO_ORDEN_NO_COINCIDE', 'La orden no coincide con la reserva, el importe o la moneda de AcadeSys.', false);
  }
  return order;
}

function validarEstadoOrden(order) {
  const status = String(order?.status || '').trim().toLowerCase();
  const detail = String(order?.status_detail || '').trim().toLowerCase();
  if (!status) return null;
  const valor = `${status}:${detail || 'sin_detalle'}`;
  if (status === 'processed' && detail === 'accredited') return { estadoProveedor: valor, estado: 'APROBADA' };
  if ((status === 'processed' && detail === 'partially_refunded') || (status === 'refunded' && detail === 'refunded')) {
    return { estadoProveedor: valor, estado: 'REEMBOLSADA' };
  }
  if (status === 'failed') return { estadoProveedor: valor, estado: 'RECHAZADA' };
  if (status === 'canceled' && detail === 'canceled') return { estadoProveedor: valor, estado: 'CANCELADA' };
  // Estados no finales: la orden sigue esperando el pago o procesándolo.
  if (['created', 'processing', 'action_required'].includes(status)) return { estadoProveedor: valor, estado: 'PENDIENTE' };
  return null;
}

async function crearOrdenPago(reserva) {
  const config = obtenerConfiguracionMercadoPago();
  const amount = importeDecimal(reserva?.monto);
  const idTransaccion = Number(reserva?.idTransaccion);
  const idPago = Number(reserva?.idPago);
  const externalReference = String(reserva?.referenciaInterna || '');
  const idempotencyKey = String(reserva?.idempotencyKey || '');
  const email = String(reserva?.emailAlumno || '').trim().toLowerCase();

  if (!Number.isSafeInteger(idTransaccion) || idTransaccion <= 0
      || !Number.isSafeInteger(idPago) || idPago <= 0
      || !validarReferenciaInterna(externalReference)
      || !amount || aCentimos(amount) <= 0
      || !idempotencyKeyValida(idempotencyKey)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ErrorPago(409, 'DATOS_ORDEN_MERCADOPAGO_INVALIDOS', 'La cuota o el correo registrado del alumno no contienen datos válidos para crear la orden.', true);
  }

  const title = normalizarTitulo(reserva, config);
  const body = {
    type: 'online',
    processing_mode: 'manual',
    capture_mode: 'automatic_async',
    total_amount: amount,
    external_reference: externalReference,
    description: title,
    payer: { email },
    items: [{ title, quantity: 1, unit_price: amount }],
    config: {
      online: {
        success_url: config.returnUrls.success,
        failure_url: config.returnUrls.failure,
        pending_url: config.returnUrls.pending,
        auto_return: 'approved',
      },
    },
  };

  const order = await solicitudMercadoPago('/v1/orders', {
    method: 'POST',
    body,
    idempotencyKey,
  });
  validarOrdenBasica(order, { referenciaInterna: externalReference, monto: amount, moneda: config.currency }, config);
  // Checkout Pro puede devolver la orden recién creada como created:created o
  // ya esperando el pago (action_required:waiting_payment). Ambos son iniciales.
  const estadoInicial = validarEstadoOrden(order);
  const estadoRecibido = `${order.status || 'sin_estado'}:${order.status_detail || 'sin_detalle'}`.slice(0, 80);
  if (estadoInicial?.estado !== 'PENDIENTE' && String(order.status || '').toLowerCase() !== 'created') {
    throw new ErrorPago(502, 'MERCADOPAGO_ORDEN_INICIAL_INVALIDA', `Mercado Pago no devolvió una orden en estado inicial (${estadoRecibido}).`, false);
  }

  return {
    idOrdenProveedor: order.id,
    checkoutUrl: validarUrlCheckout(order.checkout_url),
    estadoProveedor: estadoRecibido,
    monto: Number(order.total_amount),
    moneda: order.currency,
  };
}

async function obtenerOrden(orderId, expected = {}) {
  const id = idOrdenMercadoPago(orderId);
  if (!id) throw new ErrorPago(400, 'MERCADOPAGO_ORDEN_ID_INVALIDO', 'El identificador de orden no es válido.');
  const config = obtenerConfiguracionMercadoPago();
  const order = await solicitudMercadoPago(`/v1/orders/${encodeURIComponent(id)}`);
  validarOrdenBasica(order, { orderId: id, referenciaInterna: expected.referenciaInterna, monto: expected.monto, moneda: config.currency }, config);
  return { ...order, checkout_url: validarUrlCheckout(order.checkout_url) };
}

async function consultarOrdenVerificada({ orderId, referenciaInterna, monto } = {}) {
  const config = obtenerConfiguracionMercadoPago();
  const order = await obtenerOrden(orderId, { referenciaInterna, monto });
  const normalizado = validarEstadoOrden(order);
  if (!normalizado) {
    const recibido = `${order?.status || 'sin_estado'}:${order?.status_detail || 'sin_detalle'}`.slice(0, 80);
    throw new ErrorPago(409, 'MERCADOPAGO_ESTADO_NO_ADMITIDO', `La orden tiene un estado que requiere revisión administrativa (${recibido}).`, false);
  }
  const totalCents = aCentimos(order.total_amount);
  const paidCents = aCentimos(order.total_paid_amount);
  if (normalizado.estado === 'APROBADA' && (paidCents === null || paidCents !== totalCents)) {
    throw new ErrorPago(409, 'MERCADOPAGO_IMPORTE_NO_ACREDITADO', 'El importe acreditado no coincide con el total de la cuota.', false);
  }
  const timestamp = Date.parse(order.last_updated_date || order.created_date || '');
  return {
    proveedor: config.provider,
    referenciaInterna: order.external_reference,
    idOrdenProveedor: order.id,
    idPagoProveedor: order.id,
    monto: Number(order.total_amount),
    moneda: order.currency,
    estadoProveedor: normalizado.estadoProveedor,
    estado: normalizado.estado,
    fechaActualizacionProveedor: Number.isFinite(timestamp) ? timestamp : Date.now(),
  };
}

function parsearFirma(valor) {
  return Object.fromEntries(String(valor || '').split(',').map((parte) => {
    const separador = parte.indexOf('=');
    return separador < 1 ? ['', ''] : [parte.slice(0, separador).trim(), parte.slice(separador + 1).trim()];
  }).filter(([clave, contenido]) => clave && contenido));
}

function validarNotificacion(req) {
  const config = obtenerConfiguracionMercadoPago({ requerirWebhook: true });
  const url = new URL(String(req.originalUrl || req.url || ''), 'https://acadesys.invalid');
  const queryId = String(url.searchParams.get('data.id') || '').trim();
  const queryType = String(url.searchParams.get('type') || '').trim().toLowerCase();
  const bodyType = String(req.body?.type || '').trim().toLowerCase();
  const bodyOrderId = String(req.body?.data?.id || '').trim();
  const orderId = idOrdenMercadoPago(queryId);
  if (!orderId
      || queryType !== 'order'
      || bodyType !== 'order'
      || bodyOrderId !== orderId) {
    throw new ErrorPago(400, 'MERCADOPAGO_WEBHOOK_INVALIDO', 'La notificación no contiene un identificador de Order consistente.');
  }
  if (req.body?.live_mode !== false) {
    throw new ErrorPago(403, 'MERCADOPAGO_ENTORNO_WEBHOOK_INVALIDO', 'Esta ruta solo admite notificaciones del entorno de pruebas.', false);
  }

  const signature = parsearFirma(req.headers?.['x-signature']);
  const requestId = String(req.headers?.['x-request-id'] || '').trim();
  const timestamp = String(signature.ts || '').trim();
  const receivedHash = String(signature.v1 || '').trim().toLowerCase();
  if (!requestId || !/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(receivedHash)) {
    throw new ErrorPago(401, 'MERCADOPAGO_FIRMA_INVALIDA', 'Faltan datos de firma del webhook.');
  }
  const timestampMs = Number(timestamp) < 1e12 ? Number(timestamp) * 1000 : Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > config.webhookToleranceSeconds * 1000) {
    throw new ErrorPago(401, 'MERCADOPAGO_FIRMA_EXPIRADA', 'La firma del webhook está fuera del intervalo permitido.');
  }

  const manifest = `id:${orderId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const expectedHash = crypto.createHmac('sha256', config.webhookSecret).update(manifest).digest('hex');
  const received = Buffer.from(receivedHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw new ErrorPago(401, 'MERCADOPAGO_FIRMA_INVALIDA', 'La firma del webhook no coincide.');
  }

  return {
    orderId,
    eventId: String(req.body?.id || '').slice(0, 100),
    action: String(req.body?.action || '').slice(0, 80),
  };
}

module.exports = {
  verificarConfiguracion,
  crearOrdenPago,
  obtenerOrden,
  consultarOrdenVerificada,
  validarNotificacion,
  validarOrdenBasica,
  validarEstadoOrden,
  validarReferenciaInterna,
};
