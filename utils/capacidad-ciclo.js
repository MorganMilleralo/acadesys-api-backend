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

// Compatibilidad de registros existentes: 0/NULL conservan el contrato sin
// límite configurado; un entero positivo conserva su aforo, incluso >120.
// Esta función NO se usa para admitir nuevas capacidades fuera de 1–120.
function capacidadHistoricaValida(valor) {
  if (valor === null) return true;
  if (!['number', 'string'].includes(typeof valor) || !/^\d+$/.test(String(valor).trim())) return false;
  return Number.isSafeInteger(Number(valor)) && Number(valor) >= 0;
}

function disponibilidadCiclo(capacidad, total) {
  const totalValido = ['number', 'string'].includes(typeof total)
    && /^\d+$/.test(String(total).trim()) && Number.isSafeInteger(Number(total));
  const valida = capacidadValida(capacidad) && totalValido;
  const operativa = capacidadHistoricaValida(capacidad) && totalValido;
  const sinLimite = capacidad === null || Number(capacidad) === 0;
  return {
    capacidadValida: valida,
    requiereRevisionCapacidad: !valida || (!sinLimite && Number(total) > Number(capacidad)),
    vacantesDisponibles: operativa ? sinLimite ? null : Math.max(Number(capacidad) - Number(total), 0) : 0,
    disponible: operativa && (sinLimite || Number(total) < Number(capacidad)),
  };
}

module.exports = { MIN_CAPACIDAD, MAX_CAPACIDAD, CAPACIDAD_DEFAULT, capacidadValida, capacidadHistoricaValida, disponibilidadCiclo };
