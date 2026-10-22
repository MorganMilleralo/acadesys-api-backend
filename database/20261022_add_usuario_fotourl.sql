-- ACADESYS / Morgan
-- Añade la referencia de la foto de perfil del usuario.
-- IMPORTANTE:
-- 1) El SHOW CREATE TABLE Usuario compartido por el equipo NO incluye FotoUrl.
-- 2) Primero obtener backup y probar esta migración en una BD de QA/staging.
-- 3) Ejecutar SOLO si el precheck confirma que la columna no existe.
-- 4) No contiene UPDATE de usuarios ni altera matrículas/pagos.

-- Precheck: debe devolver 0 filas antes de ejecutar el ALTER.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'Usuario'
  AND COLUMN_NAME = 'FotoUrl';

-- Ejecutar esta sentencia por separado SOLO si el precheck devolvió 0 filas.
ALTER TABLE Usuario
  ADD COLUMN FotoUrl VARCHAR(500) NULL DEFAULT NULL AFTER Celular;

-- Verificación posterior: debe devolver 1 fila.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'Usuario'
  AND COLUMN_NAME = 'FotoUrl';
