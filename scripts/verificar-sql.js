// Verificación de sintaxis SQL de las consultas modificadas (solo lectura).
// Ejecutar con: node scripts/verificar-sql.js
// Usa EXPLAIN con valores de muestra: no ejecuta ninguna escritura ni altera datos.
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

const CONSULTAS = [
  ['notas: listado de gestión', `SELECT e.IdEvaluacion, e.IdMatricula, e.TipoEvaluacion, e.Periodo, e.Calificacion, e.FechaCreacion,
              e.EstadoRegistro AS EstadoRegistro,
              u.CodigoUsuario, CONCAT(u.Nombres, ' ', u.ApellidoPaterno) AS Alumno,
              COALESCE(c.Nombre, 'Simulacro General') AS Curso,
              ci.Nombre AS Ciclo,
              ci.UniversidadObjetivo
       FROM Evaluacion e
       INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
       INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
       LEFT JOIN Curso c ON m.IdCurso = c.IdCurso
       INNER JOIN Ciclo ci ON ci.IdCiclo = m.IdCiclo AND ci.IdAcademia = u.IdAcademia
        WHERE e.EstadoRegistro IN (1, 2) AND u.IdAcademia = ?`, [1]],
  ['notas: historial de alumno', `SELECT COALESCE(c.Nombre, 'Simulacro General') AS Curso,
              e.TipoEvaluacion, e.Periodo, e.Calificacion, e.FechaCreacion,
              e.EstadoRegistro AS EstadoRegistro,
              ci.UniversidadObjetivo, ci.Nombre AS Ciclo
       FROM Evaluacion e
       INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
       INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
       LEFT JOIN Curso c ON m.IdCurso = c.IdCurso
       INNER JOIN Ciclo ci ON ci.IdCiclo = m.IdCiclo AND ci.IdAcademia = u.IdAcademia
        WHERE u.IdUsuario = ? AND u.IdAcademia = ?
          AND e.EstadoRegistro IN (1, 2)
        ORDER BY e.FechaCreacion DESC, e.IdEvaluacion DESC`, [1, 1]],
  ['notas: duplicado por alumno/periodo/tipo', `SELECT IdEvaluacion FROM Evaluacion
           WHERE IdMatricula = ? AND COALESCE(Periodo, 'General') = ? AND TipoEvaluacion = ?
             AND EstadoRegistro IN (1, 2) LIMIT 1 FOR UPDATE`, [1, 'General', 'Simulacro']],
  ['notas: estado actual bajo lock', 'SELECT EstadoRegistro FROM Evaluacion WHERE IdEvaluacion = ? FOR UPDATE', [1]],
  ['horarios: solapamiento', `SELECT IdHorario FROM HorarioCurso WHERE IdCiclo = ? AND DiaNumero = ? AND EstadoRegistro = 1
       AND IdHorario <> ? AND HoraInicio < ? AND HoraFin > ? LIMIT 1 FOR UPDATE`, [1, 1, 0, '10:00:00', '08:00:00']],
  ['horarios: curso vinculado al ciclo', `SELECT cu.IdCurso FROM Curso cu INNER JOIN CicloCurso cc ON cc.IdCurso = cu.IdCurso
       WHERE cu.IdCurso = ? AND cc.IdCiclo = ? AND cu.EstadoRegistro = 1 AND cc.EstadoRegistro = 1 LIMIT 1 FOR UPDATE`, [1, 1]],
  ['materiales: listado por academia', `SELECT ma.IdMaterial, ma.IdCiclo, ma.IdCurso, ma.Titulo, ma.Descripcion,
              ma.NombreArchivo, ma.UrlArchivo, ma.TipoMime, ma.FechaPublicacion,
              c.Nombre AS Ciclo, cu.Nombre AS Curso
       FROM MaterialAcademico ma
       INNER JOIN Ciclo c ON c.IdCiclo = ma.IdCiclo
       INNER JOIN Curso cu ON cu.IdCurso = ma.IdCurso
       WHERE ma.EstadoRegistro = 1 AND c.IdAcademia = ?
       ORDER BY ma.FechaPublicacion DESC, ma.IdMaterial DESC`, [1]],
  ['materiales: ciclo/curso de la academia', `SELECT c.IdCiclo, cu.IdCurso, cu.Nombre AS Curso
       FROM CicloCurso cc
       INNER JOIN Ciclo c ON c.IdCiclo = cc.IdCiclo
       INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
       WHERE cc.IdCiclo = ? AND cc.IdCurso = ? AND cc.EstadoRegistro = 1
         AND c.EstadoRegistro = 1 AND c.IdAcademia = ? AND cu.EstadoRegistro = 1
       LIMIT 1`, [1, 1, 1]],
  ['alumno: historial con notas cerradas', `SELECT e.IdEvaluacion, COALESCE(cu.Nombre, 'Simulacro general') AS Curso,
              e.TipoEvaluacion, e.Calificacion, e.EstadoRegistro AS EstadoRegistro, e.FechaCreacion
       FROM Evaluacion e
       INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
       LEFT JOIN Curso cu ON cu.IdCurso = m.IdCurso
       WHERE m.IdUsuario = ? AND m.IdCiclo = ? AND e.EstadoRegistro IN (1, 2)
       ORDER BY e.FechaCreacion DESC, e.IdEvaluacion DESC`, [1, 1]],
  ['alumno: docente del curso', `SELECT COALESCE((SELECT GROUP_CONCAT(DISTINCT TRIM(CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno)) SEPARATOR ', ')
          FROM Asignacion_Aula aa INNER JOIN Usuario u ON u.IdUsuario = aa.IdUsuario
          WHERE aa.IdCiclo = cc.IdCiclo AND aa.IdCurso = cc.IdCurso AND aa.IdAcademia = ?
            AND aa.EstadoRegistro = 1 AND u.EstadoRegistro = 1 AND u.IdAcademia = aa.IdAcademia), 'Por asignar') AS Docente
       FROM CicloCurso cc
       INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
       WHERE cc.IdCiclo = ? AND cc.EstadoRegistro = 1 AND cu.EstadoRegistro = 1`, [1, 1]],
  ['alumno: ranking con notas cerradas', `SELECT COUNT(*) + 1 AS Puesto FROM (
           SELECT m2.IdUsuario, AVG(e2.Calificacion) AS Promedio
           FROM Matricula m2
           INNER JOIN Evaluacion e2 ON e2.IdMatricula = m2.IdMatricula
           INNER JOIN Usuario u2 ON u2.IdUsuario = m2.IdUsuario
           WHERE m2.IdCiclo = ? AND m2.EstadoRegistro = 1 AND u2.EstadoRegistro = 1
             AND e2.EstadoRegistro IN (1, 2)
           GROUP BY m2.IdUsuario
           HAVING AVG(e2.Calificacion) > 0
         ) r`, [1]],
  ['dashboard: total de evaluaciones', `SELECT COUNT(*) AS TotalEvaluaciones
       FROM Evaluacion e
       INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
       INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
       WHERE m.IdCiclo = ? AND m.EstadoRegistro = 1 AND e.EstadoRegistro IN (1, 2) AND u.IdAcademia = ?`, [1, 1]],
  ['pagos: actualizar estado con academia', `SELECT p.IdPago, p.Estado, p.Mes
         FROM PagosMensualidad p
         INNER JOIN Usuario u ON p.IdUsuario = u.IdUsuario
         INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
          WHERE p.IdPago = ? AND u.IdAcademia = ?
            AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
         LIMIT 1 FOR UPDATE`, [1, 1]],
  ['usuarios: duplicado de identidad', `SELECT IdUsuario FROM Usuario
     WHERE IdUsuario <> ? AND
       ((? IS NOT NULL AND LOWER(TRIM(CorreoElectronico)) = ?) OR (? IS NOT NULL AND TRIM(DNI) = ?))
     LIMIT 1 FOR UPDATE`, [0, 'a@b.test', 'a@b.test', '12345678', '12345678']],
  ['cursos: dependencias al retirar del ciclo', `SELECT IdCurso FROM HorarioCurso WHERE IdCiclo = ? AND EstadoRegistro = 1 AND IdCurso IS NOT NULL AND IdCurso NOT IN (?)
       UNION ALL SELECT IdCurso FROM Asignacion_Aula WHERE IdCiclo = ? AND EstadoRegistro = 1 AND IdCurso IS NOT NULL AND IdCurso NOT IN (?)
       UNION ALL SELECT IdCurso FROM MaterialAcademico WHERE IdCiclo = ? AND EstadoRegistro = 1 AND IdCurso IS NOT NULL AND IdCurso NOT IN (?)
       UNION ALL SELECT IdCurso FROM Matricula WHERE IdCiclo = ? AND EstadoRegistro = 1 AND IdCurso IS NOT NULL AND IdCurso NOT IN (?)
       LIMIT 1`, [1, 2, 1, 2, 1, 2, 1, 2]],
];

async function main() {
  const conexion = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 8000,
  });
  let fallos = 0;
  try {
    for (const [titulo, sql, params] of CONSULTAS) {
      try {
        await conexion.query(sql, params);
        console.log(`OK   ${titulo}`);
      } catch (error) {
        fallos += 1;
        console.log(`FALLA ${titulo}: ${error.message}`);
      }
    }
  } finally {
    await conexion.end();
  }
  console.log(fallos === 0 ? 'Todas las consultas modificadas son válidas.' : `Consultas con error: ${fallos}`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});


