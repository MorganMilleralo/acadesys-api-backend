
const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const requiereRol = require("../middlewares/roles.middleware");

// ============================================================
// ACADESYS - DASHBOARD ADMINISTRATIVO
// Notas por curso y simulacros generales
// Incluye evaluaciones abiertas y cerradas
// ============================================================

const { obtenerMaximoPermitido: maximoPorUniversidad, responderErrorEsquema } = require('../utils/evaluaciones');

function normalizarPromedio(calificacion, universidad) {
  const maximo = maximoPorUniversidad(universidad);
  const valor = Number(calificacion);

  if (!Number.isFinite(valor) || maximo === null || maximo <= 0) {
    return null;
  }

  return (valor / maximo) * 20;
}

function redondear(numero) {
  return Number(Number(numero || 0).toFixed(2));
}

function interpretarFecha(fecha, finDelDia = false) {
  if (!fecha) return null;

  let resultado;

  if (fecha instanceof Date) {
    resultado = new Date(
      fecha.getFullYear(),
      fecha.getMonth(),
      fecha.getDate()
    );
  } else {
    const fechaTexto = String(fecha).slice(0, 10);
    resultado = new Date(`${fechaTexto}T00:00:00`);
  }

  if (Number.isNaN(resultado.getTime())) {
    return null;
  }

  if (finDelDia) {
    resultado.setHours(23, 59, 59, 999);
  } else {
    resultado.setHours(0, 0, 0, 0);
  }

  return resultado;
}

// Administrador y Recursos Humanos
// tienen permisos administrativos equivalentes.
router.use(requiereRol("Administrador"));

// ============================================================
// GET /api/admin/dashboard/overview
// ============================================================

router.get("/dashboard/overview", async (req, res) => {
  const idAcademia = Number(req.usuario?.idAcademia);

  if (
    !Number.isSafeInteger(idAcademia) ||
    idAcademia <= 0
  ) {
    return res.status(401).json({
      error: "El administrador no tiene una academia valida.",
    });
  }

  try {
    // ========================================================
    // 1. TOTAL DE ESTUDIANTES
    // ========================================================

    const [usuarios] = await pool.query(
      `SELECT
          COUNT(DISTINCT u.IdUsuario) AS TotalEstudiantes
       FROM Usuario u
       INNER JOIN Usuario_Perfiles up
         ON up.IdUsuario = u.IdUsuario
         AND up.EstadoRegistro = 1
       INNER JOIN perfil p
         ON p.IdPerfil = up.IdPerfil
         AND p.EstadoRegistro = 1
       WHERE u.IdAcademia = ?
         AND u.EstadoRegistro = 1
         AND LOWER(TRIM(p.Nombre)) = 'alumno'`,
      [idAcademia]
    );

    // ========================================================
    // 2. MATRICULAS ACTIVAS
    // ========================================================

    const [matriculas] = await pool.query(
      `SELECT
          COUNT(*) AS MatriculasActivas
       FROM Matricula m
       INNER JOIN Usuario u
         ON u.IdUsuario = m.IdUsuario
       INNER JOIN Ciclo c
         ON c.IdCiclo = m.IdCiclo
       WHERE u.IdAcademia = ?
         AND c.IdAcademia = ?
         AND u.EstadoRegistro = 1
         AND m.EstadoRegistro = 1
         AND c.EstadoRegistro = 1`,
      [idAcademia, idAcademia]
    );

    // ========================================================
    // 3. CICLOS, ALUMNOS Y EVALUACIONES
    // Incluye evaluaciones abiertas (1) y cerradas (2).
    // ========================================================

    const [ciclos] = await pool.query(
      `SELECT
          c.IdCiclo,
          c.Nombre,
          c.UniversidadObjetivo,
          c.FechaInicio,
          c.FechaFin,
          c.Capacidad,
          c.EstadoRegistro,
          (
            SELECT COUNT(*)
            FROM Matricula m
            INNER JOIN Usuario u
              ON u.IdUsuario = m.IdUsuario
            WHERE m.IdCiclo = c.IdCiclo
              AND m.EstadoRegistro = 1
              AND u.EstadoRegistro = 1
              AND u.IdAcademia = c.IdAcademia
          ) AS TotalAlumnos,

          (
            SELECT COUNT(*)
            FROM Evaluacion e
            INNER JOIN Matricula m2
              ON m2.IdMatricula = e.IdMatricula
            INNER JOIN Usuario u2
              ON u2.IdUsuario = m2.IdUsuario
            WHERE m2.IdCiclo = c.IdCiclo
              AND m2.EstadoRegistro = 1
              AND e.EstadoRegistro IN (1, 2)
              AND u2.IdAcademia = c.IdAcademia
          ) AS TotalEvaluaciones

       FROM Ciclo c
       WHERE c.IdAcademia = ?
       ORDER BY c.FechaInicio ASC, c.IdCiclo ASC`,
      [idAcademia]
    );

    // ========================================================
    // 4. MOROSIDAD
    // ========================================================

    const [morosidad] = await pool.query(
      `SELECT
          COUNT(DISTINCT p.IdUsuario) AS TotalMorosos
       FROM PagosMensualidad p
       INNER JOIN Usuario u
         ON u.IdUsuario = p.IdUsuario
       WHERE u.IdAcademia = ?
         AND u.EstadoRegistro = 1
         AND p.EstadoRegistro = 1
         AND LOWER(TRIM(COALESCE(p.Estado, '')))
             IN ('moroso', 'vencido', 'pendiente')`,
      [idAcademia]
    );

    // ========================================================
    // 5. RESUMEN DE PAGOS
    // ========================================================

    const [pagosResumen] = await pool.query(
      `SELECT
          COUNT(*) AS TotalPagos,

          SUM(
            CASE
              WHEN LOWER(TRIM(COALESCE(p.Estado, '')))
                   = 'pagado'
              THEN 1
              ELSE 0
            END
          ) AS Pagados,

          SUM(
            CASE
              WHEN LOWER(TRIM(COALESCE(p.Estado, '')))
                   IN ('moroso', 'vencido', 'pendiente')
              THEN 1
              ELSE 0
            END
          ) AS Pendientes

       FROM PagosMensualidad p
       INNER JOIN Usuario u
         ON u.IdUsuario = p.IdUsuario
       WHERE u.IdAcademia = ?
         AND p.EstadoRegistro = 1`,
      [idAcademia]
    );

    // ========================================================
    // 6. RENDIMIENTO ACADEMICO
    //
    // IdCurso NULL:
    //   Simulacros generales, escala por universidad.
    //
    // IdCurso con valor:
    //   Evaluaciones de cursos, escala provisional 0 a 20.
    //
    // No mezclar ambos promedios.
    // ========================================================

    const [rendimientoRows] = await pool.query(
      `SELECT
          c.IdCiclo,
          c.Nombre,
          c.UniversidadObjetivo,

          AVG(
            CASE
              WHEN e.IdCurso IS NULL
               AND e.TipoEvaluacion = 'Simulacro'
              THEN e.Calificacion
              ELSE NULL
            END
          ) AS PromedioBruto,

          AVG(
            CASE
              WHEN e.IdCurso IS NOT NULL AND e.TipoEvaluacion IN ('Practica', 'Examen', 'Oral', 'Tarea', 'Participacion')
              THEN e.Calificacion
              ELSE NULL
            END
          ) AS PromedioCursos,

          SUM(
            CASE
              WHEN e.IdCurso IS NULL
               AND e.TipoEvaluacion = 'Simulacro'
              THEN 1
              ELSE 0
            END
          ) AS TotalSimulacros,

          SUM(
            CASE
              WHEN e.IdCurso IS NOT NULL AND e.TipoEvaluacion IN ('Practica', 'Examen', 'Oral', 'Tarea', 'Participacion')
              THEN 1
              ELSE 0
            END
          ) AS TotalNotasCurso,
          COUNT(e.IdEvaluacion) AS Evaluaciones

       FROM Evaluacion e

       INNER JOIN Matricula m
         ON m.IdMatricula = e.IdMatricula

       INNER JOIN Ciclo c
         ON c.IdCiclo = m.IdCiclo

       INNER JOIN Usuario u
         ON u.IdUsuario = m.IdUsuario

       WHERE u.IdAcademia = ?
         AND u.EstadoRegistro = 1
         AND m.EstadoRegistro = 1
         AND c.IdAcademia = ?
         AND c.EstadoRegistro = 1
         AND e.EstadoRegistro IN (1, 2)

       GROUP BY
         c.IdCiclo,
         c.Nombre,
         c.UniversidadObjetivo

       ORDER BY c.Nombre ASC`,
      [idAcademia, idAcademia]
    );

    // ========================================================
    // 7. ORGANIZAR EL RENDIMIENTO POR CICLO
    // ========================================================

    const rendimientoPorCiclo = rendimientoRows.map((row) => {
      const totalSimulacros = Number(
        row.TotalSimulacros || 0
      );

      const totalNotasCurso = Number(
        row.TotalNotasCurso || 0
      );

      const tieneSimulacros = totalSimulacros > 0;
      const tieneNotasCurso = totalNotasCurso > 0;

      const escalaConocida = maximoPorUniversidad(row.UniversidadObjetivo) !== null;
      const promedioSimulacros = tieneSimulacros && escalaConocida
        ? redondear(
            normalizarPromedio(
              row.PromedioBruto,
              row.UniversidadObjetivo
            )
          )
        : 0;

      const promedioCursos = tieneNotasCurso
        ? redondear(row.PromedioCursos)
        : 0;

      return {
        idCiclo: row.IdCiclo,
        nombre: row.Nombre,

        universidadObjetivo:
          row.UniversidadObjetivo || "Preuniversitario",

        // Campo original: se conserva para React.
        // Representa simulacros normalizados a 20.
        promedio: promedioSimulacros,

        // Campos adicionales.
        promedioSimulacros,
        promedioCursos,
        totalSimulacros,
        totalNotasCurso,

        escalaConocida,
        tieneSimulacros,
        tieneNotasCurso,

        evaluaciones: Number(row.Evaluaciones || 0),
      };
    });

    // ========================================================
    // 8. PROMEDIO INSTITUCIONAL
    //
    // Mantiene el criterio de promedio por ciclo.
    // Solo considera ciclos con simulacros registrados.
    // ========================================================

    const ciclosConSimulacros =
      rendimientoPorCiclo.filter(
        (row) => row.tieneSimulacros && row.escalaConocida
      );

    const promedioInstitucional =
      ciclosConSimulacros.length > 0
        ? ciclosConSimulacros.reduce(
            (suma, row) => suma + row.promedio,
            0
          ) / ciclosConSimulacros.length
        : 0;

    // ========================================================
    // 9. ESTADO Y VACANTES DE LOS CICLOS
    // ========================================================

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let ciclosActivos = 0;
    let ciclosCerrados = 0;
    let ciclosProximos = 0;
    let vacantesDisponibles = 0;

    const detalleCiclos = ciclos.map((ciclo) => {
      const inicio = interpretarFecha(
        ciclo.FechaInicio
      );

      const fin = interpretarFecha(
        ciclo.FechaFin,
        true
      );

      const capacidad = Number(
        ciclo.Capacidad || 0
      );

      const alumnos = Number(
        ciclo.TotalAlumnos || 0
      );

      const visible =
        Number(ciclo.EstadoRegistro) === 1;

      if (visible) {
        ciclosActivos += 1;
      } else {
        ciclosCerrados += 1;
      }

      if (visible && inicio && inicio > hoy) {
        ciclosProximos += 1;
      }

      const vacantes =
        capacidad > 0
          ? Math.max(capacidad - alumnos, 0)
          : null;

      if (vacantes !== null && visible) {
        vacantesDisponibles += vacantes;
      }

      let estado = "CERRADO";

      if (
        visible &&
        inicio &&
        fin &&
        hoy >= inicio &&
        hoy <= fin
      ) {
        estado = "EN_CURSO";
      } else if (
        visible &&
        inicio &&
        hoy < inicio
      ) {
        estado = "PROXIMO";
      } else if (
        visible &&
        (!fin || hoy <= fin)
      ) {
        estado = "ABIERTO";
      } else if (
        visible &&
        fin &&
        hoy > fin
      ) {
        estado = "FINALIZADO";
      }

      return {
        idCiclo: ciclo.IdCiclo,
        nombre: ciclo.Nombre,

        universidadObjetivo:
          ciclo.UniversidadObjetivo || "Preuniversitario",

        fechaInicio: ciclo.FechaInicio,
        fechaFin: ciclo.FechaFin,

        capacidad,
        totalAlumnos: alumnos,
        vacantesDisponibles: vacantes,

        totalEvaluaciones: Number(
          ciclo.TotalEvaluaciones || 0
        ),

        estado,
      };
    });

    // ========================================================
    // 10. RESPUESTA FINAL DEL DASHBOARD
    // Conserva la estructura utilizada por React.
    // ========================================================

    return res.json({
      resumen: {
        estudiantes: Number(
          usuarios[0]?.TotalEstudiantes || 0
        ),

        matriculasActivas: Number(
          matriculas[0]?.MatriculasActivas || 0
        ),

        ciclosActivos,
        ciclosProximos,
        ciclosCerrados,

        estudiantesMorosos: Number(
          morosidad[0]?.TotalMorosos || 0
        ),

        promedioInstitucional:
          redondear(promedioInstitucional),

        vacantesDisponibles,
      },

      pagos: {
        total: Number(
          pagosResumen[0]?.TotalPagos || 0
        ),

        pagados: Number(
          pagosResumen[0]?.Pagados || 0
        ),

        pendientes: Number(
          pagosResumen[0]?.Pendientes || 0
        ),
      },

      rendimientoPorCiclo,
      ciclos: detalleCiclos,

      actualizadoEn: new Date().toISOString(),
    });

  } catch (error) {
    if (responderErrorEsquema(res, error)) return;
    console.error(
      "Error en GET /api/admin/dashboard/overview:",
      error
    );

    return res.status(500).json({
      error:
        "No se pudieron calcular las metricas institucionales.",
    });
  }
});

module.exports = router;
