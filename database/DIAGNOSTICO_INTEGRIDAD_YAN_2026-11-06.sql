-- =============================================================================
-- AcadeSys | Yan | Diagnóstico de integridad de pagos y datos académicos
-- Fecha: 2026-11-06
--
-- SOLO LECTURA. Este archivo no crea, altera ni borra tablas ni datos.
-- Se ejecutó contra la base de auditoría (Aiven, MySQL 8.4.11) sin DDL/DML.
--
-- Objetivo:
--   1. Confirmar la estructura real de PagoTransaccion y tablas relacionadas.
--   2. Detectar huérfanos, duplicados y datos incompatibles antes de proponer
--      claves foráneas o restricciones UNIQUE.
--   3. Dejar evidencia reproducible para el informe INFORME_BACKEND_YAN.md.
--
-- Las propuestas de DDL del final están COMENTADAS a propósito. No deben
-- ejecutarse en producción sin respaldo, ventana de mantenimiento y limpieza
-- previa de los datos que marque este diagnóstico.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tablas presentes y conteos generales
-- -----------------------------------------------------------------------------
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

SELECT
  (SELECT COUNT(*) FROM Usuario)              AS Usuarios,
  (SELECT COUNT(*) FROM Usuario WHERE EstadoRegistro = 1) AS UsuariosActivos,
  (SELECT COUNT(*) FROM Academia)             AS Academias,
  (SELECT COUNT(*) FROM Ciclo)                AS Ciclos,
  (SELECT COUNT(*) FROM Curso)                AS Cursos,
  (SELECT COUNT(*) FROM Matricula)            AS Matriculas,
  (SELECT COUNT(*) FROM Evaluacion)           AS Evaluaciones,
  (SELECT COUNT(*) FROM PagosMensualidad)     AS Cuotas,
  (SELECT COUNT(*) FROM PagoTransaccion)      AS Transacciones,
  (SELECT COUNT(*) FROM PagoComprobante)      AS Comprobantes,
  (SELECT COUNT(*) FROM PagoAuditoria)        AS EventosAuditoria;

-- -----------------------------------------------------------------------------
-- 2. PagoTransaccion: columnas, índices y claves foráneas reales
-- -----------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PagoTransaccion'
ORDER BY ORDINAL_POSITION;

SELECT INDEX_NAME,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS Columnas,
       NON_UNIQUE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PagoTransaccion'
GROUP BY INDEX_NAME, NON_UNIQUE
ORDER BY INDEX_NAME;

SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'PagoTransaccion'
  AND REFERENCED_TABLE_NAME IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Compatibilidad de tipos para futuras claves foráneas
--    PagosMensualidad.IdPago es INT; PagoTransaccion.IdPago también es INT.
--    PagoComprobante y PagoAuditoria usan BIGINT UNSIGNED: no pueden referenciar
--    directamente a PagosMensualidad sin alinear el tipo.
-- -----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('PagosMensualidad', 'PagoTransaccion', 'PagoComprobante', 'PagoAuditoria')
  AND COLUMN_NAME IN ('IdPago', 'IdUsuario', 'IdAcademia', 'IdComprobante')
ORDER BY TABLE_NAME, COLUMN_NAME;

SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('PagosMensualidad', 'PagoTransaccion', 'PagoComprobante', 'PagoAuditoria')
  AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

-- -----------------------------------------------------------------------------
-- 4. Huérfanos actuales (deben ser 0 antes de agregar FK)
-- -----------------------------------------------------------------------------
SELECT 'PagoTransaccion sin cuota' AS Caso, COUNT(*) AS Filas
FROM PagoTransaccion pt
LEFT JOIN PagosMensualidad p ON p.IdPago = pt.IdPago
WHERE p.IdPago IS NULL
UNION ALL
SELECT 'PagoComprobante sin cuota', COUNT(*)
FROM PagoComprobante pc
LEFT JOIN PagosMensualidad p ON p.IdPago = pc.IdPago
WHERE p.IdPago IS NULL
UNION ALL
SELECT 'PagoAuditoria sin cuota', COUNT(*)
FROM PagoAuditoria pa
LEFT JOIN PagosMensualidad p ON p.IdPago = pa.IdPago
WHERE p.IdPago IS NULL
UNION ALL
SELECT 'Matricula sin usuario', COUNT(*)
FROM Matricula m
LEFT JOIN Usuario u ON u.IdUsuario = m.IdUsuario
WHERE u.IdUsuario IS NULL
UNION ALL
SELECT 'Matricula sin ciclo', COUNT(*)
FROM Matricula m
LEFT JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
WHERE c.IdCiclo IS NULL
UNION ALL
SELECT 'Evaluacion sin matricula', COUNT(*)
FROM Evaluacion e
LEFT JOIN Matricula m ON m.IdMatricula = e.IdMatricula
WHERE m.IdMatricula IS NULL
UNION ALL
SELECT 'HorarioCurso sin ciclo', COUNT(*)
FROM HorarioCurso h
LEFT JOIN Ciclo c ON c.IdCiclo = h.IdCiclo
WHERE c.IdCiclo IS NULL;

-- -----------------------------------------------------------------------------
-- 5. Duplicados históricos de identidad
--    La aplicación bloquea altas nuevas, pero no hay UNIQUE de DNI/correo.
-- -----------------------------------------------------------------------------
SELECT LOWER(TRIM(CorreoElectronico)) AS Correo, COUNT(*) AS Filas,
       GROUP_CONCAT(CONCAT(IdUsuario, ':', CodigoUsuario) ORDER BY IdUsuario) AS Cuentas
FROM Usuario
WHERE CorreoElectronico IS NOT NULL AND TRIM(CorreoElectronico) <> ''
GROUP BY LOWER(TRIM(CorreoElectronico))
HAVING COUNT(*) > 1;

SELECT DNI, COUNT(*) AS Filas,
       GROUP_CONCAT(CONCAT(IdUsuario, ':', CodigoUsuario) ORDER BY IdUsuario) AS Cuentas
FROM Usuario
WHERE DNI IS NOT NULL AND TRIM(DNI) <> ''
GROUP BY DNI
HAVING COUNT(*) > 1;

-- -----------------------------------------------------------------------------
-- 6. Duplicados de negocio
-- -----------------------------------------------------------------------------
SELECT IdUsuario, IdCiclo, COUNT(*) AS Filas
FROM Matricula
GROUP BY IdUsuario, IdCiclo
HAVING COUNT(*) > 1;

SELECT IdUsuario, IdCiclo, Mes, COUNT(*) AS Filas
FROM PagosMensualidad
WHERE EstadoRegistro = 1
GROUP BY IdUsuario, IdCiclo, Mes
HAVING COUNT(*) > 1;

SELECT IdPago, Referencia, COUNT(*) AS Filas
FROM PagoComprobante
WHERE EstadoRegistro = 1
GROUP BY IdPago, Referencia
HAVING COUNT(*) > 1;

SELECT IdMatricula, COALESCE(Periodo, 'General') AS Periodo, TipoEvaluacion, COUNT(*) AS Filas
FROM Evaluacion
WHERE EstadoRegistro IN (1, 2)
GROUP BY IdMatricula, COALESCE(Periodo, 'General'), TipoEvaluacion
HAVING COUNT(*) > 1;

SELECT IdCiclo, IdCurso, DiaNumero, HoraInicio, HoraFin, COUNT(*) AS Filas
FROM HorarioCurso
WHERE EstadoRegistro = 1
GROUP BY IdCiclo, IdCurso, DiaNumero, HoraInicio, HoraFin
HAVING COUNT(*) > 1;

-- -----------------------------------------------------------------------------
-- 7. Calidad de datos académicos y de pagos
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS MatriculasActivas,
       SUM(IdCurso IS NULL) AS SinCursoAsignado,
       SUM(IdCurso IS NOT NULL) AS ConCursoAsignado
FROM Matricula
WHERE EstadoRegistro = 1;

SELECT p.Estado, COUNT(*) AS Filas, SUM(p.FechaVencimiento IS NULL) AS SinVencimiento
FROM PagosMensualidad p
WHERE p.EstadoRegistro = 1
GROUP BY p.Estado;

SELECT u.IdUsuario, u.CodigoUsuario
FROM Usuario u
LEFT JOIN Usuario_Perfiles up
  ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
WHERE u.EstadoRegistro = 1 AND up.IdUsuario IS NULL;

SELECT c.IdCiclo, c.Nombre, c.EstadoRegistro, c.Capacidad,
       c.PrecioInscripcion, c.PrecioMensual, c.UniversidadObjetivo
FROM Ciclo c
ORDER BY c.IdCiclo;

SELECT p.IdTransaccion, p.IdPago, p.IdUsuario, p.Estado, p.Monto, p.Moneda,
       p.FechaCreacion, p.FechaActualizacion, p.FechaConfirmacion
FROM PagoTransaccion p
ORDER BY p.IdTransaccion;

SELECT Evento, COUNT(*) AS Filas
FROM PagoAuditoria
GROUP BY Evento
ORDER BY Filas DESC;

-- -----------------------------------------------------------------------------
-- 8. Evaluaciones fuera de la escala interna de su universidad
--    La escala es la misma de utils/escalas.js.
-- -----------------------------------------------------------------------------
SELECT e.IdEvaluacion, e.Calificacion, ci.UniversidadObjetivo,
       CASE UPPER(TRIM(COALESCE(ci.UniversidadObjetivo, '')))
         WHEN 'UNMSM' THEN 2000 WHEN 'UNI' THEN 2000 WHEN 'PUCP' THEN 1000
         WHEN 'UNFV' THEN 1000 WHEN 'UNAC' THEN 100 WHEN 'UNT' THEN 300
         WHEN 'UNALM' THEN 20 WHEN 'UPCH' THEN 20 WHEN 'ULIMA' THEN 20
         WHEN 'UPC' THEN 20 WHEN 'USMP' THEN 20 WHEN 'UTP' THEN 20
         WHEN 'PREUNIVERSITARIO' THEN 20 ELSE 20 END AS Maximo
FROM Evaluacion e
INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
INNER JOIN Ciclo ci ON ci.IdCiclo = m.IdCiclo
HAVING e.Calificacion < 0 OR e.Calificacion > Maximo;

-- =============================================================================
-- PROPUESTA FUTURA (NO EJECUTAR AQUÍ)
-- =============================================================================
-- Requisitos previos:
--   1. Respaldo verificado y ventana de mantenimiento.
--   2. Resolver los duplicados de correo/DNI y los usuarios sin perfil.
--   3. Alinear PagoComprobante/PagoAuditoria a INT si se desea FK a PagosMensualidad.
--   4. Probar en una copia restaurada de staging.
--
-- -- Identidad (MySQL 5.7+; columnas generadas para normalizar):
-- ALTER TABLE Usuario
--   ADD COLUMN IdentidadCorreo VARCHAR(150)
--     GENERATED ALWAYS AS (LOWER(TRIM(CorreoElectronico))) STORED,
--   ADD COLUMN IdentidadDni VARCHAR(8)
--     GENERATED ALWAYS AS (NULLIF(TRIM(DNI), '')) STORED;
-- CREATE UNIQUE INDEX UX_Usuario_Correo ON Usuario (IdentidadCorreo);
-- CREATE UNIQUE INDEX UX_Usuario_Dni ON Usuario (IdentidadDni);
--
-- -- Pagos: alinear tipos y agregar FK (solo tras verificar 0 huérfanos):
-- ALTER TABLE PagoComprobante
--   MODIFY IdPago INT NOT NULL,
--   MODIFY IdUsuario INT NOT NULL,
--   MODIFY IdAcademia INT NOT NULL,
--   MODIFY IdRevisadoPor INT NULL;
-- ALTER TABLE PagoAuditoria
--   MODIFY IdPago INT NOT NULL,
--   MODIFY IdComprobante BIGINT UNSIGNED NULL,
--   MODIFY IdUsuarioActor INT NULL,
--   MODIFY IdAcademia INT NOT NULL;
-- ALTER TABLE PagoTransaccion
--   ADD CONSTRAINT FK_PagoTransaccion_Pago FOREIGN KEY (IdPago) REFERENCES PagosMensualidad (IdPago),
--   ADD CONSTRAINT FK_PagoTransaccion_Usuario FOREIGN KEY (IdUsuario) REFERENCES Usuario (IdUsuario),
--   ADD CONSTRAINT FK_PagoTransaccion_Academia FOREIGN KEY (IdAcademia) REFERENCES Academia (IdAcademia);
-- ALTER TABLE PagoComprobante
--   ADD CONSTRAINT FK_PagoComprobante_Pago FOREIGN KEY (IdPago) REFERENCES PagosMensualidad (IdPago),
--   ADD CONSTRAINT FK_PagoComprobante_Usuario FOREIGN KEY (IdUsuario) REFERENCES Usuario (IdUsuario);
-- ALTER TABLE PagoAuditoria
--   ADD CONSTRAINT FK_PagoAuditoria_Pago FOREIGN KEY (IdPago) REFERENCES PagosMensualidad (IdPago);
--
-- -- Unicidad de negocio (solo tras limpiar duplicados):
-- CREATE UNIQUE INDEX UX_PagoComprobante_Pago_Referencia
--   ON PagoComprobante (IdPago, Referencia);
-- CREATE UNIQUE INDEX UX_PagosMensualidad_Usuario_Ciclo_Mes
--   ON PagosMensualidad (IdUsuario, IdCiclo, Mes, EstadoRegistro);
--
-- -- Limpieza de duplicados de índices/FK en Matricula (revisar SHOW CREATE TABLE):
-- -- ALTER TABLE Matricula DROP FOREIGN KEY FK_Matricula_CicloSeguro;
-- -- ALTER TABLE Usuario DROP INDEX CodigoUsuario_2; (revisar nombres reales)
-- =============================================================================
