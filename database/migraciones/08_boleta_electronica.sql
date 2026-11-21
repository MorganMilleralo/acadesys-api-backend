-- Boleta electrónica SUNAT por cada cuota pagada.
-- La boleta se emite en el servicio de facturación (fact_api) y AcadeSys guarda
-- una copia del PDF y del XML firmado para que el alumno y la administración la
-- descarguen aunque ese servicio no esté disponible.
-- Ejecutar UNA vez en defaultdb. Solo crea una tabla nueva: no modifica datos.
-- Después ejecutar database/procedimientos/boletas.sql.

CREATE TABLE IF NOT EXISTS BoletaElectronica (
  IdBoleta BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  IdPago INT NOT NULL,
  IdUsuario INT NOT NULL,
  IdAcademia INT NOT NULL,
  Monto DECIMAL(8,2) NOT NULL,
  Moneda CHAR(3) NOT NULL DEFAULT 'PEN',
  Estado ENUM('PENDIENTE','EMITIENDO','EMITIDA','ERROR') NOT NULL DEFAULT 'PENDIENTE',
  IdExterno VARCHAR(40) NULL,
  Serie VARCHAR(4) NULL,
  Correlativo VARCHAR(10) NULL,
  NumeroCompleto VARCHAR(20) NULL,
  EstadoSunat VARCHAR(40) NULL,
  MensajeError VARCHAR(500) NULL,
  Intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PdfArchivo MEDIUMBLOB NULL,
  XmlArchivo MEDIUMBLOB NULL,
  FechaEmision DATETIME NULL,
  FechaCreacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FechaActualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY UX_BoletaElectronica_Pago (IdPago),
  KEY IX_BoletaElectronica_Usuario (IdUsuario, IdAcademia),
  KEY IX_BoletaElectronica_Estado (Estado, Intentos),
  CONSTRAINT FK_BoletaElectronica_Pago FOREIGN KEY (IdPago) REFERENCES PagosMensualidad (IdPago)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Verificación: debe devolver 0 filas al inicio.
SELECT COUNT(*) AS BoletasRegistradas FROM BoletaElectronica;
