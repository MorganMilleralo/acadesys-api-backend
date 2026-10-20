-- SOLO LECTURA DE METADATOS. Preparado, NO ejecutado.
-- No contiene datos de alumnos ni modificaciones. No autoriza al agente a conectar.
-- Objetivo: confirmar identificacion del simulacro semanal y contrato de cierre.
-- Aiven es produccion; no hay staging. Estos resultados son estructura, no filas.
SELECT VERSION() AS VersionMySQL, @@lower_case_table_names AS NombresTablas;

-- Ejecutar individualmente solo si la tabla existe y con su nombre exacto.
-- El DDL incluye tipos, precision, defaults, claves, CHECK e indices.
SHOW CREATE TABLE Evaluacion;
SHOW CREATE TABLE Auditoria_Cierres;

-- Detectar si ya existe una entidad de simulacro, sin asumir su nombre o crearlo.
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND LOWER(TABLE_NAME) LIKE '%simulacro%';

SELECT TABLE_NAME, ENGINE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND LOWER(TABLE_NAME) IN ('evaluacion', 'auditoria_cierres', 'matricula',
      'ciclo', 'curso', 'ciclocurso', 'usuario', 'usuario_perfiles', 'perfil',
      'asignacion_aula', 'aula');

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (LOWER(TABLE_NAME) IN ('evaluacion', 'auditoria_cierres', 'matricula',
      'ciclo', 'usuario_perfiles', 'perfil', 'asignacion_aula')
      OR LOWER(TABLE_NAME) LIKE '%simulacro%')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND LOWER(TABLE_NAME) IN ('evaluacion', 'auditoria_cierres', 'matricula', 'usuario_perfiles')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND LOWER(TABLE_NAME) IN ('evaluacion', 'auditoria_cierres', 'matricula', 'usuario_perfiles')
ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;
