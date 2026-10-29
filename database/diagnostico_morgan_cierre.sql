-- AcadeSys / Diagnóstico de solo lectura para cierre académico y pagos.
-- Ejecutar primero en una conexión con permisos de lectura. No modifica datos.
-- Si Aiven niega acceso a INFORMATION_SCHEMA, detenerse: no inferir DDL ni migrar.

SELECT DATABASE() AS BaseSeleccionada;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'Ciclo', 'Matricula', 'Evaluacion', 'Auditoria_Cierres',
    'PagosMensualidad', 'Usuario', 'Usuario_Perfiles', 'Asignacion_Aula', 'HorarioCurso'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- Repetir SHOW CREATE TABLE desde el cliente SQL solo después de confirmar los nombres.
-- SHOW CREATE TABLE Ciclo;
-- SHOW CREATE TABLE Matricula;
-- SHOW CREATE TABLE Evaluacion;
-- SHOW CREATE TABLE Auditoria_Cierres;
-- SHOW CREATE TABLE PagosMensualidad;

-- Pagos repetidos para el mismo alumno/ciclo/concepto/periodo.
SELECT IdUsuario, IdCiclo, Mes, COUNT(*) AS Cantidad,
       MIN(Monto) AS MontoMinimo, MAX(Monto) AS MontoMaximo
FROM PagosMensualidad
WHERE EstadoRegistro = 1
GROUP BY IdUsuario, IdCiclo, Mes
HAVING COUNT(*) > 1 OR MIN(Monto) <> MAX(Monto)
ORDER BY IdCiclo, IdUsuario, Mes;

-- Importes de inscripción distintos dentro de un mismo ciclo.
SELECT IdCiclo, COUNT(*) AS Registros,
       COUNT(DISTINCT Monto) AS ImportesDistintos,
       MIN(Monto) AS ImporteMinimo, MAX(Monto) AS ImporteMaximo
FROM PagosMensualidad
WHERE EstadoRegistro = 1 AND LOWER(TRIM(Mes)) = 'inscripcion'
GROUP BY IdCiclo
HAVING COUNT(DISTINCT Monto) > 1
ORDER BY IdCiclo;

-- Conteo de matrículas activas por ciclo para validar capacidad antes de reducirla.
SELECT c.IdCiclo, c.Nombre, c.Capacidad,
       COUNT(m.IdMatricula) AS MatriculasActivas
FROM Ciclo c
LEFT JOIN Matricula m ON m.IdCiclo = c.IdCiclo AND m.EstadoRegistro = 1
WHERE c.EstadoRegistro IN (0, 1)
GROUP BY c.IdCiclo, c.Nombre, c.Capacidad
ORDER BY c.IdCiclo;

-- Periodos/tipos de evaluación con duplicados por matrícula; no deriva semanas de fechas.
SELECT IdMatricula, COALESCE(Periodo, 'General') AS PeriodoNormalizado,
       TipoEvaluacion, COUNT(*) AS Cantidad
FROM Evaluacion
WHERE EstadoRegistro IN (1, 2)
GROUP BY IdMatricula, COALESCE(Periodo, 'General'), TipoEvaluacion
HAVING COUNT(*) > 1
ORDER BY IdMatricula, PeriodoNormalizado, TipoEvaluacion;
