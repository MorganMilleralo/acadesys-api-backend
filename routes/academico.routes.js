const express = require('express');
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');

const router = express.Router();
const ROLES_GESTION = ['Administrador', 'Docente', 'Tutor de Aula'];
const ESTADOS_ASISTENCIA = new Set(['presente', 'tardanza', 'falta', 'justificado']);

function academiaDelUsuario(req, res) {
  const idAcademia = Number(req.usuario?.idAcademia);
  if (!Number.isInteger(idAcademia) || idAcademia <= 0) {
    res.status(401).json({ error: 'El usuario autenticado no tiene una academia válida.' });
    return null;
  }
  return idAcademia;
}

function idPositivo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizarTexto(valor, max = 120) {
  return String(valor ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function fechaISOValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

function horaValida(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).trim();
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(texto) ? texto.slice(0, 8) : undefined;
}

// ============================================================
// AULAS
// ============================================================
router.get('/aulas', async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  try {
    const [rows] = await pool.query(
      `SELECT IdAula AS idAula, Nombre AS nombre, Nivel AS nivel,
              Capacidad AS capacidad, EstadoRegistro AS estadoRegistro
       FROM Aula
       WHERE IdAcademia = ? AND EstadoRegistro = 1
       ORDER BY Nombre ASC`,
      [idAcademia],
    );
    res.json(rows);
  } catch (error) {
    console.error('GET /api/aulas:', error);
    res.status(500).json({ error: 'No se pudieron consultar las aulas.' });
  }
});

// MODIFICADO: POST /aulas con Reactivación Inteligente (Baja Lógica)
router.post('/aulas', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const nombre = normalizarTexto(req.body?.nombre ?? req.body?.Nombre);
  const nivel = normalizarTexto(req.body?.nivel ?? req.body?.Nivel ?? 'General', 80) || 'General';
  const capacidad = Number(req.body?.capacidad ?? req.body?.Capacidad ?? 35);
  if (nombre.length < 2) return res.status(400).json({ error: 'El nombre del aula debe tener al menos 2 caracteres.' });
  if (!Number.isInteger(capacidad) || capacidad < 1 || capacidad > 500) {
    return res.status(400).json({ error: 'La capacidad debe ser un entero entre 1 y 500.' });
  }
  try {
    // 1. Buscamos si el aula ya existe en la academia, sin importar su estado
    const [existentes] = await pool.query(
        'SELECT IdAula, EstadoRegistro FROM Aula WHERE IdAcademia = ? AND Nombre = ?',
        [idAcademia, nombre]
    );

    if (existentes.length > 0) {
        const aula = existentes[0];
        if (aula.EstadoRegistro === 0) {
            // Reactivación si estaba dada de baja
            await pool.query(
                'UPDATE Aula SET EstadoRegistro = 1, Nivel = ?, Capacidad = ? WHERE IdAula = ?',
                [nivel, capacidad, aula.IdAula]
            );
            return res.status(200).json({ message: 'Aula reactivada y actualizada correctamente.', idAula: aula.IdAula });
        } else {
            // Si está activa, bloqueamos
            return res.status(409).json({ error: 'Ya existe un aula activa con ese nombre en esta academia.' });
        }
    }

    // 2. Creación normal si no existía
    const [result] = await pool.query(
      `INSERT INTO Aula (IdAcademia, Nombre, Nivel, Capacidad, EstadoRegistro)
       VALUES (?, ?, ?, ?, 1)`,
      [idAcademia, nombre, nivel, capacidad],
    );
    res.status(201).json({ message: 'Aula creada correctamente.', idAula: result.insertId });
  } catch (error) {
    console.error('POST /api/aulas:', error);
    res.status(500).json({ error: 'No se pudo crear el aula.' });
  }
});

router.put('/aulas/:id', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idAula = idPositivo(req.params.id);
  if (!idAula) return res.status(400).json({ error: 'El identificador del aula no es válido.' });
  const nombre = normalizarTexto(req.body?.nombre ?? req.body?.Nombre);
  const nivel = normalizarTexto(req.body?.nivel ?? req.body?.Nivel ?? 'General', 80) || 'General';
  const capacidad = Number(req.body?.capacidad ?? req.body?.Capacidad ?? 35);
  if (nombre.length < 2) return res.status(400).json({ error: 'El nombre del aula debe tener al menos 2 caracteres.' });
  if (!Number.isInteger(capacidad) || capacidad < 1 || capacidad > 500) {
    return res.status(400).json({ error: 'La capacidad debe ser un entero entre 1 y 500.' });
  }
  try {
    const [result] = await pool.query(
      `UPDATE Aula SET Nombre = ?, Nivel = ?, Capacidad = ?
       WHERE IdAula = ? AND IdAcademia = ? AND EstadoRegistro = 1`,
      [nombre, nivel, capacidad, idAula, idAcademia],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Aula no encontrada en esta academia.' });
    res.json({ message: 'Aula actualizada correctamente.', idAula });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un aula con ese nombre en esta academia.' });
    console.error('PUT /api/aulas/:id:', error);
    res.status(500).json({ error: 'No se pudo actualizar el aula.' });
  }
});

router.delete('/aulas/:id', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idAula = idPositivo(req.params.id);
  if (!idAula) return res.status(400).json({ error: 'El identificador del aula no es válido.' });
  try {
    const [result] = await pool.query(
      'UPDATE Aula SET EstadoRegistro = 0 WHERE IdAula = ? AND IdAcademia = ? AND EstadoRegistro = 1',
      [idAula, idAcademia],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Aula no encontrada o ya desactivada.' });
    res.json({ message: 'Aula desactivada correctamente.' });
  } catch (error) {
    console.error('DELETE /api/aulas/:id:', error);
    res.status(500).json({ error: 'No se pudo desactivar el aula.' });
  }
});

// ============================================================
// CURSOS
// ============================================================
router.get('/cursos', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT IdCurso AS idCurso, Nombre AS nombre, Codigo AS codigo,
              Descripcion AS descripcion, UniversidadObjetivo AS universidadObjetivo,
              EstadoRegistro AS estadoRegistro
       FROM Curso
       WHERE EstadoRegistro = 1
       ORDER BY Nombre ASC`,
    );
    res.json(rows);
  } catch (error) {
    console.error('GET /api/cursos:', error);
    res.status(500).json({ error: 'No se pudieron consultar los cursos.' });
  }
});

// MODIFICADO: POST /cursos con Reactivación Inteligente (Baja Lógica)
router.post('/cursos', requiereRol('Administrador'), async (req, res) => {
  const nombre = normalizarTexto(req.body?.nombre ?? req.body?.Nombre, 100);
  const codigo = normalizarTexto(req.body?.codigo ?? req.body?.Codigo, 20).toUpperCase();
  const descripcion = String(req.body?.descripcion ?? req.body?.Descripcion ?? '').trim().slice(0, 500);
  const universidad = normalizarTexto(req.body?.universidadObjetivo ?? req.body?.UniversidadObjetivo ?? 'Preuniversitario', 60) || 'Preuniversitario';
  if (nombre.length < 2) return res.status(400).json({ error: 'El nombre del curso debe tener al menos 2 caracteres.' });
  if (!/^[A-Z0-9-]{2,20}$/.test(codigo)) return res.status(400).json({ error: 'El código debe tener entre 2 y 20 letras mayúsculas, números o guiones.' });
  try {
    // 1. Buscamos si el curso ya existe por código
    const [existentes] = await pool.query(
        'SELECT IdCurso, EstadoRegistro FROM Curso WHERE Codigo = ?',
        [codigo]
    );

    if (existentes.length > 0) {
        const curso = existentes[0];
        if (curso.EstadoRegistro === 0) {
            // Reactivación si estaba dado de baja
            await pool.query(
                'UPDATE Curso SET EstadoRegistro = 1, Nombre = ?, Descripcion = ?, UniversidadObjetivo = ? WHERE IdCurso = ?',
                [nombre, descripcion, universidad, curso.IdCurso]
            );
            return res.status(200).json({ message: 'Curso reactivado y actualizado correctamente.', idCurso: curso.IdCurso });
        } else {
            // Bloqueo de duplicado activo
            return res.status(409).json({ error: 'Ya existe un curso activo con ese código.' });
        }
    }

    // 2. Creación normal si no existía
    const [result] = await pool.query(
      `INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
       VALUES (?, ?, ?, ?, 1)`,
      [nombre, codigo, descripcion, universidad],
    );
    res.status(201).json({ message: 'Curso creado correctamente.', idCurso: result.insertId });
  } catch (error) {
    console.error('POST /api/cursos:', error);
    res.status(500).json({ error: 'No se pudo crear el curso.' });
  }
});

router.put('/cursos/:id', requiereRol('Administrador'), async (req, res) => {
  const idCurso = idPositivo(req.params.id);
  if (!idCurso) return res.status(400).json({ error: 'El identificador del curso no es válido.' });
  const nombre = normalizarTexto(req.body?.nombre ?? req.body?.Nombre, 100);
  const codigo = normalizarTexto(req.body?.codigo ?? req.body?.Codigo, 20).toUpperCase();
  const descripcion = String(req.body?.descripcion ?? req.body?.Descripcion ?? '').trim().slice(0, 500);
  const universidadSolicitada = req.body?.universidadObjetivo ?? req.body?.UniversidadObjetivo;
  if (nombre.length < 2) return res.status(400).json({ error: 'El nombre del curso debe tener al menos 2 caracteres.' });
  if (!/^[A-Z0-9-]{2,20}$/.test(codigo)) return res.status(400).json({ error: 'El código debe tener entre 2 y 20 letras mayúsculas, números o guiones.' });
  try {
    const [[cursoExistente]] = await pool.query(
      'SELECT UniversidadObjetivo FROM Curso WHERE IdCurso = ? AND EstadoRegistro = 1 LIMIT 1',
      [idCurso],
    );
    if (!cursoExistente) return res.status(404).json({ error: 'Curso no encontrado o inactivo.' });
    const universidad = normalizarTexto(universidadSolicitada ?? cursoExistente.UniversidadObjetivo ?? 'Preuniversitario', 60) || 'Preuniversitario';
    const [result] = await pool.query(
      `UPDATE Curso SET Nombre = ?, Codigo = ?, Descripcion = ?, UniversidadObjetivo = ?
       WHERE IdCurso = ? AND EstadoRegistro = 1`,
      [nombre, codigo, descripcion, universidad, idCurso],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Curso no encontrado o inactivo.' });
    res.json({ message: 'Curso actualizado correctamente.', idCurso });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un curso con ese código.' });
    console.error('PUT /api/cursos/:id:', error);
    res.status(500).json({ error: 'No se pudo actualizar el curso.' });
  }
});

router.delete('/cursos/:id', requiereRol('Administrador'), async (req, res) => {
  const idCurso = idPositivo(req.params.id);
  if (!idCurso) return res.status(400).json({ error: 'El identificador del curso no es válido.' });
  try {
    const [result] = await pool.query('UPDATE Curso SET EstadoRegistro = 0 WHERE IdCurso = ? AND EstadoRegistro = 1', [idCurso]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Curso no encontrado o ya inactivo.' });
    res.json({ message: 'Curso desactivado correctamente.' });
  } catch (error) {
    console.error('DELETE /api/cursos/:id:', error);
    res.status(500).json({ error: 'No se pudo desactivar el curso.' });
  }
});

// ============================================================
// ASIGNACIONES (Sin modificaciones estructurales requeridas)
// ============================================================
router.get('/asignaciones', requiereRol(...ROLES_GESTION), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  try {
    const [rows] = await pool.query(
      `SELECT aa.IdAsignacion AS idAsignacion, aa.IdUsuario AS idUsuario,
              aa.IdCiclo AS idCiclo, aa.IdCurso AS idCurso, aa.IdAula AS idAula,
              aa.Horas AS horas, aa.IdAcademia AS idAcademia,
              CONCAT(u.Nombres, ' ', u.ApellidoPaterno, ' ', COALESCE(u.ApellidoMaterno, '')) AS docente,
              cu.Nombre AS curso, cu.Codigo AS codigoCurso, a.Nombre AS aula, c.Nombre AS ciclo
       FROM Asignacion_Aula aa
       INNER JOIN Usuario u ON u.IdUsuario = aa.IdUsuario
       INNER JOIN Aula a ON a.IdAula = aa.IdAula
       INNER JOIN Curso cu ON cu.IdCurso = aa.IdCurso
       INNER JOIN Ciclo c ON c.IdCiclo = aa.IdCiclo
       WHERE aa.IdAcademia = ? AND aa.EstadoRegistro = 1
         AND u.EstadoRegistro = 1 AND a.EstadoRegistro = 1
         AND cu.EstadoRegistro = 1 AND c.EstadoRegistro = 1
       ORDER BY c.Nombre, a.Nombre, cu.Nombre, docente`,
      [idAcademia],
    );
    res.json(rows);
  } catch (error) {
    console.error('GET /api/asignaciones:', error);
    res.status(500).json({ error: 'No se pudieron consultar las asignaciones. Verifica que la migración académica esté aplicada.' });
  }
});

router.post('/asignaciones', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idUsuario = idPositivo(req.body?.idUsuario ?? req.body?.IdUsuario);
  const idCiclo = idPositivo(req.body?.idCiclo ?? req.body?.IdCiclo);
  const idCurso = idPositivo(req.body?.idCurso ?? req.body?.IdCurso);
  const idAula = idPositivo(req.body?.idAula ?? req.body?.IdAula);
  const horas = Number(req.body?.horas ?? req.body?.Horas ?? 4);
  if (!idUsuario || !idCiclo || !idCurso || !idAula) {
    return res.status(400).json({ error: 'Selecciona un docente, ciclo, curso y aula válidos.' });
  }
  if (!Number.isInteger(horas) || horas < 1 || horas > 30) return res.status(400).json({ error: 'Las horas semanales deben estar entre 1 y 30.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[docente]] = await connection.query(
      `SELECT u.IdUsuario
       FROM Usuario u
       INNER JOIN Usuario_Perfiles up ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
       INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
       WHERE u.IdUsuario = ? AND u.IdAcademia = ? AND u.EstadoRegistro = 1
         AND (LOWER(p.Nombre) LIKE '%docente%' OR LOWER(p.Nombre) LIKE '%tutor%')
       LIMIT 1`,
      [idUsuario, idAcademia],
    );
    if (!docente) {
      await connection.rollback();
      return res.status(400).json({ error: 'El usuario seleccionado no es un docente/tutor activo de esta academia.' });
    }
    const [[ciclo]] = await connection.query(
      'SELECT IdCiclo FROM Ciclo WHERE IdCiclo = ? AND IdAcademia = ? AND EstadoRegistro = 1 LIMIT 1',
      [idCiclo, idAcademia],
    );
    const [[aula]] = await connection.query(
      'SELECT IdAula FROM Aula WHERE IdAula = ? AND IdAcademia = ? AND EstadoRegistro = 1 LIMIT 1',
      [idAula, idAcademia],
    );
    const [[curso]] = await connection.query(
      'SELECT IdCurso FROM Curso WHERE IdCurso = ? AND EstadoRegistro = 1 LIMIT 1',
      [idCurso],
    );
    if (!ciclo || !aula || !curso) {
      await connection.rollback();
      return res.status(400).json({ error: 'El ciclo, aula o curso no existe, está inactivo o no pertenece a esta academia.' });
    }
    const [duplicados] = await connection.query(
      `SELECT IdAsignacion FROM Asignacion_Aula
       WHERE IdAcademia = ? AND IdUsuario = ? AND IdCiclo = ? AND IdCurso = ? AND IdAula = ? AND EstadoRegistro = 1
       LIMIT 1`,
      [idAcademia, idUsuario, idCiclo, idCurso, idAula],
    );
    if (duplicados.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'Esta asignación ya existe.' });
    }
    const [result] = await connection.query(
      `INSERT INTO Asignacion_Aula (IdUsuario, IdCiclo, IdAcademia, IdAula, IdCurso, Horas, EstadoRegistro)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [idUsuario, idCiclo, idAcademia, idAula, idCurso, horas],
    );
    await connection.commit();
    res.status(201).json({ message: 'Asignación creada correctamente.', idAsignacion: result.insertId });
  } catch (error) {
    await connection.rollback();
    console.error('POST /api/asignaciones:', error);
    res.status(500).json({ error: 'No se pudo crear la asignación. Verifica que la migración académica esté aplicada.' });
  } finally {
    connection.release();
  }
});

router.delete('/asignaciones/:id', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idAsignacion = idPositivo(req.params.id);
  if (!idAsignacion) return res.status(400).json({ error: 'El identificador de la asignación no es válido.' });
  try {
    const [result] = await pool.query(
      'UPDATE Asignacion_Aula SET EstadoRegistro = 0 WHERE IdAsignacion = ? AND IdAcademia = ? AND EstadoRegistro = 1',
      [idAsignacion, idAcademia],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Asignación no encontrada o ya desactivada.' });
    res.json({ message: 'Asignación desactivada correctamente.' });
  } catch (error) {
    console.error('DELETE /api/asignaciones/:id:', error);
    res.status(500).json({ error: 'No se pudo desactivar la asignación.' });
  }
});

// ============================================================
// ASISTENCIAS (Sin modificaciones estructurales requeridas)
// ============================================================
router.get('/asistencias', requiereRol(...ROLES_GESTION), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idAula = idPositivo(req.query.idAula);
  const fecha = String(req.query.fecha ?? '');
  if (!idAula || !fechaISOValida(fecha)) return res.status(400).json({ error: 'Debes indicar un idAula válido y una fecha en formato YYYY-MM-DD.' });
  try {
    const [[aula]] = await pool.query(
      'SELECT IdAula FROM Aula WHERE IdAula = ? AND IdAcademia = ? AND EstadoRegistro = 1 LIMIT 1',
      [idAula, idAcademia],
    );
    if (!aula) return res.status(404).json({ error: 'Aula no encontrada en esta academia.' });
    const [rows] = await pool.query(
      `SELECT DISTINCT
              m.IdMatricula AS idMatricula,
              m.IdMatricula AS idAlumno,
              u.IdUsuario AS idUsuario,
              CONCAT(u.Nombres, ' ', u.ApellidoPaterno, ' ', COALESCE(u.ApellidoMaterno, '')) AS nombre,
              COALESCE(DATE_FORMAT(ast.HoraLlegada, '%H:%i'), '--') AS horaLlegada,
              COALESCE(ast.Estado, 'pendiente') AS estado
       FROM Asignacion_Aula aa
       INNER JOIN Ciclo c ON c.IdCiclo = aa.IdCiclo AND c.IdAcademia = aa.IdAcademia
       INNER JOIN Matricula m ON m.IdCiclo = aa.IdCiclo
         AND (aa.IdCurso IS NULL OR m.IdCurso IS NULL OR m.IdCurso = aa.IdCurso)
       INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario AND u.IdAcademia = aa.IdAcademia
       LEFT JOIN Asistencia ast ON ast.IdMatricula = m.IdMatricula
         AND ast.IdAula = aa.IdAula AND ast.Fecha = ? AND ast.EstadoRegistro = 1
       WHERE aa.IdAula = ? AND aa.IdAcademia = ? AND aa.EstadoRegistro = 1
         AND c.EstadoRegistro = 1 AND m.EstadoRegistro = 1 AND u.EstadoRegistro = 1
         AND aa.IdAula IS NOT NULL
       ORDER BY nombre ASC`,
      [fecha, idAula, idAcademia],
    );
    res.json(rows);
  } catch (error) {
    console.error('GET /api/asistencias:', error);
    res.status(500).json({ error: 'No se pudo consultar la asistencia. Verifica que la migración esté aplicada.' });
  }
});

router.post('/asistencias', requiereRol(...ROLES_GESTION), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idAula = idPositivo(req.body?.idAula);
  const fecha = String(req.body?.fecha ?? '');
  const lista = req.body?.listaAlumnos;
  if (!idAula || !fechaISOValida(fecha) || !Array.isArray(lista) || lista.length === 0) {
    return res.status(400).json({ error: 'Envía un aula válida, una fecha YYYY-MM-DD y una lista de alumnos.' });
  }
  if (lista.length > 500) return res.status(413).json({ error: 'La lista de asistencia supera el límite de 500 alumnos.' });

  const registros = [];
  const idsVistos = new Set();
  for (const alumno of lista) {
    const idMatricula = idPositivo(alumno?.idMatricula);
    const estado = String(alumno?.estado ?? '').toLowerCase();
    const hora = horaValida(alumno?.horaLlegada);
    if (!idMatricula || idsVistos.has(idMatricula)) return res.status(400).json({ error: 'La lista contiene una matrícula inválida o duplicada.' });
    if (!ESTADOS_ASISTENCIA.has(estado)) return res.status(400).json({ error: 'Todos los alumnos deben tener un estado válido: presente, tardanza, falta o justificado.' });
    if (hora === undefined) return res.status(400).json({ error: 'La hora de llegada debe tener formato HH:mm.' });
    idsVistos.add(idMatricula);
    registros.push({ idMatricula, estado, hora: ['presente', 'tardanza'].includes(estado) ? hora : null });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[aula]] = await connection.query(
      'SELECT IdAula FROM Aula WHERE IdAula = ? AND IdAcademia = ? AND EstadoRegistro = 1 LIMIT 1',
      [idAula, idAcademia],
    );
    if (!aula) {
      await connection.rollback();
      return res.status(404).json({ error: 'Aula no encontrada en esta academia.' });
    }
    const placeholders = registros.map(() => '?').join(',');
    const params = [idAula, idAcademia, ...registros.map((r) => r.idMatricula)];
    const [permitidas] = await connection.query(
      `SELECT DISTINCT m.IdMatricula
       FROM Asignacion_Aula aa
       INNER JOIN Matricula m ON m.IdCiclo = aa.IdCiclo
         AND (aa.IdCurso IS NULL OR m.IdCurso IS NULL OR m.IdCurso = aa.IdCurso)
       INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario AND u.IdAcademia = aa.IdAcademia
       INNER JOIN Ciclo c ON c.IdCiclo = aa.IdCiclo AND c.IdAcademia = aa.IdAcademia
       WHERE aa.IdAula = ? AND aa.IdAcademia = ? AND aa.EstadoRegistro = 1
         AND m.EstadoRegistro = 1 AND u.EstadoRegistro = 1 AND c.EstadoRegistro = 1
         AND m.IdMatricula IN (${placeholders})`,
      params,
    );
    const permitidasSet = new Set(permitidas.map((r) => Number(r.IdMatricula)));
    if (permitidasSet.size !== registros.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'Una o más matrículas no corresponden a alumnos asignados al aula seleccionada.' });
    }

    const idUsuarioRegistro = idPositivo(req.usuario?.idUsuario ?? req.usuario?.id) || null;
    for (const registro of registros) {
      await connection.query(
        `INSERT INTO Asistencia
           (IdMatricula, IdAula, Fecha, Estado, HoraLlegada, UsuarioRegistro, EstadoRegistro)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           Estado = VALUES(Estado), HoraLlegada = VALUES(HoraLlegada),
           UsuarioRegistro = VALUES(UsuarioRegistro), EstadoRegistro = 1,
           FechaModificacion = CURRENT_TIMESTAMP`,
        [registro.idMatricula, idAula, fecha, registro.estado, registro.hora, idUsuarioRegistro],
      );
    }
    await connection.commit();
    res.json({ message: 'Asistencia guardada correctamente.', registrosGuardados: registros.length });
  } catch (error) {
    await connection.rollback();
    console.error('POST /api/asistencias:', error);
    res.status(500).json({ error: 'No se pudo guardar la asistencia. Verifica que la migración esté aplicada.' });
  } finally {
    connection.release();
  }
});

module.exports = router;