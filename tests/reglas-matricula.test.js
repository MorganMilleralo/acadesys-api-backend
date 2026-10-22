'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fechaDia,
  obtenerEstadoCicloValido,
  obtenerPrecioCiclo,
  capacidadPermiteMatricula,
  obtenerIdAcademiaPublica,
} = require('../utils/reglas-matricula');

test('fechaDia acepta fechas MySQL como texto y Date sin desplazamiento de día', () => {
  assert.equal(fechaDia('2026-10-21').valida, true);
  assert.equal(fechaDia(new Date(2026, 9, 21)).valida, true);
  assert.equal(fechaDia('2026-02-31').valida, false);
  assert.equal(fechaDia('no-es-fecha').valida, false);
});

test('ciclo activo con fecha final en el futuro está abierto', () => {
  const estado = obtenerEstadoCicloValido(
    { EstadoRegistro: 1, FechaInicio: '2026-12-01', FechaFin: '2027-01-31' },
    new Date(2026, 9, 21, 12, 0, 0),
  );
  assert.equal(estado, 'ABIERTO');
});

test('ciclo terminado o con fechas incoherentes se rechaza', () => {
  assert.equal(obtenerEstadoCicloValido({ EstadoRegistro: 1, FechaFin: '2026-10-20' }, new Date(2026, 9, 21)), 'FINALIZADO');
  assert.equal(obtenerEstadoCicloValido({ EstadoRegistro: 1, FechaInicio: '2027-01-10', FechaFin: '2026-12-01' }), 'INVALIDO');
  assert.equal(obtenerEstadoCicloValido({ EstadoRegistro: 0 }), 'CERRADO');
  assert.equal(obtenerEstadoCicloValido(null), 'NO_EXISTE');
});

test('precio debe venir configurado y ser finito/no negativo', () => {
  assert.equal(obtenerPrecioCiclo('125.30'), 125.3);
  assert.equal(obtenerPrecioCiclo(0), 0);
  for (const value of [null, undefined, '', 'abc', -1, Infinity, NaN]) assert.equal(obtenerPrecioCiclo(value), null);
});

test('capacidad 0 es ilimitada; con límite se rechaza cuando está lleno', () => {
  assert.equal(capacidadPermiteMatricula(0, 0), true);
  assert.equal(capacidadPermiteMatricula(49, 50), true);
  assert.equal(capacidadPermiteMatricula(50, 50), false);
  assert.equal(capacidadPermiteMatricula(-1, 50), false);
});

test('la academia pública proviene de la configuración y se valida', () => {
  assert.equal(obtenerIdAcademiaPublica({}), null);
  assert.equal(obtenerIdAcademiaPublica({ PUBLIC_REGISTRATION_ACADEMY_ID: '7' }), 7);
  assert.equal(obtenerIdAcademiaPublica({ PUBLIC_REGISTRATION_ACADEMY_ID: '7x' }), null);
});
