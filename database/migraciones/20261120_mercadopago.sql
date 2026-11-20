-- AcadeSys: migración de persistencia para Mercado Pago Checkout Pro / Orders API.
-- Ejecutar en DBeaver sobre la base de datos correcta, en modo SQL Script.
-- No crea tablas ni borra datos. Reemplaza únicamente dos procedures que tenían CULQI fijo.

DROP PROCEDURE IF EXISTS sp_transacciones_guardar_orden_proveedor;
DROP PROCEDURE IF EXISTS sp_transacciones_marcar_error_creacion;

DELIMITER $$

CREATE PROCEDURE sp_transacciones_guardar_orden_proveedor(
  IN p_id_orden_proveedor VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_url_checkout TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_estado_proveedor_actual VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_proveedor VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_id_transaccion BIGINT UNSIGNED
)
BEGIN
  UPDATE PagoTransaccion
     SET IdOrdenProveedor = p_id_orden_proveedor,
         UrlCheckout = p_url_checkout,
         CodigoEstadoProveedor = IF(Estado = 'CREANDO', p_estado_proveedor_actual, CodigoEstadoProveedor),
         Estado = IF(Estado = 'CREANDO', 'PENDIENTE', Estado),
         FechaActualizacion = NOW()
   WHERE IdTransaccion = p_id_transaccion
     AND EstadoRegistro = 1
     AND Proveedor = p_proveedor
     AND (IdOrdenProveedor IS NULL OR IdOrdenProveedor = p_id_orden_proveedor)
     AND Estado <> 'ERROR';

  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

CREATE PROCEDURE sp_transacciones_marcar_error_creacion(
  IN p_id_transaccion BIGINT UNSIGNED,
  IN p_proveedor VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  UPDATE PagoTransaccion
     SET Estado = 'ERROR',
         FechaActualizacion = NOW()
   WHERE IdTransaccion = p_id_transaccion
     AND Estado = 'CREANDO'
     AND IdOrdenProveedor IS NULL
     AND Proveedor = p_proveedor
     AND EstadoRegistro = 1;

  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;

-- Verificación: deben existir las dos rutinas con los nuevos parámetros.
SHOW CREATE PROCEDURE sp_transacciones_guardar_orden_proveedor;
SHOW CREATE PROCEDURE sp_transacciones_marcar_error_creacion;
