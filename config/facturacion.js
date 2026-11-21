'use strict';

// Configuración del servicio de facturación electrónica (fact_api, SUNAT).
// Si FACT_API_URL está vacío la emisión queda desactivada: los pagos siguen
// funcionando y la boleta se puede solicitar después desde administración.

function texto(nombre) {
  return String(process.env[nombre] || '').trim();
}

function entero(nombre, porDefecto, minimo, maximo) {
  const bruto = texto(nombre);
  if (!bruto) return porDefecto;
  const valor = Number(bruto);
  if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
    throw new Error(`${nombre} debe ser un entero entre ${minimo} y ${maximo}.`);
  }
  return valor;
}

function facturacionActiva() {
  return Boolean(texto('FACT_API_URL'));
}

function obtenerConfiguracionFacturacion() {
  const base = texto('FACT_API_URL');
  if (!base) {
    const error = new Error('El servicio de boletas electrónicas no está configurado.');
    error.status = 503;
    error.code = 'FACTURACION_NO_DISPONIBLE';
    throw error;
  }
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error('FACT_API_URL debe ser una URL válida.');
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && process.env.NODE_ENV !== 'production')) {
    throw new Error('FACT_API_URL debe usar HTTPS.');
  }
  const email = texto('FACT_API_EMAIL');
  const password = texto('FACT_API_PASSWORD');
  if (!email || !password) throw new Error('Faltan FACT_API_EMAIL o FACT_API_PASSWORD.');

  const serie = texto('FACT_API_SERIE_BOLETA') || 'B001';
  if (!/^B[A-Z0-9]{3}$/.test(serie)) throw new Error('FACT_API_SERIE_BOLETA debe tener el formato B001.');

  const afectacion = texto('FACT_API_AFECTACION_IGV') || '10';
  if (!['10', '20'].includes(afectacion)) throw new Error('FACT_API_AFECTACION_IGV debe ser 10 (gravado) o 20 (exonerado).');

  return Object.freeze({
    baseUrl: url.origin + url.pathname.replace(/\/+$/, ''),
    email,
    password,
    companyId: entero('FACT_API_COMPANY_ID', 1, 1, 1000000),
    branchId: entero('FACT_API_BRANCH_ID', 1, 1, 1000000),
    serie,
    afectacion,
    timeoutMs: entero('FACT_API_TIMEOUT_MS', 60000, 2000, 90000),
    maxIntentos: entero('FACT_API_MAX_INTENTOS', 5, 1, 20),
    minutosBloqueo: entero('FACT_API_MINUTOS_BLOQUEO', 5, 1, 60),
  });
}

module.exports = { facturacionActiva, obtenerConfiguracionFacturacion };
