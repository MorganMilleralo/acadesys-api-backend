-- AcadeSys | Procedimientos almacenados: Cierre de actas

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_actas_obtener_evaluacion$$
CREATE PROCEDURE sp_actas_obtener_evaluacion(
  IN p_id_evaluacion INT,
  IN p_id_academia INT
)
BEGIN
  SELECT e.IdEvaluacion, e.EstadoRegistro, e.Periodo, e.TipoEvaluacion,
                m.IdCiclo, m.IdCurso, u.IdAcademia
         FROM Evaluacion e
         INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
         INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
         INNER JOIN Ciclo ci ON ci.IdCiclo = m.IdCiclo AND ci.IdAcademia = u.IdAcademia
          WHERE e.IdEvaluacion = p_id_evaluacion AND u.IdAcademia = p_id_academia
         LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_actas_obtener_cierre$$
CREATE PROCEDURE sp_actas_obtener_cierre(
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_periodo VARCHAR(50),
  IN p_tipo_evaluacion VARCHAR(50),
  IN p_id_academia INT
)
BEGIN
  SELECT ac.IdCierre
         FROM Auditoria_Cierres ac
         INNER JOIN Ciclo ci ON ci.IdCiclo = ac.IdCiclo
         WHERE ac.IdCiclo = p_id_ciclo
           AND ac.IdCurso <=> p_id_curso
           AND ac.Periodo = p_periodo
           AND ac.TipoEvaluacion = p_tipo_evaluacion
           AND ci.IdAcademia = p_id_academia
         LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_actas_bloquear_ciclo$$
CREATE PROCEDURE sp_actas_bloquear_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdCiclo FROM Ciclo
         WHERE IdCiclo = p_id_ciclo AND IdAcademia = p_id_academia AND EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_actas_obtener_ciclo_curso$$
CREATE PROCEDURE sp_actas_obtener_ciclo_curso(
  IN p_id_ciclo INT,
  IN p_id_curso INT
)
BEGIN
  SELECT IdCurso FROM CicloCurso
           WHERE IdCiclo = p_id_ciclo AND IdCurso = p_id_curso AND EstadoRegistro = 1
           LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_actas_bloquear_cierre$$
CREATE PROCEDURE sp_actas_bloquear_cierre(
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

DROP PROCEDURE IF EXISTS sp_actas_actualizar_evaluacion$$
CREATE PROCEDURE sp_actas_actualizar_evaluacion(
  IN p_usuario_modificacion INT,
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_periodo VARCHAR(50),
  IN p_tipo_evaluacion VARCHAR(50),
  IN p_id_academia INT
)
BEGIN
  UPDATE Evaluacion e
         INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
         INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
         SET e.EstadoRegistro = 2,
             e.UsuarioModificacion = p_usuario_modificacion,
             e.FechaModificacion = NOW()
         WHERE m.IdCiclo = p_id_ciclo
           AND m.IdCurso <=> p_id_curso
           AND e.Periodo = p_periodo
           AND e.TipoEvaluacion = p_tipo_evaluacion
           AND e.EstadoRegistro = 1
           AND u.IdAcademia = p_id_academia;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_actas_registrar_cierre$$
CREATE PROCEDURE sp_actas_registrar_cierre(
  IN p_id_administrador INT,
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_periodo VARCHAR(50),
  IN p_tipo_evaluacion VARCHAR(50)
)
BEGIN
  INSERT INTO Auditoria_Cierres
           (IdAdministrador, IdCiclo, IdCurso, Periodo, TipoEvaluacion, FechaCierre)
         VALUES (p_id_administrador, p_id_ciclo, p_id_curso, p_periodo, p_tipo_evaluacion, NOW());
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;
