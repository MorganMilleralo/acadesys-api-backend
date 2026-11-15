-- AcadeSys | Procedimientos almacenados: Validaciones comunes

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_comun_bloquear_usuario$$
CREATE PROCEDURE sp_comun_bloquear_usuario(
  IN p_id_usuario INT,
  IN p_correo_efectivo VARCHAR(255),
  IN p_dni_efectivo VARCHAR(255)
)
BEGIN
  SELECT IdUsuario FROM Usuario
       WHERE IdUsuario <> p_id_usuario AND
         ((p_correo_efectivo IS NOT NULL AND LOWER(TRIM(CorreoElectronico)) = p_correo_efectivo) OR (p_dni_efectivo IS NOT NULL AND TRIM(DNI) = p_dni_efectivo))
       LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_comun_bloquear_academia$$
CREATE PROCEDURE sp_comun_bloquear_academia()
BEGIN
  SELECT IdAcademia FROM Academia ORDER BY IdAcademia FOR UPDATE;
END$$

DELIMITER ;
