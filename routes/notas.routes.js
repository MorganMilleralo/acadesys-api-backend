
const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const requiereRol = require("../middlewares/roles.middleware");
const verificarPeriodoAbierto = require("../middlewares/cierre.middleware");
const { requiereGestionNotas, autorizarHistorialAlumno } = require("../middlewares/notas-acceso.middleware");

/* ============================================================
   🛡️ MAPA DE ESCALAS POR UNIVERSIDAD OBJETIVO (Backend, no se toca)
   ============================================================ */
const ESCALAS_POR_UNIVERSIDAD = {
  UNMSM: 2000,
  UNI: 2000,
  PUCP: 1000,
  UNFV: 1000,
  UNAC: 100,
  UNT: 300,
  Preuniversitario: 20,
  // Default por si el ciclo no tiene universidad definida
  DEFAULT: 2000,
};

const obtenerMaximoPermitido = (universidad = "") => {
  const key = String(universidad || "").trim();
  return ESCALAS_POR_UNIVERSIDAD[key] ?? ESCALAS_POR_UNIVERSIDAD.DEFAULT;
};

const TIPOS_VALIDOS = ['Practica', 'Evaluacion', 'Examen', 'Simulacro'];

function normalizarTipoEvaluacion(valor) {
  const clave = String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  // Se guardan valores canónicos sin tildes para mantener compatibilidad con
  // datos preexistentes como 'Practica' y 'Participacion'. La interfaz puede
  // seguir mostrando las etiquetas con tildes.
  const tipos = { practica: 'Practica', evaluacion: 'Evaluacion', examen: 'Examen', simulacro: 'Simulacro' };
  return tipos[clave] || null;
}

/* ============================================================
   GET /api/notas - Listado de evaluaciones de la academia
   ============================================================ */
router.get("/", requiereGestionNotas, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.IdEvaluacion, e.IdMatricula, e.TipoEvaluacion, e.Periodo, e.Calificacion, e.FechaCreacion,
              u.CodigoUsuario, CONCAT(u.Nombres, ' ', u.ApellidoPaterno) AS Alumno,
              COALESCE(c.Nombre, 'Simulacro General') AS Curso,
              ci.Nombre AS Ciclo,
              ci.UniversidadObjetivo
       FROM Evaluacion e
       INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
       INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
       LEFT JOIN Curso c ON m.IdCurso = c.IdCurso
       LEFT JOIN Ciclo ci ON m.IdCiclo = ci.IdCiclo
       WHERE e.EstadoRegistro = 1 AND u.IdAcademia = ?`,
      [req.usuario.idAcademia],
    );
    res.json(rows);
  } catch (error) {
    console.error("Error en GET /notas:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* ============================================================
   GET /api/notas/contexto/:idCiclo
   Contexto de calificacion y escala dinamica del ciclo
   ============================================================ */
router.get("/contexto/:idCiclo", requiereGestionNotas, async (req, res) => {
  try {
    const idCiclo = Number(req.params.idCiclo);
    const idAcademia = req.usuario.idAcademia;

    if (!Number.isInteger(idCiclo) || idCiclo <= 0) {
      return res.status(400).json({
        error: "El idCiclo no es valido.",
      });
    }

    const [rows] = await pool.query(
      `SELECT ci.IdCiclo, ci.Nombre, ci.UniversidadObjetivo
       FROM Ciclo ci
       WHERE ci.IdCiclo = ?
         AND ci.IdAcademia = ?
         AND ci.EstadoRegistro = 1
       LIMIT 1`,
      [idCiclo, idAcademia],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "El ciclo indicado no existe, esta inactivo o no pertenece a tu academia.",
      });
    }

    const ciclo = rows[0];
    const universidadObjetivo = ciclo.UniversidadObjetivo || "UNMSM";
    const escalaMaxima = obtenerMaximoPermitido(universidadObjetivo);

    return res.json({
      idCiclo: ciclo.IdCiclo,
      ciclo: ciclo.Nombre,
      universidadObjetivo,
      escalaMinima: 0,
      escalaMaxima,
    });
  } catch (error) {
    console.error("Error en GET /notas/contexto/:idCiclo:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/* ============================================================
   GET /api/notas/matriculas/:idCiclo
   Alumnos matriculados en un ciclo para registro de notas
   ============================================================ */
router.get("/matriculas/:idCiclo", requiereGestionNotas, async (req, res) => {
  try {
    const idCiclo = Number(req.params.idCiclo);
    const idAcademia = req.usuario.idAcademia;

    if (!Number.isInteger(idCiclo) || idCiclo <= 0) {
      return res.status(400).json({ error: "El idCiclo no es valido." });
    }

    const [rows] = await pool.query(
      `SELECT m.IdMatricula, m.IdUsuario, m.IdCiclo,
              u.CodigoUsuario, u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno
       FROM Matricula m
       INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
       INNER JOIN Ciclo ci ON ci.IdCiclo = m.IdCiclo
       WHERE m.IdCiclo = ?
         AND m.EstadoRegistro = 1
         AND u.EstadoRegistro = 1
         AND u.IdAcademia = ?
         AND ci.IdAcademia = ?
         AND ci.EstadoRegistro = 1
       ORDER BY u.ApellidoPaterno, u.ApellidoMaterno, u.Nombres`,
      [idCiclo, idAcademia, idAcademia],
    );

    return res.json(
      rows.map((row) => ({
        idMatricula: row.IdMatricula,
        idUsuario: row.IdUsuario,
        idCiclo: row.IdCiclo,
        codigo: row.CodigoUsuario,
        nombre: [row.Nombres, row.ApellidoPaterno, row.ApellidoMaterno]
          .filter(Boolean)
          .join(" "),
      })),
    );
  } catch (error) {
    console.error("Error en GET /notas/matriculas/:idCiclo:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/* ============================================================
   GET /api/notas/alumno/:id - Historial y promedio individual
   ============================================================ */
router.get("/alumno/:id", autorizarHistorialAlumno, async (req, res) => {
  try {
    const { id } = req.params;

    const [notas] = await pool.query(
      `SELECT COALESCE(c.Nombre, 'Simulacro General') AS Curso,
              e.TipoEvaluacion, e.Periodo, e.Calificacion, e.FechaCreacion,
              ci.UniversidadObjetivo, ci.Nombre AS Ciclo
       FROM Evaluacion e
       INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
       LEFT JOIN Curso c ON m.IdCurso = c.IdCurso
       LEFT JOIN Ciclo ci ON m.IdCiclo = ci.IdCiclo
       INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
       WHERE u.IdUsuario = ? AND u.IdAcademia = ? AND e.EstadoRegistro = 1`,
      [id, req.usuario.idAcademia],
    );

    let promedio = 0;
    if (notas.length > 0) {
      const suma = notas.reduce((acc, n) => acc + Number(n.Calificacion), 0);
      promedio = suma / notas.length;
    }

    // Tomamos la universidad del ciclo más reciente para saber la escala con la que se muestra
    const universidadMostrar =
      notas[0]?.UniversidadObjetivo || "UNMSM";
    const escalaMaxima = obtenerMaximoPermitido(universidadMostrar);

    res.json({
      idAlumno: id,
      universidadEscala: universidadMostrar,
      escalaMaxima,
      promedioGeneral: parseFloat(promedio.toFixed(2)),
      totalCursosEvaluados: notas.length,
      historialNotas: notas,
    });
  } catch (error) {
    console.error("Error en GET /notas/alumno/:id:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* ============================================================
   POST /api/notas - Registro masivo con BLINDAJE NIVEL DIOS
   ============================================================ */
router.post(
  "/",
  requiereRol("Docente", "Tutor de Aula", "Administrador"),
  verificarPeriodoAbierto,
  async (req, res) => {
    const idCiclo = Number(req.body?.idCiclo ?? req.body?.IdCiclo);
    const { notas } = req.body || {};
    const periodo = String(req.body?.periodo ?? req.body?.Periodo ?? 'General').trim().replace(/\s+/g, ' ');
    const idUsuario = req.usuario.idUsuario ?? req.usuario.id;
    const idAcademia = Number(req.usuario.idAcademia);

    if (!Number.isInteger(idCiclo) || idCiclo <= 0) {
      return res.status(400).json({ error: "Debes enviar un idCiclo válido al que pertenecen las notas." });
    }
    if (!periodo || periodo.length > 50) {
      return res.status(400).json({ error: 'El periodo es obligatorio y debe tener hasta 50 caracteres.' });
    }
    if (!Number.isInteger(idAcademia) || idAcademia <= 0) {
      return res.status(401).json({ error: 'El usuario autenticado no tiene una academia válida.' });
    }

    if (!Array.isArray(notas) || notas.length === 0) {
      return res
        .status(400)
        .json({ error: 'Debes enviar un arreglo "notas" con al menos un registro.' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      /* ---------- 1. Universidad objetivo del ciclo ---------- */
      const [cicloData] = await connection.query(
        `SELECT IdCiclo, Nombre, UniversidadObjetivo
         FROM Ciclo
         WHERE IdCiclo = ? AND IdAcademia = ? AND EstadoRegistro = 1
         LIMIT 1 FOR UPDATE`,
        [idCiclo, idAcademia],
      );

      if (cicloData.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ error: "El ciclo indicado no existe o está inactivo." });
      }

      const ciclo = cicloData[0];
      const uniObjetivo = ciclo.UniversidadObjetivo || "UNMSM";
      const maxPermitido = obtenerMaximoPermitido(uniObjetivo);

      /* ---------- 2. Validación estricta + verificación de matrículas ---------- */
      for (const nota of notas) {
        const califRaw = nota.Calificacion;
        const calif = Number(califRaw);

        // 2.1 Bloqueo de NaN, null, vacío, infinito
        if (
          califRaw === null ||
          califRaw === undefined ||
          califRaw === "" ||
          Number.isNaN(calif) ||
          !Number.isFinite(calif)
        ) {
          await connection.rollback();
          return res.status(400).json({
            error: `Registro rechazado. La calificación (${califRaw}) no es un número válido.`,
          });
        }

        // 2.2 Escala dinámica según universidad objetivo
        if (calif < 0 || calif > maxPermitido) {
          await connection.rollback();
          return res.status(400).json({
            error: `Fraude detectado. El puntaje ${calif} es matemáticamente imposible para la escala de ${uniObjetivo} (Máximo: ${maxPermitido}).`,
          });
        }

        // 2.3 IdMatricula obligatorio
        const idMat = Number(nota.IdMatricula);
        if (!Number.isInteger(idMat) || idMat <= 0) {
          await connection.rollback();
          return res.status(400).json({
            error: `Registro rechazado. El IdMatricula (${nota.IdMatricula}) no es válido.`,
          });
        }

        // 2.4 TipoEvaluacion obligatorio + whitelist
        const tipo = normalizarTipoEvaluacion(nota.TipoEvaluacion);
        if (!tipo) {
          await connection.rollback();
          return res.status(400).json({
            error: `TipoEvaluacion inválido. Usa uno de estos valores: ${TIPOS_VALIDOS.join(', ')}.`,
          });
        }

        // 2.5 La matrícula debe pertenecer al ciclo enviado y a la academia del usuario
        const [matValida] = await connection.query(
          `SELECT m.IdMatricula, m.IdCurso
           FROM Matricula m
           INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
           INNER JOIN Ciclo ci ON ci.IdCiclo = m.IdCiclo
           WHERE m.IdMatricula = ?
             AND m.IdCiclo = ?
             AND m.EstadoRegistro = 1
             AND u.EstadoRegistro = 1
             AND u.IdAcademia = ?
             AND ci.IdAcademia = ?
             AND ci.EstadoRegistro = 1
           LIMIT 1 FOR UPDATE`,
          [idMat, idCiclo, idAcademia, idAcademia],
        );

        if (matValida.length === 0) {
          await connection.rollback();
          return res.status(403).json({
            error: `La matrícula ${idMat} no pertenece al ciclo ${idCiclo} o a tu academia.`,
          });
        }

        // Un cierre se aplica por ciclo + curso + periodo + tipo. La fila de
        // Ciclo ya está bloqueada en esta transacción, igual que en actas.routes.
        const idCurso = matValida[0].IdCurso;
        const [cierres] = await connection.query(
          `SELECT IdCierre FROM Auditoria_Cierres
           WHERE IdCiclo = ? AND IdCurso <=> ? AND Periodo = ? AND TipoEvaluacion = ?
           LIMIT 1 FOR UPDATE`,
          [idCiclo, idCurso, periodo, tipo],
        );
        if (cierres.length > 0) {
          await connection.rollback();
          return res.status(403).json({
            error: `No se puede registrar: el periodo "${periodo}" está cerrado para el curso y tipo de evaluación seleccionados.`,
          });
        }
      }

      /* ---------- 3. Inserción masiva ---------- */
      for (const nota of notas) {
        await connection.query(
          `INSERT INTO Evaluacion
             (IdMatricula, Calificacion, TipoEvaluacion, Periodo, UsuarioCreacion, FechaCreacion, EstadoRegistro)
           VALUES (?, ?, ?, ?, ?, NOW(), 1)`,
          [
            Number(nota.IdMatricula),
            Number(nota.Calificacion),
            normalizarTipoEvaluacion(nota.TipoEvaluacion),
            periodo,
            idUsuario,
          ],
        );
      }

      await connection.commit();
      res.status(201).json({
        message: `Calificaciones registradas con éxito (${notas.length} en bloque).`,
        ciclo: ciclo.Nombre,
        universidadObjetivo: uniObjetivo,
        escalaMaxima: maxPermitido,
        periodo,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Error en POST /notas:", error.message);
      res.status(500).json({ error: error.message });
    } finally {
      connection.release();
    }
  },
);

/* ============================================================
   PUT /api/notas/:id - Modificación puntual (TAMBIÉN BLINDADO)
   ============================================================ */
router.put(
  "/:id",
  requiereRol("Docente", "Tutor de Aula", "Administrador"),
  verificarPeriodoAbierto,
  async (req, res) => {
    const { id } = req.params;
    const califRaw = req.body.Calificacion;
    const calif = Number(califRaw);
    const idUsuario = req.usuario.id;
    const idAcademia = req.usuario.idAcademia;

    // Validación numérica básica antes de tocar la BD
    if (
      califRaw === null ||
      califRaw === undefined ||
      califRaw === "" ||
      Number.isNaN(calif) ||
      !Number.isFinite(calif) ||
      calif < 0
    ) {
      return res.status(400).json({
        error: `Registro rechazado. La calificación (${califRaw}) no es un número válido.`,
      });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      /* ---------- 1. Obtener la universidad objetivo del ciclo de esa evaluación ---------- */
      const [evalData] = await connection.query(
        `SELECT e.IdEvaluacion, e.EstadoRegistro, e.Periodo, e.TipoEvaluacion, m.IdCiclo, m.IdCurso,
                ci.UniversidadObjetivo, ci.Nombre AS CicloNombre
         FROM Evaluacion e
         INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
         INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
         INNER JOIN Ciclo ci ON m.IdCiclo = ci.IdCiclo
         WHERE e.IdEvaluacion = ?
           AND u.IdAcademia = ?
           AND e.EstadoRegistro = 1
         LIMIT 1`,
        [id, idAcademia],
      );

      if (evalData.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          error: "Evaluación no encontrada o no pertenece a tu academia.",
        });
      }

      const evaluacionActual = evalData[0];
      // Mantiene el mismo orden de bloqueo que el cierre de actas: primero Ciclo,
      // después se comprueba la auditoría y finalmente se actualiza la evaluación.
      const [cicloBloqueado] = await connection.query(
        `SELECT IdCiclo FROM Ciclo
         WHERE IdCiclo = ? AND IdAcademia = ? AND EstadoRegistro = 1
         LIMIT 1 FOR UPDATE`,
        [evaluacionActual.IdCiclo, idAcademia],
      );
      if (!cicloBloqueado.length) {
        await connection.rollback();
        return res.status(404).json({ error: 'El ciclo de la evaluación no está disponible para esta academia.' });
      }

      const [cierres] = await connection.query(
        `SELECT IdCierre FROM Auditoria_Cierres
         WHERE IdCiclo = ? AND IdCurso <=> ? AND Periodo = ? AND TipoEvaluacion = ?
         LIMIT 1 FOR UPDATE`,
        [evaluacionActual.IdCiclo, evaluacionActual.IdCurso, evaluacionActual.Periodo || 'General', evaluacionActual.TipoEvaluacion],
      );
      if (cierres.length > 0 || Number(evaluacionActual.EstadoRegistro) === 2) {
        await connection.rollback();
        return res.status(403).json({ error: 'Esta acta está cerrada y no admite modificaciones.' });
      }

      const uniObjetivo = evalData[0].UniversidadObjetivo || "UNMSM";
      const maxPermitido = obtenerMaximoPermitido(uniObjetivo);

      /* ---------- 2. Validación dinámica según escala ---------- */
      if (calif > maxPermitido) {
        await connection.rollback();
        return res.status(400).json({
          error: `Fraude detectado. El puntaje ${calif} es matemáticamente imposible para la escala de ${uniObjetivo} (Máximo: ${maxPermitido}).`,
        });
      }

      /* ---------- 3. Update ---------- */
      const [result] = await connection.query(
        `UPDATE Evaluacion e
         INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
         INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
         SET e.Calificacion = ?, e.UsuarioModificacion = ?, e.FechaModificacion = NOW()
         WHERE e.IdEvaluacion = ? AND u.IdAcademia = ?`,
        [calif, idUsuario, id, idAcademia],
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({
          error: "Evaluación no encontrada o no pertenece a tu academia.",
        });
      }

      await connection.commit();
      res.json({
        message: "Calificación actualizada con éxito.",
        universidadObjetivo: uniObjetivo,
        escalaMaxima: maxPermitido,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Error en PUT /notas/:id:", error.message);
      res.status(500).json({ error: error.message });
    } finally {
      connection.release();
    }
  },
);

module.exports = router;
