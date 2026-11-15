-- AcadeSys | Procedimientos almacenados: Pagos manuales y morosidad

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_pagos_registrar_auditoria_pago$$
CREATE PROCEDURE sp_pagos_registrar_auditoria_pago(
  IN p_id_pago BIGINT UNSIGNED,
  IN p_id_comprobante BIGINT UNSIGNED,
  IN p_id_usuario_actor BIGINT UNSIGNED,
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
       VALUES (p_id_pago, p_id_comprobante, p_id_usuario_actor, p_id_academia, p_evento, p_estado_anterior, p_estado_nuevo, p_monto_anterior, p_monto_nuevo, p_motivo, NOW());
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_listar_matricula$$
CREATE PROCEDURE sp_pagos_listar_matricula(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT p.IdPago, u.IdUsuario, u.CodigoUsuario,
                CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, NULLIF(u.ApellidoMaterno, '')) AS Alumno,
                c.Nombre AS Ciclo, p.Mes, p.Monto,
                COALESCE(p.Estado, 'Sin registro') AS Estado, p.FechaPago,
                p.FechaVencimiento,
                pc.IdComprobante, pc.Referencia AS ReferenciaComprobante,
                pc.UrlComprobante, pc.EstadoRevision AS EstadoRevisionComprobante,
                pc.MotivoRevision, pc.FechaCreacion AS FechaSolicitudComprobante
         FROM Matricula m
         INNER JOIN Usuario u ON m.IdUsuario = u.IdUsuario
         INNER JOIN Ciclo c ON m.IdCiclo = c.IdCiclo AND c.IdAcademia = u.IdAcademia
         LEFT JOIN PagosMensualidad p
           ON p.IdUsuario = m.IdUsuario AND p.IdCiclo = m.IdCiclo AND p.EstadoRegistro = 1
         LEFT JOIN PagoComprobante pc ON pc.IdComprobante = (
           SELECT MAX(pc2.IdComprobante)
           FROM PagoComprobante pc2
           WHERE pc2.IdPago = p.IdPago AND pc2.IdAcademia = u.IdAcademia AND pc2.EstadoRegistro = 1
         )
         WHERE m.IdCiclo = p_id_ciclo AND m.EstadoRegistro = 1
           AND u.IdAcademia = p_id_academia AND u.EstadoRegistro = 1
           AND c.EstadoRegistro IN (0, 1)
         ORDER BY u.ApellidoPaterno ASC, u.Nombres ASC, p.IdPago ASC;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_bloquear_ciclo$$
CREATE PROCEDURE sp_pagos_bloquear_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdCiclo, IdAcademia, Nombre, PrecioMensual
         FROM Ciclo WHERE IdCiclo = p_id_ciclo AND IdAcademia = p_id_academia LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_bloquear_matricula$$
CREATE PROCEDURE sp_pagos_bloquear_matricula(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT m.IdUsuario
         FROM Matricula m
         INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
         WHERE m.IdCiclo = p_id_ciclo AND m.EstadoRegistro = 1
           AND u.IdAcademia = p_id_academia AND u.EstadoRegistro = 1
         ORDER BY m.IdUsuario ASC FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_bloquear_cuota_por_id_usuario$$
CREATE PROCEDURE sp_pagos_bloquear_cuota_por_id_usuario(
  IN p_id_usuario INT,
  IN p_id_ciclo INT,
  IN p_mes VARCHAR(20)
)
BEGIN
  SELECT IdPago, Estado, Monto
           FROM PagosMensualidad
           WHERE IdUsuario = p_id_usuario AND IdCiclo = p_id_ciclo AND Mes = p_mes AND EstadoRegistro = 1
           ORDER BY IdPago ASC LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_registrar_cuota$$
CREATE PROCEDURE sp_pagos_registrar_cuota(
  IN p_id_usuario INT,
  IN p_id_ciclo INT,
  IN p_mes VARCHAR(20),
  IN p_monto DECIMAL(8,2),
  IN p_fecha_vencimiento DATE
)
BEGIN
  INSERT INTO PagosMensualidad
            (IdUsuario, IdCiclo, Mes, Monto, Estado, FechaPago, FechaVencimiento, EstadoRegistro)
           VALUES (p_id_usuario, p_id_ciclo, p_mes, p_monto, 'Pendiente', NULL, p_fecha_vencimiento, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_listar_comprobante$$
CREATE PROCEDURE sp_pagos_listar_comprobante(
  IN p_id_academia BIGINT UNSIGNED,
  IN p_estado_revision VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  SELECT pc.IdComprobante, pc.IdPago, pc.IdUsuario, pc.Referencia, pc.UrlComprobante,
                pc.EstadoRevision, pc.MotivoRevision, pc.FechaCreacion, pc.FechaRevision,
                p.IdCiclo, c.Nombre AS Ciclo, p.Mes, p.Monto, p.Estado AS EstadoPago,
                u.CodigoUsuario,
                CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, NULLIF(u.ApellidoMaterno, '')) AS Alumno
         FROM PagoComprobante pc
         INNER JOIN PagosMensualidad p ON p.IdPago = pc.IdPago AND p.IdUsuario = pc.IdUsuario
         INNER JOIN Usuario u ON u.IdUsuario = pc.IdUsuario AND u.IdAcademia = pc.IdAcademia
         INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = pc.IdAcademia
         WHERE pc.IdAcademia = p_id_academia AND pc.EstadoRevision = p_estado_revision AND pc.EstadoRegistro = 1
           AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
         ORDER BY pc.FechaCreacion ASC, pc.IdComprobante ASC;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_bloquear_comprobante_por_id_comprobante$$
CREATE PROCEDURE sp_pagos_bloquear_comprobante_por_id_comprobante(
  IN p_id_comprobante BIGINT UNSIGNED,
  IN p_id_academia BIGINT UNSIGNED
)
BEGIN
  SELECT pc.IdComprobante, pc.IdPago, pc.IdUsuario, pc.EstadoRevision,
                p.Estado AS EstadoPago, p.Monto, p.FechaPago, u.IdAcademia
         FROM PagoComprobante pc
         INNER JOIN PagosMensualidad p ON p.IdPago = pc.IdPago AND p.IdUsuario = pc.IdUsuario
         INNER JOIN Usuario u ON u.IdUsuario = pc.IdUsuario AND u.IdAcademia = pc.IdAcademia
         INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = pc.IdAcademia
         WHERE pc.IdComprobante = p_id_comprobante AND pc.IdAcademia = p_id_academia AND pc.EstadoRegistro = 1
           AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_actualizar_estado_comprobante$$
CREATE PROCEDURE sp_pagos_actualizar_estado_comprobante(
  IN p_estado_revision VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_motivo_revision VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_id_revisado_por BIGINT UNSIGNED,
  IN p_id_comprobante BIGINT UNSIGNED,
  IN p_id_academia INT
)
BEGIN
  UPDATE PagoComprobante
         SET EstadoRevision = p_estado_revision, MotivoRevision = p_motivo_revision, FechaRevision = NOW(), IdRevisadoPor = p_id_revisado_por
         WHERE IdComprobante = p_id_comprobante AND IdAcademia = p_id_academia AND EstadoRevision = 'EN_REVISION' AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_marcar_cuota_pagada$$
CREATE PROCEDURE sp_pagos_marcar_cuota_pagada(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE PagosMensualidad p
           INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
           SET p.Estado = 'Pagado', p.FechaPago = COALESCE(p.FechaPago, NOW())
           WHERE p.IdPago = p_id_pago AND p.IdUsuario = p_id_usuario AND u.IdAcademia = p_id_academia AND p.EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_bloquear_cuota_por_id_pago$$
CREATE PROCEDURE sp_pagos_bloquear_cuota_por_id_pago(
  IN p_id_pago INT,
  IN p_id_academia INT
)
BEGIN
  SELECT p.IdPago, p.Estado, p.Mes, p.Monto, p.FechaPago, p.IdUsuario
         FROM PagosMensualidad p
         INNER JOIN Usuario u ON p.IdUsuario = u.IdUsuario
         INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
         WHERE p.IdPago = p_id_pago AND u.IdAcademia = p_id_academia AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_bloquear_comprobante_por_id_pago$$
CREATE PROCEDURE sp_pagos_bloquear_comprobante_por_id_pago(
  IN p_id_pago INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdComprobante FROM PagoComprobante
         WHERE IdPago = p_id_pago AND IdAcademia = p_id_academia AND EstadoRevision = 'EN_REVISION' AND EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_pagos_marcar_cuota_morosa$$
CREATE PROCEDURE sp_pagos_marcar_cuota_morosa(
  IN p_id_pago INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE PagosMensualidad p
         INNER JOIN Usuario u ON p.IdUsuario = u.IdUsuario
         SET p.Estado = 'Moroso', p.FechaPago = NULL
         WHERE p.IdPago = p_id_pago AND u.IdAcademia = p_id_academia AND p.EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;
