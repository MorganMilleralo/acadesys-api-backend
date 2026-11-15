'use strict';
const { consultar, ejecutar } = require('../config/procedimientos');

const TIME_ZONE = 'America/Lima';

function fechaLocalLima(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(fecha);
  const valores = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

function periodoLima(fecha = new Date()) {
  return fechaLocalLima(fecha).slice(0, 7);
}

function diasDelMes(periodo) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(periodo || ''));
  if (!match) throw new Error('Periodo inválido; se esperaba AAAA-MM.');
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
}

function fechaVencimientoPeriodo(periodo, dia) {
  const n = Number(dia);
  if (!Number.isInteger(n) || n < 1 || n > 31) {
    throw new Error('PAGOS_DIA_VENCIMIENTO debe ser un entero entre 1 y 31.');
  }
  const day = String(Math.min(n, diasDelMes(periodo))).padStart(2, '0');
  return `${periodo}-${day}`;
}

function siguientePeriodo(periodo) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(periodo || ''));
  if (!match) throw new Error('Periodo inválido; se esperaba AAAA-MM.');
  const fecha = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`;
}

function cicloCubrePeriodo(fechaInicio, fechaFin, periodo) {
  if (!fechaInicio || !fechaFin) return false;
  const inicio = String(fechaInicio).slice(0, 10);
  const fin = String(fechaFin).slice(0, 10);
  const mesInicio = `${periodo}-01`;
  const mesFin = `${periodo}-${String(diasDelMes(periodo)).padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(inicio)
    && /^\d{4}-\d{2}-\d{2}$/.test(fin)
    && inicio <= mesFin
    && fin >= mesInicio;
}

function montoPositivo(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
}

async function generarCuotasMensuales({
  pool,
  periodo,
  fechaVencimiento,
  diaVencimiento,
  dryRun = true,
}) {
  if (!pool || typeof pool.getConnection !== 'function') {
    throw new Error('Se requiere un pool MySQL válido.');
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(periodo || ''))) {
    throw new Error('Periodo inválido; se esperaba AAAA-MM.');
  }

  const fechaInicioPeriodo = `${periodo}-01`;
  const fechaFinPeriodo = `${periodo}-${String(diasDelMes(periodo)).padStart(2, '0')}`;

  const [ciclos] = await consultar(pool, 'sp_cuotas_listar_ciclo', [fechaFinPeriodo, fechaInicioPeriodo]);

  const resumen = {
    dryRun: Boolean(dryRun),
    periodo,
    fechaVencimiento,
    ciclosRevisados: ciclos.length,
    ciclosOmitidosPrecio: 0,
    ciclosOmitidosFechas: 0,
    alumnosRevisados: 0,
    cuotasCreadas: 0,
    cuotasYaExistentes: 0,
    cuotasVencimientoSiguienteMes: 0,
    cuotasMorosas: 0,
    erroresCiclo: 0,
  };

  for (const ciclo of ciclos) {
    const monto = montoPositivo(ciclo.PrecioMensual);
    if (monto === null) {
      resumen.ciclosOmitidosPrecio += 1;
      continue;
    }
    if (!cicloCubrePeriodo(ciclo.FechaInicioISO, ciclo.FechaFinISO, periodo)) {
      resumen.ciclosOmitidosFechas += 1;
      continue;
    }

    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const [ciclosBloqueados] = await consultar(connection, 'sp_cuotas_bloquear_ciclo', [ciclo.IdCiclo, ciclo.IdAcademia]);

      if (!ciclosBloqueados.length) {
        if (dryRun) await connection.rollback();
        else await connection.commit();
        continue;
      }

      const cicloActual = ciclosBloqueados[0];
      const montoActual = montoPositivo(cicloActual.PrecioMensual);
      if (montoActual === null
          || !cicloCubrePeriodo(cicloActual.FechaInicioISO, cicloActual.FechaFinISO, periodo)) {
        if (dryRun) await connection.rollback();
        else await connection.commit();
        continue;
      }

      const [matriculas] = await consultar(connection, 'sp_cuotas_bloquear_matricula', [ciclo.IdCiclo, ciclo.IdAcademia]);

      resumen.alumnosRevisados += matriculas.length;

      for (const matricula of matriculas) {
        const idUsuario = Number(matricula.IdUsuario);
        if (!Number.isSafeInteger(idUsuario) || idUsuario <= 0) continue;

        // Si el alumno se matriculó después del día de vencimiento del periodo,
        // conserva la mensualidad completa (sin prorrateo), pero su fecha límite
        // pasa al mismo día del mes siguiente. Evita crear una deuda ya vencida
        // en el instante en que se matricula.
        const fechaMatricula = matricula.FechaMatriculaISO
          ? String(matricula.FechaMatriculaISO).slice(0, 10)
          : fechaInicioPeriodo;
        const fechaVencimientoAlumno = fechaMatricula > fechaVencimiento
          ? fechaVencimientoPeriodo(siguientePeriodo(periodo), diaVencimiento)
          : fechaVencimiento;
        const diferidaAlSiguienteMes = fechaVencimientoAlumno !== fechaVencimiento;

        const [existentes] = await consultar(connection, 'sp_cuotas_bloquear_cuota_por_id_usuario', [idUsuario, ciclo.IdCiclo, periodo]);

        if (existentes.length) {
          resumen.cuotasYaExistentes += 1;
          continue;
        }

        if (diferidaAlSiguienteMes) resumen.cuotasVencimientoSiguienteMes += 1;
        if (dryRun) {
          resumen.cuotasCreadas += 1;
          continue;
        }

        const [insertado] = await ejecutar(connection, 'sp_cuotas_registrar_cuota', [idUsuario, ciclo.IdCiclo, periodo, montoActual, fechaVencimientoAlumno]);

        await ejecutar(connection, 'sp_cuotas_registrar_auditoria_generacion', [
            insertado.insertId,
            ciclo.IdAcademia,
            montoActual,
            `Generación automática de la mensualidad ${periodo} para el ciclo ${ciclo.IdCiclo}.`,
          ]);
        resumen.cuotasCreadas += 1;
      }

      if (dryRun) await connection.rollback();
      else await connection.commit();
    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch { /* conservar error original */ }
      }
      resumen.erroresCiclo += 1;
      // No registrar nombres, correos ni datos personales.
      console.error(`Fallo al procesar ciclo ${ciclo.IdCiclo}: ${error?.code || error?.name || 'ERROR'}`);
    } finally {
      if (connection) connection.release();
    }
  }

  // Las cuotas vencidas pasan a Moroso, excepto las que tienen un comprobante
  // manual pendiente de revisión. El día de vencimiento todavía se considera hábil.
  let connectionMorosidad;
  try {
    connectionMorosidad = await pool.getConnection();
    await connectionMorosidad.beginTransaction();

    const [vencidas] = await consultar(connectionMorosidad, 'sp_cuotas_bloquear_cuota_por_fecha_vencimiento', [fechaLocalLima()]);

    resumen.cuotasMorosas = vencidas.length;
    if (!dryRun) {
      for (const pago of vencidas) {
        const [actualizada] = await ejecutar(connectionMorosidad, 'sp_cuotas_actualizar_estado_cuota', [pago.IdPago]);
        if (actualizada.affectedRows === 1) {
          await ejecutar(connectionMorosidad, 'sp_cuotas_registrar_auditoria_vencimiento', [
              pago.IdPago,
              pago.IdAcademia,
              pago.Estado,
              Number(pago.Monto),
              `Cuota marcada como morosa por vencimiento ${fechaLocalLima()}.`,
            ]);
        }
      }
    }

    if (dryRun) await connectionMorosidad.rollback();
    else await connectionMorosidad.commit();
  } catch (error) {
    if (connectionMorosidad) {
      try { await connectionMorosidad.rollback(); } catch { /* conservar error original */ }
    }
    throw error;
  } finally {
    if (connectionMorosidad) connectionMorosidad.release();
  }

  return resumen;
}

async function main() {
  require('dotenv').config();
  const dia = Number(process.env.PAGOS_DIA_VENCIMIENTO);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new Error('Configura PAGOS_DIA_VENCIMIENTO (1–31) con la política aprobada por la academia.');
  }

  const dryRun = String(process.env.PAGOS_CRON_DRY_RUN || 'true').toLowerCase() !== 'false';
  const periodo = periodoLima();
  const fechaVencimiento = fechaVencimientoPeriodo(periodo, dia);
  const pool = require('../config/db');

  try {
    const resumen = await generarCuotasMensuales({
      pool,
      periodo,
      fechaVencimiento,
      diaVencimiento: dia,
      dryRun,
    });
    console.log('Resultado del proceso automático de cuotas:', JSON.stringify(resumen));
    if (resumen.erroresCiclo > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('No se pudo ejecutar el proceso de cuotas:', error?.message || 'Error');
    process.exitCode = 1;
  });
}

module.exports = {
  fechaLocalLima,
  periodoLima,
  diasDelMes,
  fechaVencimientoPeriodo,
  siguientePeriodo,
  cicloCubrePeriodo,
  generarCuotasMensuales,
};
