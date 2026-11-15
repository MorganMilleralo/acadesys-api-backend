-- AcadeSys | Procedimientos almacenados: Materiales académicos

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_materiales_obtener_ciclo_curso$$
CREATE PROCEDURE sp_materiales_obtener_ciclo_curso(
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
    c.IdCiclo,
    cu.IdCurso,
    cu.Nombre AS Curso
  FROM CicloCurso cc
  INNER JOIN Ciclo c ON c.IdCiclo = cc.IdCiclo
  INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
  WHERE cc.IdCiclo = p_id_ciclo
    AND cc.IdCurso = p_id_curso
    AND cc.EstadoRegistro = 1
    AND c.EstadoRegistro = 1
    AND cu.EstadoRegistro = 1
    AND c.IdAcademia = p_id_academia
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_materiales_registrar_material$$
CREATE PROCEDURE sp_materiales_registrar_material(
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_titulo VARCHAR(200),
  IN p_descripcion VARCHAR(500),
  IN p_nombre_archivo VARCHAR(255),
  IN p_id_usuario_creacion INT
)
BEGIN
  INSERT INTO MaterialAcademico
    (IdCiclo, IdCurso, Titulo, Descripcion, NombreArchivo, UrlArchivo, TipoMime, IdUsuarioCreacion, FechaPublicacion, EstadoRegistro)
  VALUES (p_id_ciclo, p_id_curso, p_titulo, p_descripcion, p_nombre_archivo, '', 'application/pdf', p_id_usuario_creacion, NOW(), 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_materiales_registrar_archivo_material$$
CREATE PROCEDURE sp_materiales_registrar_archivo_material(
  IN p_id_material INT,
  IN p_contenido LONGBLOB,
  IN p_tamano_bytes INT UNSIGNED,
  IN p_sha256 CHAR(64)
)
BEGIN
  INSERT INTO MaterialArchivo (IdMaterial, Contenido, TamanoBytes, Sha256) VALUES (p_id_material, p_contenido, p_tamano_bytes, p_sha256);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_materiales_actualizar_material$$
CREATE PROCEDURE sp_materiales_actualizar_material(
  IN p_url_archivo VARCHAR(600),
  IN p_id_material INT
)
BEGIN
  UPDATE MaterialAcademico SET UrlArchivo = p_url_archivo WHERE IdMaterial = p_id_material;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_materiales_obtener_material_descarga$$
CREATE PROCEDURE sp_materiales_obtener_material_descarga(
  IN p_id_material INT,
  IN p_id_academia INT
)
BEGIN
  SELECT ma.IdMaterial, ma.IdCiclo, ma.IdCurso, ma.NombreArchivo, ma.UrlArchivo
  FROM MaterialAcademico ma
  INNER JOIN Ciclo c ON c.IdCiclo = ma.IdCiclo
  WHERE ma.IdMaterial = p_id_material AND ma.EstadoRegistro = 1 AND c.IdAcademia = p_id_academia
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_materiales_obtener_matricula$$
CREATE PROCEDURE sp_materiales_obtener_matricula(
  IN p_id_usuario INT,
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT m.IdMatricula FROM Matricula m
  INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
  WHERE m.IdUsuario = p_id_usuario AND m.IdCiclo = p_id_ciclo AND m.EstadoRegistro = 1
    AND u.IdAcademia = p_id_academia AND u.EstadoRegistro = 1
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_materiales_obtener_asignacion$$
CREATE PROCEDURE sp_materiales_obtener_asignacion(
  IN p_id_usuario INT,
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_id_academia INT
)
BEGIN
  SELECT aa.IdAsignacion FROM Asignacion_Aula aa
  WHERE aa.IdUsuario = p_id_usuario AND aa.IdCiclo = p_id_ciclo AND aa.IdCurso = p_id_curso
    AND aa.IdAcademia = p_id_academia AND aa.EstadoRegistro = 1
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_materiales_obtener_archivo_material$$
CREATE PROCEDURE sp_materiales_obtener_archivo_material(
  IN p_id_material INT
)
BEGIN
  SELECT Contenido FROM MaterialArchivo WHERE IdMaterial = p_id_material LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_materiales_obtener_material$$
CREATE PROCEDURE sp_materiales_obtener_material(
  IN p_id_material INT,
  IN p_id_academia INT
)
BEGIN
  SELECT ma.IdMaterial, ma.UrlArchivo
  FROM MaterialAcademico ma INNER JOIN Ciclo c ON c.IdCiclo = ma.IdCiclo
  WHERE ma.IdMaterial = p_id_material AND ma.EstadoRegistro = 1 AND c.IdAcademia = p_id_academia
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_materiales_cambiar_estado_material$$
CREATE PROCEDURE sp_materiales_cambiar_estado_material(
  IN p_id_material INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE MaterialAcademico ma INNER JOIN Ciclo c ON c.IdCiclo = ma.IdCiclo
         SET ma.EstadoRegistro = -1 WHERE ma.IdMaterial = p_id_material AND c.IdAcademia = p_id_academia AND ma.EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_materiales_eliminar_archivo_material$$
CREATE PROCEDURE sp_materiales_eliminar_archivo_material(
  IN p_id_material INT
)
BEGIN
  DELETE FROM MaterialArchivo WHERE IdMaterial = p_id_material;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_materiales_listar_admin$$
CREATE PROCEDURE sp_materiales_listar_admin(
  IN p_id_academia INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT
    ma.IdMaterial,
    ma.IdCiclo,
    ma.IdCurso,
    ma.Titulo,
    ma.Descripcion,
    ma.NombreArchivo,
    ma.UrlArchivo,
    ma.TipoMime,
    ma.FechaPublicacion,
    c.Nombre AS Ciclo,
    cu.Nombre AS Curso
  FROM MaterialAcademico ma
  INNER JOIN Ciclo c ON c.IdCiclo = ma.IdCiclo
  INNER JOIN Curso cu ON cu.IdCurso = ma.IdCurso
  WHERE ma.EstadoRegistro = 1 AND c.IdAcademia = p_id_academia
    AND (p_id_ciclo IS NULL OR ma.IdCiclo = p_id_ciclo)
  ORDER BY ma.FechaPublicacion DESC, ma.IdMaterial DESC;
END$$

DELIMITER ;
