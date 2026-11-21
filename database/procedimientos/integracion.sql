-- AcadeSys | Procedimientos almacenados: API de integración de clientes

DELIMITER $$

-- Consumidor activo por hash de su clave. Registra el último uso.
DROP PROCEDURE IF EXISTS sp_integracion_autenticar$$
CREATE PROCEDURE sp_integracion_autenticar(
  IN p_clave_hash CHAR(64)
)
BEGIN
  UPDATE IntegracionConsumidor
     SET UltimoUso = NOW()
   WHERE ClaveHash = p_clave_hash AND Activo = 1;
  SELECT IdConsumidor, IdAcademia, Nombre, Prefijo, LimitePorMinuto
    FROM IntegracionConsumidor
   WHERE ClaveHash = p_clave_hash AND Activo = 1
   LIMIT 1;
END$$

-- Clientes (alumnos activos) de la academia, ordenados por IdUsuario para
-- paginar con cursor. Version es la huella de los datos exportados: cambia
-- solo si cambian los datos del cliente.
-- p_solo_pendientes = 1 devuelve solo los que el consumidor no confirmó o
-- cuya versión cambió desde su última confirmación.
DROP PROCEDURE IF EXISTS sp_integracion_listar_clientes$$
CREATE PROCEDURE sp_integracion_listar_clientes(
  IN p_id_consumidor INT,
  IN p_id_academia INT,
  IN p_cursor INT,
  IN p_limite INT,
  IN p_solo_pendientes TINYINT,
  IN p_codigo VARCHAR(50)
)
BEGIN
  SELECT v.*
    FROM (
      SELECT clientes.*,
             SHA2(CONCAT_WS('|', clientes.CodigoUsuario, IFNULL(clientes.DNI, ''), clientes.Nombres,
               IFNULL(clientes.ApellidoPaterno, ''), IFNULL(clientes.ApellidoMaterno, ''),
               IFNULL(LOWER(TRIM(clientes.CorreoElectronico)), ''), IFNULL(clientes.Celular, ''),
               IFNULL(clientes.Ciclos, '')), 256) AS Version
        FROM (
          SELECT u.IdUsuario, u.CodigoUsuario, u.DNI, u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno,
                 u.CorreoElectronico, u.Celular, u.FechaCreacion,
                 (SELECT GROUP_CONCAT(DISTINCT c.Nombre ORDER BY c.Nombre SEPARATOR '||')
                    FROM Matricula m
                    INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
                   WHERE m.IdUsuario = u.IdUsuario AND m.EstadoRegistro = 1) AS Ciclos,
                 e.Version AS VersionConfirmada,
                 e.FechaConfirmacion
            FROM Usuario u
            LEFT JOIN IntegracionEntrega e ON e.IdConsumidor = p_id_consumidor AND e.IdUsuario = u.IdUsuario
           WHERE u.IdAcademia = p_id_academia
             AND u.EstadoRegistro = 1
             AND u.IdUsuario > p_cursor
             AND (p_codigo IS NULL OR u.CodigoUsuario = p_codigo)
             AND EXISTS (SELECT 1
                           FROM Usuario_Perfiles up
                           INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
                          WHERE up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
                            AND LOWER(TRIM(p.Nombre)) = 'alumno')
        ) clientes
    ) v
   WHERE p_solo_pendientes = 0
      OR v.VersionConfirmada IS NULL
      OR v.VersionConfirmada <> v.Version
   ORDER BY v.IdUsuario
   LIMIT p_limite;
END$$

-- Confirma que el consumidor guardó una versión concreta de un cliente.
-- Idempotente: confirmar dos veces la misma versión no crea duplicados.
-- Solo acepta clientes de la academia del consumidor y con la versión vigente.
DROP PROCEDURE IF EXISTS sp_integracion_confirmar_cliente$$
CREATE PROCEDURE sp_integracion_confirmar_cliente(
  IN p_id_consumidor INT,
  IN p_id_academia INT,
  IN p_codigo VARCHAR(50),
  IN p_version CHAR(64)
)
BEGIN
  DECLARE v_id_usuario INT DEFAULT NULL;
  DECLARE v_version CHAR(64) DEFAULT NULL;
  DECLARE v_resultado VARCHAR(30) DEFAULT 'NO_ENCONTRADO';

  SELECT u.IdUsuario,
         SHA2(CONCAT_WS('|', u.CodigoUsuario, IFNULL(u.DNI, ''), u.Nombres,
             IFNULL(u.ApellidoPaterno, ''), IFNULL(u.ApellidoMaterno, ''),
             IFNULL(LOWER(TRIM(u.CorreoElectronico)), ''), IFNULL(u.Celular, ''),
             IFNULL((SELECT GROUP_CONCAT(DISTINCT c.Nombre ORDER BY c.Nombre SEPARATOR '||')
                       FROM Matricula m
                       INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
                      WHERE m.IdUsuario = u.IdUsuario AND m.EstadoRegistro = 1), '')), 256)
    INTO v_id_usuario, v_version
    FROM Usuario u
   WHERE u.CodigoUsuario = p_codigo AND u.IdAcademia = p_id_academia AND u.EstadoRegistro = 1
     AND EXISTS (SELECT 1
                   FROM Usuario_Perfiles up
                   INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
                  WHERE up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
                    AND LOWER(TRIM(p.Nombre)) = 'alumno')
   LIMIT 1;

  IF v_id_usuario IS NOT NULL AND v_version <> p_version THEN
    SET v_resultado = 'VERSION_DESACTUALIZADA';
  ELSEIF v_id_usuario IS NOT NULL THEN
    INSERT INTO IntegracionEntrega (IdConsumidor, IdUsuario, Version)
    VALUES (p_id_consumidor, v_id_usuario, p_version)
    ON DUPLICATE KEY UPDATE
      Confirmaciones = Confirmaciones + 1,
      FechaConfirmacion = NOW(),
      Version = VALUES(Version);
    SET v_resultado = IF(ROW_COUNT() = 1, 'NUEVO', 'YA_CONFIRMADO');
  END IF;

  SELECT v_resultado AS Resultado, v_version AS VersionVigente;
END$$

DROP PROCEDURE IF EXISTS sp_integracion_registrar_auditoria$$
CREATE PROCEDURE sp_integracion_registrar_auditoria(
  IN p_id_consumidor INT,
  IN p_id_solicitud CHAR(36),
  IN p_metodo VARCHAR(10),
  IN p_ruta VARCHAR(200),
  IN p_estado_http SMALLINT,
  IN p_codigo VARCHAR(60),
  IN p_registros INT,
  IN p_ip VARCHAR(45),
  IN p_duracion_ms INT
)
BEGIN
  INSERT INTO IntegracionAuditoria (IdConsumidor, IdSolicitud, Metodo, Ruta, EstadoHttp, Codigo, Registros, Ip, DuracionMs)
  VALUES (p_id_consumidor, p_id_solicitud, p_metodo, p_ruta, p_estado_http, p_codigo, p_registros, p_ip, p_duracion_ms);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

-- Administración de consumidores (solo administradores de la misma academia).
DROP PROCEDURE IF EXISTS sp_integracion_crear_consumidor$$
CREATE PROCEDURE sp_integracion_crear_consumidor(
  IN p_id_academia INT,
  IN p_nombre VARCHAR(100),
  IN p_prefijo VARCHAR(16),
  IN p_clave_hash CHAR(64),
  IN p_limite_por_minuto SMALLINT,
  IN p_usuario_creacion INT
)
BEGIN
  INSERT INTO IntegracionConsumidor (IdAcademia, Nombre, Prefijo, ClaveHash, LimitePorMinuto, UsuarioCreacion)
  VALUES (p_id_academia, p_nombre, p_prefijo, p_clave_hash, p_limite_por_minuto, p_usuario_creacion);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_integracion_listar_consumidores$$
CREATE PROCEDURE sp_integracion_listar_consumidores(
  IN p_id_academia INT
)
BEGIN
  SELECT c.IdConsumidor, c.Nombre, c.Prefijo, c.LimitePorMinuto, c.Activo, c.FechaCreacion,
         c.FechaRevocacion, c.UltimoUso,
         (SELECT COUNT(*) FROM IntegracionEntrega e WHERE e.IdConsumidor = c.IdConsumidor) AS ClientesConfirmados
    FROM IntegracionConsumidor c
   WHERE c.IdAcademia = p_id_academia
   ORDER BY c.IdConsumidor DESC;
END$$

DROP PROCEDURE IF EXISTS sp_integracion_revocar_consumidor$$
CREATE PROCEDURE sp_integracion_revocar_consumidor(
  IN p_id_consumidor INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE IntegracionConsumidor
     SET Activo = 0, FechaRevocacion = NOW()
   WHERE IdConsumidor = p_id_consumidor AND IdAcademia = p_id_academia AND Activo = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DELIMITER ;
