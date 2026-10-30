const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');
const { idPositivo } = require('../utils/validaciones');
const { consultarCobertura } = require('../utils/cobertura-docente');
const { disponibilidadCiclo } = require('../utils/capacidad-ciclo');

router.use(requiereRol('Administrador'));

/* ============================================================
   GET /api/admin/dashboard/overview
   Una sola fuente: la BD.
   ============================================================ */
router.get('/dashboard/overview', async (req, res) => {
  const idAcademia = Number(req.usuario?.idAcademia);
  if (!Number.isInteger(idAcademia) || idAcademia <= 0) {
    return res.status(401).json({ error: 'El administrador no tiene una academia válida.' });
  }

  const idCiclo = req.query.idCiclo === undefined ? null : idPositivo(req.query.idCiclo);
  if (req.query.idCiclo !== undefined && !idCiclo) return res.status(400).json({ error: 'El ciclo no es válido.' });
  const periodo = typeof req.query.periodo === 'string' ? req.query.periodo.trim().replace(/\s+/g, ' ') : null;
  if (req.query.periodo !== undefined && (!idCiclo || !periodo || periodo.length > 50)) {
    return res.status(400).json({ error: 'Selecciona un ciclo y un periodo de hasta 50 caracteres.' });
  }
  const filtroCiclo = idCiclo === null ? '' : ' AND c.IdCiclo = ?';
  const paramsCiclo = idCiclo === null ? [] : [idCiclo];
  try {
    const [usuarios] = await pool.query(`
      SELECT COUNT(DISTINCT u.IdUsuario) AS TotalEstudiantes
      FROM Usuario u
      INNER JOIN Usuario_Perfiles up
        ON up.IdUsuario = u.IdUsuario
       AND up.EstadoRegistro = 1
      INNER JOIN perfil p
        ON p.IdPerfil = up.IdPerfil
       AND p.EstadoRegistro = 1
      WHERE u.IdAcademia = ?
        AND u.EstadoRegistro = 1
        AND LOWER(TRIM(p.Nombre)) IN ('alumno', 'estudiante')
        ${idCiclo === null ? '' : 'AND EXISTS (SELECT 1 FROM Matricula m INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo AND c.IdAcademia = u.IdAcademia WHERE m.IdUsuario = u.IdUsuario AND m.EstadoRegistro = 1 AND c.IdCiclo = ?)'}
    `, [idAcademia, ...paramsCiclo]);

    const [matriculas] = await pool.query(`
      SELECT COUNT(*) AS MatriculasActivas
      FROM Matricula m
      INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
      INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo AND c.IdAcademia = u.IdAcademia
      WHERE u.IdAcademia = ?
        AND u.EstadoRegistro = 1
        AND m.EstadoRegistro = 1
        AND c.EstadoRegistro = 1${filtroCiclo}
    `, [idAcademia, ...paramsCiclo]);

    const [ciclos] = await pool.query(`
      SELECT
        c.IdCiclo,
        c.Nombre,
        c.UniversidadObjetivo,
        c.FechaInicio,
        c.FechaFin,
        c.Capacidad,
        c.EstadoRegistro,
        (
          SELECT COUNT(*)
          FROM Matricula m
          INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
          WHERE m.IdCiclo = c.IdCiclo
            AND m.EstadoRegistro = 1
            AND u.EstadoRegistro = 1
            AND u.IdAcademia = c.IdAcademia
        ) AS TotalAlumnos,
        (
          SELECT COUNT(*)
          FROM Evaluacion e
          INNER JOIN Matricula m2 ON m2.IdMatricula = e.IdMatricula
          INNER JOIN Usuario u2 ON u2.IdUsuario = m2.IdUsuario
          WHERE m2.IdCiclo = c.IdCiclo
            AND m2.EstadoRegistro = 1
            AND e.EstadoRegistro IN (1, 2)
            AND u2.IdAcademia = ?
        ) AS TotalEvaluaciones
      FROM Ciclo c
      WHERE c.IdAcademia = ?${filtroCiclo}
      ORDER BY c.FechaInicio ASC, c.IdCiclo ASC
    `, [idAcademia, idAcademia, ...paramsCiclo]);

    if (idCiclo !== null && ciclos.length === 0) return res.status(404).json({ error: 'Ciclo no encontrado.' });

    const [morosidad] = await pool.query(`
      SELECT COUNT(DISTINCT p.IdUsuario) AS TotalMorosos
      FROM PagosMensualidad p
      INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
      INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
      WHERE u.IdAcademia = ?
        AND u.EstadoRegistro = 1
        AND p.EstadoRegistro = 1
        AND LOWER(TRIM(COALESCE(p.Estado, ''))) IN ('moroso', 'vencido', 'pendiente')${filtroCiclo}
    `, [idAcademia, ...paramsCiclo]);

    const [pagosResumen] = await pool.query(`
      SELECT
        COUNT(*) AS TotalPagos,
        SUM(CASE WHEN LOWER(TRIM(COALESCE(p.Estado, ''))) = 'pagado' THEN 1 ELSE 0 END) AS Pagados,
        SUM(CASE WHEN LOWER(TRIM(COALESCE(p.Estado, ''))) IN ('moroso', 'vencido', 'pendiente') THEN 1 ELSE 0 END) AS Pendientes
      FROM PagosMensualidad p
      INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
      INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
      WHERE u.IdAcademia = ?
        AND u.EstadoRegistro = 1
        AND p.EstadoRegistro = 1${filtroCiclo}
    `, [idAcademia, ...paramsCiclo]);

    // HU-12/13/16: Periodo (incluido General) no acredita una semana real.
    // No reconstruirla con FechaCreacion ni asignar una escala desconocida por defecto.
    const rendimientoPorCiclo = [];
    const coberturaDocente = await consultarCobertura(pool, idAcademia, idCiclo);

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let ciclosActivos = 0;
    let ciclosCerrados = 0;
    let ciclosProximos = 0;
    let vacantesDisponibles = 0;

    const detalleCiclos = ciclos.map((c) => {
      const inicio = c.FechaInicio ? new Date(`${c.FechaInicio}T00:00:00`) : null;
      const fin = c.FechaFin ? new Date(`${c.FechaFin}T23:59:59`) : null;
      const capacidad = Number(c.Capacidad || 0);
      const alumnos = Number(c.TotalAlumnos || 0);

      const visible = Number(c.EstadoRegistro) === 1;
      if (visible) ciclosActivos += 1;
      else ciclosCerrados += 1;

      if (visible && inicio && inicio > hoy) ciclosProximos += 1;

      const disponibilidad = disponibilidadCiclo(c.Capacidad, alumnos);
      const vacantes = disponibilidad.vacantesDisponibles;
      if (vacantes !== null && visible) vacantesDisponibles += vacantes;

      let estado = 'CERRADO';
      if (visible && inicio && fin && hoy >= inicio && hoy <= fin) estado = 'EN_CURSO';
      else if (visible && inicio && hoy < inicio) estado = 'PROXIMO';
      else if (visible && (!fin || hoy <= fin)) estado = 'ABIERTO';
      else if (visible && fin && hoy > fin) estado = 'FINALIZADO';

      return {
        idCiclo: c.IdCiclo,
        nombre: c.Nombre,
        universidadObjetivo: c.UniversidadObjetivo || 'Preuniversitario',
        fechaInicio: c.FechaInicio,
        fechaFin: c.FechaFin,
        capacidad,
        totalAlumnos: alumnos,
        vacantesDisponibles: vacantes,
        requiereRevisionCapacidad: disponibilidad.requiereRevisionCapacidad,
        totalEvaluaciones: Number(c.TotalEvaluaciones || 0),
        estado,
      };
    });

    res.json({
      resumen: {
        estudiantes: Number(usuarios[0]?.TotalEstudiantes || 0),
        matriculasActivas: Number(matriculas[0]?.MatriculasActivas || 0),
        ciclosActivos,
        ciclosProximos,
        ciclosCerrados,
        estudiantesMorosos: Number(morosidad[0]?.TotalMorosos || 0),
        // Clave conservada por transición; Luis debe retirar la tarjeta, no mostrar cero.
        promedioInstitucional: null,
        vacantesDisponibles,
      },
      pagos: {
        total: Number(pagosResumen[0]?.TotalPagos || 0),
        pagados: Number(pagosResumen[0]?.Pagados || 0),
        pendientes: Number(pagosResumen[0]?.Pendientes || 0),
      },
      rendimientoPorCiclo,
      coberturaDocente,
      rendimientoEstado: {
        comparable: false,
        codigo: 'IDENTIFICACION_SEMANAL_PENDIENTE',
        mensaje: 'Falta verificar la identificación semanal y la escala de los simulacros; no se calcula un promedio.',
      },
      filtros: { idAcademia, idCiclo, periodo },
      definiciones: {
        cobertura: 'Cursos activos de ciclos activos; al filtrar un ciclo también permite revisar uno cerrado. Cuenta docente/perfil/aula activos y horario válido.',
        pagos: 'Cuotas activas de usuarios activos y ciclos de la academia; incluye cuotas de ciclos cerrados.',
        rendimiento: 'Sin agregado académico hasta verificar simulacro semanal y escala; periodo recibido no acredita una semana.',
      },
      ciclos: detalleCiclos,
      actualizadoEn: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error en GET /api/admin/dashboard/overview:', error);
    res.status(500).json({ error: 'No se pudieron calcular las métricas institucionales.' });
  }
});

module.exports = router;


