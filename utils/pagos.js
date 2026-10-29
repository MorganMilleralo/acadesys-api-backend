'use strict';

function obtenerPrecioCiclo(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const precio = Number(valor);
  if (!Number.isFinite(precio) || precio < 0) return null;
  return Math.round((precio + Number.EPSILON) * 100) / 100;
}

/**
 * Precio canónico de inscripción. Precio es el nombre legado usado por main;
 * la migración copia su valor a PrecioInscripcion sin alterar el histórico.
 */
function obtenerPrecioInscripcion(ciclo) {
  if (!ciclo || typeof ciclo !== 'object') return null;
  const nuevo = obtenerPrecioCiclo(ciclo.PrecioInscripcion);
  if (nuevo !== null) return nuevo;
  return obtenerPrecioCiclo(ciclo.Precio);
}

function normalizarPeriodoMensualidad(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(texto);
  if (!match) return null;
  const anio = Number(match[1]);
  if (anio < 2000 || anio > 2200) return null;
  return texto;
}

function fechaISOValida(valor) {
  if (typeof valor !== 'string') return false;
  const texto = valor.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!match) return false;
  const anio = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

function normalizarReferenciaPago(valor) {
  if (typeof valor !== 'string' || /[\r\n\t]/.test(valor)) return null;
  const texto = valor.trim().replace(/\s+/g, ' ');
  if (texto.length < 4 || texto.length > 120) return null;
  // Admite referencias de banco frecuentes; no admite markup ni saltos de línea.
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._/#:-]{2,119}$/u.test(texto)) return null;
  return texto;
}

function normalizarUrlComprobante(valor) {
  if (valor === undefined || valor === null || valor === '') return { valida: true, valor: null };
  if (typeof valor !== 'string') return { valida: false, valor: null };
  const texto = valor.trim();
  if (texto.length > 500 || texto.includes('..') || texto.includes('\\')) {
    return { valida: false, valor: null };
  }
  // Solo rutas locales del almacenamiento de comprobantes. El cliente no puede
  // introducir URLs externas, javascript:, data: ni destinos arbitrarios.
  if (!/^\/uploads\/comprobantes\/[A-Za-z0-9][A-Za-z0-9._/-]{0,450}$/.test(texto)) {
    return { valida: false, valor: null };
  }
  return { valida: true, valor: texto };
}

function esEstadoPago(valor, estado) {
  return String(valor ?? '').trim().toLowerCase() === String(estado).trim().toLowerCase();
}

module.exports = {
  obtenerPrecioInscripcion,
  normalizarPeriodoMensualidad,
  fechaISOValida,
  normalizarReferenciaPago,
  normalizarUrlComprobante,
  esEstadoPago,
};
