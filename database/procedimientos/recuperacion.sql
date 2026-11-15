-- AcadeSys | Procedimientos almacenados: Recuperación de contraseña

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_recuperacion_listar_usuario$$
CREATE PROCEDURE sp_recuperacion_listar_usuario(
  IN p_identificador_lower VARCHAR(150),
  IN p_identificador VARCHAR(150)
)
BEGIN
  SELECT
           u.IdUsuario,
           u.CodigoUsuario,
           u.DNI,
           u.Nombres,
           u.ApellidoPaterno,
           u.CorreoElectronico,
           u.Clave
         FROM Usuario u
         WHERE u.EstadoRegistro = 1
           AND (
             LOWER(TRIM(COALESCE(u.CorreoElectronico, ''))) = p_identificador_lower
             OR LOWER(TRIM(COALESCE(u.CodigoUsuario, ''))) = p_identificador_lower
             OR TRIM(COALESCE(u.DNI, '')) = p_identificador
             OR (
               LOWER(SUBSTRING_INDEX(TRIM(COALESCE(u.CorreoElectronico, '')), '@', 1)) = p_identificador_lower
               AND (
                 SELECT COUNT(*)
                 FROM Usuario ux
                 WHERE ux.EstadoRegistro = 1
                   AND LOWER(SUBSTRING_INDEX(TRIM(COALESCE(ux.CorreoElectronico, '')), '@', 1)) = p_identificador_lower
               ) = 1
             )
           )
         LIMIT 2;
END$$

DROP PROCEDURE IF EXISTS sp_recuperacion_bloquear_usuario$$
CREATE PROCEDURE sp_recuperacion_bloquear_usuario(
  IN p_id_usuario INT
)
BEGIN
  SELECT IdUsuario, CorreoElectronico, Clave
         FROM Usuario
         WHERE IdUsuario = p_id_usuario AND EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_recuperacion_actualizar_usuario$$
CREATE PROCEDURE sp_recuperacion_actualizar_usuario(
  IN p_clave VARCHAR(255),
  IN p_id_usuario INT
)
BEGIN
  UPDATE Usuario SET Clave = p_clave WHERE IdUsuario = p_id_usuario AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;
