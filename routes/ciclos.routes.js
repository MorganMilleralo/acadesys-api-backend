const express = require('express');
const router = express.Router();
const pool = require('../config/db');

const universidadDesdeNombre = (nombre = '') => {
  const n = String(nombre).toLowerCase();
  if (n.includes('san marcos') || n.includes('unmsm')) return 'UNMSM';
  if (/\buni\b/.test(n) || n.includes('universidad nacional de ingenier')) return 'UNI';
  if (n.includes('católica') || n.includes('catolica') || n.includes('pucp')) return 'PUCP';
  if (n.includes('villarreal') || n.includes('unfv')) return 'UNFV';
  if (n.includes('unt') || n.includes('trujillo')) return 'UNT';
  if (n.includes('callao') || n.includes('unac')) return 'UNAC';
  return 'Preuniversitario';
};

const turnoDesdeHorario = (horario = '') => {
  const h = String(horario).toLowerCase();
  if (h.startsWith('08') || h.includes('07:') || h.includes('09:')) return 'Mañana';
  if (h.startsWith('14') || h.includes('15:') || h.includes('16:')) return 'Tarde';
  if (h.startsWith('18') || h.includes('19:') || h.includes('20:')) return 'Noche';
  return 'Mañana';
};

const horarioDesdeTurno = (turno = '') => {
  const t = String(turno).toLowerCase();
  if (t.includes('mañana') || t.includes('manana')) return '08:00 - 13:00';
  if (t.includes('tarde')) return '14:00 - 19:00';
  if (t.includes('noche')) return '18:00 - 22:00';
  return '08:00 - 13:00';
};

// GET /api/ciclos/publicos
router.get('/publicos', async (req, res) => {
  try {
    const [ciclos] = await pool.query(`
      SELECT
        c.IdCiclo,
        c.Nombre,
        c.PrefijoCodigo,
        c.Turno,
        COALESCE(NULLIF(TRIM(c.Horario), ''), CASE
          WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%mañana%' OR LOWER(COALESCE(c.Turno, '')) LIKE '%manana%' THEN '08:00 - 13:00'
          WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%tarde%' THEN '14:00 - 19:00'
          WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%noche%' THEN '18:00 - 22:00'
          ELSE '08:00 - 13:00'
        END) AS Horario,
        COALESCE(NULLIF(TRIM(c.DiasClase), ''), 'Lunes a Sábado') AS DiasClase,
        COALESCE(NULLIF(TRIM(c.UniversidadObjetivo), ''), '') AS UniversidadObjetivo,
        c.FechaInicio,
        c.FechaFin,
        COALESCE(c.Capacidad, 0) AS Capacidad,
        (
          SELECT COUNT(*)
          FROM Matricula m
          WHERE m.IdCiclo = c.IdCiclo
            AND m.EstadoRegistro = 1
        ) AS TotalAlumnos,
        (
          SELECT COUNT(*)
          FROM CicloCurso cc
          WHERE cc.IdCiclo = c.IdCiclo
            AND cc.EstadoRegistro = 1
        ) AS TotalCursos
      FROM Ciclo c
      WHERE c.EstadoRegistro = 1
      ORDER BY
        CASE WHEN c.FechaInicio IS NULL THEN 1 ELSE 0 END,
        c.FechaInicio ASC,
        c.IdCiclo ASC
    `);

    const salida = ciclos.map((ciclo) => {
      const horario = ciclo.Horario || horarioDesdeTurno(ciclo.Turno);
      return {
        ...ciclo,
        Turno: ciclo.Turno || turnoDesdeHorario(horario),
        UniversidadObjetivo: (!ciclo.UniversidadObjetivo || ciclo.UniversidadObjetivo === 'Preuniversitario') ? universidadDesdeNombre(ciclo.Nombre) : ciclo.UniversidadObjetivo,
        Horario: horario,
        DiasClase: ciclo.DiasClase || 'Lunes a Sábado'
      };
    });

    res.status(200).json(salida);
  } catch (error) {
    console.error('Error al cargar la vitrina de ciclos:', error);
    res.status(500).json({ error: 'Error interno del servidor al cargar los ciclos.' });
  }
});

// GET /api/ciclos/:id/cursos
router.get('/:id/cursos', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(`
      SELECT
        cc.IdCiclo,
        cu.IdCurso,
        cu.Nombre
      FROM CicloCurso cc
      INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
      WHERE cc.IdCiclo = ?
        AND cc.EstadoRegistro = 1
        AND cu.EstadoRegistro = 1
      ORDER BY cc.Orden ASC, cu.Nombre ASC
    `, [id]);

    res.json(rows);
  } catch (error) {
    console.error('Error al cargar cursos del ciclo:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar los cursos del ciclo.' });
  }
});

module.exports = router;
