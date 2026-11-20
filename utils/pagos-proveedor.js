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

function aCentimos(valor) {
  if (!['number', 'string'].includes(typeof valor)) return null;
  const texto = String(valor).trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(texto)) return null;
  const [entero, decimal = ''] = texto.split('.');
  return Number(entero) * 100 + Number(decimal.padEnd(2, '0'));
}

function importeDecimal(valor) {
  const centimos = aCentimos(valor);
  if (centimos === null) return null;
  return `${Math.floor(centimos / 100)}.${String(centimos % 100).padStart(2, '0')}`;
}

function idOrdenMercadoPago(valor) {
  if (typeof valor !== 'string') return null;
  const id = valor.trim();
  return /^ORD[A-Z0-9]{16,48}$/.test(id) ? id : null;
}

function idempotencyKeyValida(valor) {
  return typeof valor === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

module.exports = { ErrorPago, aCentimos, importeDecimal, idOrdenMercadoPago, idempotencyKeyValida };
