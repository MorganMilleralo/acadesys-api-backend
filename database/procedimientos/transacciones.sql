-- AcadeSys | Procedimientos almacenados: Transacciones de pago online

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_transacciones_registrar_auditoria_pago$$
CREATE PROCEDURE sp_transacciones_registrar_auditoria_pago(
  IN p_id_pago BIGINT UNSIGNED,
  IN p_id_academia BIGINT UNSIGNED,
  IN p_evento VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_estado_anterior VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_estado_nuevo VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_monto_anterior DECIMAL(10,2),
  IN p_monto_nuevo DECIMAL(10,2),
  IN p_motivo VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  INSERT INTO PagoAuditoria
        (IdPago, IdComprobante, IdUsuarioActor, IdAcademia, Evento,
         EstadoAnterior, EstadoNuevo, MontoAnterior, MontoNuevo, Motivo, FechaCreacion)
       VALUES (p_id_pago, NULL, NULL, p_id_academia, p_evento, p_estado_anterior, p_estado_nuevo, p_monto_anterior, p_monto_nuevo, p_motivo, NOW());
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_cambiar_estado_si_coincide$$
CREATE PROCEDURE sp_transacciones_cambiar_estado_si_coincide(
  IN p_estado VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_id_transaccion BIGINT UNSIGNED,
  IN p_estado_2 VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  UPDATE PagoTransaccion SET FechaActualizacion = NOW(), Estado = p_estado
       WHERE IdTransaccion = p_id_transaccion AND Estado = p_estado_2 AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_bloquear_cuota_alumno$$
CREATE PROCEDURE sp_transacciones_bloquear_cuota_alumno(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT p.IdPago, p.IdUsuario, p.IdCiclo, p.Mes, p.Monto, p.Estado,
                u.IdAcademia, u.CorreoElectronico, u.Celular AS Telefono,
                u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno,
                CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, NULLIF(u.ApellidoMaterno, '')) AS Alumno,
                c.Nombre AS Ciclo
         FROM PagosMensualidad p
         INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
         INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
         WHERE p.IdPago = p_id_pago AND p.IdUsuario = p_id_usuario AND u.IdAcademia = p_id_academia
           AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_bloquear_comprobante$$
CREATE PROCEDURE sp_transacciones_bloquear_comprobante(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdComprobante FROM PagoComprobante
         WHERE IdPago = p_id_pago AND IdUsuario = p_id_usuario AND IdAcademia = p_id_academia
           AND EstadoRevision = 'EN_REVISION' AND EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_bloquear_transaccion_por_id_pago$$
CREATE PROCEDURE sp_transacciones_bloquear_transaccion_por_id_pago(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT,
  IN p_proveedor VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  SELECT IdTransaccion, IdPago, ReferenciaInterna, IdOrdenProveedor, ClaveIdempotencia,
                Monto, Moneda, Estado, UrlCheckout, CodigoEstadoProveedor,
                TIMESTAMPDIFF(SECOND, FechaCreacion, NOW()) AS AntiguedadSegundos
         FROM PagoTransaccion
         WHERE IdPago = p_id_pago AND IdUsuario = p_id_usuario AND IdAcademia = p_id_academia
           AND Proveedor = p_proveedor AND EstadoRegistro = 1
           AND Estado NOT IN ('ERROR', 'EXPIRADA', 'CANCELADA', 'RECHAZADA')
         ORDER BY IdTransaccion DESC LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_registrar_transaccion$$
CREATE PROCEDURE sp_transacciones_registrar_transaccion(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT,
  IN p_proveedor VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_referencia_interna VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_clave_idempotencia VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_monto DECIMAL(10,2),
  IN p_moneda CHAR(3) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  INSERT INTO PagoTransaccion
          (IdPago, IdUsuario, IdAcademia, Proveedor, ReferenciaInterna,
           ClaveIdempotencia, Monto, Moneda, Estado, FechaCreacion, FechaActualizacion, EstadoRegistro)
         VALUES (p_id_pago, p_id_usuario, p_id_academia, p_proveedor, p_referencia_interna, p_clave_idempotencia, p_monto, p_moneda, 'CREANDO', NOW(), NOW(), 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_guardar_orden_proveedor$$
CREATE PROCEDURE sp_transacciones_guardar_orden_proveedor(
  IN p_id_orden_proveedor VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_estado_proveedor_actual VARCHAR(255),
  IN p_id_transaccion BIGINT UNSIGNED
)
BEGIN
  UPDATE PagoTransaccion
       SET IdOrdenProveedor = p_id_orden_proveedor, UrlCheckout = NULL,
           CodigoEstadoProveedor = IF(Estado = 'CREANDO', p_estado_proveedor_actual, CodigoEstadoProveedor),
           Estado = IF(Estado = 'CREANDO' AND p_estado_proveedor_actual = 'pending', 'PENDIENTE', Estado),
           FechaActualizacion = NOW()
       WHERE IdTransaccion = p_id_transaccion AND EstadoRegistro = 1
         AND Proveedor = 'CULQI'
         AND (IdOrdenProveedor IS NULL OR IdOrdenProveedor = p_id_orden_proveedor)
         AND Estado <> 'ERROR';
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_obtener_transaccion_por_id_transaccion$$
CREATE PROCEDURE sp_transacciones_obtener_transaccion_por_id_transaccion(
  IN p_id_transaccion BIGINT UNSIGNED
)
BEGIN
  SELECT IdTransaccion, Estado, UrlCheckout, IdOrdenProveedor
       FROM PagoTransaccion
       WHERE IdTransaccion = p_id_transaccion AND EstadoRegistro = 1
       LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_marcar_error_creacion$$
CREATE PROCEDURE sp_transacciones_marcar_error_creacion(
  IN p_id_transaccion BIGINT UNSIGNED
)
BEGIN
  UPDATE PagoTransaccion
       SET Estado = 'ERROR', FechaActualizacion = NOW()
       WHERE IdTransaccion = p_id_transaccion AND Estado = 'CREANDO'
         AND IdOrdenProveedor IS NULL AND Proveedor = 'CULQI'
         AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_obtener_estado_pago$$
CREATE PROCEDURE sp_transacciones_obtener_estado_pago(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT p.IdPago, p.Estado AS EstadoPago, p.Monto,
              pt.IdTransaccion, pt.Proveedor, pt.Estado AS EstadoTransaccion,
              pt.IdOrdenProveedor, pt.ReferenciaInterna, pt.UrlCheckout,
              pt.Monto AS MontoTransaccion, pt.Moneda, pt.FechaCreacion,
              pt.FechaConfirmacion
       FROM PagosMensualidad p
       INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
       INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
       LEFT JOIN PagoTransaccion pt ON pt.IdTransaccion = (
         SELECT MAX(pt2.IdTransaccion) FROM PagoTransaccion pt2
         WHERE pt2.IdPago = p.IdPago AND pt2.IdUsuario = p.IdUsuario
           AND pt2.IdAcademia = u.IdAcademia AND pt2.EstadoRegistro = 1
       )
       WHERE p.IdPago = p_id_pago AND p.IdUsuario = p_id_usuario AND u.IdAcademia = p_id_academia
         AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
       LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_obtener_transaccion_por_proveedor$$
CREATE PROCEDURE sp_transacciones_obtener_transaccion_por_proveedor(
  IN p_proveedor VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_referencia_interna VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  SELECT IdPago FROM PagoTransaccion WHERE Proveedor = p_proveedor AND ReferenciaInterna = p_referencia_interna AND EstadoRegistro = 1 LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_bloquear_cuota$$
CREATE PROCEDURE sp_transacciones_bloquear_cuota(
  IN p_id_pago INT
)
BEGIN
  SELECT p.IdPago, p.IdUsuario, p.Monto, p.Estado, u.IdAcademia
         FROM PagosMensualidad p
         INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
         INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
         WHERE p.IdPago = p_id_pago AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_bloquear_transaccion_por_proveedor$$
CREATE PROCEDURE sp_transacciones_bloquear_transaccion_por_proveedor(
  IN p_proveedor VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_referencia_interna VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  SELECT IdTransaccion, IdPago, IdUsuario, IdAcademia, ReferenciaInterna,
                IdOrdenProveedor, Monto, Moneda, Estado, CodigoEstadoProveedor
         FROM PagoTransaccion
         WHERE Proveedor = p_proveedor AND ReferenciaInterna = p_referencia_interna AND EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_bloquear_auditoria_pago$$
CREATE PROCEDURE sp_transacciones_bloquear_auditoria_pago(
  IN p_id_pago INT,
  IN p_id_academia INT,
  IN p_evento VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  SELECT IdAuditoria, Motivo FROM PagoAuditoria
         WHERE IdPago = p_id_pago AND IdAcademia = p_id_academia AND Evento = p_evento
         ORDER BY IdAuditoria DESC FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_actualizar_estado_cuota$$
CREATE PROCEDURE sp_transacciones_actualizar_estado_cuota(
  IN p_id_pago INT,
  IN p_id_usuario INT
)
BEGIN
  UPDATE PagosMensualidad SET Estado = 'Pagado', FechaPago = COALESCE(FechaPago, NOW())
             WHERE IdPago = p_id_pago AND IdUsuario = p_id_usuario AND EstadoRegistro = 1 AND Estado IN ('Pendiente', 'Moroso');
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_actualizar_estado_proveedor$$
CREATE PROCEDURE sp_transacciones_actualizar_estado_proveedor(
  IN p_estado VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_id_orden_proveedor VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_codigo_estado_proveedor VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_id_transaccion BIGINT UNSIGNED,
  IN p_proveedor VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  UPDATE PagoTransaccion SET Estado = p_estado, IdOrdenProveedor = p_id_orden_proveedor,
           CodigoEstadoProveedor = p_codigo_estado_proveedor, FechaActualizacion = NOW(),
           FechaConfirmacion = IF(p_estado = 'APROBADA', COALESCE(FechaConfirmacion, NOW()), FechaConfirmacion)
         WHERE IdTransaccion = p_id_transaccion AND EstadoRegistro = 1 AND Proveedor = p_proveedor;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_verificar_cuota$$
CREATE PROCEDURE sp_transacciones_verificar_cuota(
  IN p_id_pago INT,
  IN p_id_academia INT
)
BEGIN
  SELECT p.IdPago FROM PagosMensualidad p
       INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
       INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
       WHERE p.IdPago = p_id_pago AND u.IdAcademia = p_id_academia AND p.EstadoRegistro = 1 LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_listar_auditoria_pago$$
CREATE PROCEDURE sp_transacciones_listar_auditoria_pago(
  IN p_id_pago INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdAuditoria, IdComprobante, IdUsuarioActor, Evento, EstadoAnterior, EstadoNuevo,
              MontoAnterior, MontoNuevo, Motivo, FechaCreacion
       FROM PagoAuditoria WHERE IdPago = p_id_pago AND IdAcademia = p_id_academia
       ORDER BY IdAuditoria DESC LIMIT 200;
END$$

-- Filtros opcionales: un parámetro en NULL no filtra.
-- p_estado = 'REQUIERE_REVISION' agrupa los estados que necesitan atención.
DROP PROCEDURE IF EXISTS sp_transacciones_contar_admin$$
CREATE PROCEDURE sp_transacciones_contar_admin(
  IN p_id_academia INT,
  IN p_id_ciclo INT,
  IN p_periodo VARCHAR(20),
  IN p_estado VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_segundos_huerfana INT
)
BEGIN
  SELECT COUNT(*) AS Total
  FROM PagoTransaccion pt
  INNER JOIN PagosMensualidad p ON p.IdPago = pt.IdPago AND p.IdUsuario = pt.IdUsuario
  INNER JOIN Usuario u ON u.IdUsuario = pt.IdUsuario AND u.IdAcademia = pt.IdAcademia
  INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = pt.IdAcademia
  WHERE pt.IdAcademia = p_id_academia AND pt.EstadoRegistro = 1 AND p.EstadoRegistro = 1
    AND (p_id_ciclo IS NULL OR p.IdCiclo = p_id_ciclo)
    AND (p_periodo IS NULL OR p.Mes = p_periodo)
    AND (p_estado IS NULL
      OR (p_estado = 'REQUIERE_REVISION' AND (pt.Estado IN ('PAGO_DUPLICADO', 'REEMBOLSADA', 'CONTRACARGO')
          OR (pt.Estado = 'CREANDO' AND pt.FechaCreacion < NOW() - INTERVAL p_segundos_huerfana SECOND)))
      OR (p_estado <> 'REQUIERE_REVISION' AND pt.Estado = p_estado));
END$$

DROP PROCEDURE IF EXISTS sp_transacciones_listar_admin$$
CREATE PROCEDURE sp_transacciones_listar_admin(
  IN p_id_academia INT,
  IN p_id_ciclo INT,
  IN p_periodo VARCHAR(20),
  IN p_estado VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_segundos_huerfana INT,
  IN p_limite INT,
  IN p_desplazamiento INT
)
BEGIN
  SELECT pt.IdTransaccion, pt.IdPago, pt.Proveedor, pt.ReferenciaInterna, pt.IdOrdenProveedor,
         pt.Monto, pt.Moneda, pt.Estado, pt.CodigoEstadoProveedor,
         pt.FechaCreacion, pt.FechaActualizacion, pt.FechaConfirmacion,
         TIMESTAMPDIFF(SECOND, pt.FechaCreacion, NOW()) AS AntiguedadSegundos,
         p.IdCiclo, c.Nombre AS Ciclo, p.Mes AS Periodo, p.Estado AS EstadoCuota, p.Monto AS MontoCuota,
         u.IdUsuario, u.CodigoUsuario,
         CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, NULLIF(u.ApellidoMaterno, '')) AS Alumno
  FROM PagoTransaccion pt
  INNER JOIN PagosMensualidad p ON p.IdPago = pt.IdPago AND p.IdUsuario = pt.IdUsuario
  INNER JOIN Usuario u ON u.IdUsuario = pt.IdUsuario AND u.IdAcademia = pt.IdAcademia
  INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = pt.IdAcademia
  WHERE pt.IdAcademia = p_id_academia AND pt.EstadoRegistro = 1 AND p.EstadoRegistro = 1
    AND (p_id_ciclo IS NULL OR p.IdCiclo = p_id_ciclo)
    AND (p_periodo IS NULL OR p.Mes = p_periodo)
    AND (p_estado IS NULL
      OR (p_estado = 'REQUIERE_REVISION' AND (pt.Estado IN ('PAGO_DUPLICADO', 'REEMBOLSADA', 'CONTRACARGO')
          OR (pt.Estado = 'CREANDO' AND pt.FechaCreacion < NOW() - INTERVAL p_segundos_huerfana SECOND)))
      OR (p_estado <> 'REQUIERE_REVISION' AND pt.Estado = p_estado))
  ORDER BY pt.IdTransaccion DESC
  LIMIT p_limite OFFSET p_desplazamiento;
END$$

-- Última transacción con orden del proveedor, por cuota o por transacción.
DROP PROCEDURE IF EXISTS sp_transacciones_obtener_conciliable$$
CREATE PROCEDURE sp_transacciones_obtener_conciliable(
  IN p_id_academia INT,
  IN p_proveedor VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_id_pago INT,
  IN p_id_transaccion BIGINT UNSIGNED,
  IN p_id_usuario INT
)
BEGIN
  SELECT IdTransaccion, IdPago, ReferenciaInterna, IdOrdenProveedor, Estado FROM PagoTransaccion
  WHERE IdAcademia = p_id_academia AND Proveedor = p_proveedor AND EstadoRegistro = 1
    AND IdOrdenProveedor IS NOT NULL
    AND (p_id_pago IS NULL OR IdPago = p_id_pago)
    AND (p_id_transaccion IS NULL OR IdTransaccion = p_id_transaccion)
    AND (p_id_usuario IS NULL OR IdUsuario = p_id_usuario)
  ORDER BY IdTransaccion DESC LIMIT 1;
END$$

DELIMITER ;
