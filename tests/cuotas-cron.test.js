'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fechaLocalLima,
  periodoLima,
  diasDelMes,
  fechaVencimientoPeriodo,
  siguientePeriodo,
  cicloCubrePeriodo,
} = require('../scripts/generar-mensualidades-cron');

test('el periodo se calcula con America/Lima, no con la zona UTC del servidor', () => {
  assert.equal(fechaLocalLima(new Date('2026-11-14T04:59:59.000Z')), '2026-11-13');
  assert.equal(periodoLima(new Date('2026-11-14T05:00:00.000Z')), '2026-11');
});

test('calcula correctamente los días del mes, incluidos años bisiestos', () => {
  assert.equal(diasDelMes('2028-02'), 29);
  assert.equal(diasDelMes('2026-02'), 28);
  assert.equal(diasDelMes('2026-11'), 30);
  assert.throws(() => diasDelMes('2026-13'));
});

test('el vencimiento configurable se limita al último día del mes', () => {
  assert.equal(fechaVencimientoPeriodo('2026-11', 5), '2026-11-05');
  assert.equal(fechaVencimientoPeriodo('2026-02', 31), '2026-02-28');
  assert.equal(fechaVencimientoPeriodo('2028-02', 31), '2028-02-29');
  assert.throws(() => fechaVencimientoPeriodo('2026-11', 0));
});

test('solo considera ciclos con fechas válidas que se crucen con el periodo', () => {
  assert.equal(cicloCubrePeriodo('2026-10-15', '2026-11-03', '2026-11'), true);
  assert.equal(cicloCubrePeriodo('2026-12-01', '2027-02-01', '2026-11'), false);
  assert.equal(cicloCubrePeriodo(null, '2027-02-01', '2026-11'), false);
});

test('matriculaciones posteriores al vencimiento pueden diferir al siguiente periodo', () => {
  assert.equal(siguientePeriodo('2026-11'), '2026-12');
  assert.equal(siguientePeriodo('2026-12'), '2027-01');
  assert.throws(() => siguientePeriodo('2026-14'));
});
