const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');

const ESCALAS = {
  UNMSM: 2000,
  UNI: 2000,
  PUCP: 1000,
  UNFV: 1000,
  UNAC: 100,
  UNT: 300,
  Preuniversitario: 20,
};

function maximoPorUniversidad(universidad = '') {
  return ESCALAS[String(universidad).trim()] || ESCALAS.Preuniversitario;
}

function normalizarPromedio(calificacion, universidad) {
  const max = maximoPorUniversidad(universidad);
  const valor = Number(calificacion || 0);
  if (!Number.isFinite(valor) || max <= 0) return 0;
  return (valor / max) * 20;
}

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
        AND LOWER(TRIM(p.Nombre)) = 'alumno'
    `, [idAcademia]);

    const [matriculas] = await pool.query(`
      SELECT COUNT(*) AS MatriculasActivas
      FROM Matricula m
      INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
      INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
      WHERE u.IdAcademia = ?
        AND u.EstadoRegistro = 1
        AND m.EstadoRegistro = 1
        AND c.EstadoRegistro = 1
    `, [idAcademia]);

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
        ) AS TotalAlumnos,
        (
          SELECT COUNT(*)
          FROM Evaluacion e
          INNER JOIN Matricula m2 ON m2.IdMatricula = e.IdMatricula
          INNER JOIN Usuario u2 ON u2.IdUsuario = m2.IdUsuario
          WHERE m2.IdCiclo = c.IdCiclo
            AND m2.EstadoRegistro = 1
            AND e.EstadoRegistro = 1
            AND u2.IdAcademia = ?
        ) AS TotalEvaluaciones
      FROM Ciclo c
      WHERE c.IdAcademia = ?
      ORDER BY c.FechaInicio ASC, c.IdCiclo ASC
    `, [idAcademia, idAcademia]);

    const [morosidad] = await pool.query(`
      SELECT COUNT(DISTINCT p.IdUsuario) AS TotalMorosos
      FROM PagosMensualidad p
      INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
      WHERE u.IdAcademia = ?
        AND u.EstadoRegistro = 1
        AND p.EstadoRegistro = 1
        AND LOWER(TRIM(COALESCE(p.Estado, ''))) IN ('moroso', 'vencido', 'pendiente')
    `, [idAcademia]);

    const [pagosResumen] = await pool.query(`
      SELECT
        COUNT(*) AS TotalPagos,
        SUM(CASE WHEN LOWER(TRIM(COALESCE(p.Estado, ''))) = 'pagado' THEN 1 ELSE 0 END) AS Pagados,
        SUM(CASE WHEN LOWER(TRIM(COALESCE(p.Estado, ''))) IN ('moroso', 'vencido', 'pendiente') THEN 1 ELSE 0 END) AS Pendientes
      FROM PagosMensualidad p
      INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
      WHERE u.IdAcademia = ?
        AND p.EstadoRegistro = 1
    `, [idAcademia]);

    const [rendimientoRows] = await pool.query(`
      SELECT
        c.IdCiclo,
        c.Nombre,
        c.UniversidadObjetivo,
        AVG(e.Calificacion) AS PromedioBruto,
        COUNT(e.IdEvaluacion) AS Evaluaciones
      FROM Evaluacion e
      INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
      INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
      INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
      WHERE u.IdAcademia = ?
        AND u.EstadoRegistro = 1
        AND m.EstadoRegistro = 1
        AND c.IdAcademia = ?
        AND c.EstadoRegistro = 1
        AND e.EstadoRegistro = 1
      GROUP BY c.IdCiclo, c.Nombre, c.UniversidadObjetivo
      ORDER BY c.Nombre ASC
    `, [idAcademia, idAcademia]);

    const rendimientoPorCiclo = rendimientoRows.map((row) => ({
      idCiclo: row.IdCiclo,
      nombre: row.Nombre,
      universidadObjetivo: row.UniversidadObjetivo || 'Preuniversitario',
      promedio: Number(normalizarPromedio(row.PromedioBruto, row.UniversidadObjetivo).toFixed(2)),
      evaluaciones: Number(row.Evaluaciones || 0),
    }));

    const promedioInstitucional = rendimientoPorCiclo.length > 0
      ? rendimientoPorCiclo.reduce((sum, row) => sum + row.promedio, 0) / rendimientoPorCiclo.length
      : 0;

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

      const vacantes = capacidad > 0 ? Math.max(capacidad - alumnos, 0) : null;
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
        promedioInstitucional: Number(promedioInstitucional.toFixed(2)),
        vacantesDisponibles,
      },
      pagos: {
        total: Number(pagosResumen[0]?.TotalPagos || 0),
        pagados: Number(pagosResumen[0]?.Pagados || 0),
        pendientes: Number(pagosResumen[0]?.Pendientes || 0),
      },
      rendimientoPorCiclo,
      ciclos: detalleCiclos,
      actualizadoEn: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error en GET /api/admin/dashboard/overview:', error);
    res.status(500).json({ error: 'No se pudieron calcular las métricas institucionales.' });
  }
});

module.exports = router;
