'use strict';

const { ErrorPago } = require('../utils/pagos-proveedor');

function leerTexto(nombre) {
  return String(process.env[nombre] || '').trim();
}

function leerEntero(nombre, { minimo, maximo }) {
  const valor = Number(leerTexto(nombre));
  if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
    throw new ErrorPago(503, 'CONFIG_PAGOS_INVALIDA', `${nombre} debe ser un entero entre ${minimo} y ${maximo}.`);
  }
  return valor;
}

function validarUrlHttps(valor, nombre) {
  let url;
  try {
    url = new URL(valor);
  } catch {
    throw new ErrorPago(503, 'CONFIG_URL_INVALIDA', `${nombre} debe ser una URL válida.`);
  }
  if (url.protocol !== 'https:') {
    throw new ErrorPago(503, 'CONFIG_URL_HTTPS_REQUERIDO', `${nombre} debe usar HTTPS.`);
  }
  return url;
}

function obtenerConfiguracionPagos() {
  const provider = leerTexto('PAYMENT_PROVIDER').toUpperCase();
  const environment = leerTexto('PAYMENT_ENVIRONMENT').toUpperCase();
  const currency = leerTexto('PAYMENT_CURRENCY').toUpperCase();
  const referencePrefix = leerTexto('PAYMENT_REFERENCE_PREFIX');
  const itemTitlePrefix = leerTexto('MERCADOPAGO_ITEM_TITLE_PREFIX');
  const reservationTimeoutSeconds = leerEntero('PAYMENT_CHECKOUT_RESERVATION_TIMEOUT_SECONDS', { minimo: 30, maximo: 900 });
  const reconciliationIntervalMs = leerEntero('PAYMENT_RECONCILIATION_INTERVAL_MS', { minimo: 5000, maximo: 600000 });

  if (provider !== 'MERCADOPAGO') {
    throw new ErrorPago(503, 'PROVEEDOR_PAGO_NO_CONFIGURADO', 'PAYMENT_PROVIDER debe ser MERCADOPAGO.');
  }
  // Este paquete deliberadamente solo admite TEST: no puede procesar cobros de producción.
  if (environment !== 'TEST') {
    throw new ErrorPago(503, 'ENTORNO_PAGO_NO_PERMITIDO', 'Esta migración está limitada al entorno de pruebas.');
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ErrorPago(503, 'MONEDA_PAGO_NO_CONFIGURADA', 'PAYMENT_CURRENCY debe ser un código ISO de tres letras.');
  }
  if (!/^[A-Z0-9_-]{2,12}$/.test(referencePrefix)) {
    throw new ErrorPago(503, 'REFERENCIA_PAGO_INVALIDA', 'PAYMENT_REFERENCE_PREFIX debe contener entre 2 y 12 caracteres alfanuméricos.');
  }
  if (!itemTitlePrefix || itemTitlePrefix.length > 40) {
    throw new ErrorPago(503, 'TITULO_PAGO_INVALIDO', 'MERCADOPAGO_ITEM_TITLE_PREFIX debe tener entre 1 y 40 caracteres.');
  }

  return Object.freeze({ provider, environment, currency, referencePrefix, itemTitlePrefix, reservationTimeoutSeconds, reconciliationIntervalMs });
}

function obtenerConfiguracionMercadoPago({ requerirWebhook = false } = {}) {
  const payment = obtenerConfiguracionPagos();
  const accessToken = leerTexto('MERCADOPAGO_ACCESS_TOKEN');
  const webhookSecret = leerTexto('MERCADOPAGO_WEBHOOK_SECRET');
  const apiBase = validarUrlHttps(leerTexto('MERCADOPAGO_API_BASE_URL'), 'MERCADOPAGO_API_BASE_URL');
  const apiBaseUrl = apiBase.origin;
  if (apiBase.hostname !== 'api.mercadopago.com' || apiBase.pathname !== '/') {
    throw new ErrorPago(503, 'MERCADOPAGO_API_HOST_INVALIDO', 'La API debe usar el host oficial de Mercado Pago.');
  }

  // Un token TEST no puede procesar fondos reales y evita activar producción por error.
  if (!/^APP_USR-[A-Za-z0-9_-]{16,}$/.test(accessToken)) {
    throw new ErrorPago(503, 'MERCADOPAGO_TEST_TOKEN_INVALIDO', 'El Access Token de prueba de Checkout Pro Orders debe comenzar con APP_USR-.');
  }

  const allowedHosts = leerTexto('MERCADOPAGO_CHECKOUT_ALLOWED_HOSTS')
    .split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!allowedHosts.length || allowedHosts.some((host) => !/^[a-z0-9.-]+$/.test(host))) {
    throw new ErrorPago(503, 'MERCADOPAGO_CHECKOUT_HOSTS_INVALIDOS', 'Configura los dominios permitidos para checkout.');
  }

  const timeoutMs = leerEntero('MERCADOPAGO_REQUEST_TIMEOUT_MS', { minimo: 1000, maximo: 30000 });
  const webhookToleranceSeconds = leerEntero('MERCADOPAGO_WEBHOOK_TOLERANCE_SECONDS', { minimo: 60, maximo: 900 });
  const reservationTimeoutSeconds = leerEntero('PAYMENT_CHECKOUT_RESERVATION_TIMEOUT_SECONDS', { minimo: 30, maximo: 900 });
  if (requerirWebhook && webhookSecret.length < 16) {
    throw new ErrorPago(503, 'MERCADOPAGO_WEBHOOK_SECRET_FALTANTE', 'Falta la firma secreta del webhook de pruebas.');
  }

  const frontendBase = validarUrlHttps(leerTexto('FRONTEND_PUBLIC_URL'), 'FRONTEND_PUBLIC_URL');
  const returnUrls = {
    success: new URL(leerTexto('MERCADOPAGO_SUCCESS_RETURN_PATH'), frontendBase).toString(),
    failure: new URL(leerTexto('MERCADOPAGO_FAILURE_RETURN_PATH'), frontendBase).toString(),
    pending: new URL(leerTexto('MERCADOPAGO_PENDING_RETURN_PATH'), frontendBase).toString(),
  };
  for (const [key, value] of Object.entries(returnUrls)) {
    validarUrlHttps(value, `MERCADOPAGO_${key.toUpperCase()}_RETURN_URL`);
    if (new URL(value).origin !== frontendBase.origin) {
      throw new ErrorPago(503, 'MERCADOPAGO_RETURN_ORIGIN_INVALIDO', 'Las URLs de retorno deben pertenecer al frontend configurado.');
    }
  }

  return Object.freeze({
    ...payment,
    accessToken,
    webhookSecret,
    apiBaseUrl,
    allowedHosts: Object.freeze(allowedHosts),
    timeoutMs,
    webhookToleranceSeconds,
    reservationTimeoutSeconds,
    returnUrls: Object.freeze(returnUrls),
  });
}

function validarUrlCheckout(valor) {
  const config = obtenerConfiguracionMercadoPago();
  const url = validarUrlHttps(String(valor || ''), 'checkout_url');
  if (!config.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new ErrorPago(502, 'MERCADOPAGO_CHECKOUT_HOST_NO_PERMITIDO', 'La URL checkout no pertenece a un dominio permitido.');
  }
  if (!url.pathname.startsWith('/checkout/')) {
    throw new ErrorPago(502, 'MERCADOPAGO_CHECKOUT_URL_INVALIDA', 'Mercado Pago devolvió una URL checkout inesperada.');
  }
  return url.toString();
}

module.exports = {
  obtenerConfiguracionPagos,
  obtenerConfiguracionMercadoPago,
  validarUrlCheckout,
};
