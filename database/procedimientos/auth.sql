-- AcadeSys | Procedimientos almacenados: Autenticación y registro

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_auth_obtener_sesion_usuario$$
CREATE PROCEDURE sp_auth_obtener_sesion_usuario(
  IN p_id_usuario INT
)
BEGIN
  SELECT
              u.IdUsuario,
              u.IdAcademia,
              up.IdPerfil,
              p.Nombre AS Rol
           FROM Usuario u
           INNER JOIN Usuario_Perfiles up
             ON up.IdUsuario = u.IdUsuario
             AND up.EstadoRegistro = 1
           INNER JOIN perfil p
             ON p.IdPerfil = up.IdPerfil
             AND p.EstadoRegistro = 1
           WHERE u.IdUsuario = p_id_usuario
             AND u.EstadoRegistro = 1
           LIMIT 2;
END$$

DROP PROCEDURE IF EXISTS sp_auth_obtener_perfil$$
CREATE PROCEDURE sp_auth_obtener_perfil(
  IN p_nombre VARCHAR(255)
)
BEGIN
  SELECT IdPerfil,
              COALESCE(NULLIF(Nombre, ''), 'Sin Rol') AS Nombre
         FROM perfil
        WHERE EstadoRegistro = 1
          AND LOWER(COALESCE(NULLIF(Nombre, ''), '')) = LOWER(p_nombre)
        LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_auth_listar_academia$$
CREATE PROCEDURE sp_auth_listar_academia(
  IN p_id_academia INT
)
BEGIN
  SELECT IdAcademia FROM Academia WHERE IdAcademia = p_id_academia;
END$$

DROP PROCEDURE IF EXISTS sp_auth_obtener_usuario$$
CREATE PROCEDURE sp_auth_obtener_usuario(
  IN p_codigo_usuario VARCHAR(50)
)
BEGIN
  SELECT IdUsuario FROM Usuario WHERE CodigoUsuario = p_codigo_usuario LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_auth_registrar_usuario$$
CREATE PROCEDURE sp_auth_registrar_usuario(
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
          (CodigoUsuario, DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular,
           CorreoElectronico, Clave, FechaCreacion, EstadoRegistro, IdAcademia)
          VALUES (p_codigo_usuario, p_dni, p_nombres, p_apellido_paterno, p_apellido_materno, p_celular, p_correo_electronico, p_clave, NOW(), 1, p_id_academia);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_auth_registrar_usuario_perfil$$
CREATE PROCEDURE sp_auth_registrar_usuario_perfil(
  IN p_id_usuario INT,
  IN p_id_perfil INT
)
BEGIN
  INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro)
         VALUES (p_id_usuario, p_id_perfil, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_auth_buscar_usuario_login$$
CREATE PROCEDURE sp_auth_buscar_usuario_login(
  IN p_term_lower VARCHAR(255),
  IN p_termino VARCHAR(255)
)
BEGIN
  SELECT
          u.IdUsuario,
          u.DNI,
          u.Nombres,
          u.ApellidoPaterno,
          u.ApellidoMaterno,
          CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno) AS NombreCompleto,
          u.CorreoElectronico,
          u.Clave,
          u.EstadoRegistro,
          u.CodigoUsuario,
          u.IdAcademia,
          up.IdPerfil,
          COALESCE(NULLIF(p.Nombre, ''), 'Sin Rol') AS Rol,
          a.NombreAcademia,
          a.ColorTema,
          a.LogoUrl
        FROM Usuario u
        INNER JOIN Usuario_Perfiles up
          ON u.IdUsuario = up.IdUsuario
         AND up.EstadoRegistro = 1
        INNER JOIN perfil p
          ON up.IdPerfil = p.IdPerfil AND p.EstadoRegistro = 1
        LEFT JOIN Academia a
          ON u.IdAcademia = a.IdAcademia
        WHERE u.EstadoRegistro = 1
          AND (
            LOWER(TRIM(u.CorreoElectronico)) = p_term_lower
            OR LOWER(TRIM(u.CodigoUsuario)) = p_term_lower
            OR TRIM(COALESCE(u.DNI, '')) = p_termino
            OR (
              LOWER(SUBSTRING_INDEX(u.CorreoElectronico, '@', 1)) = p_term_lower
              AND (
                SELECT COUNT(*)
                FROM Usuario ux
                WHERE ux.EstadoRegistro = 1
                  AND LOWER(SUBSTRING_INDEX(ux.CorreoElectronico, '@', 1)) = p_term_lower
              ) = 1
            )
          )
        ORDER BY CASE
          WHEN LOWER(TRIM(u.CorreoElectronico)) = p_term_lower THEN 1
          WHEN LOWER(TRIM(u.CodigoUsuario)) = p_term_lower THEN 2
          WHEN TRIM(COALESCE(u.DNI, '')) = p_termino THEN 3
          ELSE 4
        END
        LIMIT 2;
END$$

DROP PROCEDURE IF EXISTS sp_auth_actualizar_usuario$$
CREATE PROCEDURE sp_auth_actualizar_usuario(
  IN p_clave VARCHAR(255),
  IN p_id_usuario INT,
  IN p_clave_en_bd VARCHAR(255)
)
BEGIN
  UPDATE Usuario SET Clave = p_clave WHERE IdUsuario = p_id_usuario AND BINARY Clave = BINARY p_clave_en_bd AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_auth_obtener_matricula$$
CREATE PROCEDURE sp_auth_obtener_matricula(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
            m.IdMatricula,
            c.IdCiclo,
            c.Nombre AS NombreCiclo,
            c.Turno,
            c.Horario,
            c.DiasClase,
            c.UniversidadObjetivo,
            c.FechaInicio,
            c.FechaFin,
            (
              SELECT COUNT(*)
              FROM Matricula m2
              WHERE m2.IdCiclo = c.IdCiclo
                AND m2.EstadoRegistro = 1
            ) AS TotalAlumnos
          FROM Matricula m
          INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
          WHERE m.IdUsuario = p_id_usuario
            AND c.IdAcademia = p_id_academia
            AND m.EstadoRegistro = 1
            AND c.EstadoRegistro = 1
          ORDER BY m.IdMatricula DESC
          LIMIT 1;
END$$

DELIMITER ;
