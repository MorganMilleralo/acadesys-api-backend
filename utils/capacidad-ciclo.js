'use strict';

const MIN_CAPACIDAD = 1;
const MAX_CAPACIDAD = 120;
const CAPACIDAD_DEFAULT = 100;

function capacidadValida(valor) {
  if (!['number', 'string'].includes(typeof valor)) return false;
  if (typeof valor === 'string' && !/^\d+$/.test(valor.trim())) return false;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= MIN_CAPACIDAD && numero <= MAX_CAPACIDAD;
}

function disponibilidadCiclo(capacidad, total) {
  const totalValido = ['number', 'string'].includes(typeof total)
    && /^\d+$/.test(String(total).trim()) && Number.isSafeInteger(Number(total));
  const valida = capacidadValida(capacidad) && totalValido;
  return {
    capacidadValida: valida,
    requiereRevisionCapacidad: !valida || Number(total) > Number(capacidad),
    vacantesDisponibles: valida ? Math.max(Number(capacidad) - Number(total), 0) : 0,
    disponible: valida && Number(total) < Number(capacidad),
  };
}

module.exports = { MIN_CAPACIDAD, MAX_CAPACIDAD, CAPACIDAD_DEFAULT, capacidadValida, disponibilidadCiclo };
