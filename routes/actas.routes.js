
const express = require("express");
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');

const { normalizarTipo, enteroPositivo: valido, periodoValido,
  responderErrorEsquema } = require("../utils/evaluaciones");

router.put(
  "/actas/cierre",
  requiereRol("Administrador"),
  async (req, res) => {
    let idCiclo = req.body?.idCiclo ?? req.body?.IdCiclo;
    // Conservar ambos nombres utilizados por los clientes, incluido null
    // explicito para el simulacro general.
    const entradaCurso = Object.hasOwn(req.body || {}, 'idCurso')
      ? req.body.idCurso : req.body?.IdCurso;
    let idCurso = entradaCurso == null ? null : entradaCurso;

    const periodoEntrada = (
      req.body?.periodo ??
      req.body?.Periodo ??
      ""
    );
    const periodo = typeof periodoEntrada === 'string' ? periodoEntrada.trim() : periodoEntrada;

    const tipo = normalizarTipo(
      req.body?.tipoEvaluacion ??
      req.body?.TipoEvaluacion
    );

    const idAcademia = Number(req.usuario.idAcademia);

    if (
      !valido(idCiclo) ||
      (idCurso !== null && !valido(idCurso)) ||
      !periodoValido(periodo) ||
      !tipo
    ) {
      return res.status(400).json({
        error: "Ciclo, curso, periodo o tipo invalidos.",
      });
    }

    idCiclo = Number(idCiclo);
    idCurso = idCurso === null ? null : Number(idCurso);

    if (
      (tipo === "Simulacro" && idCurso !== null) ||
      (tipo !== "Simulacro" && idCurso === null)
    ) {
      return res.status(400).json({
        error:
          "Simulacro general exige IdCurso null; otros tipos exigen curso.",
      });
    }

    let connection;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // 1. Bloquear el ciclo.
      const [ciclos] = await connection.query(
        `SELECT IdCiclo
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
          error: "Ciclo ajeno o inactivo.",
        });
      }

      // 2. Comprobar el curso, si corresponde.
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
            error: "Curso no asignado al ciclo.",
          });
        }
      }

      // 3. Comprobar que no exista ya el cierre.
      const [cerrado] = await connection.query(
        `SELECT IdCierre
         FROM Auditoria_Cierres
         WHERE IdCiclo = ?
           AND IdCurso <=> ?
           AND Periodo = ?
           AND TipoEvaluacion = ?
         LIMIT 1 FOR UPDATE`,
        [idCiclo, idCurso, periodo, tipo]
      );

      if (cerrado.length) {
        await connection.rollback();

        return res.status(409).json({
          error: "Esa acta ya esta cerrada.",
        });
      }

      // 4. Cerrar solo las evaluaciones seleccionadas.
      const [resultado] = await connection.query(
        `UPDATE Evaluacion e
         INNER JOIN Matricula m
           ON m.IdMatricula = e.IdMatricula
         INNER JOIN Usuario u
           ON u.IdUsuario = m.IdUsuario
         SET
           e.EstadoRegistro = 2,
           e.UsuarioModificacion = ?,
           e.FechaModificacion = NOW()
         WHERE m.IdCiclo = ?
           AND e.IdCurso <=> ?
           AND e.Periodo = ?
           AND e.TipoEvaluacion = ?
           AND e.EstadoRegistro = 1
           AND m.EstadoRegistro = 1
           AND u.IdAcademia = ?`,
        [
          req.usuario.id,
          idCiclo,
          idCurso,
          periodo,
          tipo,
          idAcademia,
        ]
      );

      if (resultado.affectedRows === 0) {
        await connection.rollback();

        return res.status(409).json({
          error:
            "No existen evaluaciones abiertas para ese alcance.",
        });
      }

      // 5. Registrar la auditoria.
      await connection.query(
        `INSERT INTO Auditoria_Cierres
         (
           IdAdministrador,
           IdCiclo,
           IdCurso,
           Periodo,
           TipoEvaluacion,
           RegistrosAfectados,
           FechaCierre
         )
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          req.usuario.id,
          idCiclo,
          idCurso,
          periodo,
          tipo,
          resultado.affectedRows,
        ]
      );

      await connection.commit();

      return res.json({
        message: "Acta cerrada correctamente.",
        mensaje: "Acta cerrada correctamente.",
        idCiclo,
        idCurso,
        periodo,
        tipoEvaluacion: tipo,
        notasBloqueadas: resultado.affectedRows,
        evaluacionesSelladas: resultado.affectedRows,
        alcance: { idCiclo, idCurso, periodo, tipoEvaluacion: tipo,
          alcanceCurso: idCurso === null ? 'Simulacro General' : 'Curso específico' },
      });
    } catch (error) {
      if (connection) {
        await connection.rollback().catch(() => {});
      }

      console.error("PUT /actas/cierre:", error);
      if (responderErrorEsquema(res, error)) return;

      return res.status(500).json({
        error: "No se pudo cerrar el acta.",
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
);

module.exports = router;
