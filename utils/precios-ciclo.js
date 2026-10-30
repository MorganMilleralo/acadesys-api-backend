'use strict';
const { obtenerPrecioInscripcion } = require('./pagos');

// Se conserva el máximo de negocio existente; DECIMAL(8,2) admite estos valores.
const MAX_PRECIO = 9999.99;
function importe(valor, campo) {
  if (valor === null) return null;
  if (!['number', 'string'].includes(typeof valor)
      || !/^\d+(?:\.\d{1,2})?$/.test(String(valor).trim())) {
    throw new Error(`${campo} debe ser null o un importe no negativo con hasta dos decimales.`);
  }
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero > MAX_PRECIO) throw new Error(`${campo} no puede superar S/ ${MAX_PRECIO}.`);
  return numero;
}

function campoPrecio(body, camel, pascal) {
  const claves = [camel, pascal].filter(clave => Object.hasOwn(body, clave));
  if (!claves.length) return { presente: false };
  const valores = claves.map(clave => importe(body[clave], camel));
  if (valores.some(valor => valor !== valores[0])) throw new Error(`Los alias de ${camel} contienen valores diferentes.`);
  return { presente: true, valor: valores[0] };
}

function prepararPrecios(body, existente = null) {
  try {
    const legado = campoPrecio(body, 'precio', 'Precio');
    const inscripcion = campoPrecio(body, 'precioInscripcion', 'PrecioInscripcion');
    const mensual = campoPrecio(body, 'precioMensual', 'PrecioMensual');
    if (legado.presente && inscripcion.presente && legado.valor !== inscripcion.valor) {
      throw new Error('precio es un alias de inscripción; no puede diferir de precioInscripcion.');
    }
    return {
      // PUT no reescribe el precio histórico. El payload legado actualiza la tarifa canónica.
      precio: existente ? existente.Precio ?? null : legado.presente ? legado.valor : null,
      precioInscripcion: inscripcion.presente ? inscripcion.valor
        : legado.presente ? legado.valor : existente?.PrecioInscripcion ?? null,
      precioMensual: mensual.presente ? mensual.valor : existente?.PrecioMensual ?? null,
      preciosError: null,
    };
  } catch (error) { return { preciosError: error.message }; }
}

function salidaPrecios(ciclo) {
  const nullable = valor => valor === null || valor === undefined ? null : Number(valor);
  const efectivo = obtenerPrecioInscripcion(ciclo);
  return {
    precio: efectivo,
    precioHistorico: nullable(ciclo.Precio),
    precioInscripcion: nullable(ciclo.PrecioInscripcion),
    precioInscripcionEfectivo: efectivo,
    precioMensual: nullable(ciclo.PrecioMensual),
    origenPrecioInscripcion: efectivo === null ? null
      : obtenerPrecioInscripcion({ PrecioInscripcion: ciclo.PrecioInscripcion }) !== null ? 'PrecioInscripcion' : 'Precio',
  };
}

function salidaPreciosAdmin(ciclo) {
  const precios = salidaPrecios(ciclo);
  return Object.fromEntries(Object.entries(precios).map(([clave, valor]) => [clave[0].toUpperCase() + clave.slice(1), valor]));
}

module.exports = { MAX_PRECIO, prepararPrecios, salidaPrecios, salidaPreciosAdmin };
