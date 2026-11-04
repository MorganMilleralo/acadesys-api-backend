'use strict';

const { MercadoPagoConfig, Preference, Payment, MerchantOrder, User,
  WebhookSignatureValidator } = require('mercadopago');
const { ErrorPago, aCentimos, idProveedor, urlCheckoutValida } = require('../utils/pagos-proveedor');

function configuracion() {
  const env = process.env;
  const modo = env.MERCADOPAGO_ENV || 'test';
  if (!env.MERCADOPAGO_ACCESS_TOKEN || !env.MERCADOPAGO_WEBHOOK_SECRET
      || !idProveedor(env.MERCADOPAGO_SELLER_ID) || !['test', 'production'].includes(modo)) {
    throw new ErrorPago(503, 'PASARELA_NO_CONFIGURADA', 'Falta configurar la pasarela de pagos.', true);
  }
  return { accessToken: env.MERCADOPAGO_ACCESS_TOKEN, secret: env.MERCADOPAGO_WEBHOOK_SECRET,
    sellerId: env.MERCADOPAGO_SELLER_ID, modo };
}

function cliente(config) {
  // Sin reintentos automáticos. El límite integral se aplica en llamadaProveedor.
  return new MercadoPagoConfig({ accessToken: config.accessToken,
    options: { timeout: 4000, maxRetries: 0 } });
}

function urlPublica(valor) {
  try {
    const url = new URL(valor);
    if (typeof valor !== 'string' || valor.length > 900 || url.protocol !== 'https:'
        || url.username || url.password || url.hash || url.port
        || !url.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) throw new Error();
    return url.toString();
  } catch { throw new ErrorPago(503, 'URL_PAGO_NO_CONFIGURADA', 'Configura URLs públicas HTTPS de pago.', true); }
}

async function llamadaProveedor(fn, antesDeCrear = false) {
  let timer;
  try {
    // El timeout del SDK termina al recibir headers; este incluye leer el JSON.
    return await Promise.race([fn(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Tiempo agotado')), 5000);
    })]);
  } catch (error) {
    const status = Number(error?.status);
    const credenciales = status === 401 || status === 403;
    throw new ErrorPago(credenciales ? 503 : 502,
      credenciales ? 'CREDENCIALES_PROVEEDOR_INVALIDAS' : 'PROVEEDOR_NO_DISPONIBLE',
      'No se pudo completar la operación con Mercado Pago.',
      antesDeCrear || [400, 401, 403, 422].includes(status));
  } finally { clearTimeout(timer); }
}

function respuestaInvalida() {
  throw new ErrorPago(502, 'RESPUESTA_PROVEEDOR_INVALIDA', 'Mercado Pago devolvió una respuesta que requiere verificación.');
}

async function crearOrdenPago({ idTransaccion, referenciaInterna, idempotencyKey, monto, moneda,
  concepto, ciclo, payerEmail, notificationUrl, returnUrl }) {
  const config = configuracion();
  const centimos = aCentimos(monto);
  if (!Number.isSafeInteger(idTransaccion) || idTransaccion <= 0
      || typeof referenciaInterna !== 'string' || !/^ACS-[1-9]\d*-[-a-f0-9]{36}$/.test(referenciaInterna)
      || typeof idempotencyKey !== 'string' || !/^ACS-[-a-f0-9]{36}$/.test(idempotencyKey)
      || moneda !== 'PEN' || !centimos) {
    throw new ErrorPago(409, 'DATOS_ORDEN_INVALIDOS', 'La transacción no contiene datos cobrables válidos.', true);
  }
  const retorno = urlPublica(returnUrl);
  const notificacion = new URL(urlPublica(notificationUrl));
  if (notificacion.pathname !== '/api/webhooks/mercadopago' || notificacion.search) {
    throw new ErrorPago(503, 'URL_PAGO_NO_CONFIGURADA', 'La URL del webhook no coincide con el endpoint configurado.', true);
  }
  notificacion.searchParams.set('source_news', 'webhooks');
  const sdk = cliente(config);
  const vendedor = await llamadaProveedor(() => new User(sdk).get(), true);
  if (idProveedor(vendedor?.id) !== config.sellerId || vendedor?.site_id !== 'MPE'
      || vendedor?.country_id !== 'PE'
      || !Array.isArray(vendedor?.tags)
      || vendedor.tags.includes('test_user') !== (config.modo === 'test')) {
    throw new ErrorPago(503, 'CUENTA_PROVEEDOR_INCOMPATIBLE', 'Verifica vendedor, país Perú y entorno de la cuenta.', true);
  }
  const body = {
    items: [{ id: String(idTransaccion), title: `AcadeSys ${ciclo || 'Cuota'} ${concepto || ''}`.slice(0, 240),
      quantity: 1, currency_id: 'PEN', unit_price: centimos / 100 }],
    external_reference: referenciaInterna,
    metadata: { acadesys_transaction_id: String(idTransaccion) },
    notification_url: notificacion.toString(),
    back_urls: { success: retorno, pending: retorno, failure: retorno },
    auto_return: 'approved',
  };
  if (typeof payerEmail === 'string' && payerEmail.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
    body.payer = { email: payerEmail };
  }
  const preferencia = await llamadaProveedor(() => new Preference(sdk).create({ body,
    requestOptions: { idempotencyKey } }));
  // Las cuentas de prueba también usan init_point; el prefijo del token no determina el entorno.
  if (!preferencia || typeof preferencia.id !== 'string' || !/^[\w-]{1,120}$/.test(preferencia.id)
      || preferencia.external_reference !== referenciaInterna
      || idProveedor(preferencia.collector_id) !== config.sellerId
      || !urlCheckoutValida(preferencia.init_point)) respuestaInvalida();
  return { idOrdenProveedor: preferencia.id, checkoutUrl: preferencia.init_point, estado: 'pending' };
}

function validarNotificacion(req) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) throw new ErrorPago(503, 'PASARELA_NO_CONFIGURADA', 'Falta configurar la firma del webhook.');
  const dataId = req.query?.['data.id'];
  const signature = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  const unicos = ['x-signature', 'x-request-id'].every(nombre =>
    req.rawHeaders.filter((_, i) => i % 2 === 0).filter(h => h.toLowerCase() === nombre).length === 1);
  if (!unicos || typeof dataId !== 'string' || !idProveedor(dataId)
      || typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId)
      || typeof signature !== 'string' || signature.length > 250) {
    throw new ErrorPago(401, 'FIRMA_WEBHOOK_INVALIDA', 'Notificación no autenticada.');
  }
  const partes = signature.split(',').map(p => p.trim());
  const ts = partes.find(p => p.startsWith('ts='))?.slice(3);
  if (partes.length !== 2 || partes.filter(p => /^ts=\d{10}(?:\d{3})?$/.test(p)).length !== 1
      || partes.filter(p => /^v1=[a-f0-9]{64}$/.test(p)).length !== 1) {
    throw new ErrorPago(401, 'FIRMA_WEBHOOK_INVALIDA', 'Notificación no autenticada.');
  }
  try {
    // SDK 3.6.1 asume segundos en toleranceSeconds; la documentación también
    // muestra milisegundos. HMAC usa el ts original; normalizamos SOLO su edad.
    WebhookSignatureValidator.validate({ xSignature: signature, xRequestId: requestId, dataId, secret });
    const timestampMs = Number(ts) * (ts.length === 10 ? 1000 : 1);
    if (!Number.isSafeInteger(timestampMs) || Math.abs(Date.now() - timestampMs) > 300000) throw new Error();
  } catch { throw new ErrorPago(401, 'FIRMA_WEBHOOK_INVALIDA', 'Notificación no autenticada.'); }
  if ((req.body?.data?.id !== undefined && idProveedor(req.body.data.id) !== dataId)
      || req.body?.type !== 'payment'
      || (req.query.type !== undefined && req.query.type !== 'payment')) {
    throw new ErrorPago(400, 'EVENTO_WEBHOOK_INVALIDO', 'Se requiere una notificación de pago consistente.');
  }
  return dataId;
}

async function consultarPagoVerificado(id) {
  if (!idProveedor(id)) respuestaInvalida();
  const config = configuracion();
  const sdk = cliente(config);
  const pago = await llamadaProveedor(() => new Payment(sdk).get({ id }));
  if (!pago || idProveedor(pago.id) !== String(id)
      || idProveedor(pago.collector_id) !== config.sellerId
      || pago.live_mode !== (config.modo === 'production')
      || !idProveedor(pago.order?.id) || pago.order?.type !== 'mercadopago') respuestaInvalida();
  const orden = await llamadaProveedor(() => new MerchantOrder(sdk).get({ merchantOrderId: pago.order.id }));
  if (!orden || idProveedor(orden.id) !== idProveedor(pago.order.id)
      || idProveedor(orden.collector?.id) !== config.sellerId
      || orden.external_reference !== pago.external_reference
      || typeof orden.preference_id !== 'string' || !/^[\w-]{1,120}$/.test(orden.preference_id)
      || !Array.isArray(orden.payments) || !orden.payments.some(p => idProveedor(p.id) === String(id))) respuestaInvalida();
  const preferencia = await llamadaProveedor(() => new Preference(sdk).get({ preferenceId: orden.preference_id }));
  const centimos = aCentimos(pago.transaction_amount);
  const fecha = typeof pago.date_last_updated === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(pago.date_last_updated)
    ? Date.parse(pago.date_last_updated) : NaN;
  const idTransaccion = Number(preferencia?.metadata?.acadesys_transaction_id);
  if (!preferencia || preferencia.id !== orden.preference_id
      || idProveedor(preferencia.collector_id) !== config.sellerId
      || preferencia.external_reference !== pago.external_reference
      || typeof pago.external_reference !== 'string' || !/^ACS-[1-9]\d*-[-a-f0-9]{36}$/.test(pago.external_reference)
      || !idProveedor(preferencia.metadata?.acadesys_transaction_id)
      || !Number.isSafeInteger(idTransaccion) || idTransaccion <= 0
      || !centimos || pago.currency_id !== 'PEN' || !Number.isSafeInteger(fecha)
      || fecha > Date.now() + 300000
      || !Array.isArray(preferencia.items) || preferencia.items.length !== 1
      || preferencia.items[0].quantity !== 1 || preferencia.items[0].currency_id !== 'PEN'
      || aCentimos(preferencia.items[0].unit_price) !== centimos
      || aCentimos(orden.total_amount) !== centimos) respuestaInvalida();
  const estados = { approved: 'APROBADA', pending: 'PENDIENTE', in_process: 'PENDIENTE',
    authorized: 'PENDIENTE', in_mediation: 'PENDIENTE', rejected: 'RECHAZADA', cancelled: 'CANCELADA',
    refunded: 'REEMBOLSADA', charged_back: 'CONTRACARGO' };
  if (!Object.hasOwn(estados, pago.status)) respuestaInvalida();
  if (pago.status === 'approved' && (pago.captured !== true
      || aCentimos(pago.transaction_amount_refunded ?? 0) !== 0)) respuestaInvalida();
  return { proveedor: 'MERCADOPAGO', referenciaInterna: pago.external_reference,
    idOrdenProveedor: preferencia.id, idPagoProveedor: String(id), idTransaccion,
    monto: pago.transaction_amount, moneda: pago.currency_id, estadoProveedor: pago.status,
    estado: estados[pago.status], fechaActualizacionProveedor: fecha };
}

module.exports = { crearOrdenPago, validarNotificacion, consultarPagoVerificado };
