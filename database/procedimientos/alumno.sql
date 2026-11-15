-- AcadeSys | Procedimientos almacenados: Intranet del alumno

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_alumno_registrar_auditoria_pago$$
CREATE PROCEDURE sp_alumno_registrar_auditoria_pago(
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

DROP PROCEDURE IF EXISTS sp_alumno_listar_cuota$$
CREATE PROCEDURE sp_alumno_listar_cuota(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT p.IdPago, p.IdUsuario, p.IdCiclo, c.Nombre AS Ciclo,
                p.Mes, p.Monto, p.Estado, p.FechaPago, p.FechaVencimiento,
                pc.IdComprobante, pc.Referencia AS ReferenciaComprobante,
                pc.UrlComprobante, pc.EstadoRevision AS EstadoRevisionComprobante,
                pc.MotivoRevision, pc.FechaCreacion AS FechaSolicitudComprobante,
                pc.FechaRevision
         FROM PagosMensualidad p
         INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
         INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
         LEFT JOIN PagoComprobante pc ON pc.IdComprobante = (
           SELECT MAX(pc2.IdComprobante)
           FROM PagoComprobante pc2
           WHERE pc2.IdPago = p.IdPago AND pc2.IdUsuario = p.IdUsuario
             AND pc2.IdAcademia = u.IdAcademia AND pc2.EstadoRegistro = 1
         )
         WHERE p.IdUsuario = p_id_usuario AND u.IdUsuario = p_id_usuario AND u.IdAcademia = p_id_academia
           AND c.IdAcademia = p_id_academia AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
         ORDER BY p.IdCiclo DESC, p.Mes DESC, p.IdPago DESC;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_obtener_cuota$$
CREATE PROCEDURE sp_alumno_obtener_cuota(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT p.IdPago, p.IdCiclo, p.Mes, p.Monto, p.Estado, p.FechaVencimiento,
                c.Nombre AS Ciclo
         FROM PagosMensualidad p
         INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
         INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
         WHERE p.IdPago = p_id_pago AND p.IdUsuario = p_id_usuario AND u.IdAcademia = p_id_academia
           AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
         LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_obtener_comprobante$$
CREATE PROCEDURE sp_alumno_obtener_comprobante(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdComprobante, EstadoRevision
         FROM PagoComprobante
         WHERE IdPago = p_id_pago AND IdUsuario = p_id_usuario AND IdAcademia = p_id_academia
           AND EstadoRegistro = 1 AND EstadoRevision = 'EN_REVISION'
         ORDER BY IdComprobante DESC LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_bloquear_cuota$$
CREATE PROCEDURE sp_alumno_bloquear_cuota(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT p.IdPago, p.IdUsuario, p.IdCiclo, p.Estado, p.Monto, u.IdAcademia
         FROM PagosMensualidad p
         INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
         INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
         WHERE p.IdPago = p_id_pago AND p.IdUsuario = p_id_usuario AND u.IdAcademia = p_id_academia
           AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_bloquear_comprobante_por_id_pago$$
CREATE PROCEDURE sp_alumno_bloquear_comprobante_por_id_pago(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT,
  IN p_referencia VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  SELECT IdComprobante FROM PagoComprobante
         WHERE IdPago = p_id_pago AND IdUsuario = p_id_usuario AND IdAcademia = p_id_academia AND Referencia = p_referencia AND EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_bloquear_comprobante_por_id_pago_y_id_usuario$$
CREATE PROCEDURE sp_alumno_bloquear_comprobante_por_id_pago_y_id_usuario(
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

DROP PROCEDURE IF EXISTS sp_alumno_bloquear_transaccion$$
CREATE PROCEDURE sp_alumno_bloquear_transaccion(
  IN p_id_pago INT,
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdTransaccion FROM PagoTransaccion
         WHERE IdPago = p_id_pago AND IdUsuario = p_id_usuario AND IdAcademia = p_id_academia AND EstadoRegistro = 1
           AND Estado = 'PENDIENTE'
           AND CodigoEstadoProveedor IN ('pending', 'in_process', 'authorized', 'in_mediation')
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_registrar_comprobante$$
CREATE PROCEDURE sp_alumno_registrar_comprobante(
  IN p_id_pago BIGINT UNSIGNED,
  IN p_id_usuario BIGINT UNSIGNED,
  IN p_id_academia BIGINT UNSIGNED,
  IN p_referencia VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_url_comprobante VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  INSERT INTO PagoComprobante
          (IdPago, IdUsuario, IdAcademia, Referencia, UrlComprobante,
           EstadoRevision, MotivoRevision, FechaCreacion, EstadoRegistro)
         VALUES (p_id_pago, p_id_usuario, p_id_academia, p_referencia, p_url_comprobante, 'EN_REVISION', NULL, NOW(), 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_obtener_usuario$$
CREATE PROCEDURE sp_alumno_obtener_usuario(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
    u.IdUsuario,
    u.DNI,
    u.Nombres,
    u.ApellidoPaterno,
    u.ApellidoMaterno,
    CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno) AS NombreCompleto,
    u.CorreoElectronico,
    u.CodigoUsuario
  FROM Usuario u
  WHERE u.IdUsuario = p_id_usuario AND u.IdAcademia = p_id_academia AND u.EstadoRegistro = 1
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_obtener_matricula$$
CREATE PROCEDURE sp_alumno_obtener_matricula(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
    m.IdMatricula,
    c.IdCiclo,
    c.Nombre AS Ciclo,
    c.Turno,
    COALESCE(NULLIF(TRIM(c.Horario), ''), CASE
      WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%mañana%' OR LOWER(COALESCE(c.Turno, '')) LIKE '%manana%' THEN '08:00 - 13:00'
      WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%tarde%' THEN '14:00 - 19:00'
      WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%noche%' THEN '18:00 - 22:00'
      ELSE '08:00 - 13:00'
    END) AS Horario,
    COALESCE(NULLIF(TRIM(c.DiasClase), ''), 'Lunes a Sábado') AS DiasClase,
    COALESCE(NULLIF(TRIM(c.UniversidadObjetivo), ''), 'Preuniversitario') AS UniversidadObjetivo,
    c.FechaInicio,
    c.FechaFin,
    (
      SELECT COUNT(*)
      FROM Matricula m2
      WHERE m2.IdCiclo = c.IdCiclo AND m2.EstadoRegistro = 1
    ) AS TotalAlumnos
  FROM Matricula m
  INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
  WHERE m.IdUsuario = p_id_usuario
    AND m.EstadoRegistro = 1
     AND c.EstadoRegistro = 1
     AND c.IdAcademia = p_id_academia
  ORDER BY m.IdMatricula DESC
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_listar_ciclo_curso$$
CREATE PROCEDURE sp_alumno_listar_ciclo_curso(
  IN p_id_academia INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT
    cu.IdCurso,
    cu.Nombre, cu.Codigo, cu.Descripcion, cu.UniversidadObjetivo,
    COALESCE((SELECT GROUP_CONCAT(DISTINCT TRIM(CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno)) SEPARATOR ', ')
      FROM Asignacion_Aula aa INNER JOIN Usuario u ON u.IdUsuario = aa.IdUsuario
      WHERE aa.IdCiclo = cc.IdCiclo AND aa.IdCurso = cc.IdCurso AND aa.IdAcademia = p_id_academia
        AND aa.EstadoRegistro = 1 AND u.EstadoRegistro = 1 AND u.IdAcademia = aa.IdAcademia), 'Por asignar') AS Docente
  FROM CicloCurso cc
  INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
  WHERE cc.IdCiclo = p_id_ciclo
    AND cc.EstadoRegistro = 1
    AND cu.EstadoRegistro = 1
  ORDER BY cc.Orden ASC, cu.Nombre ASC;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_listar_horario$$
CREATE PROCEDURE sp_alumno_listar_horario(
  IN p_id_academia INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT
    h.IdHorario,
    h.DiaSemana,
    TIME_FORMAT(h.HoraInicio, '%H:%i') AS HoraInicio,
    TIME_FORMAT(h.HoraFin, '%H:%i') AS HoraFin,
    cu.Nombre AS Curso,
    COALESCE((SELECT GROUP_CONCAT(DISTINCT TRIM(CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno)) SEPARATOR ', ')
      FROM Asignacion_Aula aa INNER JOIN Usuario u ON u.IdUsuario = aa.IdUsuario
      WHERE aa.IdCiclo = h.IdCiclo AND aa.IdCurso = h.IdCurso AND aa.IdAcademia = p_id_academia
        AND aa.EstadoRegistro = 1 AND u.EstadoRegistro = 1 AND u.IdAcademia = aa.IdAcademia), 'Por asignar') AS Docente
  FROM HorarioCurso h
  INNER JOIN Curso cu ON cu.IdCurso = h.IdCurso
  WHERE h.IdCiclo = p_id_ciclo
    AND h.EstadoRegistro = 1
  ORDER BY h.Orden ASC, h.DiaNumero ASC, h.HoraInicio ASC;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_listar_evaluacion$$
CREATE PROCEDURE sp_alumno_listar_evaluacion(
  IN p_id_usuario INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT
    e.IdEvaluacion,
    COALESCE(cu.Nombre, 'Simulacro general') AS Curso,
    e.TipoEvaluacion,
    e.Calificacion,
    e.EstadoRegistro AS EstadoRegistro,
    e.FechaCreacion
  FROM Evaluacion e
  INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
  LEFT JOIN Curso cu ON cu.IdCurso = m.IdCurso
  WHERE m.IdUsuario = p_id_usuario
    AND m.IdCiclo = p_id_ciclo
    AND m.EstadoRegistro = 1
    AND e.EstadoRegistro IN (1, 2)
  ORDER BY e.FechaCreacion DESC, e.IdEvaluacion DESC;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_listar_matricula$$
CREATE PROCEDURE sp_alumno_listar_matricula(
  IN p_id_ciclo INT,
  IN p_id_academia INT,
  IN p_id_usuario INT,
  IN p_promedio_bruto DOUBLE
)
BEGIN
  SELECT COUNT(*) + 1 AS Puesto
  FROM (
    SELECT
      m2.IdUsuario,
      AVG(e2.Calificacion) AS Promedio
    FROM Matricula m2
    INNER JOIN Evaluacion e2 ON e2.IdMatricula = m2.IdMatricula
    INNER JOIN Usuario u2 ON u2.IdUsuario = m2.IdUsuario AND u2.EstadoRegistro = 1
    WHERE m2.IdCiclo = p_id_ciclo
      AND m2.EstadoRegistro = 1
      AND e2.EstadoRegistro IN (1, 2)
      AND u2.IdAcademia = p_id_academia AND m2.IdUsuario <> p_id_usuario
    GROUP BY m2.IdUsuario
    HAVING AVG(e2.Calificacion) > p_promedio_bruto
  ) r;
END$$

DROP PROCEDURE IF EXISTS sp_alumno_listar_material$$
CREATE PROCEDURE sp_alumno_listar_material(
  IN p_id_ciclo INT
)
BEGIN
  SELECT
    ma.IdMaterial,
    ma.Titulo,
    ma.Descripcion,
    ma.NombreArchivo,
    ma.UrlArchivo,
    ma.TipoMime,
    ma.FechaPublicacion,
    cu.Nombre AS Curso
  FROM MaterialAcademico ma
  INNER JOIN CicloCurso cc ON cc.IdCiclo = ma.IdCiclo AND cc.IdCurso = ma.IdCurso AND cc.EstadoRegistro = 1
  INNER JOIN Curso cu ON cu.IdCurso = ma.IdCurso
  WHERE ma.IdCiclo = p_id_ciclo
    AND ma.EstadoRegistro = 1
    AND cu.EstadoRegistro = 1
  ORDER BY ma.FechaPublicacion DESC, ma.IdMaterial DESC;
END$$

DELIMITER ;
