-- ============================================================
-- Migration: Añadir columna FotoUrl a la tabla Usuario
-- ============================================================
-- Esta migración añade una columna opcional para almacenar la URL
-- de la foto de perfil del usuario. Es nullable porque la foto
-- es opcional y los usuarios existentes no tendrán foto por defecto.
--
-- La convención de nombre sigue el patrón existente en la BD:
--   - Academia usa LogoUrl
--   - MaterialAcademico usa UrlArchivo
--   - Se usa FotoUrl para la foto de usuario
--
-- Al ser VARCHAR(255) y nullable, no afecta a filas existentes
-- y permite almacenar una ruta/URL relativa a la imagen.
-- ============================================================

ALTER TABLE Usuario
ADD FotoUrl VARCHAR(255) NULL DEFAULT NULL AFTER EstadoRegistro;

-- ------------------------------------------------------------
-- Verificación: confirmar que la columna fue añadida correctamente
-- ------------------------------------------------------------
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Usuario'
  AND COLUMN_NAME = 'FotoUrl';