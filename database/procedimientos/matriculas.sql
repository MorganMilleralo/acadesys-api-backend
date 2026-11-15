-- AcadeSys | Procedimientos almacenados: Matrícula en línea

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_matriculas_bloquear_matricula_por_id_ciclo$$
CREATE PROCEDURE sp_matriculas_bloquear_matricula_por_id_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT m.IdMatricula
         FROM Matricula m
         INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
         WHERE m.IdCiclo = p_id_ciclo
           AND m.EstadoRegistro = 1
           AND u.EstadoRegistro = 1
           AND u.IdAcademia = p_id_academia
         FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_bloquear_usuario_por_correo$$
CREATE PROCEDURE sp_matriculas_bloquear_usuario_por_correo(
  IN p_correo VARCHAR(255)
)
BEGIN
  SELECT
    u.IdUsuario,
    u.CodigoUsuario,
    u.Nombres,
    u.ApellidoPaterno,
    u.Clave AS ClaveHash,
    u.CorreoElectronico,
    u.IdAcademia,
    u.EstadoRegistro,
    up.IdPerfil,
    p.Nombre AS NombrePerfil
  FROM Usuario u
  INNER JOIN Usuario_Perfiles up
    ON up.IdUsuario = u.IdUsuario
   AND up.EstadoRegistro = 1
  INNER JOIN perfil p
    ON p.IdPerfil = up.IdPerfil
   AND p.EstadoRegistro = 1
  WHERE LOWER(TRIM(u.CorreoElectronico)) = p_correo
    AND u.EstadoRegistro = 1
  ORDER BY CASE WHEN LOWER(TRIM(p.Nombre)) = 'alumno' THEN 0 ELSE 1 END
  LIMIT 2
  FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_bloquear_matricula_por_id_usuario$$
CREATE PROCEDURE sp_matriculas_bloquear_matricula_por_id_usuario(
  IN p_id_usuario INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT IdMatricula
  FROM Matricula
  WHERE IdUsuario = p_id_usuario
    AND IdCiclo = p_id_ciclo
    AND EstadoRegistro = 1
  LIMIT 1
  FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_obtener_perfil$$
CREATE PROCEDURE sp_matriculas_obtener_perfil()
BEGIN
  SELECT IdPerfil
  FROM perfil
  WHERE EstadoRegistro = 1
    AND LOWER(TRIM(Nombre)) = 'alumno'
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_obtener_usuario$$
CREATE PROCEDURE sp_matriculas_obtener_usuario(
  IN p_codigo_usuario VARCHAR(50)
)
BEGIN
  SELECT IdUsuario FROM Usuario WHERE CodigoUsuario = p_codigo_usuario LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_registrar_usuario$$
CREATE PROCEDURE sp_matriculas_registrar_usuario(
  IN p_codigo_usuario VARCHAR(50),
  IN p_nombres VARCHAR(100),
  IN p_apellido_paterno VARCHAR(100),
  IN p_correo_electronico VARCHAR(150),
  IN p_clave VARCHAR(255),
  IN p_id_academia INT
)
BEGIN
  INSERT INTO Usuario
    (CodigoUsuario, DNI, Nombres, ApellidoPaterno, ApellidoMaterno,
     Celular, CorreoElectronico, Clave, FechaCreacion,
     EstadoRegistro, IdAcademia)
  VALUES (p_codigo_usuario, NULL, p_nombres, p_apellido_paterno, '', '', p_correo_electronico, p_clave, NOW(), 1, p_id_academia);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_registrar_usuario_perfil$$
CREATE PROCEDURE sp_matriculas_registrar_usuario_perfil(
  IN p_id_usuario INT,
  IN p_id_perfil INT
)
BEGIN
  INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro)
  VALUES (p_id_usuario, p_id_perfil, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_registrar_matricula$$
CREATE PROCEDURE sp_matriculas_registrar_matricula(
  IN p_id_usuario INT,
  IN p_id_ciclo INT
)
BEGIN
  INSERT INTO Matricula (IdUsuario, IdCiclo, EstadoRegistro)
  VALUES (p_id_usuario, p_id_ciclo, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_bloquear_cuota$$
CREATE PROCEDURE sp_matriculas_bloquear_cuota(
  IN p_id_usuario INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT IdPago, Monto, Estado
         FROM PagosMensualidad
         WHERE IdUsuario = p_id_usuario AND IdCiclo = p_id_ciclo
           AND LOWER(TRIM(Mes)) = 'inscripcion' AND EstadoRegistro = 1
         ORDER BY IdPago ASC LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_registrar_cuota$$
CREATE PROCEDURE sp_matriculas_registrar_cuota(
  IN p_id_usuario INT,
  IN p_id_ciclo INT,
  IN p_monto DECIMAL(8,2)
)
BEGIN
  INSERT INTO PagosMensualidad
            (IdUsuario, IdCiclo, Mes, Monto, Estado, FechaPago, FechaVencimiento, EstadoRegistro)
           VALUES (p_id_usuario, p_id_ciclo, 'Inscripcion', p_monto, 'Pendiente', NULL, NULL, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_registrar_auditoria_pago$$
CREATE PROCEDURE sp_matriculas_registrar_auditoria_pago(
  IN p_id_pago BIGINT UNSIGNED,
  IN p_id_usuario_actor BIGINT UNSIGNED,
  IN p_id_academia BIGINT UNSIGNED,
  IN p_monto_nuevo DECIMAL(10,2),
  IN p_motivo VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  INSERT INTO PagoAuditoria
            (IdPago, IdComprobante, IdUsuarioActor, IdAcademia, Evento,
             EstadoAnterior, EstadoNuevo, MontoAnterior, MontoNuevo, Motivo, FechaCreacion)
           VALUES (p_id_pago, NULL, p_id_usuario_actor, p_id_academia, 'INSCRIPCION_CREADA', NULL, 'Pendiente', NULL, p_monto_nuevo, p_motivo, NOW());
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_contar_matricula$$
CREATE PROCEDURE sp_matriculas_contar_matricula(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT COUNT(*) AS TotalAlumnos
  FROM Matricula m
  INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
  WHERE m.IdCiclo = p_id_ciclo
    AND m.EstadoRegistro = 1
    AND u.EstadoRegistro = 1
    AND u.IdAcademia = p_id_academia;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_bloquear_usuario_por_id_usuario$$
CREATE PROCEDURE sp_matriculas_bloquear_usuario_por_id_usuario(
  IN p_id_usuario INT,
  IN p_correo VARCHAR(255)
)
BEGIN
  SELECT IdUsuario, CorreoElectronico, Clave
  FROM Usuario
  WHERE IdUsuario = p_id_usuario AND LOWER(TRIM(CorreoElectronico)) = p_correo AND EstadoRegistro = 1
  LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_actualizar_usuario$$
CREATE PROCEDURE sp_matriculas_actualizar_usuario(
  IN p_clave VARCHAR(255),
  IN p_id_usuario INT
)
BEGIN
  UPDATE Usuario SET Clave = p_clave WHERE IdUsuario = p_id_usuario;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_obtener_ciclo_disponible$$
CREATE PROCEDURE sp_matriculas_obtener_ciclo_disponible(
  IN p_id_ciclo INT
)
BEGIN
  SELECT
    c.IdCiclo,
    c.IdAcademia,
    c.Nombre,
    c.PrefijoCodigo,
    c.UniversidadObjetivo,
    c.Turno,
    c.Horario,
    c.DiasClase,
    c.FechaInicio,
    c.FechaFin,
    c.PrecioInscripcion,
    c.PrecioMensual,
    c.Precio,
    c.Capacidad,
    c.EstadoRegistro,
    (
      SELECT COUNT(*)
      FROM Matricula m
      INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
      WHERE m.IdCiclo = c.IdCiclo
        AND m.EstadoRegistro = 1
        AND u.EstadoRegistro = 1
        AND u.IdAcademia = c.IdAcademia
    ) AS TotalAlumnos
  FROM Ciclo c
  WHERE c.IdCiclo = p_id_ciclo
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_matriculas_bloquear_ciclo_disponible$$
CREATE PROCEDURE sp_matriculas_bloquear_ciclo_disponible(
  IN p_id_ciclo INT
)
BEGIN
  SELECT
    c.IdCiclo,
    c.IdAcademia,
    c.Nombre,
    c.PrefijoCodigo,
    c.UniversidadObjetivo,
    c.Turno,
    c.Horario,
    c.DiasClase,
    c.FechaInicio,
    c.FechaFin,
    c.PrecioInscripcion,
    c.PrecioMensual,
    c.Precio,
    c.Capacidad,
    c.EstadoRegistro,
    (
      SELECT COUNT(*)
      FROM Matricula m
      INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
      WHERE m.IdCiclo = c.IdCiclo
        AND m.EstadoRegistro = 1
        AND u.EstadoRegistro = 1
        AND u.IdAcademia = c.IdAcademia
    ) AS TotalAlumnos
  FROM Ciclo c
  WHERE c.IdCiclo = p_id_ciclo
  LIMIT 1
  FOR UPDATE;
END$$

DELIMITER ;
