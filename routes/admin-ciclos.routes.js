const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');

const {
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
} = require('./ciclos.routes');

router.use(requiereRol('Administrador'));

function validarTurno(turno) {
  return ['Mañana', 'Tarde', 'Noche'].includes(String(turno || '').trim());
}

function validarHorario(horario) {
  const valor = String(horario || '').trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d\s*-\s*(?:[01]\d|2[0-3]):[0-5]\d$/.test(valor);
}

function validarRangoHorario(horario) {
  const match = String(horario || '').match(/^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
  if (!match) return false;
  const inicio = Number(match[1]) * 60 + Number(match[2]);
  const fin = Number(match[3]) * 60 + Number(match[4]);
  return fin > inicio;
}

function prepararCiclo(body = {}, existente = null) {
  const nombre = String(body.nombre ?? existente?.Nombre ?? '').trim().replace(/\s+/g, ' ');
  const universidad = String(
    body.universidadObjetivo ?? existente?.UniversidadObjetivo ?? universidadDesdeNombre(nombre)
  ).trim();

  const turnoSolicitado = String(body.turno ?? existente?.Turno ?? '').trim();
  const horarioSolicitado = String(body.horario ?? existente?.Horario ?? '').trim();
  const turno = turnoSolicitado || turnoDesdeHorario(horarioSolicitado);
  const horario = horarioSolicitado || horarioDesdeTurno(turno);

  const capacidadRaw = body.capacidad ?? existente?.Capacidad ?? '';
  const precioRaw = body.precio ?? existente?.Precio ?? '';

  const capacidad = Number(capacidadRaw);
  const precio = Number(precioRaw);

  const fechaInicio = body.fechaInicio ?? existente?.FechaInicio ?? null;
  const fechaFin = body.fechaFin ?? existente?.FechaFin ?? null;
  const diasClase = String(body.diasClase ?? existente?.DiasClase ?? 'Lunes a Sábado').trim();
  const prefijo = String(
    body.prefijoCodigo ?? existente?.PrefijoCodigo ?? generarPrefijo(nombre, universidad)
  ).trim().toUpperCase();

  return {
    nombre,
    universidad,
    turno,
    horario,
    capacidad,
    precio,
    fechaInicio,
    fechaFin,
    diasClase,
    prefijo,
  };
}

function validarDatosCiclo(data, { esCreacion = true } = {}) {
  const errorNombre = validarNombreCiclo(data.nombre);
  if (errorNombre) return errorNombre;

  if (!UNIVERSIDADES_VALIDAS.has(data.universidad)) {
    return `UniversidadObjetivo inválida. Permitidas: ${Array.from(UNIVERSIDADES_VALIDAS).join(', ')}.`;
  }

  if (!validarTurno(data.turno)) {
    return 'El turno debe ser exactamente Mañana, Tarde o Noche.';
  }

  if (!validarHorario(data.horario) || !validarRangoHorario(data.horario)) {
    return 'El horario debe tener formato HH:mm - HH:mm y la hora final debe ser mayor a la inicial.';
  }

  const errorInicio = validarFechaISO(data.fechaInicio, 'FechaInicio');
  if (errorInicio) return errorInicio;
  const errorFin = validarFechaISO(data.fechaFin, 'FechaFin');
  if (errorFin) return errorFin;

  if (data.fechaInicio && data.fechaFin) {
    if (data.fechaInicio >= data.fechaFin) {
      return 'La FechaInicio debe ser anterior a la FechaFin.';
    }
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (esCreacion && data.fechaInicio) {
    const inicio = new Date(`${data.fechaInicio}T00:00:00`);
    if (inicio < hoy) {
      return 'No se puede crear un ciclo con fecha de inicio anterior a la fecha actual.';
    }
  }

  if (!Number.isInteger(data.capacidad) || data.capacidad < MIN_CAPACIDAD || data.capacidad > MAX_CAPACIDAD) {
    return `La capacidad debe ser un número entero entre ${MIN_CAPACIDAD} y ${MAX_CAPACIDAD}.`;
  }

  if (!Number.isFinite(data.precio) || data.precio < 0 || data.precio > MAX_PRECIO) {
    return `El precio debe estar entre S/ 0.00 y S/ ${MAX_PRECIO.toFixed(2)}.`;
  }

  if (!/^\d{1,2}:?/.test(data.horario)) {
    return 'El horario no tiene un formato válido.';
  }

  if (!data.diasClase || data.diasClase.length < 3 || data.diasClase.length > 100) {
    return 'DiasClase debe contener una descripción válida.';
  }

  if (!/^[A-Z0-9-]{2,10}$/.test(data.prefijo)) {
    return 'PrefijoCodigo solo puede contener letras, números y guion, entre 2 y 10 caracteres.';
  }

  return null;
}

async function obtenerCicloAcademia(idCiclo, idAcademia, connection = pool) {
  const [rows] = await connection.query(`
    SELECT
      c.IdCiclo,
      c.IdAcademia,
      c.Nombre,
      c.PrefijoCodigo,
      c.FechaInicio,
      c.FechaFin,
      c.EstadoRegistro,
      c.Turno,
      c.Horario,
      c.Precio,
      c.DiasClase,
      c.UniversidadObjetivo,
      c.Capacidad,
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
        FROM CicloCurso cc
        INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
        WHERE cc.IdCiclo = c.IdCiclo
          AND cc.EstadoRegistro = 1
          AND cu.EstadoRegistro = 1
      ) AS TotalCursos
    FROM Ciclo c
    WHERE c.IdCiclo = ?
      AND c.IdAcademia = ?
    LIMIT 1
  `, [idCiclo, idAcademia]);

  return rows[0] || null;
}

/* GET /api/admin/ciclos */
router.get('/', async (req, res) => {
  try {
    const idAcademia = req.usuario.idAcademia;
    if (!idAcademia) return res.status(401).json({ error: 'El usuario no tiene academia asociada.' });

    const [rows] = await pool.query(`
      SELECT
        c.IdCiclo,
        c.IdAcademia,
        c.Nombre,
        c.PrefijoCodigo,
        c.FechaInicio,
        c.FechaFin,
        c.EstadoRegistro,
        c.Turno,
        c.Horario,
        c.Precio,
        c.DiasClase,
        c.UniversidadObjetivo,
        c.Capacidad,
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
          FROM CicloCurso cc
          INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
          WHERE cc.IdCiclo = c.IdCiclo
            AND cc.EstadoRegistro = 1
            AND cu.EstadoRegistro = 1
        ) AS TotalCursos
      FROM Ciclo c
      WHERE c.IdAcademia = ?
        AND c.EstadoRegistro IN (0, 1)
      ORDER BY c.EstadoRegistro DESC, c.FechaInicio ASC, c.IdCiclo ASC
    `, [idAcademia]);

    res.json(rows.map((c) => ({
      ...c,
      Capacidad: Number(c.Capacidad || 0),
      Precio: Number(c.Precio || 0),
      TotalAlumnos: Number(c.TotalAlumnos || 0),
      TotalCursos: Number(c.TotalCursos || 0),
      VacantesDisponibles: Number(c.Capacidad || 0) > 0
        ? Math.max(Number(c.Capacidad) - Number(c.TotalAlumnos || 0), 0)
        : null,
      Estado: Number(c.EstadoRegistro) === 1 ? 'Activo / Visible' : 'Cerrado / Oculto',
    })));
  } catch (error) {
    console.error('Error en GET /api/admin/ciclos:', error);
    res.status(500).json({ error: 'No se pudo obtener la gestión de ciclos.' });
  }
});

/* GET /api/admin/ciclos/:id */
router.get('/:id', async (req, res) => {
  const idCiclo = Number(req.params.id);
  if (!Number.isInteger(idCiclo) || idCiclo <= 0) {
    return res.status(400).json({ error: 'IdCiclo inválido.' });
  }

  try {
    const ciclo = await obtenerCicloAcademia(idCiclo, req.usuario.idAcademia);
    if (!ciclo) return res.status(404).json({ error: 'Ciclo no encontrado.' });

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
        h.Docente,
        h.Orden,
        cu.Nombre AS Curso
      FROM HorarioCurso h
      INNER JOIN Curso cu ON cu.IdCurso = h.IdCurso
      WHERE h.IdCiclo = ?
        AND h.EstadoRegistro = 1
        AND cu.EstadoRegistro = 1
      ORDER BY h.DiaNumero ASC, h.HoraInicio ASC, h.Orden ASC
    `, [idCiclo]);

    res.json({
      ciclo,
      cursos,
      horarios,
    });
  } catch (error) {
    console.error('Error en GET /api/admin/ciclos/:id:', error);
    res.status(500).json({ error: 'No se pudo obtener el ciclo.' });
  }
});

/* POST /api/admin/ciclos */
router.post('/', async (req, res) => {
  const idAcademia = req.usuario.idAcademia;
  if (!idAcademia) return res.status(401).json({ error: 'El administrador no tiene academia asociada.' });

  const data = prepararCiclo(req.body);
  const errorValidacion = validarDatosCiclo(data, { esCreacion: true });
  if (errorValidacion) return res.status(400).json({ error: errorValidacion });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [duplicados] = await connection.query(`
      SELECT IdCiclo
      FROM Ciclo
      WHERE IdAcademia = ?
        AND EstadoRegistro IN (0, 1)
        AND LOWER(TRIM(Nombre)) = LOWER(TRIM(?))
      LIMIT 1
    `, [idAcademia, data.nombre]);

    if (duplicados.length > 0) {
      await connection.rollback();
      return res.status(409).json({ error: 'Ya existe un ciclo con ese nombre en tu academia.' });
    }

    const publicar = req.body?.publicar !== false;
    const estadoRegistro = publicar ? 1 : 0;

    const [result] = await connection.query(`
      INSERT INTO Ciclo
        (IdAcademia, Nombre, PrefijoCodigo, FechaInicio, FechaFin, EstadoRegistro,
         Turno, Horario, Precio, DiasClase, UniversidadObjetivo, Capacidad)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      idAcademia,
      data.nombre,
      data.prefijo,
      data.fechaInicio || null,
      data.fechaFin || null,
      estadoRegistro,
      data.turno,
      data.horario,
      data.precio,
      data.diasClase,
      data.universidad,
      data.capacidad,
    ]);

    await connection.commit();

    res.status(201).json({
      message: publicar ? 'Ciclo aperturado y publicado correctamente.' : 'Ciclo creado como oculto/borrador.',
      idCiclo: result.insertId,
      estadoRegistro,
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error en POST /api/admin/ciclos:', error);
    res.status(500).json({ error: 'No se pudo crear el ciclo.', detalle: error.code === 'ER_DUP_ENTRY' ? 'Existe un registro duplicado.' : undefined });
  } finally {
    connection.release();
  }
});

/* PUT /api/admin/ciclos/:id */
router.put('/:id', async (req, res) => {
  const idCiclo = Number(req.params.id);
  const idAcademia = req.usuario.idAcademia;
  if (!Number.isInteger(idCiclo) || idCiclo <= 0) return res.status(400).json({ error: 'IdCiclo inválido.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const existente = await obtenerCicloAcademia(idCiclo, idAcademia, connection);
    if (!existente) {
      await connection.rollback();
      return res.status(404).json({ error: 'Ciclo no encontrado.' });
    }

    const data = prepararCiclo(req.body, existente);
    const errorValidacion = validarDatosCiclo(data, { esCreacion: false });
    if (errorValidacion) {
      await connection.rollback();
      return res.status(400).json({ error: errorValidacion });
    }

    const totalAlumnos = Number(existente.TotalAlumnos || 0);
    if (data.capacidad < totalAlumnos) {
      await connection.rollback();
      return res.status(409).json({
        error: `No puedes establecer una capacidad de ${data.capacidad} porque ya existen ${totalAlumnos} matrículas activas en el ciclo.`,
      });
    }

    const [duplicados] = await connection.query(`
      SELECT IdCiclo
      FROM Ciclo
      WHERE IdAcademia = ?
        AND IdCiclo <> ?
        AND EstadoRegistro IN (0, 1)
        AND LOWER(TRIM(Nombre)) = LOWER(TRIM(?))
      LIMIT 1
    `, [idAcademia, idCiclo, data.nombre]);

    if (duplicados.length > 0) {
      await connection.rollback();
      return res.status(409).json({ error: 'Ya existe otro ciclo con ese nombre en tu academia.' });
    }

    // Una vez que el ciclo tiene matrículas, evitamos cambiar la universidad objetivo,
    // porque esta información define la escala académica del historial.
    if (totalAlumnos > 0 && data.universidad !== existente.UniversidadObjetivo) {
      await connection.rollback();
      return res.status(409).json({
        error: 'No se puede cambiar la UniversidadObjetivo de un ciclo que ya tiene matrículas activas.',
      });
    }

    await connection.query(`
      UPDATE Ciclo
      SET
        Nombre = ?,
        PrefijoCodigo = ?,
        FechaInicio = ?,
        FechaFin = ?,
        Turno = ?,
        Horario = ?,
        Precio = ?,
        DiasClase = ?,
        UniversidadObjetivo = ?,
        Capacidad = ?
      WHERE IdCiclo = ?
        AND IdAcademia = ?
    `, [
      data.nombre,
      data.prefijo,
      data.fechaInicio || null,
      data.fechaFin || null,
      data.turno,
      data.horario,
      data.precio,
      data.diasClase,
      data.universidad,
      data.capacidad,
      idCiclo,
      idAcademia,
    ]);

    await connection.commit();

    res.json({ message: 'Ciclo actualizado correctamente.', idCiclo });
  } catch (error) {
    await connection.rollback();
    console.error('Error en PUT /api/admin/ciclos/:id:', error);
    res.status(500).json({ error: 'No se pudo actualizar el ciclo.' });
  } finally {
    connection.release();
  }
});

/* PATCH /api/admin/ciclos/:id/estado */
router.patch('/:id/estado', async (req, res) => {
  const idCiclo = Number(req.params.id);
  const idAcademia = req.usuario.idAcademia;
  const estadoSolicitado = normalizarTexto(req.body?.estado || '').toLowerCase();

  if (!Number.isInteger(idCiclo) || idCiclo <= 0) return res.status(400).json({ error: 'IdCiclo inválido.' });

  const mapaEstados = {
    activo: 1,
    abrir: 1,
    abierto: 1,
    aperturar: 1,
    reabrir: 1,
    cerrado: 0,
    cerrar: 0,
    oculto: 0,
    ocultar: 0,
  };

  if (!(estadoSolicitado in mapaEstados)) {
    return res.status(400).json({
      error: 'Estado inválido. Usa Activo/Abrir/Reabrir o Cerrado/Cerrar/Oculto/Ocultar.',
    });
  }

  try {
    const ciclo = await obtenerCicloAcademia(idCiclo, idAcademia);
    if (!ciclo) return res.status(404).json({ error: 'Ciclo no encontrado.' });

    const nuevoEstado = mapaEstados[estadoSolicitado];

    if (nuevoEstado === 1) {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      if (ciclo.FechaFin) {
        const fin = new Date(`${ciclo.FechaFin}T23:59:59`);
        if (fin < hoy) {
          return res.status(409).json({ error: 'No se puede reabrir un ciclo cuya fecha de finalización ya pasó.' });
        }
      }

      const totalAlumnos = Number(ciclo.TotalAlumnos || 0);
      const capacidad = Number(ciclo.Capacidad || 0);
      if (capacidad > 0 && totalAlumnos >= capacidad) {
        return res.status(409).json({ error: 'No se puede reabrir el ciclo porque su capacidad ya está completa.' });
      }
    }

    await pool.query(`
      UPDATE Ciclo
      SET EstadoRegistro = ?
      WHERE IdCiclo = ?
        AND IdAcademia = ?
    `, [nuevoEstado, idCiclo, idAcademia]);

    res.json({
      message: nuevoEstado === 1 ? 'Ciclo aperturado/visible nuevamente.' : 'Ciclo cerrado/ocultado. Ya no será mostrado en la vitrina pública.',
      idCiclo,
      estadoRegistro: nuevoEstado,
    });
  } catch (error) {
    console.error('Error en PATCH /api/admin/ciclos/:id/estado:', error);
    res.status(500).json({ error: 'No se pudo cambiar el estado del ciclo.' });
  }
});

/* DELETE /api/admin/ciclos/:id - eliminación lógica */
router.delete('/:id', async (req, res) => {
  const idCiclo = Number(req.params.id);
  const idAcademia = req.usuario.idAcademia;
  if (!Number.isInteger(idCiclo) || idCiclo <= 0) return res.status(400).json({ error: 'IdCiclo inválido.' });

  try {
    const ciclo = await obtenerCicloAcademia(idCiclo, idAcademia);
    if (!ciclo) return res.status(404).json({ error: 'Ciclo no encontrado.' });

    const totalAlumnos = Number(ciclo.TotalAlumnos || 0);
    if (totalAlumnos > 0) {
      return res.status(409).json({
        error: 'El ciclo ya tiene matrículas y no puede eliminarse. Debe cerrarse u ocultarse para conservar el historial.',
      });
    }

    await pool.query(`
      UPDATE Ciclo
      SET EstadoRegistro = 0
      WHERE IdCiclo = ?
        AND IdAcademia = ?
    `, [idCiclo, idAcademia]);

    res.json({ message: 'Ciclo dado de baja lógicamente.', idCiclo, estadoRegistro: 0 });
  } catch (error) {
    console.error('Error en DELETE /api/admin/ciclos/:id:', error);
    res.status(500).json({ error: 'No se pudo dar de baja el ciclo.' });
  }
});

module.exports = router;
