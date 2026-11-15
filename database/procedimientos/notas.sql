-- AcadeSys | Procedimientos almacenados: Notas y simulacros

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_notas_listar_evaluacion_todos$$
CREATE PROCEDURE sp_notas_listar_evaluacion_todos(
  IN p_id_academia INT
)
BEGIN
  SELECT e.IdEvaluacion, e.IdMatricula, e.TipoEvaluacion, e.Periodo, e.Calificacion, e.FechaCreacion,
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
          WHERE e.EstadoRegistro IN (1, 2) AND u.IdAcademia = p_id_academia;
END$$

DROP PROCEDURE IF EXISTS sp_notas_obtener_ciclo$$
CREATE PROCEDURE sp_notas_obtener_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT ci.IdCiclo, ci.Nombre, ci.UniversidadObjetivo
         FROM Ciclo ci
         WHERE ci.IdCiclo = p_id_ciclo
           AND ci.IdAcademia = p_id_academia
           AND ci.EstadoRegistro = 1
         LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_notas_listar_matricula$$
CREATE PROCEDURE sp_notas_listar_matricula(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT m.IdMatricula, m.IdUsuario, m.IdCiclo,
                u.CodigoUsuario, u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno
         FROM Matricula m
         INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
         INNER JOIN Ciclo ci ON ci.IdCiclo = m.IdCiclo
         WHERE m.IdCiclo = p_id_ciclo
           AND m.EstadoRegistro = 1
           AND u.EstadoRegistro = 1
           AND u.IdAcademia = p_id_academia
           AND ci.IdAcademia = p_id_academia
           AND ci.EstadoRegistro = 1
         ORDER BY u.ApellidoPaterno, u.ApellidoMaterno, u.Nombres;
END$$

DROP PROCEDURE IF EXISTS sp_notas_listar_evaluacion_por_id_usuario$$
CREATE PROCEDURE sp_notas_listar_evaluacion_por_id_usuario(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT COALESCE(c.Nombre, 'Simulacro General') AS Curso,
                e.TipoEvaluacion, e.Periodo, e.Calificacion, e.FechaCreacion,
                e.EstadoRegistro AS EstadoRegistro,
                ci.UniversidadObjetivo, ci.Nombre AS Ciclo
         FROM Evaluacion e
         INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
         INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
         LEFT JOIN Curso c ON m.IdCurso = c.IdCurso
         INNER JOIN Ciclo ci ON ci.IdCiclo = m.IdCiclo AND ci.IdAcademia = u.IdAcademia
          WHERE u.IdUsuario = p_id_usuario AND u.IdAcademia = p_id_academia
            AND e.EstadoRegistro IN (1, 2)
          ORDER BY e.FechaCreacion DESC, e.IdEvaluacion DESC;
END$$

DROP PROCEDURE IF EXISTS sp_notas_bloquear_ciclo_universidad$$
CREATE PROCEDURE sp_notas_bloquear_ciclo_universidad(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdCiclo, Nombre, UniversidadObjetivo
           FROM Ciclo
           WHERE IdCiclo = p_id_ciclo AND IdAcademia = p_id_academia AND EstadoRegistro = 1
           LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_notas_bloquear_matricula$$
CREATE PROCEDURE sp_notas_bloquear_matricula(
  IN p_id_matricula INT,
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT m.IdMatricula, m.IdCurso
             FROM Matricula m
             INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
             INNER JOIN Ciclo ci ON ci.IdCiclo = m.IdCiclo
             WHERE m.IdMatricula = p_id_matricula
               AND m.IdCiclo = p_id_ciclo
               AND m.EstadoRegistro = 1
               AND u.EstadoRegistro = 1
               AND u.IdAcademia = p_id_academia
               AND ci.IdAcademia = p_id_academia
               AND ci.EstadoRegistro = 1
             LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_notas_bloquear_evaluacion_por_id_matricula$$
CREATE PROCEDURE sp_notas_bloquear_evaluacion_por_id_matricula(
  IN p_id_matricula INT,
  IN p_periodo VARCHAR(255),
  IN p_tipo_evaluacion VARCHAR(50)
)
BEGIN
  SELECT IdEvaluacion FROM Evaluacion
             WHERE IdMatricula = p_id_matricula AND COALESCE(Periodo, 'General') = p_periodo AND TipoEvaluacion = p_tipo_evaluacion
               AND EstadoRegistro IN (1, 2) LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_notas_bloquear_cierre$$
CREATE PROCEDURE sp_notas_bloquear_cierre(
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_periodo VARCHAR(50),
  IN p_tipo_evaluacion VARCHAR(50)
)
BEGIN
  SELECT IdCierre FROM Auditoria_Cierres
             WHERE IdCiclo = p_id_ciclo AND IdCurso <=> p_id_curso AND Periodo = p_periodo AND TipoEvaluacion = p_tipo_evaluacion
             LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_notas_registrar_evaluacion$$
CREATE PROCEDURE sp_notas_registrar_evaluacion(
  IN p_id_matricula INT,
  IN p_calificacion INT,
  IN p_tipo_evaluacion VARCHAR(50),
  IN p_periodo VARCHAR(50),
  IN p_usuario_creacion INT
)
BEGIN
  INSERT INTO Evaluacion
               (IdMatricula, Calificacion, TipoEvaluacion, Periodo, UsuarioCreacion, FechaCreacion, EstadoRegistro)
             VALUES (p_id_matricula, p_calificacion, p_tipo_evaluacion, p_periodo, p_usuario_creacion, NOW(), 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_notas_obtener_evaluacion$$
CREATE PROCEDURE sp_notas_obtener_evaluacion(
  IN p_id_evaluacion INT,
  IN p_id_academia INT
)
BEGIN
  SELECT e.IdEvaluacion, e.EstadoRegistro, e.Periodo, e.TipoEvaluacion, m.IdCiclo, m.IdCurso,
                  ci.UniversidadObjetivo, ci.Nombre AS CicloNombre
           FROM Evaluacion e
           INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
           INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
           INNER JOIN Ciclo ci ON m.IdCiclo = ci.IdCiclo
           WHERE e.IdEvaluacion = p_id_evaluacion
             AND u.IdAcademia = p_id_academia
              AND ci.IdAcademia = u.IdAcademia
              AND m.EstadoRegistro = 1 AND u.EstadoRegistro = 1
              AND e.EstadoRegistro IN (1, 2)
           LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_notas_bloquear_ciclo$$
CREATE PROCEDURE sp_notas_bloquear_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdCiclo FROM Ciclo
           WHERE IdCiclo = p_id_ciclo AND IdAcademia = p_id_academia AND EstadoRegistro = 1
           LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_notas_bloquear_evaluacion_por_id_evaluacion$$
CREATE PROCEDURE sp_notas_bloquear_evaluacion_por_id_evaluacion(
  IN p_id_evaluacion INT
)
BEGIN
  SELECT EstadoRegistro FROM Evaluacion WHERE IdEvaluacion = p_id_evaluacion FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_notas_actualizar_evaluacion$$
CREATE PROCEDURE sp_notas_actualizar_evaluacion(
  IN p_calificacion INT,
  IN p_usuario_modificacion INT,
  IN p_id_evaluacion INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE Evaluacion e
           INNER JOIN Matricula m ON e.IdMatricula = m.IdMatricula
           INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
           SET e.Calificacion = p_calificacion, e.UsuarioModificacion = p_usuario_modificacion, e.FechaModificacion = NOW()
            WHERE e.IdEvaluacion = p_id_evaluacion AND u.IdAcademia = p_id_academia AND e.EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;
