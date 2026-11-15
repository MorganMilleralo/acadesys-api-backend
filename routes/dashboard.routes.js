const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');
const { idPositivo } = require('../utils/validaciones');
const { consultarCobertura } = require('../utils/cobertura-docente');
const { disponibilidadCiclo } = require('../utils/capacidad-ciclo');
const { consultar } = require('../config/procedimientos');

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
  try {
    const [usuarios] = await consultar(pool, 'sp_dashboard_contar_estudiantes', [idAcademia, idCiclo]);
    const [matriculas] = await consultar(pool, 'sp_dashboard_contar_matriculas', [idAcademia, idCiclo]);
    const [ciclos] = await consultar(pool, 'sp_dashboard_listar_ciclos', [idAcademia, idCiclo]);

    if (idCiclo !== null && ciclos.length === 0) return res.status(404).json({ error: 'Ciclo no encontrado.' });

    const [morosidad] = await consultar(pool, 'sp_dashboard_contar_morosos', [idAcademia, idCiclo]);
    const [pagosResumen] = await consultar(pool, 'sp_dashboard_resumen_pagos', [idAcademia, idCiclo]);

    // Periodo (incluido 'General') no identifica una semana real.
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
        // Se mantiene la clave por compatibilidad con el frontend; no hay promedio institucional.
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


