-- ACADESYS / Migración aditiva de precios y pagos, propuesta para MySQL.
-- NO ejecutar en producción hasta revisar el diagnóstico, tener backup y aprobar el DDL vivo.
-- Elegir explícitamente la base de datos correcta antes de ejecutar este archivo.
-- Requiere que Ciclo.Precio y las columnas de PagosMensualidad descritas en el diagrama existan.
-- Se puede volver a ejecutar: el alta de columnas comprueba INFORMATION_SCHEMA.
-- Los DDL de MySQL pueden hacer commit implícito; el rollback de una transacción no revierte ALTER TABLE.

SET @schema_actual := DATABASE();

-- Crear PrecioInscripcion solo si no existe.
SET @sql := IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @schema_actual AND TABLE_NAME = 'Ciclo' AND COLUMN_NAME = 'PrecioInscripcion'),
  'SELECT ''Ciclo.PrecioInscripcion ya existe'' AS migracion',
  'ALTER TABLE Ciclo ADD COLUMN PrecioInscripcion DECIMAL(10,2) NULL DEFAULT NULL COMMENT ''Precio único de inscripción del ciclo'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Crear PrecioMensual solo si no existe. Se deja NULL para exigir configuración expresa por la academia.
SET @sql := IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @schema_actual AND TABLE_NAME = 'Ciclo' AND COLUMN_NAME = 'PrecioMensual'),
  'SELECT ''Ciclo.PrecioMensual ya existe'' AS migracion',
  'ALTER TABLE Ciclo ADD COLUMN PrecioMensual DECIMAL(10,2) NULL DEFAULT NULL COMMENT ''Cuota mensual de enseñanza del ciclo'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Copiar el precio anterior como precio de inscripción solo en filas nuevas/vacías.
-- Esto conserva el significado actual de Ciclo.Precio; NO corrige por sí solo importes históricos equivocados.
UPDATE Ciclo
SET PrecioInscripcion = ROUND(Precio, 2)
WHERE PrecioInscripcion IS NULL AND Precio IS NOT NULL AND Precio >= 0;

-- Vencimiento de una cuota. Las cuotas históricas pueden seguir con NULL.
SET @sql := IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @schema_actual AND TABLE_NAME = 'PagosMensualidad' AND COLUMN_NAME = 'FechaVencimiento'),
  'SELECT ''PagosMensualidad.FechaVencimiento ya existe'' AS migracion',
  'ALTER TABLE PagosMensualidad ADD COLUMN FechaVencimiento DATE NULL DEFAULT NULL COMMENT ''Fecha de vencimiento de la cuota'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Comprobante/referencia de transferencia. Se evita FK en esta primera migración
-- porque antes deben verificarse en el esquema vivo los tipos exactos de los IDs.
CREATE TABLE IF NOT EXISTS PagoComprobante (
  IdComprobante BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  IdPago BIGINT UNSIGNED NOT NULL,
  IdUsuario BIGINT UNSIGNED NOT NULL,
  IdAcademia BIGINT UNSIGNED NOT NULL,
  Referencia VARCHAR(120) NOT NULL,
  UrlComprobante VARCHAR(500) NULL,
  EstadoRevision VARCHAR(20) NOT NULL DEFAULT 'EN_REVISION',
  MotivoRevision VARCHAR(500) NULL,
  FechaCreacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FechaRevision DATETIME NULL,
  IdRevisadoPor BIGINT UNSIGNED NULL,
  EstadoRegistro TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (IdComprobante),
  KEY idx_PagoComprobante_pago_estado (IdPago, EstadoRevision, EstadoRegistro),
  KEY idx_PagoComprobante_academia_estado (IdAcademia, EstadoRevision, EstadoRegistro),
  KEY idx_PagoComprobante_usuario (IdUsuario, IdAcademia, EstadoRegistro)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bitácora de altas, ajustes y transiciones de estado. No almacena tokens ni datos bancarios completos.
CREATE TABLE IF NOT EXISTS PagoAuditoria (
  IdAuditoria BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  IdPago BIGINT UNSIGNED NOT NULL,
  IdComprobante BIGINT UNSIGNED NULL,
  IdUsuarioActor BIGINT UNSIGNED NULL,
  IdAcademia BIGINT UNSIGNED NOT NULL,
  Evento VARCHAR(60) NOT NULL,
  EstadoAnterior VARCHAR(40) NULL,
  EstadoNuevo VARCHAR(40) NULL,
  MontoAnterior DECIMAL(10,2) NULL,
  MontoNuevo DECIMAL(10,2) NULL,
  Motivo VARCHAR(500) NULL,
  FechaCreacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (IdAuditoria),
  KEY idx_PagoAuditoria_pago_fecha (IdPago, FechaCreacion),
  KEY idx_PagoAuditoria_academia_fecha (IdAcademia, FechaCreacion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comprobación final: si aparecen estas columnas/tablas, la parte aditiva quedó instalada.
SHOW COLUMNS FROM Ciclo LIKE 'PrecioInscripcion';
SHOW COLUMNS FROM Ciclo LIKE 'PrecioMensual';
SHOW COLUMNS FROM PagosMensualidad LIKE 'FechaVencimiento';
SHOW CREATE TABLE PagoComprobante;
SHOW CREATE TABLE PagoAuditoria;
