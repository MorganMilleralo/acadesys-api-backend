
const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const requiereRol = require("../middlewares/roles.middleware");
const verificarPeriodoAbierto = require("../middlewares/cierre.middleware");
const { requiereGestionNotas, autorizarHistorialAlumno } = require("../middlewares/notas-acceso.middleware");

const { MAX_NOTA_CURSO, obtenerMaximoPermitido, normalizarTipo, enteroPositivo,
  calificacionValida, promedio, esNotaCurso, esSimulacro, periodoValido,
  responderErrorEsquema } = require("../utils/evaluaciones");

// ============================================================
// GET /api/notas
// ============================================================
router.get(
  "/",
  requiereGestionNotas,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT
            e.IdEvaluacion,
            e.IdMatricula,
            e.IdCurso,
            e.Periodo,
            e.TipoEvaluacion,
            e.Calificacion,
            e.EstadoRegistro,
            e.FechaCreacion,
            u.CodigoUsuario,
            CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno) AS Alumno,
            CASE WHEN e.IdCurso IS NULL AND e.TipoEvaluacion = 'Simulacro'
              THEN 'Simulacro General' ELSE COALESCE(c.Nombre, 'Curso pendiente de clasificar') END AS Curso,
            ci.Nombre AS Ciclo,
            ci.UniversidadObjetivo
         FROM Evaluacion e
         INNER JOIN Matricula m
           ON m.IdMatricula = e.IdMatricula
         INNER JOIN Usuario u
           ON u.IdUsuario = m.IdUsuario
         INNER JOIN Ciclo ci
           ON ci.IdCiclo = m.IdCiclo
         LEFT JOIN Curso c
           ON c.IdCurso = e.IdCurso
         WHERE e.EstadoRegistro IN (1, 2)
           AND u.IdAcademia = ?
           AND ci.IdAcademia = ?
         ORDER BY e.FechaCreacion DESC, e.IdEvaluacion DESC`,
        [
          req.usuario.idAcademia,
          req.usuario.idAcademia,
        ]
      );

      return res.json(rows);
    } catch (error) {
      console.error("GET /notas:", error);
      if (responderErrorEsquema(res, error)) return;
      return res.status(500).json({
        error: "No se pudieron consultar las notas.",
      });
    }
  }
);

// ============================================================
// GET /api/notas/contexto/:idCiclo
// ============================================================
router.get(
  "/contexto/:idCiclo",
  requiereGestionNotas,
  async (req, res) => {
    const idCiclo = Number(req.params.idCiclo);

    if (!enteroPositivo(idCiclo)) {
      return res.status(400).json({
        error: "idCiclo invalido.",
      });
    }

    try {
      const [rows] = await pool.query(
        `SELECT IdCiclo, Nombre, UniversidadObjetivo
         FROM Ciclo
         WHERE IdCiclo = ?
           AND IdAcademia = ?
           AND EstadoRegistro = 1
         LIMIT 1`,
        [idCiclo, req.usuario.idAcademia]
      );

      if (!rows.length) {
        return res.status(404).json({
          error: "Ciclo no encontrado.",
        });
      }

      const ciclo = rows[0];

      return res.json({
        idCiclo: ciclo.IdCiclo,
        ciclo: ciclo.Nombre,
        universidadObjetivo: ciclo.UniversidadObjetivo,
        escalaMinima: 0,
        escalaMaxima: obtenerMaximoPermitido(
          ciclo.UniversidadObjetivo
        ),
        escalaMaximaCurso: MAX_NOTA_CURSO,
      });
    } catch (error) {
      console.error("GET /notas/contexto:", error);
      if (responderErrorEsquema(res, error)) return;
      return res.status(500).json({
        error: "Error consultando el ciclo.",
      });
    }
  }
);

// ============================================================
// GET /api/notas/matriculas/:idCiclo
// ============================================================
router.get(
  "/matriculas/:idCiclo",
  requiereGestionNotas,
  async (req, res) => {
    const idCiclo = Number(req.params.idCiclo);

    if (!enteroPositivo(idCiclo)) {
      return res.status(400).json({
        error: "idCiclo invalido.",
      });
    }

    try {
      const [rows] = await pool.query(
        `SELECT
            m.IdMatricula,
            m.IdUsuario,
            m.IdCiclo,
            u.CodigoUsuario,
            u.Nombres,
            u.ApellidoPaterno,
            u.ApellidoMaterno
         FROM Matricula m
         INNER JOIN Usuario u
           ON u.IdUsuario = m.IdUsuario
         INNER JOIN Ciclo ci
           ON ci.IdCiclo = m.IdCiclo
         WHERE m.IdCiclo = ?
           AND m.EstadoRegistro = 1
           AND u.EstadoRegistro = 1
           AND u.IdAcademia = ?
           AND ci.IdAcademia = ?
           AND ci.EstadoRegistro = 1
         ORDER BY
           u.ApellidoPaterno,
           u.ApellidoMaterno,
           u.Nombres`,
        [
          idCiclo,
          req.usuario.idAcademia,
          req.usuario.idAcademia,
        ]
      );

      return res.json(
        rows.map((row) => ({
          idMatricula: row.IdMatricula,
          idUsuario: row.IdUsuario,
          idCiclo: row.IdCiclo,
          codigo: row.CodigoUsuario,
          nombre: [
            row.Nombres,
            row.ApellidoPaterno,
            row.ApellidoMaterno,
          ]
            .filter(Boolean)
            .join(" "),
        }))
      );
    } catch (error) {
      console.error("GET /notas/matriculas:", error);
      if (responderErrorEsquema(res, error)) return;
      return res.status(500).json({
        error: "Error consultando matriculas.",
      });
    }
  }
);

// ============================================================
// GET /api/notas/alumno/:id
// ============================================================
router.get("/alumno/:id", autorizarHistorialAlumno, async (req, res) => {
  const idAlumno = Number(req.params.id);

  if (!enteroPositivo(idAlumno)) {
    return res.status(400).json({
      error: "Alumno invalido.",
    });
  }

  try {
    const [notas] = await pool.query(
      `SELECT
          CASE WHEN e.IdCurso IS NULL AND e.TipoEvaluacion = 'Simulacro'
            THEN 'Simulacro General' ELSE COALESCE(c.Nombre, 'Curso pendiente de clasificar') END AS Curso,
          e.IdCurso,
          e.Periodo,
          e.TipoEvaluacion,
          e.Calificacion,
          e.EstadoRegistro,
          e.FechaCreacion,
          ci.UniversidadObjetivo,
          ci.IdCiclo,
          ci.Nombre AS Ciclo
       FROM Evaluacion e
       INNER JOIN Matricula m
         ON m.IdMatricula = e.IdMatricula
       INNER JOIN Usuario u
         ON u.IdUsuario = m.IdUsuario
       INNER JOIN Ciclo ci
         ON ci.IdCiclo = m.IdCiclo
       LEFT JOIN Curso c
         ON c.IdCurso = e.IdCurso
       WHERE u.IdUsuario = ?
         AND u.IdAcademia = ?
         AND ci.IdAcademia = ?
         AND e.EstadoRegistro IN (1, 2)
       ORDER BY e.FechaCreacion DESC`,
      [
        idAlumno,
        req.usuario.idAcademia,
        req.usuario.idAcademia,
      ]
    );

    const notasCursos = notas.filter(esNotaCurso);
    const simulacros = notas.filter(esSimulacro);
    // El historial puede incluir ciclos con escalas distintas.
    // El promedio bruto solo es comparable cuando todas las escalas coinciden.
    const escalas = new Set(simulacros.map((n) => obtenerMaximoPermitido(n.UniversidadObjetivo)));
    const universidades = new Set(simulacros.map((n) => n.UniversidadObjetivo));
    const simulacrosComparables = escalas.size === 1 && !escalas.has(null);

    return res.json({
      idAlumno,
      universidadEscala: universidades.size === 1 ? [...universidades][0] : null,
      escalaMaxima: simulacrosComparables ? [...escalas][0] : null,
      escalaMaximaCurso: MAX_NOTA_CURSO,
      // Alias conservado; misma semantica que /alumno/me: simulacros brutos.
      promedioGeneral: simulacrosComparables ? promedio(simulacros) : null,
      promedioCursos: promedio(notasCursos),
      promedioSimulacros: simulacrosComparables ? promedio(simulacros) : null,
      escalasSimulacrosComparables: simulacrosComparables,
      evaluacionesPendientesClasificar: notas.length - notasCursos.length - simulacros.length,
      totalCursosEvaluados: new Set(
        notasCursos.map((nota) => nota.IdCurso)
      ).size,
      totalEvaluaciones: notas.length,
      historialNotas: notas,
    });
  } catch (error) {
    console.error("GET /notas/alumno:", error);
      if (responderErrorEsquema(res, error)) return;
    return res.status(500).json({
      error: "No se pudieron consultar las notas.",
    });
  }
});

// ============================================================
// POST /api/notas
// ============================================================
router.post(
  "/",
  requiereRol("Administrador"),
  verificarPeriodoAbierto,
  async (req, res) => {
    const idCiclo = req.body?.idCiclo ?? req.body?.IdCiclo;

    const periodoEntrada = (
      req.body?.periodo ??
      req.body?.Periodo ??
      "General"
    );
    const periodo = typeof periodoEntrada === 'string' ? periodoEntrada.trim() : periodoEntrada;

    const notas = req.body?.notas;
    const idAcademia = Number(req.usuario.idAcademia);

    if (
      !enteroPositivo(idCiclo) ||
      !periodoValido(periodo) ||
      !Array.isArray(notas) ||
      notas.length === 0 ||
      notas.length > 200
    ) {
      return res.status(400).json({
        error: "Ciclo, periodo o lista de notas invalidos.",
      });
    }

    let connection;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Bloqueo compartido con PUT y cierre de actas.
      const [ciclos] = await connection.query(
        `SELECT
            IdCiclo,
            Nombre,
            UniversidadObjetivo
         FROM Ciclo
         WHERE IdCiclo = ?
           AND IdAcademia = ?
           AND EstadoRegistro = 1
         LIMIT 1 FOR UPDATE`,
        [idCiclo, idAcademia]
      );

      if (!ciclos.length) {
        await connection.rollback();

        return res.status(404).json({
          error: "Ciclo no encontrado en tu academia.",
        });
      }

      const maxSimulacro = obtenerMaximoPermitido(
        ciclos[0].UniversidadObjetivo
      );

      const preparadas = [];

      for (const nota of notas) {
        if (!nota || typeof nota !== "object") {
          await connection.rollback();

          return res.status(400).json({
            error: "Cada nota debe ser un objeto.",
          });
        }

        const idMatricula = nota.IdMatricula;
        const tipo = normalizarTipo(nota.TipoEvaluacion);

        const idCurso =
          nota.IdCurso == null
            ? null
            : nota.IdCurso;

        if (
          !enteroPositivo(idMatricula) ||
          !tipo ||
          !calificacionValida(nota.Calificacion)
        ) {
          await connection.rollback();

          return res.status(400).json({
            error: "Matricula, tipo o calificacion invalidos.",
          });
        }

        if (
          (tipo === "Simulacro" && idCurso !== null) ||
          (tipo !== "Simulacro" && !enteroPositivo(idCurso))
        ) {
          await connection.rollback();

          return res.status(400).json({
            error:
              "Simulacro requiere IdCurso null; las otras evaluaciones requieren un curso valido.",
          });
        }

        const calificacion = Number(nota.Calificacion);

        const maximo =
          idCurso === null
            ? maxSimulacro
            : MAX_NOTA_CURSO;

        if (maximo === null) {
          await connection.rollback();
          return res.status(409).json({ error: "La escala del simulacro requiere configuracion." });
        }

        if (calificacion > maximo) {
          await connection.rollback();

          return res.status(400).json({
            error: `La nota supera el maximo permitido de ${maximo}.`,
          });
        }

        // Validar que el alumno pertenezca al ciclo
        // y a la academia.
        const [matriculas] = await connection.query(
          `SELECT m.IdMatricula
           FROM Matricula m
           INNER JOIN Usuario u
             ON u.IdUsuario = m.IdUsuario
           WHERE m.IdMatricula = ?
             AND m.IdCiclo = ?
             AND m.EstadoRegistro = 1
             AND u.EstadoRegistro = 1
             AND u.IdAcademia = ?
           LIMIT 1`,
          [idMatricula, idCiclo, idAcademia]
        );

        if (!matriculas.length) {
          await connection.rollback();

          return res.status(403).json({
            error: "Matricula ajena, inactiva o invalida.",
          });
        }

        // Validar que el curso pertenezca al ciclo.
        if (idCurso !== null) {
          const [cursos] = await connection.query(
            `SELECT cc.IdCurso
             FROM CicloCurso cc
             INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso AND cu.EstadoRegistro = 1
             WHERE cc.IdCiclo = ?
               AND cc.IdCurso = ?
               AND cc.EstadoRegistro = 1
             LIMIT 1`,
            [idCiclo, idCurso]
          );

          if (!cursos.length) {
            await connection.rollback();

            return res.status(400).json({
              error: "El curso no pertenece al ciclo activo.",
            });
          }
        }

        // Comprobar cierre en la misma transaccion.
        const [cierres] = await connection.query(
          `SELECT IdCierre
           FROM Auditoria_Cierres
           WHERE IdCiclo = ?
             AND IdCurso <=> ?
             AND Periodo = ?
             AND TipoEvaluacion = ?
           LIMIT 1 FOR UPDATE`,
          [idCiclo, idCurso, periodo, tipo]
        );

        if (cierres.length) {
          await connection.rollback();

          return res.status(409).json({
            error: `El acta de ${tipo} (${periodo}) esta cerrada.`,
          });
        }

        preparadas.push({
          idMatricula: Number(idMatricula),
          idCurso: idCurso === null ? null : Number(idCurso),
          tipo,
          calificacion,
        });
      }

      // Insertar despues de validar todas las notas.
      for (const nota of preparadas) {
        await connection.query(
          `INSERT INTO Evaluacion
           (
             IdMatricula,
             IdCurso,
             Periodo,
             TipoEvaluacion,
             Calificacion,
             UsuarioCreacion,
             FechaCreacion,
             EstadoRegistro
           )
           VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)`,
          [
            nota.idMatricula,
            nota.idCurso,
            periodo,
            nota.tipo,
            nota.calificacion,
            req.usuario.id,
          ]
        );
      }

      await connection.commit();

      return res.status(201).json({
        message:
          `Calificaciones registradas (${preparadas.length}).`,
        ciclo: ciclos[0].Nombre,
        periodo,
        universidadObjetivo:
          ciclos[0].UniversidadObjetivo,
        escalaMaximaSimulacro: maxSimulacro,
        escalaMaximaCurso: MAX_NOTA_CURSO,
      });
    } catch (error) {
      if (connection) {
        await connection.rollback().catch(() => {});
      }

      console.error("POST /notas:", error);
      if (responderErrorEsquema(res, error)) return;

      return res.status(500).json({
        error: "Error registrando las notas.",
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
);

// ============================================================
// PUT /api/notas/:id
// ============================================================
router.put(
  "/:id",
  requiereRol("Administrador"),
  verificarPeriodoAbierto,
  async (req, res) => {
    const idEvaluacion = Number(req.params.id);

    if (
      !enteroPositivo(idEvaluacion) ||
      !calificacionValida(req.body?.Calificacion)
    ) {
      return res.status(400).json({
        error: "Evaluacion o calificacion invalida.",
      });
    }

    const calificacion = Number(req.body.Calificacion);
    const idAcademia = Number(req.usuario.idAcademia);

    let connection;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Obtener primero el ciclo.
      const [referencias] = await connection.query(
        `SELECT m.IdCiclo
         FROM Evaluacion e
         INNER JOIN Matricula m
           ON m.IdMatricula = e.IdMatricula
         INNER JOIN Usuario u
           ON u.IdUsuario = m.IdUsuario
         WHERE e.IdEvaluacion = ?
           AND u.IdAcademia = ?
           AND m.EstadoRegistro = 1
           AND u.EstadoRegistro = 1
         LIMIT 1`,
        [idEvaluacion, idAcademia]
      );

      if (!referencias.length) {
        await connection.rollback();

        return res.status(404).json({
          error: "Evaluacion no encontrada.",
        });
      }

      const idCiclo = referencias[0].IdCiclo;

      // Bloquear el ciclo igual que POST y cierre.
      const [ciclos] = await connection.query(
        `SELECT UniversidadObjetivo
         FROM Ciclo
         WHERE IdCiclo = ?
           AND IdAcademia = ?
           AND EstadoRegistro = 1
         LIMIT 1 FOR UPDATE`,
        [idCiclo, idAcademia]
      );

      if (!ciclos.length) {
        await connection.rollback();

        return res.status(404).json({
          error: "Ciclo inactivo o fuera de tu academia.",
        });
      }

      // Leer la evaluacion y su curso actual.
      const [evaluaciones] = await connection.query(
        `SELECT
            e.IdCurso,
            e.Periodo,
            e.TipoEvaluacion,
            e.EstadoRegistro
         FROM Evaluacion e
         INNER JOIN Matricula m
           ON m.IdMatricula = e.IdMatricula
         WHERE e.IdEvaluacion = ?
           AND m.IdCiclo = ?
           AND m.EstadoRegistro = 1
         LIMIT 1 FOR UPDATE`,
        [idEvaluacion, idCiclo]
      );

      if (
        !evaluaciones.length ||
        Number(evaluaciones[0].EstadoRegistro) !== 1
      ) {
        await connection.rollback();

        return res.status(409).json({
          error: "Evaluacion cerrada o no disponible.",
        });
      }

      const evaluacion = evaluaciones[0];

      if ((!esNotaCurso(evaluacion) && !esSimulacro(evaluacion)) || !periodoValido(evaluacion.Periodo)) {
        await connection.rollback();
        return res.status(409).json({ error: "La evaluacion historica requiere clasificacion antes de editarse." });
      }

      if (evaluacion.IdCurso !== null) {
        const [cursos] = await connection.query(
          `SELECT cc.IdCurso FROM CicloCurso cc
           INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso AND cu.EstadoRegistro = 1
           WHERE cc.IdCiclo = ? AND cc.IdCurso = ? AND cc.EstadoRegistro = 1 LIMIT 1`,
          [idCiclo, evaluacion.IdCurso]
        );
        if (!cursos.length) {
          await connection.rollback();
          return res.status(409).json({ error: "El curso ya no pertenece al ciclo activo." });
        }
      }

      // Impedir modificar actas cerradas.
      const [cierres] = await connection.query(
        `SELECT IdCierre
         FROM Auditoria_Cierres
         WHERE IdCiclo = ?
           AND IdCurso <=> ?
           AND Periodo = ?
           AND TipoEvaluacion = ?
         LIMIT 1 FOR UPDATE`,
        [
          idCiclo,
          evaluacion.IdCurso,
          evaluacion.Periodo,
          evaluacion.TipoEvaluacion,
        ]
      );

      if (cierres.length) {
        await connection.rollback();

        return res.status(409).json({
          error: "El acta ya esta cerrada.",
        });
      }

      const maximo =
        evaluacion.IdCurso === null
          ? obtenerMaximoPermitido(
              ciclos[0].UniversidadObjetivo
            )
          : MAX_NOTA_CURSO;

      if (maximo === null) {
        await connection.rollback();
        return res.status(409).json({ error: "La escala del simulacro requiere configuracion." });
      }

      if (calificacion > maximo) {
        await connection.rollback();

        return res.status(400).json({
          error: `El puntaje supera el maximo ${maximo}.`,
        });
      }

      // Actualizar solo evaluaciones abiertas.
      const [resultado] = await connection.query(
        `UPDATE Evaluacion e
         INNER JOIN Matricula m
           ON m.IdMatricula = e.IdMatricula
         INNER JOIN Usuario u
           ON u.IdUsuario = m.IdUsuario
         SET
           e.Calificacion = ?,
           e.UsuarioModificacion = ?,
           e.FechaModificacion = NOW()
         WHERE e.IdEvaluacion = ?
           AND e.EstadoRegistro = 1
           AND m.EstadoRegistro = 1
           AND u.IdAcademia = ?`,
        [
          calificacion,
          req.usuario.id,
          idEvaluacion,
          idAcademia,
        ]
      );

      if (!resultado.affectedRows) {
        await connection.rollback();

        return res.status(409).json({
          error: "No se pudo modificar la evaluacion.",
        });
      }

      await connection.commit();

      return res.json({
        message: "Calificacion actualizada.",
        idEvaluacion,
        calificacion,
        escalaMaxima: maximo,
      });
    } catch (error) {
      if (connection) {
        await connection.rollback().catch(() => {});
      }

      console.error("PUT /notas/:id:", error);
      if (responderErrorEsquema(res, error)) return;

      return res.status(500).json({
        error: "Error modificando la evaluacion.",
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
);

module.exports = router;
