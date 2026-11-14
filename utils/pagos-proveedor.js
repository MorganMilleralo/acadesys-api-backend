
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

function idOrdenCulqi(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  return /^ord_(?:test|live)_[A-Za-z0-9]{8,40}$/.test(texto) ? texto : null;
}

module.exports = { ErrorPago, aCentimos, idOrdenCulqi };