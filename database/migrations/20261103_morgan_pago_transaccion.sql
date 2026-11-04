-- AcadeSys | Morgan | Transacciones online de mensualidades e inscripción
-- Ejecutar primero en una BD de QA y verificar SHOW CREATE TABLE.
-- Esta migración es aditiva. No modifica PagosMensualidad ni datos históricos.
-- Se omiten FK deliberadamente hasta confirmar tipos/signos y constraints
-- exactos de las tablas existentes en el entorno objetivo.

CREATE TABLE IF NOT EXISTS PagoTransaccion (
  IdTransaccion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  IdPago INT NOT NULL,
  IdUsuario INT NOT NULL,
  IdAcademia INT NOT NULL,
  Proveedor VARCHAR(30) NOT NULL DEFAULT 'MERCADOPAGO',
  ReferenciaInterna VARCHAR(100) NOT NULL,
  IdOrdenProveedor VARCHAR(120) NULL,
  ClaveIdempotencia VARCHAR(100) NOT NULL,
  Monto DECIMAL(10,2) NOT NULL,
  Moneda CHAR(3) NOT NULL DEFAULT 'PEN',
  Estado VARCHAR(24) NOT NULL DEFAULT 'CREANDO',
  UrlCheckout VARCHAR(1000) NULL,
  CodigoEstadoProveedor VARCHAR(80) NULL,
  FechaCreacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FechaActualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FechaConfirmacion DATETIME NULL,
  EstadoRegistro TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (IdTransaccion),
  UNIQUE KEY uq_pago_transaccion_referencia (ReferenciaInterna),
  UNIQUE KEY uq_pago_transaccion_idempotencia (ClaveIdempotencia),
  UNIQUE KEY uq_pago_transaccion_orden (Proveedor, IdOrdenProveedor),
  KEY idx_pago_transaccion_cuota_estado (IdPago, Estado, IdTransaccion),
  KEY idx_pago_transaccion_alumno (IdUsuario, IdAcademia, IdTransaccion),
  KEY idx_pago_transaccion_academia_fecha (IdAcademia, FechaCreacion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verificación posterior sugerida:
-- SHOW CREATE TABLE PagoTransaccion;
-- SHOW COLUMNS FROM PagoTransaccion;
-- SELECT COUNT(*) FROM PagoTransaccion;
