-- ACADESYS / QA de Morgan / SOLO LECTURA
-- Ejecutar con una cuenta autorizada de lectura y seleccionar la base correcta en DBeaver.
-- No contiene INSERT, UPDATE, DELETE, ALTER, DROP ni CREATE.
-- Ejecutar cada sentencia por separado. Si una columna no existe, detenerse y conservar
-- el error como evidencia: NO modificar el esquema para hacer que esta auditoría pase.

-- 1) Contratos reales: guardar la salida en el expediente de QA, ocultando datos personales.
SHOW CREATE TABLE Usuario;
SHOW CREATE TABLE Matricula;
SHOW CREATE TABLE Evaluacion;
SHOW CREATE TABLE Auditoria_Cierres;
SHOW CREATE TABLE PagosMensualidad;
SHOW CREATE TABLE Asistencia;
SHOW CREATE TABLE Aula;
SHOW CREATE TABLE Asignacion_Aula;
SHOW CREATE TABLE HorarioCurso;
SHOW CREATE TABLE CorreosPendientes;

-- 2) Índices y UNIQUE actuales.
SHOW INDEX FROM Usuario;
SHOW INDEX FROM Matricula;
SHOW INDEX FROM Evaluacion;
SHOW INDEX FROM Auditoria_Cierres;
SHOW INDEX FROM PagosMensualidad;
SHOW INDEX FROM HorarioCurso;

-- 3) Solo un contador: ¿existe Usuario.FotoUrl en LA BASE SELECCIONADA?
SELECT COUNT(*) AS existe_columna_foto_url
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'Usuario'
  AND COLUMN_NAME = 'FotoUrl';

-- 4) Cantidad de grupos con correos duplicados (no muestra correos).
SELECT COUNT(*) AS grupos_correo_duplicado
FROM (
  SELECT LOWER(TRIM(CorreoElectronico)) AS clave_correo
  FROM Usuario
  WHERE CorreoElectronico IS NOT NULL AND TRIM(CorreoElectronico) <> ''
  GROUP BY LOWER(TRIM(CorreoElectronico))
  HAVING COUNT(*) > 1
) AS duplicados_correo;

-- 5) Cantidad de grupos con DNI duplicado (no muestra DNI).
SELECT COUNT(*) AS grupos_dni_duplicado
FROM (
  SELECT TRIM(DNI) AS clave_dni
  FROM Usuario
  WHERE DNI IS NOT NULL AND TRIM(DNI) <> ''
  GROUP BY TRIM(DNI)
  HAVING COUNT(*) > 1
) AS duplicados_dni;

-- 6) Matrículas activas repetidas por alumno y ciclo.
SELECT COUNT(*) AS grupos_matricula_activa_duplicada
FROM (
  SELECT IdUsuario, IdCiclo
  FROM Matricula
  WHERE EstadoRegistro = 1
  GROUP BY IdUsuario, IdCiclo
  HAVING COUNT(*) > 1
) AS duplicadas;

-- 7) Grupos candidatos a notas duplicadas. No crea ni cambia restricciones.
-- Ejecutar solo después de confirmar que estas cuatro columnas existen en el DDL.
SELECT COUNT(*) AS grupos_evaluacion_duplicada
FROM (
  SELECT IdMatricula, COALESCE(Periodo, 'General') AS PeriodoNormalizado,
         TipoEvaluacion, EstadoRegistro
  FROM Evaluacion
  WHERE EstadoRegistro IN (1, 2)
  GROUP BY IdMatricula, COALESCE(Periodo, 'General'), TipoEvaluacion, EstadoRegistro
  HAVING COUNT(*) > 1
) AS duplicadas;

-- 8) Relaciones huérfanas: conteos agregados, sin exponer IDs o datos de alumnos.
SELECT COUNT(*) AS matriculas_sin_usuario
FROM Matricula m
LEFT JOIN Usuario u ON u.IdUsuario = m.IdUsuario
WHERE u.IdUsuario IS NULL;

SELECT COUNT(*) AS matriculas_sin_ciclo
FROM Matricula m
LEFT JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
WHERE c.IdCiclo IS NULL;

-- 9) Pagos pendientes de matrícula. Solo conteo; nunca marcar como pagado desde QA.
SELECT COUNT(*) AS pagos_inscripcion_pendientes
FROM PagosMensualidad
WHERE Mes = 'Inscripcion' AND Estado = 'Pendiente' AND EstadoRegistro = 1;

-- Fin: no ejecutar ningún cambio de esquema/datos desde esta auditoría.
