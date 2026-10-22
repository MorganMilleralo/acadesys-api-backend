'use strict';

/**
 * Reglas puras de matrícula que pueden probarse sin MySQL ni credenciales.
 * El servidor continúa siendo la fuente de verdad para ciclo, precio y vacantes.
 */
function fechaDia(valor, finDeDia = false) {
  if (valor === null || valor === undefined || valor === '') return { presente: false, valida: true, fecha: null };

  let texto;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return { presente: true, valida: false, fecha: null };
    const año = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, '0');
    const dia = String(valor.getDate()).padStart(2, '0');
    texto = `${año}-${mes}-${dia}`;
  } else {
    texto = String(valor).trim().slice(0, 10);
  }

  const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { presente: true, valida: false, fecha: null };

  const año = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  const fecha = new Date(año, mes - 1, dia, finDeDia ? 23 : 0, finDeDia ? 59 : 0, finDeDia ? 59 : 0, finDeDia ? 999 : 0);
  if (fecha.getFullYear() !== año || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
    return { presente: true, valida: false, fecha: null };
  }

  return { presente: true, valida: true, fecha };
}

function obtenerEstadoCicloValido(ciclo, ahora = new Date()) {
  if (!ciclo) return 'NO_EXISTE';
  if (Number(ciclo.EstadoRegistro) !== 1) return 'CERRADO';

  const inicio = fechaDia(ciclo.FechaInicio, false);
  const fin = fechaDia(ciclo.FechaFin, true);
  if (!inicio.valida || !fin.valida) return 'INVALIDO';
  if (inicio.presente && fin.presente && fin.fecha < inicio.fecha) return 'INVALIDO';
  if (fin.presente && fin.fecha < ahora) return 'FINALIZADO';

  // Una fecha de inicio futura no bloquea la matrícula si el ciclo está
  // publicado y todavía admite inscripciones.
  return 'ABIERTO';
}

function obtenerPrecioCiclo(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const precio = Number(valor);
  if (!Number.isFinite(precio) || precio < 0) return null;
  return Math.round((precio + Number.EPSILON) * 100) / 100;
}

function capacidadPermiteMatricula(total, capacidad) {
  const totalNumerico = Number(total);
  const capacidadNumerica = capacidad === null || capacidad === undefined || capacidad === ''
    ? 0
    : Number(capacidad);
  if (!Number.isFinite(totalNumerico) || totalNumerico < 0) return false;
  if (!Number.isFinite(capacidadNumerica) || capacidadNumerica < 0) return false;
  // Por contrato actual, capacidad 0/null significa que no se configuró un límite.
  return capacidadNumerica === 0 || totalNumerico < capacidadNumerica;
}

function idPositivoSeguro(valor) {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  if (typeof valor === 'string' && !/^\d+$/.test(valor.trim())) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function obtenerIdAcademiaPublica(env = process.env) {
  const raw = env.PUBLIC_REGISTRATION_ACADEMY_ID;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  return idPositivoSeguro(String(raw).trim());
}

module.exports = {
  fechaDia,
  obtenerEstadoCicloValido,
  obtenerPrecioCiclo,
  capacidadPermiteMatricula,
  obtenerIdAcademiaPublica,
};
