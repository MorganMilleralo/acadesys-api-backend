const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const requiereRol = require("../middlewares/roles.middleware");
const verificarPeriodoAbierto = require("../middlewares/cierre.middleware");

// GET /api/notas - Listado de evaluaciones de la academia
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.IdEvaluacion, e.IdMatricula, e.TipoEvaluacion, e.Calificacion, e.FechaCreacion,
                    u.CodigoUsuario, CONCAT(u.Nombres, ' ', u.ApellidoPaterno) AS Alumno,
                    COALESCE(c.Nombre, 'Simulacro General') AS Curso
             FROM Evaluacion e
             INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
             INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
             LEFT JOIN Curso c ON m.IdCurso = c.IdCurso
             WHERE e.EstadoRegistro = 1 AND u.IdAcademia = ?`,
      [req.usuario.idAcademia],
    );
    res.json(rows);
  } catch (error) {
    console.error("Error en GET /notas:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/notas/alumno/:id - Historial y promedio académico individual
router.get("/alumno/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [notas] = await pool.query(
      `SELECT COALESCE(c.Nombre, 'Simulacro General') AS Curso,
                    e.TipoEvaluacion, e.Calificacion, e.FechaCreacion
             FROM Evaluacion e
             INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
             LEFT JOIN Curso c ON m.IdCurso = c.IdCurso
             INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
             WHERE u.IdUsuario = ? AND u.IdAcademia = ? AND e.EstadoRegistro = 1`,
      [id, req.usuario.idAcademia],
    );

    let promedio = 0;
    if (notas.length > 0) {
      const suma = notas.reduce((acc, n) => acc + Number(n.Calificacion), 0);
      promedio = suma / notas.length;
    }

    res.json({
      idAlumno: id,
      promedioGeneral: parseFloat(promedio.toFixed(2)),
      totalCursosEvaluados: notas.length,
      historialNotas: notas,
    });
  } catch (error) {
    console.error("Error en GET /notas/alumno/:id:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notas - Registro de notas masivo con validación transaccional
router.post(
  "/",
  requiereRol("Docente", "Tutor de Aula", "Administrador"),
  verificarPeriodoAbierto,
  async (req, res) => {
    const { notas } = req.body;
    const idUsuario = req.usuario.id;

    if (!Array.isArray(notas) || notas.length === 0) {
      return res
        .status(400)
        .json({
          error: 'Debes enviar un arreglo "notas" con al menos un registro.',
        });
    }

    for (const nota of notas) {
      const calif = Number(nota.Calificacion);
      if (
        !nota.IdMatricula ||
        !nota.TipoEvaluacion ||
        Number.isNaN(calif) ||
        calif < 0 ||
        calif > 20
      ) {
        return res.status(400).json({
          error:
            "Nota inválida: La calificación debe ser un valor numérico entre 0 y 20.",
        });
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const nota of notas) {
        await connection.query(
          `INSERT INTO Evaluacion
                    (IdMatricula, Calificacion, TipoEvaluacion, UsuarioCreacion, FechaCreacion, EstadoRegistro)
                 VALUES (?, ?, ?, ?, NOW(), 1)`,
          [nota.IdMatricula, nota.Calificacion, nota.TipoEvaluacion, idUsuario],
        );
      }

      await connection.commit();
      res
        .status(201)
        .json({ message: "Calificaciones registradas con éxito en bloque" });
    } catch (error) {
      await connection.rollback();
      console.error("Error en POST /notas:", error.message);
      res.status(500).json({ error: error.message });
    } finally {
      connection.release();
    }
  },
);

// PUT /api/notas/:id - Modificación puntual asegurando aislamiento por academia
router.put(
  "/:id",
  requiereRol("Docente", "Tutor de Aula", "Administrador"),
  verificarPeriodoAbierto,
  async (req, res) => {
    const { id } = req.params;
    const calif = Number(req.body.Calificacion);
    const idUsuario = req.usuario.id;
    const idAcademia = req.usuario.idAcademia;

    if (Number.isNaN(calif) || calif < 0 || calif > 20) {
      return res
        .status(400)
        .json({ error: "La calificación debe ser un número entre 0 y 20." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

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
        return res
          .status(404)
          .json({
            error: "Evaluación no encontrada o no pertenece a tu academia.",
          });
      }

      await connection.commit();
      res.json({ message: "Calificación actualizada con éxito" });
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
