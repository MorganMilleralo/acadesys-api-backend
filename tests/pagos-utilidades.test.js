'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  obtenerPrecioInscripcion,
  normalizarPeriodoMensualidad,
  fechaISOValida,
  normalizarReferenciaPago,
  normalizarUrlComprobante,
  esEstadoPago,
} = require('../utils/pagos');

test('precio de inscripción usa PrecioInscripcion y conserva fallback legado Precio', () => {
  assert.equal(obtenerPrecioInscripcion({ PrecioInscripcion: '275.50', Precio: 100 }), 275.5);
  assert.equal(obtenerPrecioInscripcion({ PrecioInscripcion: null, Precio: '100.00' }), 100);
  assert.equal(obtenerPrecioInscripcion({ PrecioInscripcion: 0, Precio: 100 }), 0);
  assert.equal(obtenerPrecioInscripcion({ PrecioInscripcion: null, Precio: null }), null);
  assert.equal(obtenerPrecioInscripcion(null), null);
});

test('periodo mensual admite AAAA-MM válido y rechaza fechas arbitrarias', () => {
  assert.equal(normalizarPeriodoMensualidad('2026-10'), '2026-10');
  assert.equal(normalizarPeriodoMensualidad(' 2027-01 '), '2027-01');
  for (const valor of ['2026-00', '2026-13', '2026-1', '2026-10-01', 202610, '1999-12', '2201-01']) {
    assert.equal(normalizarPeriodoMensualidad(valor), null, String(valor));
  }
});

test('fecha de vencimiento valida fechas reales, incluyendo años bisiestos', () => {
  assert.equal(fechaISOValida('2028-02-29'), true);
  assert.equal(fechaISOValida('2026-02-29'), false);
  assert.equal(fechaISOValida('2026-04-31'), false);
  assert.equal(fechaISOValida('2026-4-01'), false);
  assert.equal(fechaISOValida('no-fecha'), false);
});

test('referencias de pago se normalizan y rechazan markup o valores fuera de rango', () => {
  assert.equal(normalizarReferenciaPago('  OP-1234  '), 'OP-1234');
  assert.equal(normalizarReferenciaPago('Transferencia 12345'), 'Transferencia 12345');
  for (const valor of [undefined, null, 12345, 'abc', ' <script>alert(1)</script> ', 'x'.repeat(121), 'OP\n1234']) {
    assert.equal(normalizarReferenciaPago(valor), null, String(valor));
  }
});

test('URL de comprobante solo acepta rutas locales controladas', () => {
  assert.deepEqual(normalizarUrlComprobante(undefined), { valida: true, valor: null });
  assert.deepEqual(normalizarUrlComprobante('/uploads/comprobantes/op-123.png'), {
    valida: true,
    valor: '/uploads/comprobantes/op-123.png',
  });
  for (const valor of [
    'https://evil.example/a.png',
    'javascript:alert(1)',
    '/uploads/comprobantes/../secreto',
    '/uploads/otros/a.png',
    '/uploads/comprobantes/a\\b.png',
    'x'.repeat(501),
  ]) assert.equal(normalizarUrlComprobante(valor).valida, false, valor);
});

test('comparación del estado de pago no depende de mayúsculas/minúsculas', () => {
  assert.equal(esEstadoPago('Pagado', 'pagado'), true);
  assert.equal(esEstadoPago('En revisión', 'Pagado'), false);
});
