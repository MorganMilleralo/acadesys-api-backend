'use strict';

// Generador OFFLINE: no importa db/dotenv y nunca ejecuta SQL.
// Entrada: exportación revisada, con monto propuesto y decisión de Morgan por cada fila.
const fs = require('node:fs');
const path = require('node:path');

function id(valor) {
  if (!Number.isSafeInteger(valor) || valor <= 0 || valor > 2147483647) throw new Error('ID inválido.');
  return valor;
}
function monto(valor) {
  // Cadenas decimales exactas: no redondear silenciosamente los históricos.
  if (typeof valor !== 'string' || !/^\d{1,8}\.\d{2}$/.test(valor)) throw new Error('El monto debe ser una cadena decimal con dos posiciones.');
  return valor;
}
function prepararPlan(entrada) {
  if (!Array.isArray(entrada) || !entrada.length) throw new Error('La lista revisada está vacía.');
  const vistos = new Set();
  const filas = entrada.map(row => {
    const IdPago = id(row.IdPago);
    if (vistos.has(IdPago)) throw new Error('IdPago duplicado.');
    vistos.add(IdPago);
    if (row.Estado !== 'Pendiente' || row.FechaPago !== null || row.EstadoRegistro !== 1) {
      throw new Error('Solo cuotas Pendiente activas y sin FechaPago.');
    }
    if (typeof row.Mes !== 'string' || !/^(Inscripcion|20\d{2}-(0[1-9]|1[0-2]))$/.test(row.Mes)) {
      throw new Error('Concepto/periodo histórico no clasificado.');
    }
    if (typeof row.decisionMorgan !== 'string' || !row.decisionMorgan.trim()) throw new Error('Falta referencia de la decisión de Morgan.');
    const anterior = monto(row.Monto);
    const nuevo = monto(row.MontoAprobado);
    if (Number(anterior) === Number(nuevo)) throw new Error('La fila no requiere ajuste.');
    return { IdPago, IdUsuario: id(row.IdUsuario), IdCiclo: id(row.IdCiclo), IdAcademia: id(row.IdAcademia),
      Mes: row.Mes, Estado: row.Estado, FechaPago: null, EstadoRegistro: 1,
      Monto: anterior, MontoAprobado: nuevo, decisionMorgan: row.decisionMorgan.trim() };
  });
  const generar = (revertir) => [
    '-- BORRADOR PARA QA. Verificar esquema, respaldo y aprobación antes de ejecutar.',
    '-- Cada FilasAfectadas debe ser 1. Si alguna es 0: ROLLBACK del lote completo.',
    '-- ROLLBACK por defecto. COMMIT requiere revisión del lote, bitácora y autorización explícita.',
    'START TRANSACTION;',
    ...filas.map(row => {
      const esperado = revertir ? row.MontoAprobado : row.Monto;
      const destino = revertir ? row.Monto : row.MontoAprobado;
      const filtro = `p.IdPago = ${row.IdPago} AND p.IdUsuario = ${row.IdUsuario} AND p.IdCiclo = ${row.IdCiclo}
  AND u.IdAcademia = ${row.IdAcademia} AND c.IdAcademia = ${row.IdAcademia}
  AND BINARY p.Mes = '${row.Mes}' AND BINARY p.Estado = 'Pendiente'
  AND p.EstadoRegistro = 1 AND p.FechaPago IS NULL AND p.Monto = ${esperado}`;
      return `-- Pago ${row.IdPago}; no tocar si fue confirmado o modificado desde la vista previa.
SELECT p.* FROM PagosMensualidad p
JOIN Usuario u ON u.IdUsuario = p.IdUsuario JOIN Ciclo c ON c.IdCiclo = p.IdCiclo
WHERE ${filtro} FOR UPDATE;
UPDATE PagosMensualidad p
JOIN Usuario u ON u.IdUsuario = p.IdUsuario JOIN Ciclo c ON c.IdCiclo = p.IdCiclo
SET p.Monto = ${destino} WHERE ${filtro};
SELECT ROW_COUNT() AS FilasAfectadas;`;
    }),
    'ROLLBACK;',
  ].join('\n\n');
  return { respaldo: filas, vistaPrevia: filas.map(row => ({ idPago: row.IdPago, anterior: row.Monto, nuevo: row.MontoAprobado })),
    aplicarSQL: generar(false), revertirSQL: generar(true) };
}

if (require.main === module) {
  try {
    const [entrada, salida] = process.argv.slice(2);
    if (!entrada || !salida) throw new Error('Uso offline: node scripts/plan-regularizacion-pagos.js exportacion-revisada.json directorio-nuevo');
    const plan = prepararPlan(JSON.parse(fs.readFileSync(entrada, 'utf8')));
    // Directorio nuevo: nunca sobrescribe respaldo o bitácora existentes.
    fs.mkdirSync(salida);
    fs.writeFileSync(path.join(salida, 'respaldo.json'), JSON.stringify(plan.respaldo, null, 2), { flag: 'wx' });
    fs.writeFileSync(path.join(salida, 'vista-previa.json'), JSON.stringify(plan.vistaPrevia, null, 2), { flag: 'wx' });
    fs.writeFileSync(path.join(salida, 'aplicar.sql'), plan.aplicarSQL, { flag: 'wx' });
    fs.writeFileSync(path.join(salida, 'revertir.sql'), plan.revertirSQL, { flag: 'wx' });
    fs.writeFileSync(path.join(salida, 'bitacora.json'), JSON.stringify({ estado: 'PREPARADO_NO_EJECUTADO', filas: plan.respaldo.length,
      creadoEn: new Date().toISOString(), instrucciones: 'Adjuntar aprobación, respaldo completo verificado y resultado de QA antes de ejecución. Registrar actor, fecha, filas afectadas y transacción aplicada/revertida.' }, null, 2), { flag: 'wx' });
    console.log('Artefactos preparados. No se ejecutó SQL.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { prepararPlan };
