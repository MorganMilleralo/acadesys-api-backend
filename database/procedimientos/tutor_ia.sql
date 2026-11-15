-- AcadeSys | Procedimientos almacenados: Tutor IA

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_tutor_ia_obtener_usuario$$
CREATE PROCEDURE sp_tutor_ia_obtener_usuario(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
         u.IdUsuario,
         u.Nombres,
         u.ApellidoPaterno,
         u.ApellidoMaterno,
         CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno) AS NombreCompleto,
         u.CodigoUsuario,
         u.CorreoElectronico
       FROM Usuario u
       WHERE u.IdUsuario = p_id_usuario
         AND u.IdAcademia = p_id_academia
         AND u.EstadoRegistro = 1
       LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_tutor_ia_obtener_matricula$$
CREATE PROCEDURE sp_tutor_ia_obtener_matricula(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
         m.IdMatricula,
         c.IdCiclo,
         c.Nombre AS NombreCiclo,
         COALESCE(NULLIF(TRIM(c.UniversidadObjetivo), ''), 'Preuniversitario') AS UniversidadObjetivo,
         c.Turno,
         c.Horario,
         c.FechaInicio,
         c.FechaFin,
         c.EstadoRegistro AS EstadoCiclo
       FROM Matricula m
       INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
       INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
       WHERE m.IdUsuario = p_id_usuario
         AND u.IdAcademia = p_id_academia
         AND u.EstadoRegistro = 1
         AND m.EstadoRegistro = 1
         AND c.EstadoRegistro = 1
         AND c.IdAcademia = p_id_academia
       ORDER BY m.IdMatricula DESC
       LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_tutor_ia_listar_ciclo_curso$$
CREATE PROCEDURE sp_tutor_ia_listar_ciclo_curso(
  IN p_id_ciclo INT
)
BEGIN
  SELECT cu.IdCurso, cu.Nombre, cu.Codigo, cu.Descripcion
         FROM CicloCurso cc
         INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
         WHERE cc.IdCiclo = p_id_ciclo
           AND cc.EstadoRegistro = 1
           AND cu.EstadoRegistro = 1
         ORDER BY cc.Orden ASC, cu.Nombre ASC;
END$$

DROP PROCEDURE IF EXISTS sp_tutor_ia_listar_evaluacion$$
CREATE PROCEDURE sp_tutor_ia_listar_evaluacion(
  IN p_id_usuario INT,
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
           e.IdEvaluacion,
           COALESCE(cu.Nombre, 'Simulacro general') AS Curso,
           e.TipoEvaluacion,
           e.Calificacion,
           e.EstadoRegistro,
           e.FechaCreacion
         FROM Evaluacion e
         INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
         INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
         INNER JOIN Ciclo ci ON ci.IdCiclo = m.IdCiclo AND ci.IdAcademia = u.IdAcademia
         LEFT JOIN Curso cu ON cu.IdCurso = m.IdCurso
         WHERE m.IdUsuario = p_id_usuario
           AND m.IdCiclo = p_id_ciclo
           AND u.IdAcademia = p_id_academia
           AND u.EstadoRegistro = 1
           AND m.EstadoRegistro = 1
           AND e.EstadoRegistro IN (1, 2)
         ORDER BY e.FechaCreacion DESC, e.IdEvaluacion DESC
         LIMIT 100;
END$$

DROP PROCEDURE IF EXISTS sp_tutor_ia_listar_matricula$$
CREATE PROCEDURE sp_tutor_ia_listar_matricula(
  IN p_id_ciclo INT,
  IN p_id_academia INT,
  IN p_promedio_general DOUBLE
)
BEGIN
  SELECT COUNT(*) + 1 AS Puesto
           FROM (
             SELECT m2.IdUsuario, AVG(e2.Calificacion) AS Promedio
             FROM Matricula m2
             INNER JOIN Evaluacion e2 ON e2.IdMatricula = m2.IdMatricula
             INNER JOIN Usuario u2 ON u2.IdUsuario = m2.IdUsuario
             WHERE m2.IdCiclo = p_id_ciclo
               AND m2.EstadoRegistro = 1
               AND u2.IdAcademia = p_id_academia
               AND u2.EstadoRegistro = 1
               AND e2.EstadoRegistro IN (1, 2)
             GROUP BY m2.IdUsuario
             HAVING AVG(e2.Calificacion) > p_promedio_general
           ) r;
END$$

DELIMITER ;
