-- AcadeSys | Procedimientos almacenados: Generación automática de cuotas

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_cuotas_listar_ciclo$$
CREATE PROCEDURE sp_cuotas_listar_ciclo(
  IN p_fecha_inicio DATE,
  IN p_fecha_fin DATE
)
BEGIN
  SELECT IdCiclo, IdAcademia, Nombre, PrecioMensual,
              DATE_FORMAT(FechaInicio, '%Y-%m-%d') AS FechaInicioISO,
              DATE_FORMAT(FechaFin, '%Y-%m-%d') AS FechaFinISO
       FROM Ciclo
       WHERE EstadoRegistro = 1
         AND FechaInicio IS NOT NULL
         AND FechaFin IS NOT NULL
         AND FechaInicio <= p_fecha_inicio
         AND FechaFin >= p_fecha_fin
       ORDER BY IdCiclo ASC;
END$$

DROP PROCEDURE IF EXISTS sp_cuotas_bloquear_ciclo$$
CREATE PROCEDURE sp_cuotas_bloquear_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdCiclo, IdAcademia, PrecioMensual,
                  DATE_FORMAT(FechaInicio, '%Y-%m-%d') AS FechaInicioISO,
                  DATE_FORMAT(FechaFin, '%Y-%m-%d') AS FechaFinISO
           FROM Ciclo
           WHERE IdCiclo = p_id_ciclo AND IdAcademia = p_id_academia AND EstadoRegistro = 1
           LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_cuotas_bloquear_matricula$$
CREATE PROCEDURE sp_cuotas_bloquear_matricula(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT DISTINCT m.IdUsuario,
                  DATE_FORMAT(m.FechaCreacion, '%Y-%m-%d') AS FechaMatriculaISO
           FROM Matricula m
           INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
           WHERE m.IdCiclo = p_id_ciclo
             AND m.EstadoRegistro = 1
             AND u.IdAcademia = p_id_academia
             AND u.EstadoRegistro = 1
           ORDER BY m.IdUsuario ASC
           FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_cuotas_bloquear_cuota_por_id_usuario$$
CREATE PROCEDURE sp_cuotas_bloquear_cuota_por_id_usuario(
  IN p_id_usuario INT,
  IN p_id_ciclo INT,
  IN p_mes VARCHAR(20)
)
BEGIN
  SELECT IdPago
             FROM PagosMensualidad
             WHERE IdUsuario = p_id_usuario AND IdCiclo = p_id_ciclo AND Mes = p_mes AND EstadoRegistro = 1
             ORDER BY IdPago ASC
             LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_cuotas_registrar_cuota$$
CREATE PROCEDURE sp_cuotas_registrar_cuota(
  IN p_id_usuario INT,
  IN p_id_ciclo INT,
  IN p_mes VARCHAR(20),
  IN p_monto DECIMAL(8,2),
  IN p_fecha_vencimiento DATE
)
BEGIN
  INSERT INTO PagosMensualidad
              (IdUsuario, IdCiclo, Mes, Monto, Estado,
               FechaPago, FechaVencimiento, EstadoRegistro)
             VALUES (p_id_usuario, p_id_ciclo, p_mes, p_monto, 'Pendiente', NULL, p_fecha_vencimiento, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_cuotas_registrar_auditoria_generacion$$
CREATE PROCEDURE sp_cuotas_registrar_auditoria_generacion(
  IN p_id_pago BIGINT UNSIGNED,
  IN p_id_academia BIGINT UNSIGNED,
  IN p_monto_nuevo DECIMAL(10,2),
  IN p_motivo VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  INSERT INTO PagoAuditoria
              (IdPago, IdComprobante, IdUsuarioActor, IdAcademia, Evento,
               EstadoAnterior, EstadoNuevo, MontoAnterior, MontoNuevo, Motivo, FechaCreacion)
             VALUES (p_id_pago, NULL, NULL, p_id_academia, 'CUOTA_MENSUAL_CREADA_CRON',
                     NULL, 'Pendiente', NULL, p_monto_nuevo, p_motivo, NOW());
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_cuotas_bloquear_cuota_por_fecha_vencimiento$$
CREATE PROCEDURE sp_cuotas_bloquear_cuota_por_fecha_vencimiento(
  IN p_fecha_vencimiento DATE
)
BEGIN
  SELECT p.IdPago, p.Monto, p.Estado, u.IdAcademia
         FROM PagosMensualidad p
         INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
         INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
         WHERE p.EstadoRegistro = 1
           AND u.EstadoRegistro = 1
           AND LOWER(TRIM(COALESCE(p.Estado, ''))) = 'pendiente'
           AND p.FechaVencimiento IS NOT NULL
           AND p.FechaVencimiento < p_fecha_vencimiento
           AND NOT EXISTS (
             SELECT 1
             FROM PagoComprobante pc
             WHERE pc.IdPago = p.IdPago
               AND pc.IdUsuario = p.IdUsuario
               AND pc.IdAcademia = u.IdAcademia
               AND pc.EstadoRegistro = 1
               AND pc.EstadoRevision = 'EN_REVISION'
           )
         ORDER BY p.IdPago ASC
         FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_cuotas_actualizar_estado_cuota$$
CREATE PROCEDURE sp_cuotas_actualizar_estado_cuota(
  IN p_id_pago INT
)
BEGIN
  UPDATE PagosMensualidad
             SET Estado = 'Moroso'
             WHERE IdPago = p_id_pago AND EstadoRegistro = 1
               AND LOWER(TRIM(COALESCE(Estado, ''))) = 'pendiente';
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_cuotas_registrar_auditoria_vencimiento$$
CREATE PROCEDURE sp_cuotas_registrar_auditoria_vencimiento(
  IN p_id_pago BIGINT UNSIGNED,
  IN p_id_academia BIGINT UNSIGNED,
  IN p_estado_anterior VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_monto_anterior DECIMAL(10,2),
  IN p_motivo VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  INSERT INTO PagoAuditoria
                (IdPago, IdComprobante, IdUsuarioActor, IdAcademia, Evento,
                 EstadoAnterior, EstadoNuevo, MontoAnterior, MontoNuevo, Motivo, FechaCreacion)
               VALUES (p_id_pago, NULL, NULL, p_id_academia, 'CUOTA_MOROSA_AUTOMATICA',
                       p_estado_anterior, 'Moroso', p_monto_anterior, p_monto_anterior, p_motivo, NOW());
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;
