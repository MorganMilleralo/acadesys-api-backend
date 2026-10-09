const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');

const universidadDesdeNombre = (nombre = '') => {
  const n = String(nombre).toLowerCase();
  if (n.includes('san marcos') || n.includes('unmsm')) return 'UNMSM';
  if (/\buni\b/.test(n) || n.includes('ingenier')) return 'UNI';
  if (n.includes('católica') || n.includes('catolica') || n.includes('pucp')) return 'PUCP';
  if (n.includes('villarreal') || n.includes('unfv')) return 'UNFV';
  if (n.includes('unt') || n.includes('trujillo')) return 'UNT';
  if (n.includes('callao') || n.includes('unac')) return 'UNAC';
  return 'Preuniversitario';
};

router.use(requiereRol('Alumno', 'Estudiante'));

router.get('/me', async (req, res) => {
  try {
    const idUsuario = req.usuario?.idUsuario || req.usuario?.id;
    const idAcademia = req.usuario?.idAcademia;

    if (!idUsuario || !idAcademia) {
      return res.status(401).json({ error: 'No fue posible identificar al alumno autenticado.' });
    }

    const [usuarios] = await pool.query(`
      SELECT
        u.IdUsuario,
        u.DNI,
        u.Nombres,
        u.ApellidoPaterno,
        u.ApellidoMaterno,
        CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno) AS NombreCompleto,
        u.CorreoElectronico,
        u.CodigoUsuario
      FROM Usuario u
      WHERE u.IdUsuario = ? AND u.IdAcademia = ? AND u.EstadoRegistro = 1
      LIMIT 1
    `, [idUsuario, idAcademia]);

    if (usuarios.length === 0) {
      return res.status(404).json({ error: 'Alumno no encontrado.' });
    }

    const usuario = usuarios[0];

    const [matriculas] = await pool.query(`
      SELECT
        m.IdMatricula,
        c.IdCiclo,
        c.Nombre AS Ciclo,
        c.Turno,
        COALESCE(NULLIF(TRIM(c.Horario), ''), CASE
          WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%mañana%' OR LOWER(COALESCE(c.Turno, '')) LIKE '%manana%' THEN '08:00 - 13:00'
          WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%tarde%' THEN '14:00 - 19:00'
          WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%noche%' THEN '18:00 - 22:00'
          ELSE '08:00 - 13:00'
        END) AS Horario,
        COALESCE(NULLIF(TRIM(c.DiasClase), ''), 'Lunes a Sábado') AS DiasClase,
        COALESCE(NULLIF(TRIM(c.UniversidadObjetivo), ''), 'Preuniversitario') AS UniversidadObjetivo,
        c.FechaInicio,
        c.FechaFin,
        (
          SELECT COUNT(*)
          FROM Matricula m2
          WHERE m2.IdCiclo = c.IdCiclo AND m2.EstadoRegistro = 1
        ) AS TotalAlumnos
      FROM Matricula m
      INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
      WHERE m.IdUsuario = ?
        AND m.EstadoRegistro = 1
        AND c.EstadoRegistro = 1
      ORDER BY m.IdMatricula DESC
      LIMIT 1
    `, [idUsuario]);

    let ciclo = null;
    let matriculaId = null;

    if (matriculas.length > 0) {
      const m = matriculas[0];
      matriculaId = m.IdMatricula;
      ciclo = {
        idCiclo: m.IdCiclo,
        nombre: m.Ciclo,
        turno: m.Turno || '',
        horario: m.Horario || '',
        diasClase: m.DiasClase || '',
        universidadObjetivo: (!m.UniversidadObjetivo || m.UniversidadObjetivo === 'Preuniversitario') ? universidadDesdeNombre(m.Ciclo) : m.UniversidadObjetivo,
        fechaInicio: m.FechaInicio,
        fechaFin: m.FechaFin,
        totalAlumnos: Number(m.TotalAlumnos || 0)
      };
    }

    if (!ciclo) {
      return res.json({
        usuario: {
          idUsuario: usuario.IdUsuario,
          dni: usuario.DNI,
          nombres: usuario.Nombres,
          apellidoPaterno: usuario.ApellidoPaterno,
          apellidoMaterno: usuario.ApellidoMaterno,
          nombreCompleto: usuario.NombreCompleto,
          correo: usuario.CorreoElectronico,
          codigoUsuario: usuario.CodigoUsuario
        },
        ciclo: null,
        cursos: [],
        horarioDetalle: [],
        notas: {
          promedioGeneral: 0,
          puestoRanking: null,
          totalEvaluaciones: 0,
          historial: []
        },
        materiales: []
      });
    }

    const [cursos] = await pool.query(`
      SELECT
        cu.IdCurso,
        cu.Nombre
      FROM CicloCurso cc
      INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
      WHERE cc.IdCiclo = ?
        AND cc.EstadoRegistro = 1
        AND cu.EstadoRegistro = 1
      ORDER BY cc.Orden ASC, cu.Nombre ASC
    `, [ciclo.idCiclo]);

    const [horarioDetalle] = await pool.query(`
      SELECT
        h.IdHorario,
        h.DiaSemana,
        TIME_FORMAT(h.HoraInicio, '%H:%i') AS HoraInicio,
        TIME_FORMAT(h.HoraFin, '%H:%i') AS HoraFin,
        cu.Nombre AS Curso,
        'Por asignar' AS Docente
      FROM HorarioCurso h
      INNER JOIN Curso cu ON cu.IdCurso = h.IdCurso
      WHERE h.IdCiclo = ?
        AND h.EstadoRegistro = 1
      ORDER BY h.Orden ASC, h.DiaNumero ASC, h.HoraInicio ASC
    `, [ciclo.idCiclo]);

    const [notas] = await pool.query(`
      SELECT
        e.IdEvaluacion,
        COALESCE(cu.Nombre, 'Simulacro general') AS Curso,
        e.TipoEvaluacion,
        e.Calificacion,
        e.FechaCreacion
      FROM Evaluacion e
      INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
      LEFT JOIN Curso cu ON cu.IdCurso = m.IdCurso
      WHERE m.IdUsuario = ?
        AND m.IdCiclo = ?
        AND e.EstadoRegistro = 1
      ORDER BY e.FechaCreacion DESC, e.IdEvaluacion DESC
    `, [idUsuario, ciclo.idCiclo]);

    const promedio = notas.length
      ? Number((notas.reduce((sum, n) => sum + Number(n.Calificacion || 0), 0) / notas.length).toFixed(2))
      : 0;

    let puestoRanking = null;
    if (promedio > 0) {
      const [rankingRows] = await pool.query(`
        SELECT COUNT(*) + 1 AS Puesto
        FROM (
          SELECT
            m2.IdUsuario,
            AVG(e2.Calificacion) AS Promedio
          FROM Matricula m2
          INNER JOIN Evaluacion e2 ON e2.IdMatricula = m2.IdMatricula
          WHERE m2.IdCiclo = ?
            AND m2.EstadoRegistro = 1
            AND e2.EstadoRegistro = 1
          GROUP BY m2.IdUsuario
          HAVING AVG(e2.Calificacion) > ?
        ) r
      `, [ciclo.idCiclo, promedio]);

      puestoRanking = Number(rankingRows[0]?.Puesto || 1);
    }

    const [materiales] = await pool.query(`
      SELECT
        ma.IdMaterial,
        ma.Titulo,
        ma.Descripcion,
        ma.NombreArchivo,
        ma.UrlArchivo,
        ma.TipoMime,
        ma.FechaPublicacion,
        cu.Nombre AS Curso
      FROM MaterialAcademico ma
      INNER JOIN CicloCurso cc ON cc.IdCiclo = ma.IdCiclo AND cc.IdCurso = ma.IdCurso AND cc.EstadoRegistro = 1
      INNER JOIN Curso cu ON cu.IdCurso = ma.IdCurso
      WHERE ma.IdCiclo = ?
        AND ma.EstadoRegistro = 1
      ORDER BY ma.FechaPublicacion DESC, ma.IdMaterial DESC
    `, [ciclo.idCiclo]);

    res.json({
      usuario: {
        idUsuario: usuario.IdUsuario,
        dni: usuario.DNI,
        nombres: usuario.Nombres,
        apellidoPaterno: usuario.ApellidoPaterno,
        apellidoMaterno: usuario.ApellidoMaterno,
        nombreCompleto: usuario.NombreCompleto,
        correo: usuario.CorreoElectronico,
        codigoUsuario: usuario.CodigoUsuario
      },
      matricula: { idMatricula: matriculaId },
      ciclo,
      cursos: cursos.map((c) => ({
        idCurso: c.IdCurso,
        nombre: c.Nombre,
        codigo: '',
        descripcion: '',
        universidadObjetivo: ciclo.universidadObjetivo
      })),
      horarioDetalle: horarioDetalle.map((h) => ({
        idHorario: h.IdHorario,
        diaSemana: h.DiaSemana,
        horaInicio: h.HoraInicio,
        horaFin: h.HoraFin,
        curso: h.Curso,
        docente: h.Docente
      })),
      notas: {
        promedioGeneral: promedio,
        puestoRanking,
        totalEvaluaciones: notas.length,
        historial: notas.map((n) => ({
          idEvaluacion: n.IdEvaluacion,
          curso: n.Curso,
          tipoEvaluacion: n.TipoEvaluacion,
          calificacion: Number(n.Calificacion || 0),
          fechaCreacion: n.FechaCreacion
        }))
      },
      materiales: materiales.map((m) => ({
        idMaterial: m.IdMaterial,
        titulo: m.Titulo,
        descripcion: m.Descripcion,
        nombreArchivo: m.NombreArchivo,
        urlArchivo: m.UrlArchivo,
        tipoMime: m.TipoMime,
        fechaPublicacion: m.FechaPublicacion,
        curso: m.Curso
      }))
    });
  } catch (error) {
    console.error('Error en GET /api/alumno/me:', error.message);
    res.status(500).json({ error: 'No se pudo cargar el expediente del alumno.' });
  }
});

module.exports = router;
