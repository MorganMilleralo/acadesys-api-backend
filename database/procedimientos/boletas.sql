-- AcadeSys | Procedimientos almacenados: Boleta electrónica SUNAT

DELIMITER $$

-- Crea el registro de la boleta de una cuota pagada (si no existe) y lo reserva
-- para emitirlo. Devuelve los datos del comprobante solo si la reserva se logró:
-- así dos procesos no emiten dos boletas para la misma cuota.
DROP PROCEDURE IF EXISTS sp_boletas_reclamar_emision$$
CREATE PROCEDURE sp_boletas_reclamar_emision(
  IN p_id_pago INT,
  IN p_minutos_bloqueo INT,
  IN p_max_intentos INT
)
BEGIN
  DECLARE v_filas INT DEFAULT 0;
  INSERT IGNORE INTO BoletaElectronica (IdPago, IdUsuario, IdAcademia, Monto, Moneda, Estado)
    SELECT p.IdPago, p.IdUsuario, u.IdAcademia, p.Monto, 'PEN', 'PENDIENTE'
    FROM PagosMensualidad p
    INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
    WHERE p.IdPago = p_id_pago AND p.Estado = 'Pagado' AND p.EstadoRegistro = 1;
  UPDATE BoletaElectronica
     SET Estado = 'EMITIENDO', Intentos = Intentos + 1, FechaActualizacion = NOW()
   WHERE IdPago = p_id_pago
     AND Intentos < p_max_intentos
     AND (Estado IN ('PENDIENTE', 'ERROR')
          OR (Estado = 'EMITIENDO' AND FechaActualizacion < NOW() - INTERVAL p_minutos_bloqueo MINUTE));
  SET v_filas = ROW_COUNT();
  SELECT b.IdBoleta, b.IdPago, b.IdExterno, b.Monto, b.Moneda, b.Intentos,
         p.Mes, c.Nombre AS Ciclo,
         u.DNI, u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno, u.CorreoElectronico
    FROM BoletaElectronica b
    INNER JOIN PagosMensualidad p ON p.IdPago = b.IdPago
    INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo
    INNER JOIN Usuario u ON u.IdUsuario = b.IdUsuario
   WHERE b.IdPago = p_id_pago AND v_filas = 1
   LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_boletas_guardar_externo$$
CREATE PROCEDURE sp_boletas_guardar_externo(
  IN p_id_boleta BIGINT UNSIGNED,
  IN p_id_externo VARCHAR(40),
  IN p_serie VARCHAR(4),
  IN p_correlativo VARCHAR(10),
  IN p_numero_completo VARCHAR(20)
)
BEGIN
  UPDATE BoletaElectronica
     SET IdExterno = p_id_externo, Serie = p_serie, Correlativo = p_correlativo,
         NumeroCompleto = p_numero_completo, FechaActualizacion = NOW()
   WHERE IdBoleta = p_id_boleta AND Estado = 'EMITIENDO'
     AND (IdExterno IS NULL OR IdExterno = p_id_externo);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_boletas_marcar_emitida$$
CREATE PROCEDURE sp_boletas_marcar_emitida(
  IN p_id_boleta BIGINT UNSIGNED,
  IN p_estado_sunat VARCHAR(40),
  IN p_pdf MEDIUMBLOB,
  IN p_xml MEDIUMBLOB
)
BEGIN
  UPDATE BoletaElectronica
     SET Estado = 'EMITIDA', EstadoSunat = p_estado_sunat, PdfArchivo = p_pdf,
         XmlArchivo = p_xml, MensajeError = NULL,
         FechaEmision = COALESCE(FechaEmision, NOW()), FechaActualizacion = NOW()
   WHERE IdBoleta = p_id_boleta AND Estado = 'EMITIENDO';
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_boletas_marcar_error$$
CREATE PROCEDURE sp_boletas_marcar_error(
  IN p_id_boleta BIGINT UNSIGNED,
  IN p_mensaje VARCHAR(500)
)
BEGIN
  UPDATE BoletaElectronica
     SET Estado = 'ERROR', MensajeError = p_mensaje, FechaActualizacion = NOW()
   WHERE IdBoleta = p_id_boleta AND Estado = 'EMITIENDO';
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

-- Cuotas cuya boleta quedó pendiente o con error y aún admite reintentos.
DROP PROCEDURE IF EXISTS sp_boletas_listar_reintentos$$
CREATE PROCEDURE sp_boletas_listar_reintentos(
  IN p_minutos_bloqueo INT,
  IN p_max_intentos INT,
  IN p_limite INT
)
BEGIN
  SELECT IdPago
    FROM BoletaElectronica
   WHERE Intentos < p_max_intentos
     AND (Estado IN ('PENDIENTE', 'ERROR')
          OR (Estado = 'EMITIENDO' AND FechaActualizacion < NOW() - INTERVAL p_minutos_bloqueo MINUTE))
   ORDER BY FechaActualizacion
   LIMIT p_limite;
END$$

-- Administración: solicita (o vuelve a solicitar) la boleta de una cuota pagada
-- de su academia. Reinicia los intentos de una boleta con error.
DROP PROCEDURE IF EXISTS sp_boletas_solicitar_admin$$
CREATE PROCEDURE sp_boletas_solicitar_admin(
  IN p_id_pago INT,
  IN p_id_academia INT
)
BEGIN
  INSERT IGNORE INTO BoletaElectronica (IdPago, IdUsuario, IdAcademia, Monto, Moneda, Estado)
    SELECT p.IdPago, p.IdUsuario, u.IdAcademia, p.Monto, 'PEN', 'PENDIENTE'
    FROM PagosMensualidad p
    INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
    WHERE p.IdPago = p_id_pago AND u.IdAcademia = p_id_academia
      AND p.Estado = 'Pagado' AND p.EstadoRegistro = 1;
  UPDATE BoletaElectronica
     SET Intentos = 0, Estado = 'PENDIENTE', FechaActualizacion = NOW()
   WHERE IdPago = p_id_pago AND IdAcademia = p_id_academia AND Estado = 'ERROR';
  SELECT IdBoleta, Estado
    FROM BoletaElectronica
   WHERE IdPago = p_id_pago AND IdAcademia = p_id_academia
   LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_boletas_listar_alumno$$
CREATE PROCEDURE sp_boletas_listar_alumno(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdPago, Estado, NumeroCompleto, EstadoSunat, FechaEmision,
         (PdfArchivo IS NOT NULL) AS TienePdf
    FROM BoletaElectronica
   WHERE IdUsuario = p_id_usuario AND IdAcademia = p_id_academia
   ORDER BY IdPago;
END$$

DROP PROCEDURE IF EXISTS sp_boletas_obtener_archivo_alumno$$
CREATE PROCEDURE sp_boletas_obtener_archivo_alumno(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdPago, Estado, NumeroCompleto, PdfArchivo, XmlArchivo
    FROM BoletaElectronica
   WHERE IdPago = p_id_pago AND IdUsuario = p_id_usuario AND IdAcademia = p_id_academia
   LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_boletas_obtener_archivo_admin$$
CREATE PROCEDURE sp_boletas_obtener_archivo_admin(
  IN p_id_pago INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdPago, Estado, NumeroCompleto, PdfArchivo, XmlArchivo
    FROM BoletaElectronica
   WHERE IdPago = p_id_pago AND IdAcademia = p_id_academia
   LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_boletas_obtener_estado_admin$$
CREATE PROCEDURE sp_boletas_obtener_estado_admin(
  IN p_id_pago INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdPago, Estado, NumeroCompleto, EstadoSunat, MensajeError, Intentos,
         FechaEmision, (PdfArchivo IS NOT NULL) AS TienePdf
    FROM BoletaElectronica
   WHERE IdPago = p_id_pago AND IdAcademia = p_id_academia
   LIMIT 1;
END$$

DELIMITER ;
