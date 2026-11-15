const express = require('express');
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');
const { esAdministrativo } = requiereRol;
const { rollbackSeguro, idPositivo } = require('../utils/validaciones');
const { consultarCobertura } = require('../utils/cobertura-docente');
const { conflictoAsignacion, conflictoHorario } = require('../utils/conflictos-docentes');
const { consultar, ejecutar } = require('../config/procedimientos');

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
    const [rows] = await consultar(pool, 'sp_academico_listar_aula_todos', [idAcademia]);
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
    const [existentes] = await consultar(pool, 'sp_academico_listar_aula_por_nombre', [idAcademia, nombre]);

    if (existentes.length > 0) {
        const aula = existentes[0];
        if (aula.EstadoRegistro === 0) {
            // ReactivaciÃ³n si estaba dada de baja
            await ejecutar(pool, 'sp_academico_reactivar_aula', [nivel, capacidad, aula.IdAula]);
            return res.status(200).json({ message: 'Aula reactivada y actualizada correctamente.', idAula: aula.IdAula });
        } else {
            // Si estÃ¡ activa, bloqueamos
            return res.status(409).json({ error: 'Ya existe un aula activa con ese nombre en esta academia.' });
        }
    }

    // 2. CreaciÃ³n normal si no existÃ­a
    const [result] = await ejecutar(pool, 'sp_academico_registrar_aula', [idAcademia, nombre, nivel, capacidad]);
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
    const [duplicados] = await consultar(pool, 'sp_academico_buscar_aula_duplicada', [idAcademia, nombre, idAula]);
    if (duplicados.length) return res.status(409).json({ error: 'Ya existe un aula activa con ese nombre.' });
    const [result] = await ejecutar(pool, 'sp_academico_actualizar_aula', [nombre, nivel, capacidad, idAula, idAcademia]);
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
    const [relaciones] = await consultar(pool, 'sp_academico_obtener_asignacion', [idAula, idAcademia]);
    if (relaciones.length) return res.status(409).json({ error: 'El aula tiene asignaciones o asistencias vigentes; no se puede desactivar.' });
    const [result] = await ejecutar(pool, 'sp_academico_desactivar_aula', [idAula, idAcademia]);
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
    const [rows] = await consultar(pool, 'sp_academico_listar_curso_todos', []);
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
    const [existentes] = await consultar(pool, 'sp_academico_listar_curso_por_codigo', [codigo]);

    if (existentes.length > 0) {
        const curso = existentes[0];
        if (curso.EstadoRegistro === 0) {
            // ReactivaciÃ³n si estaba dado de baja
            await ejecutar(pool, 'sp_academico_reactivar_curso', [nombre, descripcion, universidad, curso.IdCurso]);
            return res.status(200).json({ message: 'Curso reactivado y actualizado correctamente.', idCurso: curso.IdCurso });
        } else {
            // Bloqueo de duplicado activo
            return res.status(409).json({ error: 'Ya existe un curso activo con ese cÃ³digo.' });
        }
    }

    // 2. CreaciÃ³n normal si no existÃ­a
    const [result] = await ejecutar(pool, 'sp_academico_registrar_curso', [nombre, codigo, descripcion, universidad]);
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
    const [[cursoExistente]] = await consultar(pool, 'sp_academico_obtener_curso_por_id_curso', [idCurso]);
    if (!cursoExistente) return res.status(404).json({ error: 'Curso no encontrado o inactivo.' });
    const [duplicados] = await consultar(pool, 'sp_academico_obtener_curso_por_codigo', [codigo, idCurso]);
    if (duplicados.length) return res.status(409).json({ error: 'Ya existe un curso activo con ese código.' });
    const universidad = normalizarTexto(universidadSolicitada ?? cursoExistente.UniversidadObjetivo ?? 'Preuniversitario', 50);
    if (!universidad) return res.status(400).json({ error: 'La universidad objetivo debe ser texto de hasta 50 caracteres.' });
    const [result] = await ejecutar(pool, 'sp_academico_actualizar_curso', [nombre, codigo, descripcion, universidad, idCurso]);
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

    const [relaciones] = await consultar(pool, 'sp_academico_obtener_ciclo_curso', [idCurso]);
    if (relaciones.length) return res.status(409).json({ error: 'El curso tiene relaciones académicas activas; desvincúlalas antes de darlo de baja.' });
    const [result] = await ejecutar(pool, 'sp_academico_desactivar_curso', [idCurso]);
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
    const [rows] = await consultar(pool, 'sp_academico_listar_asignacion', [idAcademia, esAdministrativo(req.usuario.rol) ? 1 : 0, req.usuario.id]);
    res.json(rows);
  } catch (error) {
    console.error('GET /api/asignaciones:', error);
    res.status(500).json({ error: 'No se pudieron consultar las asignaciones.' });
  }
});

router.get('/ciclos/:id/cobertura', requiereRol('Administrador'), async (req, res) => {
  const idAcademia = academiaDelUsuario(req, res);
  if (!idAcademia) return;
  const idCiclo = idPositivo(req.params.id);
  if (!idCiclo) return res.status(400).json({ error: 'El ciclo no es válido.' });
  try {
    const [[ciclo]] = await consultar(pool, 'sp_academico_listar_ciclo', [idCiclo, idAcademia]);
    if (!ciclo) return res.status(404).json({ error: 'Ciclo no encontrado.' });
    res.json({ idCiclo, ...await consultarCobertura(pool, idAcademia, idCiclo) });
  } catch (error) {
    console.error('GET cobertura:', error);
    res.status(500).json({ error: 'No se pudo consultar la cobertura docente.' });
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
    await consultar(connection, 'sp_academico_bloquear_academia', [idAcademia]);
    const [[docente]] = await consultar(connection, 'sp_academico_obtener_usuario', [idUsuario, idAcademia]);
    if (!docente) {
      await connection.rollback();
      return res.status(400).json({ error: 'El usuario seleccionado no es un docente/tutor activo de esta academia.' });
    }
    const [[ciclo]] = await consultar(connection, 'sp_academico_bloquear_ciclo_nombre', [idCiclo, idAcademia]);
    const [[curso]] = await consultar(connection, 'sp_academico_bloquear_curso_por_id_curso', [idCurso]);
    if (!ciclo || !curso) {
      await connection.rollback();
      return res.status(400).json({ error: 'El ciclo o el curso no existe, estÃ¡ inactivo o no pertenece a esta academia.' });
    }
    const [[cicloCurso]] = await consultar(connection, 'sp_academico_bloquear_ciclo_curso', [idCiclo, idCurso]);
    if (!cicloCurso) {
      await connection.rollback();
      return res.status(400).json({ error: 'El curso seleccionado no pertenece al ciclo indicado.' });
    }

    if (await conflictoAsignacion(connection, idAcademia, idUsuario, idCiclo, idCurso, idAulaSolicitada)) {
      await connection.rollback();
      return res.status(409).json({ code: 'CONFLICTO_HORARIO_ASIGNACION', error: 'El docente o el aula ya tiene una clase en ese horario.' });
    }

    // Aula interna de compatibilidad. En pantalla la organización es por ciclo,
    // pero Asignacion_Aula conserva IdAula como campo obligatorio.
    if (!idAula) {
      const nombreAulaInterna = `Ciclo ${idCiclo}`;
      const [[aulaExistente]] = await consultar(connection, 'sp_academico_obtener_aula_por_nombre', [idAcademia, nombreAulaInterna]);
      if (aulaExistente) {
        idAula = Number(aulaExistente.IdAula);
        if (Number(aulaExistente.EstadoRegistro) !== 1) {
          await ejecutar(connection, 'sp_academico_reactivar_aula_preuniversitaria', ['Preuniversitario', idAula, idAcademia]);
        }
      } else {
        const [aulaCreada] = await ejecutar(connection, 'sp_academico_registrar_aula_preuniversitaria', [idAcademia, nombreAulaInterna]);
        idAula = aulaCreada.insertId;
      }
    } else {
      const [[aulaSolicitada]] = await consultar(connection, 'sp_academico_obtener_aula_por_id_aula', [idAula, idAcademia]);
      if (!aulaSolicitada) {
        await connection.rollback();
        return res.status(400).json({ error: 'El aula seleccionada no existe o estÃ¡ inactiva.' });
      }
    }
    const [duplicados] = await consultar(connection, 'sp_academico_bloquear_asignacion_por_id_usuario', [idAcademia, idUsuario, idCiclo, idCurso, idAula]);
    if (duplicados.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'Esta asignaciÃ³n ya existe.' });
    }
    const [result] = await ejecutar(connection, 'sp_academico_registrar_asignacion', [idUsuario, idCiclo, idAcademia, idAula, idCurso, horas]);
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
    const [result] = await ejecutar(pool, 'sp_academico_desactivar_asignacion', [idAsignacion, idAcademia]);
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
    const [rows] = await consultar(pool, 'sp_academico_listar_horarios', [idAcademia, idCiclo || null]);
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
    await consultar(connection, 'sp_academico_bloquear_academia', [idAcademia]);
    const [[ciclo]] = await consultar(connection, 'sp_academico_bloquear_ciclo_universidad', [idCiclo, idAcademia]);
    const [[curso]] = await consultar(connection, 'sp_academico_bloquear_curso_por_id_curso_y_id_ciclo', [idCurso, idCiclo]);
    if (!ciclo || !curso) {
      await connection.rollback();
      return res.status(400).json({ error: 'El ciclo no pertenece a tu academia o el curso no está activo y vinculado mediante CicloCurso.' });
    }
    // La universidad del curso debe coincidir con la del ciclo (campo
    // estructurado UniversidadObjetivo de cada tabla; los prefijos de código
    // NUNCA se usan como fuente de verdad). Mismo criterio que el guardado de
    // ciclos (admin-ciclos.routes.js): mensaje 400 sin modificar relaciones.
    const universidadCiclo = String(ciclo.UniversidadObjetivo ?? '').trim();
    const universidadCurso = String(curso.CursoUniversidad ?? '').trim();
    if (universidadCiclo.toLowerCase() !== universidadCurso.toLowerCase()) {
      await connection.rollback();
      return res.status(400).json({
        error: universidadCurso
          ? `El curso pertenece a ${universidadCurso} y el ciclo a ${universidadCiclo}: un horario no puede mezclar universidades.`
          : 'El curso no tiene universidad objetivo asignada: asígnala en Cursos Académicos antes de crear su horario.'
      });
    }
    if (editar) {
      const [[actual]] = await consultar(connection, 'sp_academico_bloquear_horario_por_id_horario', [idHorario, idAcademia]);
      if (!actual) { await connection.rollback(); return res.status(404).json({ error: 'Horario no encontrado en esta academia.' }); }
    }
    const [solapados] = await consultar(connection, 'sp_academico_bloquear_horario_por_id_ciclo', [idCiclo, diaNumero, idHorario, fin, inicio]);
    if (solapados.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'El horario se solapa con otro del mismo ciclo y día.' });
    }
    if (await conflictoHorario(connection, idAcademia, idCiclo, idCurso, idHorario, diaNumero, inicio, fin)) {
      await connection.rollback();
      return res.status(409).json({ code: 'CONFLICTO_HORARIO_ASIGNACION', error: 'Un docente o aula del curso ya tiene una clase en ese horario.' });
    }
    let result;
    if (editar) {
      [result] = await ejecutar(connection, 'sp_academico_actualizar_horario', [
          idCiclo,
          idCurso,
          diaNumero,
          dias[diaNumero - 1],
          inicio,
          fin,
          orden,
          idHorario,
        ]);
    } else {
      [result] = await ejecutar(connection, 'sp_academico_registrar_horario', [idCiclo, idCurso, diaNumero, dias[diaNumero - 1], inicio, fin, orden]);
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
    const [result] = await ejecutar(pool, 'sp_academico_desactivar_horario', [idHorario, idAcademia]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Horario no encontrado o ya desactivado.' });
    res.json({ message: 'Horario desactivado correctamente.' });
  } catch (error) {
    console.error('DELETE /api/horarios/:id:', error);
    res.status(500).json({ error: 'No se pudo desactivar el horario.' });
  }
});

// ============================================================
// ASISTENCIAS POR CICLO
// Mantiene compatibilidad con idAula y los permisos de ROLES_GESTION.
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
      const [[aula]] = await consultar(pool, 'sp_academico_obtener_aula_por_id_aula', [idAula, idAcademia]);
      if (!aula) return res.status(404).json({ error: 'Aula no encontrada en esta academia.' });
    }
    if (idCiclo) {
      const [[ciclo]] = await consultar(pool, 'sp_academico_obtener_ciclo', [idCiclo, idAcademia]);
      if (!ciclo) return res.status(404).json({ error: 'Ciclo no encontrado o inactivo.' });
    }

    const [rows] = await consultar(pool, 'sp_academico_listar_asistencia', [fecha, idAcademia, idCiclo || null, idAula || null]);
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
      const [[ciclo]] = await consultar(connection, 'sp_academico_bloquear_ciclo_nombre', [idCiclo, idAcademia]);
      if (!ciclo) {
        await connection.rollback();
        return res.status(404).json({ error: 'Ciclo no encontrado o inactivo.' });
      }
      // The old schema requires Asistencia.IdAula. Create/reuse a hidden
      // compatibility row per cycle; attendance selection remains by IdCiclo.
      const nombreAulaInterna = `Ciclo ${idCiclo}`;
      const [[aulaExistente]] = await consultar(connection, 'sp_academico_bloquear_aula', [idAcademia, nombreAulaInterna]);
      if (aulaExistente) {
        idAula = Number(aulaExistente.IdAula);
        if (Number(aulaExistente.EstadoRegistro) !== 1) {
          await ejecutar(connection, 'sp_academico_reactivar_aula_preuniversitaria', ['Preuniversitario', idAula, idAcademia]);
        }
      } else {
        const [aulaCreada] = await ejecutar(connection, 'sp_academico_registrar_aula_preuniversitaria', [idAcademia, nombreAulaInterna]);
        idAula = Number(aulaCreada.insertId);
      }
    }

    const [[aula]] = await consultar(connection, 'sp_academico_obtener_aula_por_id_aula', [idAula, idAcademia]);
    if (!aula) {
      await connection.rollback();
      return res.status(404).json({ error: 'No existe un aula operativa asociada a este registro de asistencia.' });
    }

    const [permitidas] = await consultar(connection, 'sp_academico_validar_matriculas_asistencia', [
      idAcademia,
      idCiclo || null,
      idAulaSolicitada || null,
      JSON.stringify(registros.map((r) => r.idMatricula)),
    ]);
    const permitidasSet = new Set(permitidas.map((r) => Number(r.IdMatricula)));
    if (permitidasSet.size !== registros.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'Una o más matrículas no pertenecen al ciclo seleccionado o a esta academia.' });
    }

    const idUsuarioRegistro = idPositivo(req.usuario?.idUsuario ?? req.usuario?.id) || null;
    for (const registro of registros) {
      await ejecutar(connection, 'sp_academico_registrar_asistencia', [
          registro.idMatricula,
          idAula,
          fecha,
          registro.estado,
          registro.hora,
          idUsuarioRegistro,
        ]);
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


