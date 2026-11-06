-- TARIFAS POR CICLO: PREPARADO EL 31/10/2026, NO EJECUTADO.
-- Propuesta del usuario: inscripción única y mensualidad por modalidad/universidad.
-- Fuente de identidades: docs/CATALOGO_PUBLICO_2026-10-31.json (GET público).
-- No acredita valores canónicos, DDL, permisos ni ciclos ocultos. Revalidar en DBeaver.
-- No ALTER/DDL, no Precio histórico, no pagos ni capacidades. Ids 14/15 excluidos.
-- EJECUCIÓN FUTURA: conexión dedicada, sin transacción previa, detenerse ante CUALQUIER error.
-- Exportar vista previa y backup restaurable; revisar las identidades, importes y vigencia.
-- Primero ensayar en MySQL QA. Este archivo nunca es parte del arranque del servidor.
-- No ejecutar todo el archivo para publicar: termina deliberadamente en ROLLBACK.
-- Una ejecución autorizada usa la misma conexión y revisa el resultado ANTES del cierre.
-- COMMIT solo con autorización explícita, controles conformes y bitácora; no está incluido.
-- Si se aplica y luego se requiere reversión: usar el respaldo aprobado, comparar valores
-- actuales bajo lock y revertir solo las tarifas. No eliminar columnas ni modificar cuotas.

SET @autorizar_asignacion_tarifas = 0;
-- Poner 1 únicamente al ensayar/aplicar el lote revisado y autorizado; no autoriza COMMIT.
-- Id 4 no está en el catálogo público. NO se inventa nombre, academia ni universidad.
-- Mantener NULL hasta contrastar exportación autorizada de Ciclo y modalidad real.
SET @nombre_ciclo_4 = NULL;
SET @universidad_ciclo_4 = NULL;
SET @academia_ciclo_4 = NULL;
SET @modalidad_ciclo_4 = NULL;

SHOW CREATE TABLE Ciclo;
SELECT IdCiclo, IdAcademia, Nombre, UniversidadObjetivo, Precio,
       PrecioInscripcion, PrecioMensual, Capacidad, EstadoRegistro
FROM Ciclo WHERE IdCiclo IN (1,2,3,4,5,6,10,11,12,13,14,15) ORDER BY IdCiclo;
-- Ningún trigger no revisado debe provocar escrituras indirectas.
SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT
FROM INFORMATION_SCHEMA.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'Ciclo';
SET @motor_transaccional = (
  SELECT COUNT(*) = 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ciclo' AND ENGINE = 'InnoDB'
);
SET @sin_triggers_ciclo = (
  SELECT COUNT(*) = 0 FROM INFORMATION_SCHEMA.TRIGGERS
  WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'Ciclo'
);
-- La cuenta que revisa debe tener visibilidad de triggers; cero con permisos limitados
-- no constituye evidencia. Ante triggers, revisar su efecto antes de preparar otro lote.

START TRANSACTION;
-- Serializa con checkout, edición de ciclo y generación mensual de Morgan.
SELECT IdCiclo, IdAcademia, Nombre, UniversidadObjetivo, Precio,
       PrecioInscripcion, PrecioMensual
FROM Ciclo WHERE IdCiclo IN (1,2,3,4,5,6,10,11,12,13) ORDER BY IdCiclo FOR UPDATE;

-- VISTA PREVIA: exportarla ANTES de cualquier escritura para conservar el estado original.
SELECT p.IdCiclo, p.Nombre AS NombreEsperado, c.Nombre AS NombreActual,
  p.IdAcademia AS AcademiaEsperada, c.IdAcademia AS AcademiaActual,
  p.UniversidadObjetivo AS UniversidadEsperada, c.UniversidadObjetivo AS UniversidadActual,
  c.Precio AS PrecioHistoricoIntacto,
  c.PrecioInscripcion AS InscripcionAnterior, p.Inscripcion AS InscripcionPropuesta,
  c.PrecioMensual AS MensualAnterior, p.Mensual AS MensualPropuesta,
  CASE
    WHEN p.Nombre IS NULL OR p.IdAcademia IS NULL OR p.UniversidadObjetivo IS NULL THEN 'IDENTIDAD_PENDIENTE'
    WHEN c.IdCiclo IS NULL THEN 'CICLO_NO_ENCONTRADO'
    WHEN NOT COALESCE((c.IdAcademia = p.IdAcademia
  AND CAST(c.Nombre AS BINARY) = CAST(p.Nombre AS BINARY)
  AND CAST(c.UniversidadObjetivo AS BINARY) = CAST(p.UniversidadObjetivo AS BINARY)
  AND (p.IdCiclo <> 4 OR (@modalidad_ciclo_4 = 'Verano' AND p.UniversidadObjetivo IN ('UNFV','UNAC','UNT')))), 0) THEN 'IDENTIDAD_O_MODALIDAD_DISTINTA'
    WHEN NOT ((c.PrecioInscripcion IS NULL OR c.PrecioInscripcion = p.Inscripcion)
  AND (c.PrecioMensual IS NULL OR c.PrecioMensual = p.Mensual)) THEN 'TARIFA_EXISTENTE_DISTINTA_REVISAR'
    WHEN NOT (NOT (c.PrecioInscripcion <=> p.Inscripcion) OR NOT (c.PrecioMensual <=> p.Mensual)) THEN 'YA_CONFIGURADO'
    ELSE 'ELEGIBLE_TRAS_AUTORIZACION' END AS Revision
FROM (
  SELECT 1 AS IdCiclo, 1 AS IdAcademia, 'Semestral San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 350.00 AS Mensual
  UNION ALL
  SELECT 2 AS IdCiclo, 1 AS IdAcademia, 'Repaso UNI' AS Nombre,
    'UNI' AS UniversidadObjetivo, 200.00 AS Inscripcion, 500.00 AS Mensual
  UNION ALL
  SELECT 3 AS IdCiclo, 1 AS IdAcademia, 'Veranito San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 400.00 AS Mensual
  UNION ALL
  SELECT 4 AS IdCiclo, @academia_ciclo_4 AS IdAcademia, @nombre_ciclo_4 AS Nombre,
    @universidad_ciclo_4 AS UniversidadObjetivo, 170.00 AS Inscripcion, 350.00 AS Mensual
  UNION ALL
  SELECT 5 AS IdCiclo, 1 AS IdAcademia, 'Anual Católica (PUCP)' AS Nombre,
    'PUCP' AS UniversidadObjetivo, 200.00 AS Inscripcion, 330.00 AS Mensual
  UNION ALL
  SELECT 6 AS IdCiclo, 1 AS IdAcademia, 'Semestral Callao (UNAC)' AS Nombre,
    'UNAC' AS UniversidadObjetivo, 170.00 AS Inscripcion, 300.00 AS Mensual
  UNION ALL
  SELECT 10 AS IdCiclo, 1 AS IdAcademia, 'Repaso San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 500.00 AS Mensual
  UNION ALL
  SELECT 11 AS IdCiclo, 1 AS IdAcademia, 'Anual UNI' AS Nombre,
    'UNI' AS UniversidadObjetivo, 200.00 AS Inscripcion, 330.00 AS Mensual
  UNION ALL
  SELECT 12 AS IdCiclo, 1 AS IdAcademia, 'Veranito San Marcos (II)' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 400.00 AS Mensual
  UNION ALL
  SELECT 13 AS IdCiclo, 1 AS IdAcademia, 'Ciclo Semestral UNFV 2026' AS Nombre,
    'UNFV' AS UniversidadObjetivo, 170.00 AS Inscripcion, 300.00 AS Mensual
) p LEFT JOIN Ciclo c ON c.IdCiclo = p.IdCiclo ORDER BY p.IdCiclo;

SELECT COUNT(*) INTO @cambios_esperados
FROM Ciclo c JOIN (
  SELECT 1 AS IdCiclo, 1 AS IdAcademia, 'Semestral San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 350.00 AS Mensual
  UNION ALL
  SELECT 2 AS IdCiclo, 1 AS IdAcademia, 'Repaso UNI' AS Nombre,
    'UNI' AS UniversidadObjetivo, 200.00 AS Inscripcion, 500.00 AS Mensual
  UNION ALL
  SELECT 3 AS IdCiclo, 1 AS IdAcademia, 'Veranito San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 400.00 AS Mensual
  UNION ALL
  SELECT 4 AS IdCiclo, @academia_ciclo_4 AS IdAcademia, @nombre_ciclo_4 AS Nombre,
    @universidad_ciclo_4 AS UniversidadObjetivo, 170.00 AS Inscripcion, 350.00 AS Mensual
  UNION ALL
  SELECT 5 AS IdCiclo, 1 AS IdAcademia, 'Anual Católica (PUCP)' AS Nombre,
    'PUCP' AS UniversidadObjetivo, 200.00 AS Inscripcion, 330.00 AS Mensual
  UNION ALL
  SELECT 6 AS IdCiclo, 1 AS IdAcademia, 'Semestral Callao (UNAC)' AS Nombre,
    'UNAC' AS UniversidadObjetivo, 170.00 AS Inscripcion, 300.00 AS Mensual
  UNION ALL
  SELECT 10 AS IdCiclo, 1 AS IdAcademia, 'Repaso San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 500.00 AS Mensual
  UNION ALL
  SELECT 11 AS IdCiclo, 1 AS IdAcademia, 'Anual UNI' AS Nombre,
    'UNI' AS UniversidadObjetivo, 200.00 AS Inscripcion, 330.00 AS Mensual
  UNION ALL
  SELECT 12 AS IdCiclo, 1 AS IdAcademia, 'Veranito San Marcos (II)' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 400.00 AS Mensual
  UNION ALL
  SELECT 13 AS IdCiclo, 1 AS IdAcademia, 'Ciclo Semestral UNFV 2026' AS Nombre,
    'UNFV' AS UniversidadObjetivo, 170.00 AS Inscripcion, 300.00 AS Mensual
) p ON c.IdCiclo = p.IdCiclo
WHERE c.IdAcademia = p.IdAcademia
  AND CAST(c.Nombre AS BINARY) = CAST(p.Nombre AS BINARY)
  AND CAST(c.UniversidadObjetivo AS BINARY) = CAST(p.UniversidadObjetivo AS BINARY)
  AND (p.IdCiclo <> 4 OR (@modalidad_ciclo_4 = 'Verano' AND p.UniversidadObjetivo IN ('UNFV','UNAC','UNT')))
  AND (c.PrecioInscripcion IS NULL OR c.PrecioInscripcion = p.Inscripcion)
  AND (c.PrecioMensual IS NULL OR c.PrecioMensual = p.Mensual) AND (NOT (c.PrecioInscripcion <=> p.Inscripcion) OR NOT (c.PrecioMensual <=> p.Mensual));

-- Solo completa NULL o conserva el importe ya propuesto. No pisa otra tarifa configurada.
-- Las discrepancias y ciclos sin identidad comprobada quedan fuera del UPDATE.
UPDATE Ciclo c JOIN (
  SELECT 1 AS IdCiclo, 1 AS IdAcademia, 'Semestral San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 350.00 AS Mensual
  UNION ALL
  SELECT 2 AS IdCiclo, 1 AS IdAcademia, 'Repaso UNI' AS Nombre,
    'UNI' AS UniversidadObjetivo, 200.00 AS Inscripcion, 500.00 AS Mensual
  UNION ALL
  SELECT 3 AS IdCiclo, 1 AS IdAcademia, 'Veranito San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 400.00 AS Mensual
  UNION ALL
  SELECT 4 AS IdCiclo, @academia_ciclo_4 AS IdAcademia, @nombre_ciclo_4 AS Nombre,
    @universidad_ciclo_4 AS UniversidadObjetivo, 170.00 AS Inscripcion, 350.00 AS Mensual
  UNION ALL
  SELECT 5 AS IdCiclo, 1 AS IdAcademia, 'Anual Católica (PUCP)' AS Nombre,
    'PUCP' AS UniversidadObjetivo, 200.00 AS Inscripcion, 330.00 AS Mensual
  UNION ALL
  SELECT 6 AS IdCiclo, 1 AS IdAcademia, 'Semestral Callao (UNAC)' AS Nombre,
    'UNAC' AS UniversidadObjetivo, 170.00 AS Inscripcion, 300.00 AS Mensual
  UNION ALL
  SELECT 10 AS IdCiclo, 1 AS IdAcademia, 'Repaso San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 500.00 AS Mensual
  UNION ALL
  SELECT 11 AS IdCiclo, 1 AS IdAcademia, 'Anual UNI' AS Nombre,
    'UNI' AS UniversidadObjetivo, 200.00 AS Inscripcion, 330.00 AS Mensual
  UNION ALL
  SELECT 12 AS IdCiclo, 1 AS IdAcademia, 'Veranito San Marcos (II)' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 400.00 AS Mensual
  UNION ALL
  SELECT 13 AS IdCiclo, 1 AS IdAcademia, 'Ciclo Semestral UNFV 2026' AS Nombre,
    'UNFV' AS UniversidadObjetivo, 170.00 AS Inscripcion, 300.00 AS Mensual
) p ON c.IdCiclo = p.IdCiclo
SET c.PrecioInscripcion = p.Inscripcion, c.PrecioMensual = p.Mensual
WHERE @autorizar_asignacion_tarifas = 1 AND @motor_transaccional = 1 AND @sin_triggers_ciclo = 1
  AND c.IdAcademia = p.IdAcademia
  AND CAST(c.Nombre AS BINARY) = CAST(p.Nombre AS BINARY)
  AND CAST(c.UniversidadObjetivo AS BINARY) = CAST(p.UniversidadObjetivo AS BINARY)
  AND (p.IdCiclo <> 4 OR (@modalidad_ciclo_4 = 'Verano' AND p.UniversidadObjetivo IN ('UNFV','UNAC','UNT')))
  AND (c.PrecioInscripcion IS NULL OR c.PrecioInscripcion = p.Inscripcion)
  AND (c.PrecioMensual IS NULL OR c.PrecioMensual = p.Mensual) AND (NOT (c.PrecioInscripcion <=> p.Inscripcion) OR NOT (c.PrecioMensual <=> p.Mensual));
SET @filas_actualizadas = ROW_COUNT();

-- COMPROBACIÓN POSTERIOR: filas esperadas vs actualizadas; diferencias => ROLLBACK.
SELECT @autorizar_asignacion_tarifas AS AutorizacionLocal,
  @motor_transaccional AS EsInnoDB, @sin_triggers_ciclo AS SinTriggers,
  @cambios_esperados AS CambiosElegibles, @filas_actualizadas AS FilasActualizadas,
  CASE WHEN @autorizar_asignacion_tarifas = 1 AND @motor_transaccional = 1
    AND @sin_triggers_ciclo = 1 AND @filas_actualizadas = @cambios_esperados
    THEN 'REVISAR_RESULTADOS_ANTES_DE_CONFIRMAR' ELSE 'NO_CONFIRMAR' END AS Control;
SELECT p.IdCiclo, c.Nombre, c.UniversidadObjetivo, c.Precio AS PrecioHistoricoIntacto,
  c.PrecioInscripcion, p.Inscripcion AS InscripcionPropuesta,
  c.PrecioMensual, p.Mensual AS MensualPropuesta,
  CASE WHEN (c.IdAcademia = p.IdAcademia
  AND CAST(c.Nombre AS BINARY) = CAST(p.Nombre AS BINARY)
  AND CAST(c.UniversidadObjetivo AS BINARY) = CAST(p.UniversidadObjetivo AS BINARY)
  AND (p.IdCiclo <> 4 OR (@modalidad_ciclo_4 = 'Verano' AND p.UniversidadObjetivo IN ('UNFV','UNAC','UNT')))) AND c.PrecioInscripcion = p.Inscripcion
    AND c.PrecioMensual = p.Mensual THEN 'COINCIDE' ELSE 'EXCLUIDO_O_PENDIENTE' END AS Resultado
FROM (
  SELECT 1 AS IdCiclo, 1 AS IdAcademia, 'Semestral San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 350.00 AS Mensual
  UNION ALL
  SELECT 2 AS IdCiclo, 1 AS IdAcademia, 'Repaso UNI' AS Nombre,
    'UNI' AS UniversidadObjetivo, 200.00 AS Inscripcion, 500.00 AS Mensual
  UNION ALL
  SELECT 3 AS IdCiclo, 1 AS IdAcademia, 'Veranito San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 400.00 AS Mensual
  UNION ALL
  SELECT 4 AS IdCiclo, @academia_ciclo_4 AS IdAcademia, @nombre_ciclo_4 AS Nombre,
    @universidad_ciclo_4 AS UniversidadObjetivo, 170.00 AS Inscripcion, 350.00 AS Mensual
  UNION ALL
  SELECT 5 AS IdCiclo, 1 AS IdAcademia, 'Anual Católica (PUCP)' AS Nombre,
    'PUCP' AS UniversidadObjetivo, 200.00 AS Inscripcion, 330.00 AS Mensual
  UNION ALL
  SELECT 6 AS IdCiclo, 1 AS IdAcademia, 'Semestral Callao (UNAC)' AS Nombre,
    'UNAC' AS UniversidadObjetivo, 170.00 AS Inscripcion, 300.00 AS Mensual
  UNION ALL
  SELECT 10 AS IdCiclo, 1 AS IdAcademia, 'Repaso San Marcos' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 500.00 AS Mensual
  UNION ALL
  SELECT 11 AS IdCiclo, 1 AS IdAcademia, 'Anual UNI' AS Nombre,
    'UNI' AS UniversidadObjetivo, 200.00 AS Inscripcion, 330.00 AS Mensual
  UNION ALL
  SELECT 12 AS IdCiclo, 1 AS IdAcademia, 'Veranito San Marcos (II)' AS Nombre,
    'UNMSM' AS UniversidadObjetivo, 200.00 AS Inscripcion, 400.00 AS Mensual
  UNION ALL
  SELECT 13 AS IdCiclo, 1 AS IdAcademia, 'Ciclo Semestral UNFV 2026' AS Nombre,
    'UNFV' AS UniversidadObjetivo, 170.00 AS Inscripcion, 300.00 AS Mensual
) p LEFT JOIN Ciclo c ON c.IdCiclo = p.IdCiclo ORDER BY p.IdCiclo;

-- El código no cambia Precio, pagos emitidos ni confirma cobros. Exportar resultados.
-- Si faltó una fila esperada, cambió identidad o hubo un error: ROLLBACK, nunca continuar.
ROLLBACK;
