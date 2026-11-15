-- AcadeSys | Procedimientos almacenados: Usuarios

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_usuario_verificar_perfil$$
CREATE PROCEDURE sp_usuario_verificar_perfil(
  IN p_id_perfil INT
)
BEGIN
  SELECT IdPerfil FROM perfil WHERE IdPerfil = p_id_perfil AND EstadoRegistro = 1 LIMIT 1 FOR SHARE;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_listar_perfiles_usuario$$
CREATE PROCEDURE sp_usuario_listar_perfiles_usuario(
  IN p_id_academia INT,
  IN p_id_usuario INT
)
BEGIN
  SELECT u.IdUsuario, p.Nombre AS NombrePerfil
         FROM Usuario u
         INNER JOIN Usuario_Perfiles up
           ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
         INNER JOIN perfil p
           ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
        WHERE u.IdAcademia = p_id_academia AND u.EstadoRegistro = 1 AND u.IdUsuario <> p_id_usuario;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_verificar_columna_foto$$
CREATE PROCEDURE sp_usuario_verificar_columna_foto()
BEGIN
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Usuario' AND COLUMN_NAME = 'FotoUrl' LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_obtener_foto$$
CREATE PROCEDURE sp_usuario_obtener_foto(
  IN p_id_usuario INT
)
BEGIN
  SELECT FotoUrl FROM Usuario WHERE IdUsuario = p_id_usuario LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_eliminar_foto$$
CREATE PROCEDURE sp_usuario_eliminar_foto(
  IN p_nombre_archivo VARCHAR(255)
)
BEGIN
  DELETE FROM FotoPerfil WHERE NombreArchivo = p_nombre_archivo;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_listar_academia$$
CREATE PROCEDURE sp_usuario_listar_academia(
  IN p_id_academia INT
)
BEGIN
  SELECT IdAcademia FROM Academia WHERE IdAcademia = p_id_academia;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_obtener_usuario_por_codigo_usuario$$
CREATE PROCEDURE sp_usuario_obtener_usuario_por_codigo_usuario(
  IN p_codigo_usuario VARCHAR(50)
)
BEGIN
  SELECT IdUsuario FROM Usuario WHERE CodigoUsuario = p_codigo_usuario LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_registrar_usuario$$
CREATE PROCEDURE sp_usuario_registrar_usuario(
  IN p_codigo_usuario VARCHAR(50),
  IN p_dni VARCHAR(8),
  IN p_nombres VARCHAR(100),
  IN p_apellido_paterno VARCHAR(100),
  IN p_apellido_materno VARCHAR(100),
  IN p_celular VARCHAR(15),
  IN p_correo_electronico VARCHAR(150),
  IN p_clave VARCHAR(255),
  IN p_id_academia INT
)
BEGIN
  INSERT INTO Usuario
                  (CodigoUsuario, DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, IdAcademia, FechaCreacion, EstadoRegistro)
               VALUES (p_codigo_usuario, p_dni, p_nombres, p_apellido_paterno, p_apellido_materno, p_celular, p_correo_electronico, p_clave, p_id_academia, NOW(), 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_registrar_usuario_perfil$$
CREATE PROCEDURE sp_usuario_registrar_usuario_perfil(
  IN p_id_usuario INT,
  IN p_id_perfil INT
)
BEGIN
  INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (p_id_usuario, p_id_perfil, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_listar_usuario_todos$$
CREATE PROCEDURE sp_usuario_listar_usuario_todos(
  IN p_id_academia INT
)
BEGIN
  SELECT
    u.IdUsuario, u.DNI, u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno,
    CONCAT(u.Nombres, ' ', COALESCE(u.ApellidoPaterno, ''), ' ', COALESCE(u.ApellidoMaterno, '')) AS NombreCompleto,
    u.CorreoElectronico, u.CorreoElectronico AS Correo, u.Celular, u.CodigoUsuario, u.EstadoRegistro,
    up.IdPerfil, p.Nombre AS NombrePerfil, p.Nombre AS Perfil, p.EstadoRegistro AS EstadoPerfil
  FROM Usuario u
  LEFT JOIN Usuario_Perfiles up ON u.IdUsuario = up.IdUsuario AND up.EstadoRegistro = 1
  LEFT JOIN perfil p ON up.IdPerfil = p.IdPerfil
             WHERE u.EstadoRegistro IN (0, 1) AND u.IdAcademia = p_id_academia
             ORDER BY u.IdUsuario DESC;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_listar_usuario_por_rol$$
CREATE PROCEDURE sp_usuario_listar_usuario_por_rol(
  IN p_id_academia INT,
  IN p_rol VARCHAR(255),
  IN p_id_usuario INT
)
BEGIN
  SELECT
               u.IdUsuario,
               CONCAT(u.Nombres, ' ', COALESCE(u.ApellidoPaterno, ''), ' ', COALESCE(u.ApellidoMaterno, '')) AS NombreCompleto,
               p.Nombre AS Perfil
             FROM Usuario u
             INNER JOIN Usuario_Perfiles up
               ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
             INNER JOIN perfil p
               ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
             WHERE u.EstadoRegistro = 1 AND u.IdAcademia = p_id_academia
               AND (p_rol = 1 OR u.IdUsuario = p_id_usuario)
             ORDER BY u.Nombres ASC, u.ApellidoPaterno ASC;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_obtener_detalle$$
CREATE PROCEDURE sp_usuario_obtener_detalle(
  IN p_id_usuario INT
)
BEGIN
  SELECT
    u.IdUsuario, u.DNI, u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno,
    CONCAT(u.Nombres, ' ', COALESCE(u.ApellidoPaterno, ''), ' ', COALESCE(u.ApellidoMaterno, '')) AS NombreCompleto,
    u.CorreoElectronico, u.CorreoElectronico AS Correo, u.Celular, u.CodigoUsuario, u.EstadoRegistro,
    up.IdPerfil, p.Nombre AS NombrePerfil, p.Nombre AS Perfil, p.EstadoRegistro AS EstadoPerfil
  FROM Usuario u
  LEFT JOIN Usuario_Perfiles up ON u.IdUsuario = up.IdUsuario AND up.EstadoRegistro = 1
  LEFT JOIN perfil p ON up.IdPerfil = p.IdPerfil
             WHERE u.IdUsuario = p_id_usuario AND u.EstadoRegistro = 1
             LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_registrar_foto$$
CREATE PROCEDURE sp_usuario_registrar_foto(
  IN p_nombre_archivo VARCHAR(120),
  IN p_id_usuario INT,
  IN p_contenido MEDIUMBLOB,
  IN p_tipo_mime VARCHAR(20),
  IN p_tamano_bytes INT UNSIGNED
)
BEGIN
  INSERT INTO FotoPerfil (NombreArchivo, IdUsuario, Contenido, TipoMime, TamanoBytes) VALUES (p_nombre_archivo, p_id_usuario, p_contenido, p_tipo_mime, p_tamano_bytes);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_bloquear_usuario$$
CREATE PROCEDURE sp_usuario_bloquear_usuario(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdUsuario, EstadoRegistro, DNI, CorreoElectronico FROM Usuario WHERE IdUsuario = p_id_usuario AND IdAcademia = p_id_academia AND EstadoRegistro IN (0, 1) FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_listar_usuario_perfil$$
CREATE PROCEDURE sp_usuario_listar_usuario_perfil(
  IN p_id_usuario INT
)
BEGIN
  SELECT p.Nombre AS NombrePerfil
           FROM Usuario_Perfiles up
           INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
          WHERE up.IdUsuario = p_id_usuario AND up.EstadoRegistro = 1
          FOR SHARE;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_obtener_perfil$$
CREATE PROCEDURE sp_usuario_obtener_perfil(
  IN p_id_perfil INT
)
BEGIN
  SELECT IdPerfil, Nombre FROM perfil WHERE IdPerfil = p_id_perfil AND EstadoRegistro = 1 LIMIT 1 FOR SHARE;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_obtener_estado_perfil$$
CREATE PROCEDURE sp_usuario_obtener_estado_perfil(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT u.IdUsuario, u.EstadoRegistro, p.Nombre AS NombrePerfil
             FROM Usuario u
             LEFT JOIN Usuario_Perfiles up ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
             LEFT JOIN perfil p ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
            WHERE u.IdUsuario = p_id_usuario AND u.IdAcademia = p_id_academia
            LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_cambiar_estado_usuario$$
CREATE PROCEDURE sp_usuario_cambiar_estado_usuario(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE Usuario SET EstadoRegistro = -1 WHERE IdUsuario = p_id_usuario AND IdAcademia = p_id_academia AND EstadoRegistro IN (0, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_cambiar_estado_usuario_perfil$$
CREATE PROCEDURE sp_usuario_cambiar_estado_usuario_perfil(
  IN p_id_usuario INT
)
BEGIN
  UPDATE Usuario_Perfiles SET EstadoRegistro = -1 WHERE IdUsuario = p_id_usuario;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_listar_foto_activa$$
CREATE PROCEDURE sp_usuario_listar_foto_activa(
  IN p_id_usuario INT
)
BEGIN
  SELECT IdUsuario, FotoUrl FROM Usuario WHERE IdUsuario = p_id_usuario AND EstadoRegistro = 1;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_actualizar_usuario$$
CREATE PROCEDURE sp_usuario_actualizar_usuario(
  IN p_id_usuario INT
)
BEGIN
  UPDATE Usuario SET FotoUrl = NULL WHERE IdUsuario = p_id_usuario AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_usuario_bloquear_datos_actuales$$
CREATE PROCEDURE sp_usuario_bloquear_datos_actuales(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT DNI, CorreoElectronico, FotoUrl
  FROM Usuario
  WHERE IdUsuario = p_id_usuario AND IdAcademia = p_id_academia AND EstadoRegistro = 1
  FOR UPDATE;
END$$

-- Actualización parcial: cada campo se modifica solo si su indicador p_cambia_* es 1.
-- p_solo_activos = 1 limita el cambio a usuarios activos (edición del propio perfil).
DROP PROCEDURE IF EXISTS sp_usuario_actualizar_datos$$
CREATE PROCEDURE sp_usuario_actualizar_datos(
  IN p_id_usuario INT,
  IN p_id_academia INT,
  IN p_solo_activos TINYINT,
  IN p_cambia_dni TINYINT,
  IN p_dni VARCHAR(8),
  IN p_cambia_nombres TINYINT,
  IN p_nombres VARCHAR(100),
  IN p_cambia_apellido_paterno TINYINT,
  IN p_apellido_paterno VARCHAR(100),
  IN p_cambia_apellido_materno TINYINT,
  IN p_apellido_materno VARCHAR(100),
  IN p_cambia_celular TINYINT,
  IN p_celular VARCHAR(15),
  IN p_cambia_correo TINYINT,
  IN p_correo VARCHAR(150),
  IN p_cambia_clave TINYINT,
  IN p_clave VARCHAR(255),
  IN p_cambia_estado TINYINT,
  IN p_estado_registro INT,
  IN p_cambia_foto TINYINT,
  IN p_foto_url VARCHAR(500)
)
BEGIN
  UPDATE Usuario SET
      DNI = IF(p_cambia_dni = 1, p_dni, DNI),
      Nombres = IF(p_cambia_nombres = 1, p_nombres, Nombres),
      ApellidoPaterno = IF(p_cambia_apellido_paterno = 1, p_apellido_paterno, ApellidoPaterno),
      ApellidoMaterno = IF(p_cambia_apellido_materno = 1, p_apellido_materno, ApellidoMaterno),
      Celular = IF(p_cambia_celular = 1, p_celular, Celular),
      CorreoElectronico = IF(p_cambia_correo = 1, p_correo, CorreoElectronico),
      Clave = IF(p_cambia_clave = 1, p_clave, Clave),
      EstadoRegistro = IF(p_cambia_estado = 1, p_estado_registro, EstadoRegistro),
      FotoUrl = IF(p_cambia_foto = 1, p_foto_url, FotoUrl)
  WHERE IdUsuario = p_id_usuario
    AND IdAcademia = p_id_academia
    AND (p_solo_activos = 0 OR EstadoRegistro = 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

-- Deja un único perfil activo: desactiva los demás y reactiva o crea el indicado.
DROP PROCEDURE IF EXISTS sp_usuario_asignar_perfil$$
CREATE PROCEDURE sp_usuario_asignar_perfil(
  IN p_id_usuario INT,
  IN p_id_perfil INT
)
BEGIN
  UPDATE Usuario_Perfiles SET EstadoRegistro = 0 WHERE IdUsuario = p_id_usuario;
  INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro)
  VALUES (p_id_usuario, p_id_perfil, 1)
  ON DUPLICATE KEY UPDATE EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;
