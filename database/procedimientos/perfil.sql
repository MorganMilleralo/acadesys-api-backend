-- AcadeSys | Procedimientos almacenados: Perfiles

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_perfil_listar_activos$$
CREATE PROCEDURE sp_perfil_listar_activos()
BEGIN
  SELECT IdPerfil, Nombre FROM perfil WHERE EstadoRegistro = 1;
END$$

DROP PROCEDURE IF EXISTS sp_perfil_contar_usuario_perfil$$
CREATE PROCEDURE sp_perfil_contar_usuario_perfil(
  IN p_id_perfil INT
)
BEGIN
  SELECT COUNT(*) AS total
         FROM Usuario_Perfiles up
         INNER JOIN Usuario u
           ON u.IdUsuario = up.IdUsuario
          AND u.EstadoRegistro = 1
        WHERE up.IdPerfil = p_id_perfil
          AND up.EstadoRegistro = 1;
END$$

DROP PROCEDURE IF EXISTS sp_perfil_listar_todos$$
CREATE PROCEDURE sp_perfil_listar_todos()
BEGIN
  SELECT * FROM perfil WHERE EstadoRegistro IN (0, 1) ORDER BY IdPerfil;
END$$

DROP PROCEDURE IF EXISTS sp_perfil_bloquear_perfil_por_nombre_perfil$$
CREATE PROCEDURE sp_perfil_bloquear_perfil_por_nombre_perfil(
  IN p_nombre_perfil VARCHAR(255)
)
BEGIN
  SELECT IdPerfil FROM perfil WHERE LOWER(TRIM(Nombre)) = LOWER(p_nombre_perfil) AND EstadoRegistro IN (0, 1) LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_perfil_registrar_perfil$$
CREATE PROCEDURE sp_perfil_registrar_perfil(
  IN p_nombre VARCHAR(50),
  IN p_descripcion VARCHAR(150),
  IN p_estado_registro INT
)
BEGIN
  INSERT INTO perfil (Nombre, Descripcion, EstadoRegistro) VALUES (p_nombre, p_descripcion, p_estado_registro);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_perfil_listar_perfil_por_id_perfil$$
CREATE PROCEDURE sp_perfil_listar_perfil_por_id_perfil(
  IN p_id_perfil INT
)
BEGIN
  SELECT IdPerfil, Nombre, EstadoRegistro FROM perfil WHERE IdPerfil = p_id_perfil AND EstadoRegistro IN (0, 1);
END$$

DROP PROCEDURE IF EXISTS sp_perfil_bloquear_perfil_por_nombre$$
CREATE PROCEDURE sp_perfil_bloquear_perfil_por_nombre(
  IN p_nombre VARCHAR(255),
  IN p_id_perfil INT
)
BEGIN
  SELECT IdPerfil FROM perfil WHERE LOWER(TRIM(Nombre)) = LOWER(p_nombre) AND IdPerfil <> p_id_perfil AND EstadoRegistro IN (0, 1) LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_perfil_cambiar_estado_perfil$$
CREATE PROCEDURE sp_perfil_cambiar_estado_perfil(
  IN p_id_perfil INT
)
BEGIN
  UPDATE perfil SET EstadoRegistro = -1 WHERE IdPerfil = p_id_perfil AND EstadoRegistro IN (0, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

-- Los parámetros en NULL conservan el valor actual.
DROP PROCEDURE IF EXISTS sp_perfil_actualizar$$
CREATE PROCEDURE sp_perfil_actualizar(
  IN p_id_perfil INT,
  IN p_nombre VARCHAR(50),
  IN p_descripcion VARCHAR(150),
  IN p_estado_registro INT
)
BEGIN
  UPDATE perfil
  SET Nombre = COALESCE(p_nombre, Nombre),
      Descripcion = COALESCE(p_descripcion, Descripcion),
      EstadoRegistro = COALESCE(p_estado_registro, EstadoRegistro)
  WHERE IdPerfil = p_id_perfil AND EstadoRegistro IN (0, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;
