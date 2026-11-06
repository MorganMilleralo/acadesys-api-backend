'use strict';

/**
 * Vista previa por defecto. Solo corrige cuotas PENDIENTES, sin FechaPago,
 * y únicamente los IdPago aprobados explícitamente en --ids. Resuelve el importe
 * según concepto: PrecioInscripcion/Precio legado para Inscripcion; PrecioMensual
 * para periodos mensuales. No toca pagos Pagados, Morosos ni importes canónicos nulos.
 * Ejemplo de vista previa: node scripts/regularizar-inscripciones-pendientes.js
 * Ejemplo de aplicación: CONFIRMAR_AJUSTE_PAGOS=SI node scripts/regularizar-inscripciones-pendientes.js --apply --ids=21,25
 */
require('dotenv').config();
const pool = require('../config/db');
const { idPositivo } = require('../utils/validaciones');

function parseIds(argumento) {
  if (!argumento) return [];
  const raw = argumento.replace(/^--ids=/, '');
  const partes = raw.split(',').map((x) => x.trim());
  if (!partes.length || partes.some((x) => !idPositivo(x))) {
    throw new Error('Usa --ids=ID1,ID2 con identificadores enteros positivos.');
  }
  return [...new Set(partes.map(Number))];
}

async function listarCandidatas(connection, ids = null, bloquear = false) {
  const params = [];
  let filtroIds = '';
  if (ids && ids.length) {
    filtroIds = ` AND p.IdPago IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  const lock = bloquear ? ' FOR UPDATE' : '';
  const [rows] = await connection.query(
    `SELECT p.IdPago, p.IdUsuario, p.IdCiclo, p.Monto AS MontoAnterior,
            CASE WHEN LOWER(TRIM(p.Mes)) = 'inscripcion'
              THEN COALESCE(c.PrecioInscripcion, c.Precio)
              ELSE c.PrecioMensual END AS MontoCanonico,
            CASE WHEN LOWER(TRIM(p.Mes)) = 'inscripcion' THEN 'Inscripcion' ELSE 'Mensualidad' END AS Concepto,
            p.Mes, p.Estado, p.FechaPago, c.Nombre AS Ciclo, c.IdAcademia
     FROM PagosMensualidad p
     INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo
     INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario AND u.IdAcademia = c.IdAcademia
     WHERE LOWER(TRIM(COALESCE(p.Estado, ''))) = 'pendiente'
       AND p.FechaPago IS NULL AND p.EstadoRegistro = 1
       AND u.EstadoRegistro = 1
       AND (
         (LOWER(TRIM(p.Mes)) = 'inscripcion' AND COALESCE(c.PrecioInscripcion, c.Precio) IS NOT NULL)
         OR (LOWER(TRIM(p.Mes)) <> 'inscripcion' AND c.PrecioMensual IS NOT NULL)
       )
       AND ROUND(p.Monto, 2) <> ROUND(
         CASE WHEN LOWER(TRIM(p.Mes)) = 'inscripcion'
           THEN COALESCE(c.PrecioInscripcion, c.Precio)
           ELSE c.PrecioMensual END, 2)
       ${filtroIds}
     ORDER BY p.IdPago ASC${lock}`,
    params,
  );
  return rows;
}

async function main() {
  const argumentos = process.argv.slice(2);
  const aplicar = argumentos.includes('--apply');
  const idsArg = argumentos.find((x) => x.startsWith('--ids='));
  const ids = parseIds(idsArg);

  if (aplicar && process.env.CONFIRMAR_AJUSTE_PAGOS !== 'SI') {
    throw new Error('Bloqueado: para aplicar, define CONFIRMAR_AJUSTE_PAGOS=SI después de revisar la vista previa y tener respaldo.');
  }
  if (aplicar && ids.length === 0) {
    throw new Error('Bloqueado: --apply requiere --ids=ID1,ID2 con los pagos revisados y aprobados.');
  }
  const idActorAjuste = idPositivo(process.env.PAGO_AJUSTE_ACTOR_ID);
  if (aplicar && !idActorAjuste) {
    throw new Error('Bloqueado: define PAGO_AJUSTE_ACTOR_ID con el IdUsuario del administrador que aprobó el ajuste.');
  }

  if (!aplicar) {
    const rows = await listarCandidatas(pool);
    console.log(JSON.stringify({ modo: 'VISTA_PREVIA_NO_MODIFICA', candidatas: rows.map((row) => ({
      idPago: Number(row.IdPago), idUsuario: Number(row.IdUsuario), idCiclo: Number(row.IdCiclo),
      ciclo: row.Ciclo, concepto: row.Concepto, periodo: row.Mes,
      montoActual: Number(row.MontoAnterior), montoCanonico: Number(row.MontoCanonico), estado: row.Estado,
    })), siguientePaso: 'Revisar cada IdPago con administración. No aplicar automáticamente toda la lista.' }, null, 2));
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const rows = await listarCandidatas(connection, ids, true);
    const idsEncontrados = new Set(rows.map((row) => Number(row.IdPago)));
    const faltantes = ids.filter((id) => !idsEncontrados.has(id));
    if (faltantes.length) {
      throw new Error(`No se aplicó ningún cambio: estos IdPago no son candidatas seguras (no pendientes, ya pagados, sin diferencia o importe canónico nulo): ${faltantes.join(', ')}.`);
    }

    for (const row of rows) {
      const [actoresAutorizados] = await connection.query(
        `SELECT u.IdUsuario
         FROM Usuario u
         INNER JOIN Usuario_Perfiles up ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
         INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
         WHERE u.IdUsuario = ? AND u.IdAcademia = ? AND u.EstadoRegistro = 1
           AND LOWER(TRIM(p.Nombre)) IN ('administrador', 'recursos humanos')
         LIMIT 1 FOR UPDATE`,
        [idActorAjuste, row.IdAcademia],
      );
      if (!actoresAutorizados.length) {
        throw new Error(`El usuario ${idActorAjuste} no es administrador activo de la academia ${row.IdAcademia}; se cancela el lote.`);
      }
      const anterior = Number(row.MontoAnterior);
      const canonico = Number(row.MontoCanonico);
      const [actualizado] = await connection.query(
        `UPDATE PagosMensualidad
         SET Monto = ?
         WHERE IdPago = ? AND Mes = ? AND EstadoRegistro = 1
           AND LOWER(TRIM(COALESCE(Estado, ''))) = 'pendiente'
           AND FechaPago IS NULL`,
        [canonico, row.IdPago, row.Mes],
      );
      if (actualizado.affectedRows !== 1) throw new Error(`El pago ${row.IdPago} cambió durante la operación; se cancela el lote.`);
      await connection.query(
        `INSERT INTO PagoAuditoria
          (IdPago, IdComprobante, IdUsuarioActor, IdAcademia, Evento,
           EstadoAnterior, EstadoNuevo, MontoAnterior, MontoNuevo, Motivo, FechaCreacion)
         VALUES (?, NULL, ?, ?, 'AJUSTE_MONTO_PENDIENTE', 'Pendiente', 'Pendiente', ?, ?, ?, NOW())`,
        [row.IdPago, idActorAjuste, row.IdAcademia, anterior, canonico, `Ajuste aprobado de cuota pendiente ${row.Mes} al precio canónico del ciclo y concepto.`],
      );
    }
    await connection.commit();
    console.log(JSON.stringify({ modo: 'APLICADO', ajustados: rows.map((row) => ({
      idPago: Number(row.IdPago), montoAnterior: Number(row.MontoAnterior), montoNuevo: Number(row.MontoCanonico),
    })) }, null, 2));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

main()
  .catch((error) => {
    console.error(`No se aplicó la regularización: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
