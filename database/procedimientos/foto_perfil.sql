-- AcadeSys | Procedimientos almacenados: Fotos de perfil

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_foto_perfil_obtener_foto$$
CREATE PROCEDURE sp_foto_perfil_obtener_foto(
  IN p_nombre_archivo VARCHAR(255)
)
BEGIN
  SELECT Contenido, TipoMime FROM FotoPerfil WHERE NombreArchivo = p_nombre_archivo LIMIT 1;
END$$

DELIMITER ;
