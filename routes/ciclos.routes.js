const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { idPositivo } = require('../utils/validaciones');

const UNIVERSIDADES_VALIDAS = new Set([
  'UNMSM',
  'UNI',
  'PUCP',
  'UNFV',
  'UNAC',
  'UNT',
  'UNALM',
  'UPCH',
  'ULIMA',
  'UPC',
  'USMP',
  'UTP',
  'Preuniversitario',
]);

const MIN_CAPACIDAD = 1;
const MAX_CAPACIDAD = 500;
const MAX_PRECIO = 9999.99;

function idAcademiaRegistroPublico() {
  const raw = process.env.PUBLIC_REGISTRATION_ACADEMY_ID;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  return idPositivo(String(raw).trim());
}

function normalizarTexto(valor = '') {
  return String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function universidadDesdeNombre(nombre = '') {
  const n = normalizarTexto(nombre).toLowerCase();
  if (n.includes('san marcos') || n.includes('unmsm')) return 'UNMSM';
  if (/\buni\b/.test(n) || n.includes('ingenier')) return 'UNI';
  if (n.includes('catolica') || n.includes('pucp')) return 'PUCP';
  if (n.includes('villarreal') || n.includes('unfv')) return 'UNFV';
  if (n.includes('callao') || n.includes('unac')) return 'UNAC';
  if (n.includes('trujillo') || n.includes('unt')) return 'UNT';
  if (n.includes('agraria') || n.includes('unalm') || n.includes('la molina')) return 'UNALM';
  if (n.includes('cayetano') || n.includes('upch')) return 'UPCH';
  if (n.includes('de lima') || n.includes('ulima')) return 'ULIMA';
  if (/\bupc\b/.test(n) || n.includes('ciencias aplicadas')) return 'UPC';
  if (n.includes('san martin de porres') || n.includes('usmp')) return 'USMP';
  if (/\butp\b/.test(n) || n.includes('tecnologica de peru')) return 'UTP';
  return 'Preuniversitario';
}

function turnoDesdeHorario(horario = '') {
  const h = String(horario).trim();
  const match = h.match(/^(\d{2}):(\d{2})/);
  if (!match) return 'Mañana';

  const hour = Number(match[1]);
  if (hour >= 6 && hour < 13) return 'Mañana';
  if (hour >= 13 && hour < 18) return 'Tarde';
  if (hour >= 18 && hour <= 23) return 'Noche';
  return 'Mañana';
}

function horarioDesdeTurno(turno = '') {
  const t = normalizarTexto(turno).toLowerCase();
  if (t.includes('manana')) return '08:00 - 13:00';
  if (t.includes('tarde')) return '14:00 - 19:00';
  if (t.includes('noche')) return '18:00 - 22:00';
  return '08:00 - 13:00';
}

function validarFechaISO(valor, campo) {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return `${campo} debe tener formato YYYY-MM-DD.`;
  }
  const fecha = new Date(`${texto}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== texto) return `${campo} no es una fecha válida.`;
  return null;
}

function validarNombreCiclo(nombre = '') {
  const limpio = String(nombre).trim().replace(/\s+/g, ' ');
  if (limpio.length < 10) {
    return 'El nombre del ciclo debe tener al menos 10 caracteres.';
  }
  if (limpio.length > 100) {
    return 'El nombre del ciclo no puede superar los 100 caracteres.';
  }
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(limpio)) {
    return 'El nombre debe contener texto descriptivo.';
  }
  if (/^(.)\1{3,}$/i.test(normalizarTexto(limpio))) {
    return 'El nombre ingresado no es descriptivo.';
  }
  if (/^\d+$/.test(limpio) || /^[A-Za-z]$/i.test(limpio)) {
    return 'El nombre ingresado no es válido para un ciclo académico.';
  }

  // Se conserva la regla pedida por el profesor: nombres preuniversitarios reconocibles.
  const regexPre = /(semestral|anual|repaso|verano|veranito|intensivo|ciclo|pre|san\s+marcos|unmsm|\buni\b|pucp|catolica|villarreal|unfv|callao|unac|trujillo|unt|ingenier|unalm|agraria|molina|upch|cayetano|ulima|\bupc\b|usmp|porres|\butp\b|tecnologica)/i;
  if (!regexPre.test(limpio)) {
    return 'El nombre debe identificar un ciclo preuniversitario (ej. Repaso UNI, Semestral San Marcos o Veranito PUCP).';
  }

  // Evita cadenas de prueba típicas.
  if (/^(test|asdf|qwerty|curso|prueba|abc)(\s*\d*)?$/i.test(normalizarTexto(limpio))) {
    return 'El nombre ingresado corresponde a un valor de prueba y no a una oferta académica válida.';
  }

  return null;
}

function generarPrefijo(nombre, universidad) {
  const base = {
    UNMSM: 'SEMSM',
    UNI: 'UNI',
    PUCP: 'PUCP',
    UNFV: 'UNFV',
    UNAC: 'UNAC',
    UNT: 'UNT',
    UNALM: 'UNALM',
    UPCH: 'UPCH',
    ULIMA: 'ULIMA',
    UPC: 'UPC',
    USMP: 'USMP',
    UTP: 'UTP',
    Preuniversitario: 'PREU',
  }[universidad] || universidadDesdeNombre(nombre);

  return String(base).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'ACAD';
}

function normalizarSalida(ciclo) {
  const horario = ciclo.Horario || horarioDesdeTurno(ciclo.Turno);
  // Capacidad real configurada por el administrador (hasta MAX_CAPACIDAD).
  // Una capacidad 0/null se interpreta como "sin límite definido".
  const capacidad = Number(ciclo.Capacidad || 0);
  const totalAlumnos = Number(ciclo.TotalAlumnos || 0);

  return {
    idCiclo: ciclo.IdCiclo,
    idAcademia: ciclo.IdAcademia == null ? null : Number(ciclo.IdAcademia),
    nombre: ciclo.Nombre,
    prefijo: ciclo.PrefijoCodigo,
    turno: ciclo.Turno || turnoDesdeHorario(horario),
    horario,
    diasClase: ciclo.DiasClase || 'Lunes a Sábado',
    universidadObjetivo: ciclo.UniversidadObjetivo || universidadDesdeNombre(ciclo.Nombre),
    fechaInicio: ciclo.FechaInicio,
    fechaFin: ciclo.FechaFin,
    precio: ciclo.Precio === null || ciclo.Precio === undefined || String(ciclo.Precio).trim() === '' ? null : Number(ciclo.Precio),
    capacidad,
    totalAlumnos,
    vacantesDisponibles: capacidad > 0 ? Math.max(capacidad - totalAlumnos, 0) : null,
    totalCursos: Number(ciclo.TotalCursos || 0),
    disponible: capacidad === 0 || totalAlumnos < capacidad,
    estadoRegistro: Number(ciclo.EstadoRegistro),
  };
}

/* ============================================================
   GET /api/ciclos/publicos
   Vitrina pública: SOLO ciclos visibles/activos.
   ============================================================ */
router.get('/publicos', async (req, res) => {
  const idAcademia = idAcademiaRegistroPublico();
  if (!idAcademia) {
    return res.status(503).json({
      code: 'CONFIGURACION_ACADEMIA_PUBLICA_INVALIDA',
      error: 'La oferta académica pública no está configurada correctamente.',
    });
  }

  try {
    const [ciclos] = await pool.query(`
      SELECT
        c.IdCiclo,
        c.IdAcademia,
        c.Nombre,
        c.PrefijoCodigo,
        c.Turno,
        c.Horario,
        c.DiasClase,
        c.UniversidadObjetivo,
        c.FechaInicio,
        c.FechaFin,
        c.Precio,
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
          FROM CicloCurso cc
          INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
          WHERE cc.IdCiclo = c.IdCiclo
            AND cc.EstadoRegistro = 1
            AND cu.EstadoRegistro = 1
        ) AS TotalCursos
      FROM Ciclo c
      WHERE c.IdAcademia = ?
        AND c.EstadoRegistro = 1
      ORDER BY
        CASE WHEN c.FechaInicio IS NULL THEN 1 ELSE 0 END,
        c.FechaInicio ASC,
        c.IdCiclo ASC
    `, [idAcademia]);

    const salida = ciclos.map(normalizarSalida);
    res.status(200).json(salida);
  } catch (error) {
    console.error('Error en GET /api/ciclos/publicos:', error);
    res.status(500).json({ error: 'No se pudo cargar la oferta académica pública.' });
  }
});

/* ============================================================
   GET /api/ciclos/publicos/:id/detalle
   Detalle público: ciclo + cursos + horarios + docentes.
   ============================================================ */
router.get('/publicos/:id/detalle', async (req, res) => {
  const idCiclo = idPositivo(req.params.id);
  if (!idCiclo) {
    return res.status(400).json({ error: 'El IdCiclo no es válido.' });
  }

  const idAcademia = idAcademiaRegistroPublico();
  if (!idAcademia) {
    return res.status(503).json({
      code: 'CONFIGURACION_ACADEMIA_PUBLICA_INVALIDA',
      error: 'La oferta académica pública no está configurada correctamente.',
    });
  }

  try {
    const [ciclos] = await pool.query(`
      SELECT
        c.IdCiclo,
        c.IdAcademia,
        c.Nombre,
        c.PrefijoCodigo,
        c.Turno,
        c.Horario,
        c.DiasClase,
        c.UniversidadObjetivo,
        c.FechaInicio,
        c.FechaFin,
        c.Precio,
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
          FROM CicloCurso cc
          INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
          WHERE cc.IdCiclo = c.IdCiclo
            AND cc.EstadoRegistro = 1
            AND cu.EstadoRegistro = 1
        ) AS TotalCursos
      FROM Ciclo c
      WHERE c.IdCiclo = ?
        AND c.IdAcademia = ?
        AND c.EstadoRegistro = 1
      LIMIT 1
    `, [idCiclo, idAcademia]);

    if (ciclos.length === 0) {
      return res.status(404).json({ error: 'El ciclo no existe o ya no está publicado.' });
    }

    const ciclo = normalizarSalida(ciclos[0]);

    const [cursos] = await pool.query(`
      SELECT
        cc.IdCiclo,
        cc.IdCurso,
        cc.Orden,
        cu.Nombre,
        cu.Codigo,
        cu.Descripcion
      FROM CicloCurso cc
      INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
      WHERE cc.IdCiclo = ?
        AND cc.EstadoRegistro = 1
        AND cu.EstadoRegistro = 1
      ORDER BY cc.Orden ASC, cu.Nombre ASC
    `, [idCiclo]);

    const [horarios] = await pool.query(`
      SELECT
        h.IdHorario,
        h.IdCiclo,
        h.IdCurso,
        h.DiaNumero,
        h.DiaSemana,
        TIME_FORMAT(h.HoraInicio, '%H:%i') AS HoraInicio,
        TIME_FORMAT(h.HoraFin, '%H:%i') AS HoraFin,
        COALESCE(doc.Docentes, 'Por asignar') AS Docente,
        h.Orden,
        cu.Nombre AS Curso
      FROM HorarioCurso h
      INNER JOIN Curso cu ON cu.IdCurso = h.IdCurso
      LEFT JOIN (
        SELECT
          aa.IdCiclo,
          aa.IdCurso,
          GROUP_CONCAT(
            DISTINCT TRIM(CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno))
            ORDER BY TRIM(CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno)) ASC
            SEPARATOR ', '
          ) AS Docentes
        FROM Asignacion_Aula aa
        INNER JOIN Usuario u
          ON u.IdUsuario = aa.IdUsuario
         AND u.EstadoRegistro = 1
        WHERE aa.EstadoRegistro = 1
        GROUP BY aa.IdCiclo, aa.IdCurso
      ) doc
        ON doc.IdCiclo = h.IdCiclo
       AND doc.IdCurso = h.IdCurso
      WHERE h.IdCiclo = ?
        AND h.EstadoRegistro = 1
        AND cu.EstadoRegistro = 1
      ORDER BY
        h.DiaNumero ASC,
        h.HoraInicio ASC,
        h.Orden ASC,
        cu.Nombre ASC
    `, [idCiclo]);

    res.json({
      ciclo,
      cursos: cursos.map((curso) => ({
        idCurso: curso.IdCurso,
        nombre: curso.Nombre,
        codigo: curso.Codigo || '',
        descripcion: curso.Descripcion || '',
        orden: Number(curso.Orden || 0),
      })),
      horarios: horarios.map((h) => ({
        idHorario: h.IdHorario,
        idCurso: h.IdCurso,
        curso: h.Curso,
        diaNumero: Number(h.DiaNumero || 0),
        diaSemana: h.DiaSemana,
        horaInicio: h.HoraInicio,
        horaFin: h.HoraFin,
        docente: h.Docente || 'Por asignar',
        orden: Number(h.Orden || 0),
      })),
    });
  } catch (error) {
    console.error('Error en GET /api/ciclos/publicos/:id/detalle:', error);
    res.status(500).json({ error: 'No se pudo cargar el detalle del ciclo.' });
  }
});

/* ============================================================
   GET /api/ciclos/:id/cursos
   Mantiene compatibilidad con el frontend existente.
   ============================================================ */
router.get('/:id/cursos', async (req, res) => {
  const idCiclo = idPositivo(req.params.id);
  if (!idCiclo) {
    return res.status(400).json({ error: 'El IdCiclo no es válido.' });
  }

  const idAcademia = idAcademiaRegistroPublico();
  if (!idAcademia) {
    return res.status(503).json({
      code: 'CONFIGURACION_ACADEMIA_PUBLICA_INVALIDA',
      error: 'La oferta académica pública no está configurada correctamente.',
    });
  }

  try {
    const [rows] = await pool.query(`
      SELECT
        cc.IdCiclo,
        cc.IdCurso,
        cc.Orden,
        cu.Nombre,
        cu.Codigo,
        cu.Descripcion,
        doc.Docentes
      FROM Ciclo ci
      INNER JOIN CicloCurso cc ON cc.IdCiclo = ci.IdCiclo
      INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
      LEFT JOIN (
        SELECT
          aa.IdCiclo,
          aa.IdCurso,
          GROUP_CONCAT(
            DISTINCT TRIM(CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno))
            ORDER BY TRIM(CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno)) ASC
            SEPARATOR ', '
          ) AS Docentes
        FROM Asignacion_Aula aa
        INNER JOIN Usuario u
          ON u.IdUsuario = aa.IdUsuario
         AND u.EstadoRegistro = 1
        WHERE aa.EstadoRegistro = 1
        GROUP BY aa.IdCiclo, aa.IdCurso
      ) doc
        ON doc.IdCiclo = cc.IdCiclo
       AND doc.IdCurso = cc.IdCurso
      WHERE cc.IdCiclo = ?
        AND ci.IdAcademia = ?
        AND ci.EstadoRegistro = 1
        AND cc.EstadoRegistro = 1
        AND cu.EstadoRegistro = 1
      ORDER BY cc.Orden ASC, cu.Nombre ASC
    `, [idCiclo, idAcademia]);

    res.json(rows);
  } catch (error) {
    console.error('Error al cargar cursos del ciclo:', error);
    res.status(500).json({ error: 'No se pudieron cargar los cursos del ciclo.' });
  }
});

module.exports = {
  router,
  validarNombreCiclo,
  validarFechaISO,
  normalizarTexto,
  universidadDesdeNombre,
  horarioDesdeTurno,
  turnoDesdeHorario,
  generarPrefijo,
  UNIVERSIDADES_VALIDAS,
  MIN_CAPACIDAD,
  MAX_CAPACIDAD,
  MAX_PRECIO,
};


