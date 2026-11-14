
'use strict';

const crypto = require('node:crypto');
const { ErrorPago, aCentimos, idOrdenCulqi } = require('../utils/pagos-proveedor');

const API_BASE = 'https://api.culqi.com/v2';
const QR_MIN_CENTIMOS = 600;
const QR_MAX_CENTIMOS = 50000;

function configuracion() {
  const secretKey = String(process.env.CULQI_SECRET_KEY || '').trim();
  const publicKey = String(process.env.CULQI_PUBLIC_KEY || '').trim();
  const username = String(process.env.CULQI_WEBHOOK_USERNAME || '').trim();
  const password = String(process.env.CULQI_WEBHOOK_PASSWORD || '');
  const matchSecret = secretKey.match(/^sk_(test|live)_[A-Za-z0-9]+$/);
  const matchPublic = publicKey.match(/^pk_(test|live)_[A-Za-z0-9]+$/);

  if (!matchSecret || !matchPublic || matchSecret[1] !== matchPublic[1]) {
    throw new ErrorPago(503, 'CULQI_NO_CONFIGURADO',
      'La pasarela de pagos no está configurada correctamente. Puedes usar el medio manual habilitado por la academia.', true);
  }
  if (username.length < 4 || username.length > 20 || password.length < 12 || password.length > 120) {
    throw new ErrorPago(503, 'CULQI_WEBHOOK_NO_CONFIGURADO',
      'Falta configurar la autenticación del webhook de pagos.', true);
  }

  return {
    secretKey,
    publicKey,
    entorno: matchSecret[1],
    webhookUsername: username,
    webhookPassword: password,
  };
}

function verificarConfiguracion() {
  configuracion();
}

function errorProveedor(status, code, safeToMarkError = false) {
  if (status === 401 || status === 403) {
    return new ErrorPago(503, 'CULQI_CREDENCIALES_INVALIDAS',
      'No se pudo autenticar la cuenta de pagos. Verifica la configuración de Culqi.', true);
  }
  if (status === 400 || status === 422) {
    return new ErrorPago(422, 'CULQI_SOLICITUD_INVALIDA',
      'Culqi rechazó los datos de la orden. Revisa los datos registrados del alumno.', safeToMarkError);
  }
  if (status === 429) {
    return new ErrorPago(503, 'CULQI_LIMITE_SOLICITUDES',
      'El servicio de pagos recibió demasiadas solicitudes. Inténtalo más tarde.', true);
  }
  return new ErrorPago(502, code || 'CULQI_NO_DISPONIBLE',
    'No se pudo completar la operación con Culqi. La transacción queda protegida para evitar generar otro cobro.', false);
}

async function solicitudCulqi(path, { method = 'GET', body, key, timeoutMs = 8000 } = {}) {
  const config = configuracion();
  const bearer = key || config.secretKey;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-culqi-product': 'online',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = String(data?.code || data?.type || '').slice(0, 80);
      // Un rechazo 4xx de creación indica que Culqi no aceptó la orden.
      throw errorProveedor(response.status, code, [400, 401, 403, 422].includes(response.status));
    }
    return data;
  } catch (error) {
    if (error instanceof ErrorPago) throw error;
    if (error?.name === 'AbortError') {
      throw new ErrorPago(502, 'CULQI_TIMEOUT',
        'Culqi tardó demasiado en responder. El intento queda bloqueado para evitar un cobro duplicado.', false);
    }
    throw new ErrorPago(502, 'CULQI_RED_NO_DISPONIBLE',
      'No se pudo contactar con Culqi. El intento queda protegido para evitar un cobro duplicado.', false);
  } finally {
    clearTimeout(timer);
  }
}

function normalizarTelefono(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (/^9\d{8}$/.test(digitos)) return `+51${digitos}`;
  if (/^519\d{8}$/.test(digitos)) return `+${digitos}`;
  return null;
}

function normalizarNombres(reserva) {
  const nombre = String(reserva.nombreAlumno || '').trim().replace(/\s+/g, ' ');
  const apellido = [reserva.apellidoPaterno, reserva.apellidoMaterno]
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  if (nombre.length < 2 || nombre.length > 50 || apellido.length < 2 || apellido.length > 50) {
    throw new ErrorPago(409, 'DATOS_TITULAR_INCOMPLETOS',
      'Completa los nombres y apellidos del alumno en su perfil antes de iniciar el pago.', true);
  }
  return { nombre, apellido };
}

function minutosExpiracion() {
  const valor = Number(process.env.CULQI_ORDER_EXPIRATION_MINUTES || 30);
  if (!Number.isInteger(valor) || valor < 10 || valor > 120) {
    throw new ErrorPago(503, 'CULQI_EXPIRACION_INVALIDA',
      'La vigencia configurada para el QR no es válida.', true);
  }
  return valor;
}

function validarOrdenBasica(order, { orderId, amountCentimos, orderNumber } = {}) {
  if (!order || !idOrdenCulqi(order.id)
      || (orderId && order.id !== orderId)
      || !Number.isSafeInteger(Number(order.amount))
      || (amountCentimos !== undefined && Number(order.amount) !== amountCentimos)
      || order.currency_code !== 'PEN'
      || (orderNumber && order.order_number !== orderNumber)
      || !['created', 'pending', 'paid', 'expired', 'deleted'].includes(String(order.state))) {
    throw new ErrorPago(502, 'CULQI_ORDEN_RESPUESTA_INVALIDA',
      'Culqi devolvió una orden que no coincide con la transacción de AcadeSys.', false);
  }
  return order;
}

async function crearOrdenPago(reserva) {
  const config = configuracion();
  const amountCentimos = aCentimos(reserva?.monto);
  const idTransaccion = Number(reserva?.idTransaccion);
  const referencia = String(reserva?.referenciaInterna || '');
  if (!Number.isSafeInteger(idTransaccion) || idTransaccion <= 0
      || !/^ACS-[1-9]\d*-[-a-f0-9]{36}$/.test(referencia)
      || amountCentimos === null || amountCentimos < QR_MIN_CENTIMOS || amountCentimos > QR_MAX_CENTIMOS
      || reserva?.moneda !== 'PEN') {
    throw new ErrorPago(409, 'DATOS_ORDEN_CULQI_INVALIDOS',
      'La cuota no cumple los requisitos para generar un QR de billeteras móviles.', true);
  }

  const email = String(reserva.emailAlumno || '').trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ErrorPago(409, 'CORREO_TITULAR_INVALIDO',
      'El alumno debe tener un correo electrónico válido registrado en su perfil.', true);
  }
  const phone = normalizarTelefono(reserva.telefonoAlumno);
  if (!phone) {
    throw new ErrorPago(409, 'TELEFONO_TITULAR_INVALIDO',
      'Registra un celular peruano válido en el perfil del alumno antes de pagar con billeteras móviles.', true);
  }
  const { nombre, apellido } = normalizarNombres(reserva);
  const orderNumber = `ACS-${idTransaccion}`;
  const descripcionBase = `${reserva.concepto || 'Cuota'} ${reserva.ciclo || 'AcadeSys'}`
    .replace(/[^\p{L}\p{N} ._-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const description = (`AcadeSys ${descripcionBase}`).slice(0, 80);
  const expirationSeconds = Math.floor(Date.now() / 1000) + (minutosExpiracion() * 60);

  const body = {
    amount: amountCentimos,
    currency_code: 'PEN',
    description,
    order_number: orderNumber,
    client_details: {
      first_name: nombre,
      last_name: apellido,
      email,
      phone_number: phone,
    },
    expiration_date: expirationSeconds,
    // Las órdenes para billeteras móviles siguen el flujo de confirmación documentado por Culqi.
    // La orden se guarda primero en MySQL; luego se confirma desde el backend con la llave privada.
    confirm: false,
    metadata: {
      acadesys_transaction_id: String(idTransaccion),
      acadesys_payment_id: String(reserva.idPago || ''),
      acadesys_reference: referencia,
    },
  };

  const order = await solicitudCulqi('/orders', { method: 'POST', body });
  validarOrdenBasica(order, { amountCentimos, orderNumber });
  if (order.state !== 'created'
      || String(order.metadata?.acadesys_transaction_id) !== String(idTransaccion)
      || String(order.metadata?.acadesys_payment_id) !== String(reserva.idPago)
      || order.metadata?.acadesys_reference !== referencia) {
    throw new ErrorPago(502, 'CULQI_ORDEN_NO_VINCULADA',
      'La orden creada no pudo vincularse con la cuota de AcadeSys.', false);
  }

  return { idOrdenProveedor: order.id, estado: 'created', montoCentimos: amountCentimos, moneda: 'PEN' };
}

function validarOrdenDeReserva(order, orderId, reserva) {
  const amountCentimos = aCentimos(reserva?.monto);
  const idTransaccion = Number(reserva?.idTransaccion);
  const idPago = Number(reserva?.idPago);
  const referencia = String(reserva?.referenciaInterna || '');
  validarOrdenBasica(order, {
    orderId,
    amountCentimos,
    orderNumber: `ACS-${idTransaccion}`,
  });

  const metadata = order.metadata || {};
  if (!Number.isSafeInteger(idTransaccion) || idTransaccion <= 0
      || !Number.isSafeInteger(idPago) || idPago <= 0
      || !/^ACS-[1-9]\d*-[-a-f0-9]{36}$/.test(referencia)
      || String(metadata.acadesys_transaction_id) !== String(idTransaccion)
      || String(metadata.acadesys_payment_id) !== String(idPago)
      || metadata.acadesys_reference !== referencia) {
    throw new ErrorPago(409, 'CULQI_ORDEN_NO_COINCIDE',
      'La orden no coincide con la cuota reservada en AcadeSys.', false);
  }
  return order;
}

async function confirmarOrdenPago(orderId, reserva) {
  const config = configuracion();
  const id = idOrdenCulqi(orderId);
  if (!id || !id.startsWith(`ord_${config.entorno}_`)) {
    throw new ErrorPago(409, 'CULQI_ORDEN_ENTORNO_INVALIDO',
      'La orden no pertenece al entorno de Culqi configurado.', true);
  }

  // Primero consultamos el estado actual. Si un intento anterior sí confirmó
  // la orden pero falló al guardar la respuesta, reutilizamos esa misma orden.
  const existente = await solicitudCulqi(`/orders/${encodeURIComponent(id)}`);
  validarOrdenDeReserva(existente, id, reserva);

  if (['pending', 'paid', 'expired', 'deleted'].includes(existente.state)) {
    return existente;
  }
  if (existente.state !== 'created') {
    throw new ErrorPago(502, 'CULQI_ESTADO_ORDEN_DESCONOCIDO',
      'Culqi devolvió un estado de orden que requiere revisión.', false);
  }

  // La orden fue creada con confirm:false. La confirmamos en servidor con
  // la llave privada, de acuerdo con el flujo de Órdenes de Culqi.
  const confirmada = await solicitudCulqi(`/orders/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    body: { confirm: true },
    key: config.secretKey,
  });
  validarOrdenDeReserva(confirmada, id, reserva);
  if (!['pending', 'paid', 'expired', 'deleted'].includes(confirmada.state)) {
    throw new ErrorPago(502, 'CULQI_ORDEN_NO_CONFIRMADA',
      'Culqi no dejó la orden disponible para continuar el pago.', false);
  }
  return confirmada;
}

function compararSecreto(actual, esperado) {
  const a = Buffer.from(String(actual || ''), 'utf8');
  const b = Buffer.from(String(esperado || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validarNotificacion(req) {
  const config = configuracion();
  const authorization = String(req.headers?.authorization || '');
  const match = authorization.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) throw new ErrorPago(401, 'CULQI_WEBHOOK_NO_AUTORIZADO', 'Notificación no autenticada.');

  let credenciales;
  try { credenciales = Buffer.from(match[1], 'base64').toString('utf8'); }
  catch { throw new ErrorPago(401, 'CULQI_WEBHOOK_NO_AUTORIZADO', 'Notificación no autenticada.'); }
  const separador = credenciales.indexOf(':');
  if (separador < 1) throw new ErrorPago(401, 'CULQI_WEBHOOK_NO_AUTORIZADO', 'Notificación no autenticada.');
  const username = credenciales.slice(0, separador);
  const password = credenciales.slice(separador + 1);
  if (!compararSecreto(username, config.webhookUsername)
      || !compararSecreto(password, config.webhookPassword)) {
    throw new ErrorPago(401, 'CULQI_WEBHOOK_NO_AUTORIZADO', 'Notificación no autenticada.');
  }

  const event = req.body || {};
  if (event.type !== 'order.status.changed') {
    throw new ErrorPago(400, 'CULQI_EVENTO_NO_ADMITIDO', 'Tipo de notificación no admitido.');
  }
  let data = event.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); }
    catch { throw new ErrorPago(400, 'CULQI_WEBHOOK_INVALIDO', 'Notificación inválida.'); }
  }
  const orderId = idOrdenCulqi(data?.id);
  if (!orderId || !orderId.startsWith(`ord_${config.entorno}_`)) {
    throw new ErrorPago(400, 'CULQI_WEBHOOK_INVALIDO', 'Identificador de orden inválido.');
  }
  const fechaEvento = Number(event.creation_date);
  return {
    orderId,
    eventId: typeof event.id === 'string' ? event.id.slice(0, 80) : null,
    fechaEvento: Number.isSafeInteger(fechaEvento) && fechaEvento > 0
      ? (fechaEvento < 1e12 ? fechaEvento * 1000 : fechaEvento)
      : Date.now(),
  };
}

async function consultarOrdenVerificada({ orderId, fechaEvento } = {}) {
  const config = configuracion();
  const id = idOrdenCulqi(orderId);
  if (!id || !id.startsWith(`ord_${config.entorno}_`)) {
    throw new ErrorPago(400, 'CULQI_ORDEN_INVALIDA', 'Identificador de orden inválido.');
  }
  const order = await solicitudCulqi(`/orders/${encodeURIComponent(id)}`);
  validarOrdenBasica(order, { orderId: id });

  const metadata = order.metadata || {};
  const idTransaccion = Number(metadata.acadesys_transaction_id);
  const idPago = Number(metadata.acadesys_payment_id);
  const referencia = String(metadata.acadesys_reference || '');
  if (!Number.isSafeInteger(idTransaccion) || idTransaccion <= 0
      || !Number.isSafeInteger(idPago) || idPago <= 0
      || !/^ACS-[1-9]\d*-[-a-f0-9]{36}$/.test(referencia)
      || !referencia.startsWith(`ACS-${idPago}-`)
      || order.order_number !== `ACS-${idTransaccion}`
      || !['created', 'pending', 'paid', 'expired', 'deleted'].includes(order.state)) {
    throw new ErrorPago(409, 'CULQI_ORDEN_NO_COINCIDE',
      'La orden consultada no corresponde a una transacción de AcadeSys.', false);
  }
  const fechaRaw = Number(order.updated_at || order.paid_at || fechaEvento || order.creation_date || Date.now());
  const fechaActualizacionProveedor = Number.isSafeInteger(fechaRaw) && fechaRaw > 0
    ? (fechaRaw < 1e12 ? fechaRaw * 1000 : fechaRaw)
    : (Number.isSafeInteger(fechaEvento) && fechaEvento > 0 ? fechaEvento : Date.now());

  return {
    proveedor: 'CULQI',
    referenciaInterna: referencia,
    idOrdenProveedor: order.id,
    idPagoProveedor: order.id,
    idTransaccion,
    idPago,
    monto: Number(order.amount) / 100,
    moneda: order.currency_code,
    estadoProveedor: order.state,
    estado: ({ created: 'PENDIENTE', pending: 'PENDIENTE', paid: 'APROBADA',
      expired: 'EXPIRADA', deleted: 'CANCELADA' })[order.state],
    fechaActualizacionProveedor,
  };
}

module.exports = {
  verificarConfiguracion,
  crearOrdenPago,
  confirmarOrdenPago,
  validarNotificacion,
  consultarOrdenVerificada,
  // Exportaciones auxiliares para pruebas unitarias; no contienen secretos.
  normalizarTelefono,
  validarOrdenBasica,
  validarOrdenDeReserva,
};