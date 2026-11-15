-- AcadeSys | Procedimientos almacenados: Menús y permisos

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_menu_listar_menus_principales$$
CREATE PROCEDURE sp_menu_listar_menus_principales()
BEGIN
  SELECT IdOpcionMenu, Nombre, UrlMenu, Descripcion, IdPadre, EstadoRegistro FROM OpcionesMenu WHERE (IdPadre IS NULL OR IdPadre = 0) AND EstadoRegistro = 1 ORDER BY IdOpcionMenu;
END$$

DROP PROCEDURE IF EXISTS sp_menu_listar_menu_por_id_opcion_menu$$
CREATE PROCEDURE sp_menu_listar_menu_por_id_opcion_menu(
  IN p_id_opcion_menu INT
)
BEGIN
  SELECT IdOpcionMenu FROM OpcionesMenu WHERE IdOpcionMenu = p_id_opcion_menu AND EstadoRegistro = 1;
END$$

DROP PROCEDURE IF EXISTS sp_menu_listar_menu_por_id_padre$$
CREATE PROCEDURE sp_menu_listar_menu_por_id_padre(
  IN p_id_padre INT
)
BEGIN
  SELECT IdOpcionMenu, Nombre, UrlMenu, Descripcion, IdPadre, EstadoRegistro FROM OpcionesMenu WHERE IdPadre = p_id_padre AND EstadoRegistro = 1 ORDER BY IdOpcionMenu;
END$$

DROP PROCEDURE IF EXISTS sp_menu_obtener_perfil$$
CREATE PROCEDURE sp_menu_obtener_perfil(
  IN p_id_perfil INT
)
BEGIN
  SELECT IdPerfil, Nombre, EstadoRegistro FROM perfil WHERE IdPerfil = p_id_perfil AND EstadoRegistro = 1;
END$$

DROP PROCEDURE IF EXISTS sp_menu_listar_menu_por_id_perfil$$
CREATE PROCEDURE sp_menu_listar_menu_por_id_perfil(
  IN p_id_perfil INT
)
BEGIN
  SELECT m.IdOpcionMenu, m.Nombre, m.UrlMenu, m.Descripcion, m.IdPadre,
                m.EstadoRegistro, MIN(mp.Orden) AS Orden
         FROM OpcionesMenu m
         INNER JOIN OpcionesMenu_Perfiles mp ON mp.IdOpcionMenu = m.IdOpcionMenu
         WHERE mp.IdPerfil = p_id_perfil AND mp.EstadoRegistro = 1 AND m.EstadoRegistro = 1
         GROUP BY m.IdOpcionMenu, m.Nombre, m.UrlMenu, m.Descripcion, m.IdPadre, m.EstadoRegistro
         ORDER BY Orden, m.IdOpcionMenu;
END$$

DROP PROCEDURE IF EXISTS sp_menu_listar_jerarquia$$
CREATE PROCEDURE sp_menu_listar_jerarquia()
BEGIN
  SELECT IdOpcionMenu, IdPadre FROM OpcionesMenu WHERE EstadoRegistro = 1;
END$$

DROP PROCEDURE IF EXISTS sp_menu_bloquear_menu$$
CREATE PROCEDURE sp_menu_bloquear_menu(
  IN p_url_menu VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
  IN p_padre INT
)
BEGIN
  SELECT IdOpcionMenu FROM OpcionesMenu WHERE UrlMenu = p_url_menu
        AND COALESCE(IdPadre, 0) = COALESCE(p_padre, 0) AND EstadoRegistro IN (0, 1) LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_menu_registrar_menu$$
CREATE PROCEDURE sp_menu_registrar_menu(
  IN p_nombre VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
  IN p_url_menu VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
  IN p_descripcion VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
  IN p_id_padre INT,
  IN p_estado_registro INT
)
BEGIN
  INSERT INTO OpcionesMenu (Nombre, UrlMenu, Descripcion, IdPadre, EstadoRegistro) VALUES (p_nombre, p_url_menu, p_descripcion, p_id_padre, p_estado_registro);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_menu_verificar_perfil$$
CREATE PROCEDURE sp_menu_verificar_perfil(
  IN p_id_perfil INT
)
BEGIN
  SELECT IdPerfil FROM perfil WHERE IdPerfil = p_id_perfil AND EstadoRegistro = 1;
END$$

DROP PROCEDURE IF EXISTS sp_menu_obtener_menu_perfil$$
CREATE PROCEDURE sp_menu_obtener_menu_perfil(
  IN p_id_opcion_menu INT,
  IN p_id_perfil INT,
  IN p_estado_registro INT
)
BEGIN
  SELECT IdOpcionMenu FROM OpcionesMenu_Perfiles WHERE IdOpcionMenu = p_id_opcion_menu AND IdPerfil = p_id_perfil AND EstadoRegistro = p_estado_registro ORDER BY Orden LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_menu_registrar_menu_perfil$$
CREATE PROCEDURE sp_menu_registrar_menu_perfil(
  IN p_id_opcion_menu INT,
  IN p_id_perfil INT,
  IN p_orden INT,
  IN p_estado_registro INT
)
BEGIN
  INSERT INTO OpcionesMenu_Perfiles (IdOpcionMenu, IdPerfil, Orden, EstadoRegistro) VALUES (p_id_opcion_menu, p_id_perfil, p_orden, p_estado_registro);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;
