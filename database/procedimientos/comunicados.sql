-- AcadeSys | Procedimientos almacenados: Comunicados

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_comunicados_obtener_usuario$$
CREATE PROCEDURE sp_comunicados_obtener_usuario(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT CONCAT_WS(' ', Nombres, ApellidoPaterno, NULLIF(ApellidoMaterno, '')) AS nombreCompleto
         FROM Usuario
        WHERE IdUsuario = p_id_usuario AND IdAcademia = p_id_academia AND EstadoRegistro = 1
        LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_comunicados_obtener_comunicado$$
CREATE PROCEDURE sp_comunicados_obtener_comunicado(
  IN p_id_usuario INT,
  IN p_id_comunicado INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
    c.IdComunicado AS id,
    c.Titulo AS titulo,
    c.Categoria AS categoria,
    c.Prioridad AS prioridad,
    c.DirigidoA AS dirigidoA,
    c.Contenido AS contenido,
    c.AutorNombre AS autor,
    DATE_FORMAT(c.FechaCreacion, '%d/%m/%Y') AS fecha,
    DATE_FORMAT(c.FechaCreacion, '%h:%i %p') AS hora,
    CASE WHEN cl.IdComunicadoLectura IS NULL THEN 0 ELSE 1 END AS confirmado,
    CASE WHEN cl.IdComunicadoLectura IS NULL THEN 0 ELSE 1 END AS leido,
    c.EstadoRegistro AS estadoRegistro,
    c.FechaCreacion AS fechaCreacion
  FROM Comunicado c
  LEFT JOIN Comunicado_Lectura cl
    ON cl.IdComunicado = c.IdComunicado
   AND cl.IdUsuario = p_id_usuario
   AND cl.EstadoRegistro = 1

     WHERE c.IdComunicado = p_id_comunicado AND c.IdAcademia = p_id_academia AND c.EstadoRegistro = 1
     LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_comunicados_listar_comunicado$$
CREATE PROCEDURE sp_comunicados_listar_comunicado(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
    c.IdComunicado AS id,
    c.Titulo AS titulo,
    c.Categoria AS categoria,
    c.Prioridad AS prioridad,
    c.DirigidoA AS dirigidoA,
    c.Contenido AS contenido,
    c.AutorNombre AS autor,
    DATE_FORMAT(c.FechaCreacion, '%d/%m/%Y') AS fecha,
    DATE_FORMAT(c.FechaCreacion, '%h:%i %p') AS hora,
    CASE WHEN cl.IdComunicadoLectura IS NULL THEN 0 ELSE 1 END AS confirmado,
    CASE WHEN cl.IdComunicadoLectura IS NULL THEN 0 ELSE 1 END AS leido,
    c.EstadoRegistro AS estadoRegistro,
    c.FechaCreacion AS fechaCreacion
  FROM Comunicado c
  LEFT JOIN Comunicado_Lectura cl
    ON cl.IdComunicado = c.IdComunicado
   AND cl.IdUsuario = p_id_usuario
   AND cl.EstadoRegistro = 1

       WHERE c.IdAcademia = p_id_academia AND c.EstadoRegistro = 1
       ORDER BY c.FechaCreacion DESC, c.IdComunicado DESC;
END$$

DROP PROCEDURE IF EXISTS sp_comunicados_registrar_comunicado$$
CREATE PROCEDURE sp_comunicados_registrar_comunicado(
  IN p_id_academia INT,
  IN p_titulo VARCHAR(180) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_categoria VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_prioridad VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_dirigido_a VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_contenido TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_id_autor INT,
  IN p_autor_nombre VARCHAR(180) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  INSERT INTO Comunicado
          (IdAcademia, Titulo, Categoria, Prioridad, DirigidoA, Contenido, IdAutor, AutorNombre, EstadoRegistro)
         VALUES (p_id_academia, p_titulo, p_categoria, p_prioridad, p_dirigido_a, p_contenido, p_id_autor, p_autor_nombre, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_comunicados_actualizar_comunicado$$
CREATE PROCEDURE sp_comunicados_actualizar_comunicado(
  IN p_titulo VARCHAR(180) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_categoria VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_prioridad VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_dirigido_a VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_contenido TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_id_comunicado INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE Comunicado
            SET Titulo = p_titulo, Categoria = p_categoria, Prioridad = p_prioridad, DirigidoA = p_dirigido_a, Contenido = p_contenido, FechaModificacion = CURRENT_TIMESTAMP
          WHERE IdComunicado = p_id_comunicado AND IdAcademia = p_id_academia AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_comunicados_eliminar_comunicado$$
CREATE PROCEDURE sp_comunicados_eliminar_comunicado(
  IN p_id_comunicado INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE Comunicado
            SET EstadoRegistro = 0, FechaModificacion = CURRENT_TIMESTAMP
          WHERE IdComunicado = p_id_comunicado AND IdAcademia = p_id_academia AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_comunicados_registrar_lectura_comunicado$$
CREATE PROCEDURE sp_comunicados_registrar_lectura_comunicado(
  IN p_id_comunicado INT,
  IN p_id_usuario INT
)
BEGIN
  INSERT INTO Comunicado_Lectura (IdComunicado, IdUsuario, FechaLectura, EstadoRegistro)
         VALUES (p_id_comunicado, p_id_usuario, CURRENT_TIMESTAMP, 1)
         ON DUPLICATE KEY UPDATE FechaLectura = CURRENT_TIMESTAMP, EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;
