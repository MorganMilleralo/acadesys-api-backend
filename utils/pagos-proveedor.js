'use strict';

class ErrorPago extends Error {
  constructor(status, code, message, safeToMarkError = false) {
    super(message);
    this.name = 'ErrorPago';
    this.status = status;
    this.code = code;
    this.safeToMarkError = safeToMarkError;
  }
}

// DECIMAL(10,2): nunca redondear un importe del proveedor para hacerlo coincidir.
function aCentimos(valor) {
  if (!['number', 'string'].includes(typeof valor)) return null;
  const texto = String(valor);
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(texto)) return null;
  const [entero, decimal = ''] = texto.split('.');
  return Number(entero) * 100 + Number(decimal.padEnd(2, '0'));
}

function idProveedor(valor) {
  if (typeof valor === 'number' && !Number.isSafeInteger(valor)) return null;
  if (!['string', 'number'].includes(typeof valor)) return null;
  const texto = String(valor);
  return /^[1-9]\d{0,19}$/.test(texto) ? texto : null;
}

function urlCheckoutValida(valor) {
  try {
    const url = new URL(valor);
    return typeof valor === 'string' && valor.length <= 1000
      && url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['www.mercadopago.com.pe', 'sandbox.mercadopago.com.pe',
        'www.mercadopago.com', 'sandbox.mercadopago.com'].includes(url.hostname)
      && /^(?:\/[a-z]{3})?\/checkout\//.test(url.pathname);
  } catch { return false; }
}

module.exports = { ErrorPago, aCentimos, idProveedor, urlCheckoutValida };
