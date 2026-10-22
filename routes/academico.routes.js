const express = require('express');
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');
const { esAdministrativo } = requiereRol;
const { rollbackSeguro, idPositivo } = require('../utils/validaciones');

const router = express.Router();
const ROLES_GESTION = ['Administrador', 'Docente', 'Tutor de Aula'];
const ESTADOS_ASISTENCIA = new Set(['presente', 'tardanza', 'falta', 'justificado']);

function academiaDelUsuario(req, res) {
  const idAcademia = Number(req.usuario?.idAcademia);
  if (!Number.isInteger(idAcademia) || idAcademia <= 0) {
    res.status(401).json({ error: 'El usuario autenticado no tiene una academia vÃ¡lida.' });
    return null;
  }
  return idAcademia;
}

function normalizarTexto(valor, max = 120) {
  if (typeof valor !== 'string') return '';
  const texto = valor.trim().replace(/\s+/g, ' ');
  return texto.length <= max ? texto : '';
}

function fechaISOValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

// Validador compartido por horarios y asistencias.
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

// MODIFICADO: POST /aulas con ReactivaciÃ³n Inteligente (Baja LÃ³gica)
router.post('/aulas', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const nombre = normalizarTexto(req.body?.nombre ?? req.body?.Nombre);
  const nivel = normalizarTexto(req.body?.nivel ?? req.body?.Nivel ?? 'General', 80);
  if (!nivel) return res.status(400).json({ error: 'El nivel debe contener texto de hasta 80 caracteres.' });
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
            // ReactivaciÃ³n si estaba dada de baja
            await pool.query(
                'UPDATE Aula SET EstadoRegistro = 1, Nivel = ?, Capacidad = ? WHERE IdAula = ?',
                [nivel, capacidad, aula.IdAula]
            );
            return res.status(200).json({ message: 'Aula reactivada y actualizada correctamente.', idAula: aula.IdAula });
        } else {
            // Si estÃ¡ activa, bloqueamos
            return res.status(409).json({ error: 'Ya existe un aula activa con ese nombre en esta academia.' });
        }
    }

    // 2. CreaciÃ³n normal si no existÃ­a
    const [result] = await pool.query(
      `INSERT INTO Aula (IdAcademia, Nombre, Nivel, Capacidad, EstadoRegistro)
       VALUES (?, ?, ?, ?, 1)`,
      [idAcademia, nombre, nivel, capacidad],
    );
    res.status(201).json({ message: 'Aula creada correctamente.', idAula: result.insertId });
  } catch (error) {
    // Aula tiene UNIQUE (IdAcademia, Nombre): una alta concurrente se reporta
    // como conflicto, no como error interno.
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un aula con ese nombre en esta academia.' });
    console.error('POST /api/aulas:', error);
    res.status(500).json({ error: 'No se pudo crear el aula.' });
  }
});

router.put('/aulas/:id', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idAula = idPositivo(req.params.id);
  if (!idAula) return res.status(400).json({ error: 'El identificador del aula no es vÃ¡lido.' });
  const nombre = normalizarTexto(req.body?.nombre ?? req.body?.Nombre);
  const nivel = normalizarTexto(req.body?.nivel ?? req.body?.Nivel ?? 'General', 80);
  if (!nivel) return res.status(400).json({ error: 'El nivel debe contener texto de hasta 80 caracteres.' });
  const capacidad = Number(req.body?.capacidad ?? req.body?.Capacidad ?? 35);
  if (nombre.length < 2) return res.status(400).json({ error: 'El nombre del aula debe tener al menos 2 caracteres.' });
  if (!Number.isInteger(capacidad) || capacidad < 1 || capacidad > 500) {
    return res.status(400).json({ error: 'La capacidad debe ser un entero entre 1 y 500.' });
  }
  try {
    const [duplicados] = await pool.query('SELECT IdAula FROM Aula WHERE IdAcademia = ? AND Nombre = ? AND IdAula <> ? AND EstadoRegistro = 1 LIMIT 1', [idAcademia, nombre, idAula]);
    if (duplicados.length) return res.status(409).json({ error: 'Ya existe un aula activa con ese nombre.' });
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
  if (!idAula) return res.status(400).json({ error: 'El identificador del aula no es vÃ¡lido.' });
  try {
    const [relaciones] = await pool.query(`SELECT aa.IdAula FROM Asignacion_Aula aa INNER JOIN Aula a ON a.IdAula = aa.IdAula
      WHERE aa.IdAula = ? AND a.IdAcademia = ? AND aa.EstadoRegistro = 1
      UNION ALL SELECT ast.IdAula FROM Asistencia ast INNER JOIN Aula a ON a.IdAula = ast.IdAula
      WHERE ast.IdAula = ? AND a.IdAcademia = ? AND ast.EstadoRegistro = 1 LIMIT 1`, [idAula, idAcademia, idAula, idAcademia]);
    if (relaciones.length) return res.status(409).json({ error: 'El aula tiene asignaciones o asistencias vigentes; no se puede desactivar.' });
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

// MODIFICADO: POST /cursos con ReactivaciÃ³n Inteligente (Baja LÃ³gica)
router.post('/cursos', requiereRol('Administrador'), async (req, res) => {
  const nombre = normalizarTexto(req.body?.nombre ?? req.body?.Nombre, 100);
  const codigo = normalizarTexto(req.body?.codigo ?? req.body?.Codigo, 20).toUpperCase();
  const descripcion = req.body?.descripcion ?? req.body?.Descripcion ?? '';
  if (typeof descripcion !== 'string' || descripcion.length > 255) return res.status(400).json({ error: 'La descripción debe tener hasta 255 caracteres.' });
  const universidad = normalizarTexto(req.body?.universidadObjetivo ?? req.body?.UniversidadObjetivo ?? 'Preuniversitario', 50);
  if (!universidad) return res.status(400).json({ error: 'La universidad objetivo debe ser texto de hasta 50 caracteres.' });
  if (nombre.length < 2) return res.status(400).json({ error: 'El nombre del curso debe tener al menos 2 caracteres.' });
  if (!/^[A-Z0-9-]{2,20}$/.test(codigo)) return res.status(400).json({ error: 'El cÃ³digo debe tener entre 2 y 20 letras mayÃºsculas, nÃºmeros o guiones.' });
  try {
    // 1. Buscamos si el curso ya existe por cÃ³digo
    const [existentes] = await pool.query(
        'SELECT IdCurso, EstadoRegistro FROM Curso WHERE Codigo = ?',
        [codigo]
    );

    if (existentes.length > 0) {
        const curso = existentes[0];
        if (curso.EstadoRegistro === 0) {
            // ReactivaciÃ³n si estaba dado de baja
            await pool.query(
                'UPDATE Curso SET EstadoRegistro = 1, Nombre = ?, Descripcion = ?, UniversidadObjetivo = ? WHERE IdCurso = ?',
                [nombre, descripcion, universidad, curso.IdCurso]
            );
            return res.status(200).json({ message: 'Curso reactivado y actualizado correctamente.', idCurso: curso.IdCurso });
        } else {
            // Bloqueo de duplicado activo
            return res.status(409).json({ error: 'Ya existe un curso activo con ese cÃ³digo.' });
        }
    }

    // 2. CreaciÃ³n normal si no existÃ­a
    const [result] = await pool.query(
      `INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
       VALUES (?, ?, ?, ?, 1)`,
      [nombre, codigo, descripcion, universidad],
    );
    res.status(201).json({ message: 'Curso creado correctamente.', idCurso: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un curso con ese código.' });
    console.error('POST /api/cursos:', error);
    res.status(500).json({ error: 'No se pudo crear el curso.' });
  }
});

router.put('/cursos/:id', requiereRol('Administrador'), async (req, res) => {
  const idCurso = idPositivo(req.params.id);
  if (!idCurso) return res.status(400).json({ error: 'El identificador del curso no es vÃ¡lido.' });
  const nombre = normalizarTexto(req.body?.nombre ?? req.body?.Nombre, 100);
  const codigo = normalizarTexto(req.body?.codigo ?? req.body?.Codigo, 20).toUpperCase();
  const descripcion = req.body?.descripcion ?? req.body?.Descripcion ?? '';
  if (typeof descripcion !== 'string' || descripcion.length > 255) return res.status(400).json({ error: 'La descripción debe tener hasta 255 caracteres.' });
  const universidadSolicitada = req.body?.universidadObjetivo ?? req.body?.UniversidadObjetivo;
  if (nombre.length < 2) return res.status(400).json({ error: 'El nombre del curso debe tener al menos 2 caracteres.' });
  if (!/^[A-Z0-9-]{2,20}$/.test(codigo)) return res.status(400).json({ error: 'El cÃ³digo debe tener entre 2 y 20 letras mayÃºsculas, nÃºmeros o guiones.' });
  try {
    const [[cursoExistente]] = await pool.query(
      'SELECT UniversidadObjetivo FROM Curso WHERE IdCurso = ? AND EstadoRegistro = 1 LIMIT 1',
      [idCurso],
    );
    if (!cursoExistente) return res.status(404).json({ error: 'Curso no encontrado o inactivo.' });
    const [duplicados] = await pool.query('SELECT IdCurso FROM Curso WHERE Codigo = ? AND IdCurso <> ? AND EstadoRegistro = 1 LIMIT 1', [codigo, idCurso]);
    if (duplicados.length) return res.status(409).json({ error: 'Ya existe un curso activo con ese código.' });
    const universidad = normalizarTexto(universidadSolicitada ?? cursoExistente.UniversidadObjetivo ?? 'Preuniversitario', 50);
    if (!universidad) return res.status(400).json({ error: 'La universidad objetivo debe ser texto de hasta 50 caracteres.' });
    const [result] = await pool.query(
      `UPDATE Curso SET Nombre = ?, Codigo = ?, Descripcion = ?, UniversidadObjetivo = ?
       WHERE IdCurso = ? AND EstadoRegistro = 1`,
      [nombre, codigo, descripcion, universidad, idCurso],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Curso no encontrado o inactivo.' });
    res.json({ message: 'Curso actualizado correctamente.', idCurso });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un curso con ese cÃ³digo.' });
    console.error('PUT /api/cursos/:id:', error);
    res.status(500).json({ error: 'No se pudo actualizar el curso.' });
  }
});

router.delete('/cursos/:id', requiereRol('Administrador'), async (req, res) => {
  const idCurso = idPositivo(req.params.id);
  if (!idCurso) return res.status(400).json({ error: 'El identificador del curso no es vÃ¡lido.' });
  try {
    // Curso es un catálogo compartido: no tiene IdAcademia, pero sí puede estar
    // vinculado a ciclos de varias academias. Se bloquean las relaciones activas.

    const [relaciones] = await pool.query(`SELECT IdCurso FROM CicloCurso WHERE IdCurso = ? AND EstadoRegistro = 1
      UNION ALL SELECT IdCurso FROM HorarioCurso WHERE IdCurso = ? AND EstadoRegistro = 1
      UNION ALL SELECT IdCurso FROM Asignacion_Aula WHERE IdCurso = ? AND EstadoRegistro = 1
      UNION ALL SELECT IdCurso FROM MaterialAcademico WHERE IdCurso = ? AND EstadoRegistro = 1
      UNION ALL SELECT IdCurso FROM Matricula WHERE IdCurso = ? AND EstadoRegistro = 1 LIMIT 1`, [idCurso, idCurso, idCurso, idCurso, idCurso]);
    if (relaciones.length) return res.status(409).json({ error: 'El curso tiene relaciones académicas activas; desvincúlalas antes de darlo de baja.' });
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
       INNER JOIN CicloCurso cc ON cc.IdCiclo = aa.IdCiclo AND cc.IdCurso = aa.IdCurso
       WHERE aa.IdAcademia = ? AND aa.EstadoRegistro = 1
         AND u.IdAcademia = aa.IdAcademia AND a.IdAcademia = aa.IdAcademia
         AND c.IdAcademia = aa.IdAcademia AND cc.EstadoRegistro = 1
         AND (? = 1 OR aa.IdUsuario = ?)
         AND u.EstadoRegistro = 1 AND a.EstadoRegistro = 1
         AND cu.EstadoRegistro = 1 AND c.EstadoRegistro = 1
       ORDER BY c.Nombre, a.Nombre, cu.Nombre, docente`,
      [idAcademia, esAdministrativo(req.usuario.rol) ? 1 : 0, req.usuario.id],
    );
    res.json(rows);
  } catch (error) {
    console.error('GET /api/asignaciones:', error);
    res.status(500).json({ error: 'No se pudieron consultar las asignaciones.' });
  }
});

router.post('/asignaciones', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idUsuario = idPositivo(req.body?.idUsuario ?? req.body?.IdUsuario);
  const idCiclo = idPositivo(req.body?.idCiclo ?? req.body?.IdCiclo);
  const idCurso = idPositivo(req.body?.idCurso ?? req.body?.IdCurso);
  const idAulaSolicitada = idPositivo(req.body?.idAula ?? req.body?.IdAula);
  const aulaRaw = req.body?.idAula ?? req.body?.IdAula;
  if (aulaRaw != null && aulaRaw !== '' && !idAulaSolicitada) return res.status(400).json({ error: 'El aula indicada no es válida.' });
  let idAula = idAulaSolicitada;
  const horas = Number(req.body?.horas ?? req.body?.Horas ?? 4);
  if (!idUsuario || !idCiclo || !idCurso) {
    return res.status(400).json({ error: 'Selecciona un docente/tutor, ciclo y curso vÃ¡lidos.' });
  }
  if (!Number.isInteger(horas) || horas < 1 || horas > 30) return res.status(400).json({ error: 'Las horas semanales deben estar entre 1 y 30.' });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[docente]] = await connection.query(
      `SELECT u.IdUsuario
       FROM Usuario u
       INNER JOIN Usuario_Perfiles up ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
       INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
       WHERE u.IdUsuario = ? AND u.IdAcademia = ? AND u.EstadoRegistro = 1
         AND LOWER(TRIM(p.Nombre)) IN ('docente', 'tutor de aula')
       LIMIT 1`,
      [idUsuario, idAcademia],
    );
    if (!docente) {
      await connection.rollback();
      return res.status(400).json({ error: 'El usuario seleccionado no es un docente/tutor activo de esta academia.' });
    }
    const [[ciclo]] = await connection.query(
      'SELECT IdCiclo, Nombre FROM Ciclo WHERE IdCiclo = ? AND IdAcademia = ? AND EstadoRegistro = 1 LIMIT 1 FOR UPDATE',
      [idCiclo, idAcademia],
    );
    const [[curso]] = await connection.query(
      'SELECT IdCurso FROM Curso WHERE IdCurso = ? AND EstadoRegistro = 1 LIMIT 1 FOR UPDATE',
      [idCurso],
    );
    if (!ciclo || !curso) {
      await connection.rollback();
      return res.status(400).json({ error: 'El ciclo o el curso no existe, estÃ¡ inactivo o no pertenece a esta academia.' });
    }
    const [[cicloCurso]] = await connection.query(
      'SELECT IdCiclo FROM CicloCurso WHERE IdCiclo = ? AND IdCurso = ? AND EstadoRegistro = 1 LIMIT 1 FOR UPDATE',
      [idCiclo, idCurso],
    );
    if (!cicloCurso) {
      await connection.rollback();
      return res.status(400).json({ error: 'El curso seleccionado no pertenece al ciclo indicado.' });
    }

    // Aula interna de compatibilidad. En pantalla la organización es por ciclo,
    // pero Asignacion_Aula conserva IdAula como campo obligatorio.
    if (!idAula) {
      const nombreAulaInterna = `Ciclo ${idCiclo}`;
      const [[aulaExistente]] = await connection.query(
        'SELECT IdAula, EstadoRegistro FROM Aula WHERE IdAcademia = ? AND Nombre = ? LIMIT 1',
        [idAcademia, nombreAulaInterna],
      );
      if (aulaExistente) {
        idAula = Number(aulaExistente.IdAula);
        if (Number(aulaExistente.EstadoRegistro) !== 1) {
          await connection.query('UPDATE Aula SET EstadoRegistro = 1, Nivel = ?, Capacidad = 100 WHERE IdAula = ? AND IdAcademia = ?', ['Preuniversitario', idAula, idAcademia]);
        }
      } else {
        const [aulaCreada] = await connection.query(
          `INSERT INTO Aula (IdAcademia, Nombre, Nivel, Capacidad, EstadoRegistro)
           VALUES (?, ?, 'Preuniversitario', 100, 1)`,
          [idAcademia, nombreAulaInterna],
        );
        idAula = aulaCreada.insertId;
      }
    } else {
      const [[aulaSolicitada]] = await connection.query(
        'SELECT IdAula FROM Aula WHERE IdAula = ? AND IdAcademia = ? AND EstadoRegistro = 1 LIMIT 1',
        [idAula, idAcademia],
      );
      if (!aulaSolicitada) {
        await connection.rollback();
        return res.status(400).json({ error: 'El aula seleccionada no existe o estÃ¡ inactiva.' });
      }
    }
    const [duplicados] = await connection.query(
      `SELECT IdAsignacion FROM Asignacion_Aula
       WHERE IdAcademia = ? AND IdUsuario = ? AND IdCiclo = ? AND IdCurso = ? AND IdAula = ? AND EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [idAcademia, idUsuario, idCiclo, idCurso, idAula],
    );
    if (duplicados.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'Esta asignaciÃ³n ya existe.' });
    }
    const [result] = await connection.query(
      `INSERT INTO Asignacion_Aula (IdUsuario, IdCiclo, IdAcademia, IdAula, IdCurso, Horas, EstadoRegistro)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [idUsuario, idCiclo, idAcademia, idAula, idCurso, horas],
    );
    await connection.commit();
    res.status(201).json({ message: 'AsignaciÃ³n creada correctamente.', idAsignacion: result.insertId });
  } catch (error) {
    await rollbackSeguro(connection);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Esta asignación ya existe.' });
    }
    console.error('POST /api/asignaciones:', error);
    res.status(500).json({ error: 'No se pudo crear la asignación.' });
  } finally {
    if (connection) connection.release();
  }
});

router.delete('/asignaciones/:id', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idAsignacion = idPositivo(req.params.id);
  if (!idAsignacion) return res.status(400).json({ error: 'El identificador de la asignaciÃ³n no es vÃ¡lido.' });
  try {
    const [result] = await pool.query(
      'UPDATE Asignacion_Aula SET EstadoRegistro = 0 WHERE IdAsignacion = ? AND IdAcademia = ? AND EstadoRegistro = 1',
      [idAsignacion, idAcademia],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'AsignaciÃ³n no encontrada o ya desactivada.' });
    res.json({ message: 'AsignaciÃ³n desactivada correctamente.' });
  } catch (error) {
    console.error('DELETE /api/asignaciones/:id:', error);
    res.status(500).json({ error: 'No se pudo desactivar la asignaciÃ³n.' });
  }
});


// ============================================================
// HORARIOS / TURNOS
// ============================================================
router.get('/horarios', requiereRol(...ROLES_GESTION), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idCiclo = req.query.idCiclo ? idPositivo(req.query.idCiclo) : null;
  if (req.query.idCiclo && !idCiclo) return res.status(400).json({ error: 'El identificador del ciclo no es válido.' });
  try {
    const params = [idAcademia];
    let filtroCiclo = '';
    if (idCiclo) {
      filtroCiclo = ' AND h.IdCiclo = ?';
      params.push(idCiclo);
    }
    const [rows] = await pool.query(
      `SELECT h.IdHorario AS idHorario, h.IdCiclo AS idCiclo, h.IdCurso AS idCurso,
              h.DiaNumero AS diaNumero, h.DiaSemana AS diaSemana,
              TIME_FORMAT(h.HoraInicio, '%H:%i') AS horaInicio,
              TIME_FORMAT(h.HoraFin, '%H:%i') AS horaFin,
              h.Orden AS orden, h.EstadoRegistro AS estadoRegistro,
              c.Nombre AS ciclo, cu.Nombre AS curso
       FROM HorarioCurso h
       INNER JOIN Ciclo c ON c.IdCiclo = h.IdCiclo
       INNER JOIN Curso cu ON cu.IdCurso = h.IdCurso
       WHERE c.IdAcademia = ? AND h.EstadoRegistro = 1
         AND c.EstadoRegistro = 1 AND cu.EstadoRegistro = 1${filtroCiclo}
       ORDER BY h.IdCiclo, h.DiaNumero, h.Orden, h.HoraInicio`,
      params,
    );
    res.json(rows);
  } catch (error) {
    console.error('GET /api/horarios:', error);
    res.status(500).json({ error: 'No se pudieron consultar los horarios.' });
  }
});

async function guardarHorario(req, res, editar = false) {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idHorario = editar ? idPositivo(req.params.id) : 0;
  if (editar && !idHorario) return res.status(400).json({ error: 'El identificador del horario no es válido.' });
  const idCiclo = idPositivo(req.body?.idCiclo ?? req.body?.IdCiclo);
  const idCurso = idPositivo(req.body?.idCurso ?? req.body?.IdCurso);
  const diaNumero = Number(req.body?.diaNumero ?? req.body?.DiaNumero);
  const diaSemana = normalizarTexto(req.body?.diaSemana ?? req.body?.DiaSemana, 20);
  const horaInicio = horaValida(req.body?.horaInicio ?? req.body?.HoraInicio);
  const horaFin = horaValida(req.body?.horaFin ?? req.body?.HoraFin);
  const orden = Number(req.body?.orden ?? req.body?.Orden ?? 1);
  if (!idCiclo || !idCurso) return res.status(400).json({ error: 'Selecciona un ciclo y curso válidos.' });
  if (!Number.isInteger(diaNumero) || diaNumero < 1 || diaNumero > 7) return res.status(400).json({ error: 'El día debe estar entre 1 y 7.' });
  if (!diaSemana) return res.status(400).json({ error: 'Indica el nombre del día.' });
  if (!horaInicio || horaInicio === undefined || !horaFin || horaFin === undefined) return res.status(400).json({ error: 'Las horas deben tener formato HH:mm.' });
  const inicio = horaInicio.length === 5 ? `${horaInicio}:00` : horaInicio;
  const fin = horaFin.length === 5 ? `${horaFin}:00` : horaFin;
  if (inicio >= fin) return res.status(400).json({ error: 'La hora de inicio debe ser anterior a la hora de fin.' });
  if (!Number.isInteger(orden) || orden < 1 || orden > 100) return res.status(400).json({ error: 'El orden debe ser un entero entre 1 y 100.' });
  const dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const normalizarDia = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (normalizarDia(diaSemana) !== normalizarDia(dias[diaNumero - 1])) return res.status(400).json({ error: 'El nombre del día no coincide con DiaNumero.' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    // Serializa también cambios de ciclo para que dos altas concurrentes no se solapen.
    await connection.query('SELECT IdAcademia FROM Academia WHERE IdAcademia = ? FOR UPDATE', [idAcademia]);
    const [[ciclo]] = await connection.query(
      'SELECT IdCiclo FROM Ciclo WHERE IdCiclo = ? AND IdAcademia = ? AND EstadoRegistro = 1 LIMIT 1 FOR UPDATE',
      [idCiclo, idAcademia],
    );
    const [[curso]] = await connection.query(
      `SELECT cu.IdCurso FROM Curso cu INNER JOIN CicloCurso cc ON cc.IdCurso = cu.IdCurso
       WHERE cu.IdCurso = ? AND cc.IdCiclo = ? AND cu.EstadoRegistro = 1 AND cc.EstadoRegistro = 1 LIMIT 1 FOR UPDATE`,
      [idCurso, idCiclo],
    );
    if (!ciclo || !curso) {
      await connection.rollback();
      return res.status(400).json({ error: 'El ciclo no pertenece a tu academia o el curso no está activo y vinculado mediante CicloCurso.' });
    }
    if (editar) {
      const [[actual]] = await connection.query(
        `SELECT h.IdHorario FROM HorarioCurso h INNER JOIN Ciclo c ON c.IdCiclo = h.IdCiclo
         WHERE h.IdHorario = ? AND c.IdAcademia = ? AND h.EstadoRegistro = 1 FOR UPDATE`, [idHorario, idAcademia],
      );
      if (!actual) { await connection.rollback(); return res.status(404).json({ error: 'Horario no encontrado en esta academia.' }); }
    }
    const [solapados] = await connection.query(
      `SELECT IdHorario FROM HorarioCurso WHERE IdCiclo = ? AND DiaNumero = ? AND EstadoRegistro = 1
       AND IdHorario <> ? AND HoraInicio < ? AND HoraFin > ? LIMIT 1 FOR UPDATE`,
      [idCiclo, diaNumero, idHorario, fin, inicio],
    );
    if (solapados.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'El horario se solapa con otro del mismo ciclo y día.' });
    }
    let result;
    if (editar) {
      [result] = await connection.query(
        `UPDATE HorarioCurso SET IdCiclo = ?, IdCurso = ?, DiaNumero = ?, DiaSemana = ?, HoraInicio = ?, HoraFin = ?, Orden = ?
         WHERE IdHorario = ? AND EstadoRegistro = 1`,
        [idCiclo, idCurso, diaNumero, dias[diaNumero - 1], inicio, fin, orden, idHorario],
      );
    } else {
      [result] = await connection.query(
      `INSERT INTO HorarioCurso
          (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [idCiclo, idCurso, diaNumero, dias[diaNumero - 1], inicio, fin, orden],
    );
    }
    await connection.commit();
    res.status(editar ? 200 : 201).json({ message: editar ? 'Horario actualizado correctamente.' : 'Horario creado correctamente.', idHorario: editar ? idHorario : result.insertId });
  } catch (error) {
    await rollbackSeguro(connection);
    console.error('Guardar horario:', error);
    res.status(500).json({ error: 'No se pudo guardar el horario.' });
  } finally {
    if (connection) connection.release();
  }
}
router.post('/horarios', requiereRol('Administrador'), (req, res) => guardarHorario(req, res));

router.put('/horarios/:id', requiereRol('Administrador'), (req, res) => guardarHorario(req, res, true));

router.delete('/horarios/:id', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idHorario = idPositivo(req.params.id);
  if (!idHorario) return res.status(400).json({ error: 'El identificador del horario no es válido.' });
  try {
    const [result] = await pool.query(
      `UPDATE HorarioCurso h
       INNER JOIN Ciclo c ON c.IdCiclo = h.IdCiclo
       SET h.EstadoRegistro = 0
       WHERE h.IdHorario = ? AND c.IdAcademia = ? AND h.EstadoRegistro = 1`,
      [idHorario, idAcademia],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Horario no encontrado o ya desactivado.' });
    res.json({ message: 'Horario desactivado correctamente.' });
  } catch (error) {
    console.error('DELETE /api/horarios/:id:', error);
    res.status(500).json({ error: 'No se pudo desactivar el horario.' });
  }
});

// ============================================================
// ASISTENCIAS POR CICLO: flujo de Morgan conservado por decision del usuario.
// Mantiene compatibilidad con idAula y los permisos actuales de ROLES_GESTION.
// ============================================================
router.get('/asistencias', requiereRol(...ROLES_GESTION), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idAula = idPositivo(req.query.idAula);
  const idCiclo = idPositivo(req.query.idCiclo);
  const fecha = String(req.query.fecha ?? '');
  if ((!idAula && !idCiclo) || !fechaISOValida(fecha)) {
    return res.status(400).json({ error: 'Debes indicar idCiclo (recomendado) o idAula y una fecha YYYY-MM-DD.' });
  }
  try {
    if (idAula) {
      const [[aula]] = await pool.query(
        'SELECT IdAula FROM Aula WHERE IdAula = ? AND IdAcademia = ? AND EstadoRegistro = 1 LIMIT 1',
        [idAula, idAcademia],
      );
      if (!aula) return res.status(404).json({ error: 'Aula no encontrada en esta academia.' });
    }
    if (idCiclo) {
      const [[ciclo]] = await pool.query(
        'SELECT IdCiclo FROM Ciclo WHERE IdCiclo = ? AND IdAcademia = ? AND EstadoRegistro = 1 LIMIT 1',
        [idCiclo, idAcademia],
      );
      if (!ciclo) return res.status(404).json({ error: 'Ciclo no encontrado o inactivo.' });
    }

    const filtros = ['m.EstadoRegistro = 1', 'u.EstadoRegistro = 1', 'u.IdAcademia = ?', 'c.EstadoRegistro = 1'];
    const params = [fecha, fecha, idAcademia];
    if (idCiclo) { filtros.push('m.IdCiclo = ?'); params.push(idCiclo); }
    if (idAula) {
      filtros.push(`EXISTS (SELECT 1 FROM Asignacion_Aula aa
        WHERE aa.IdCiclo = m.IdCiclo AND aa.IdAula = ? AND aa.IdAcademia = ?
          AND aa.EstadoRegistro = 1 AND (aa.IdCurso IS NULL OR m.IdCurso IS NULL OR m.IdCurso = aa.IdCurso))`);
      params.push(idAula, idAcademia);
    }

    const [rows] = await pool.query(`
      SELECT
        m.IdMatricula AS idMatricula,
        m.IdMatricula AS idAlumno,
        u.IdUsuario AS idUsuario,
        CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, NULLIF(u.ApellidoMaterno, '')) AS nombre,
        COALESCE((SELECT DATE_FORMAT(ast.HoraLlegada, '%H:%i')
                  FROM Asistencia ast
                  WHERE ast.IdMatricula = m.IdMatricula AND ast.Fecha = ? AND ast.EstadoRegistro = 1
                  ORDER BY ast.IdAsistencia DESC LIMIT 1), '--') AS horaLlegada,
        COALESCE((SELECT ast.Estado
                  FROM Asistencia ast
                  WHERE ast.IdMatricula = m.IdMatricula AND ast.Fecha = ? AND ast.EstadoRegistro = 1
                  ORDER BY ast.IdAsistencia DESC LIMIT 1), 'pendiente') AS estado
      FROM Matricula m
      INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
      INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo AND c.IdAcademia = u.IdAcademia
      WHERE ${filtros.join(' AND ')}
      ORDER BY nombre ASC
    `, params);
    res.json(rows);
  } catch (error) {
    console.error('GET /api/asistencias:', error);
    res.status(500).json({ error: 'No se pudo consultar la asistencia.' });
  }
});

router.post('/asistencias', requiereRol(...ROLES_GESTION), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idAulaSolicitada = idPositivo(req.body?.idAula);
  const idCiclo = idPositivo(req.body?.idCiclo);
  const fecha = String(req.body?.fecha ?? '');
  const lista = req.body?.listaAlumnos;
  if ((!idAulaSolicitada && !idCiclo) || !fechaISOValida(fecha) || !Array.isArray(lista) || lista.length === 0) {
    return res.status(400).json({ error: 'Envía un ciclo (o aula para compatibilidad), fecha YYYY-MM-DD y lista de alumnos.' });
  }
  if (lista.length > 500) return res.status(413).json({ error: 'La lista de asistencia supera el límite técnico de 500 registros.' });

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

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    let idAula = idAulaSolicitada;
    if (idCiclo) {
      const [[ciclo]] = await connection.query(
        'SELECT IdCiclo, Nombre FROM Ciclo WHERE IdCiclo = ? AND IdAcademia = ? AND EstadoRegistro = 1 LIMIT 1 FOR UPDATE',
        [idCiclo, idAcademia],
      );
      if (!ciclo) {
        await connection.rollback();
        return res.status(404).json({ error: 'Ciclo no encontrado o inactivo.' });
      }
      // The old schema requires Asistencia.IdAula. Create/reuse a hidden
      // compatibility row per cycle; attendance selection remains by IdCiclo.
      const nombreAulaInterna = `Ciclo ${idCiclo}`;
      const [[aulaExistente]] = await connection.query(
        'SELECT IdAula, EstadoRegistro FROM Aula WHERE IdAcademia = ? AND Nombre = ? LIMIT 1 FOR UPDATE',
        [idAcademia, nombreAulaInterna],
      );
      if (aulaExistente) {
        idAula = Number(aulaExistente.IdAula);
        if (Number(aulaExistente.EstadoRegistro) !== 1) {
          await connection.query(
            'UPDATE Aula SET EstadoRegistro = 1, Nivel = ?, Capacidad = 100 WHERE IdAula = ? AND IdAcademia = ?',
            ['Preuniversitario', idAula, idAcademia],
          );
        }
      } else {
        const [aulaCreada] = await connection.query(
          `INSERT INTO Aula (IdAcademia, Nombre, Nivel, Capacidad, EstadoRegistro)
           VALUES (?, ?, 'Preuniversitario', 100, 1)`,
          [idAcademia, nombreAulaInterna],
        );
        idAula = Number(aulaCreada.insertId);
      }
    }

    const [[aula]] = await connection.query(
      'SELECT IdAula FROM Aula WHERE IdAula = ? AND IdAcademia = ? AND EstadoRegistro = 1 LIMIT 1',
      [idAula, idAcademia],
    );
    if (!aula) {
      await connection.rollback();
      return res.status(404).json({ error: 'No existe un aula operativa asociada a este registro de asistencia.' });
    }

    const placeholders = registros.map(() => '?').join(',');
    const parametrosMatriculas = [idAcademia, ...(idCiclo ? [idCiclo] : []), ...registros.map((r) => r.idMatricula)];
    const whereCiclo = idCiclo ? 'AND m.IdCiclo = ?' : '';
    const whereAula = !idCiclo && idAulaSolicitada ? `AND EXISTS (SELECT 1 FROM Asignacion_Aula aa
      WHERE aa.IdCiclo = m.IdCiclo AND aa.IdAula = ? AND aa.IdAcademia = u.IdAcademia
        AND aa.EstadoRegistro = 1 AND (aa.IdCurso IS NULL OR m.IdCurso IS NULL OR m.IdCurso = aa.IdCurso))` : '';
    if (whereAula) parametrosMatriculas.push(idAulaSolicitada);
    const [permitidas] = await connection.query(
      `SELECT DISTINCT m.IdMatricula
       FROM Matricula m
       INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
       INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo AND c.IdAcademia = u.IdAcademia
       WHERE u.IdAcademia = ? AND u.EstadoRegistro = 1 AND m.EstadoRegistro = 1
         AND c.EstadoRegistro = 1 ${whereCiclo}
          AND m.IdMatricula IN (${placeholders}) ${whereAula}`,
      parametrosMatriculas,
    );
    const permitidasSet = new Set(permitidas.map((r) => Number(r.IdMatricula)));
    if (permitidasSet.size !== registros.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'Una o más matrículas no pertenecen al ciclo seleccionado o a esta academia.' });
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
    res.json({ message: 'Asistencia del ciclo guardada correctamente.', registrosGuardados: registros.length, idCiclo: idCiclo || null });
  } catch (error) {
    await rollbackSeguro(connection);
    console.error('POST /api/asistencias:', error);
    res.status(500).json({ error: 'No se pudo guardar la asistencia.' });
  } finally {
    if (connection) connection.release();
  }
});
module.exports = router;


