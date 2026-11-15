-- AcadeSys | Procedimientos almacenados: Administración de ciclos

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_obtener_ciclo_por_id_ciclo$$
CREATE PROCEDURE sp_admin_ciclos_obtener_ciclo_por_id_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
    c.IdCiclo,
    c.IdAcademia,
    c.Nombre,
    c.PrefijoCodigo,
    c.FechaInicio,
    c.FechaFin,
    c.EstadoRegistro,
    c.Turno,
    c.Horario,
    c.Precio,
    c.PrecioInscripcion,
    c.PrecioMensual,
    c.DiasClase,
    c.UniversidadObjetivo,
    c.Capacidad,
    (
      SELECT COUNT(*)
      FROM Matricula m
      INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
      WHERE m.IdCiclo = c.IdCiclo
        AND m.EstadoRegistro = 1
        AND u.EstadoRegistro = 1
        AND u.IdAcademia = c.IdAcademia
    ) AS TotalAlumnos,
    (
      SELECT COUNT(*)
      FROM CicloCurso cc
      INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
      WHERE cc.IdCiclo = c.IdCiclo
        AND cc.EstadoRegistro = 1
        AND cu.EstadoRegistro = 1
    ) AS TotalCursos
  FROM Ciclo c
  WHERE c.IdCiclo = p_id_ciclo
    AND c.IdAcademia = p_id_academia
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_listar_ciclo$$
CREATE PROCEDURE sp_admin_ciclos_listar_ciclo(
  IN p_id_academia INT
)
BEGIN
  SELECT
    c.IdCiclo,
    c.IdAcademia,
    c.Nombre,
    c.PrefijoCodigo,
    c.FechaInicio,
    c.FechaFin,
    c.EstadoRegistro,
    c.Turno,
    c.Horario,
    c.Precio,
    c.PrecioInscripcion,
    c.PrecioMensual,
    c.DiasClase,
    c.UniversidadObjetivo,
    c.Capacidad,
    (
      SELECT COUNT(*)
      FROM Matricula m
      INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
      WHERE m.IdCiclo = c.IdCiclo
        AND m.EstadoRegistro = 1
        AND u.EstadoRegistro = 1
        AND u.IdAcademia = c.IdAcademia
    ) AS TotalAlumnos,
    (
      SELECT COUNT(*)
      FROM CicloCurso cc
      INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
      WHERE cc.IdCiclo = c.IdCiclo
        AND cc.EstadoRegistro = 1
        AND cu.EstadoRegistro = 1
    ) AS TotalCursos
  FROM Ciclo c
  WHERE c.IdAcademia = p_id_academia
    AND c.EstadoRegistro IN (0, 1)
  ORDER BY c.EstadoRegistro DESC, c.FechaInicio ASC, c.IdCiclo ASC;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_listar_ciclo_curso$$
CREATE PROCEDURE sp_admin_ciclos_listar_ciclo_curso(
  IN p_id_ciclo INT
)
BEGIN
  SELECT
    cc.IdCiclo,
    cc.IdCurso,
    cc.Orden,
    cu.Nombre,
    cu.Codigo,
    cu.Descripcion
  FROM CicloCurso cc
  INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
  WHERE cc.IdCiclo = p_id_ciclo
    AND cc.EstadoRegistro = 1
    AND cu.EstadoRegistro = 1
  ORDER BY cc.Orden ASC, cu.Nombre ASC;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_listar_horario$$
CREATE PROCEDURE sp_admin_ciclos_listar_horario(
  IN p_id_ciclo INT
)
BEGIN
  SELECT
    h.IdHorario,
    h.IdCiclo,
    h.IdCurso,
    h.DiaNumero,
    h.DiaSemana,
    TIME_FORMAT(h.HoraInicio, '%H:%i') AS HoraInicio,
    TIME_FORMAT(h.HoraFin, '%H:%i') AS HoraFin,
    COALESCE(doc.Docentes, 'Por asignar') AS Docente,
    h.Orden,
    cu.Nombre AS Curso
  FROM HorarioCurso h
  INNER JOIN Curso cu ON cu.IdCurso = h.IdCurso
  LEFT JOIN (
    SELECT
      aa.IdCiclo,
      aa.IdCurso,
      GROUP_CONCAT(
        DISTINCT TRIM(CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno))
        ORDER BY TRIM(CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno)) ASC
        SEPARATOR ', '
      ) AS Docentes
    FROM Asignacion_Aula aa
    INNER JOIN Usuario u
      ON u.IdUsuario = aa.IdUsuario
     AND u.EstadoRegistro = 1
    WHERE aa.EstadoRegistro = 1
    GROUP BY aa.IdCiclo, aa.IdCurso
  ) doc
    ON doc.IdCiclo = h.IdCiclo
   AND doc.IdCurso = h.IdCurso
  WHERE h.IdCiclo = p_id_ciclo
    AND h.EstadoRegistro = 1
    AND cu.EstadoRegistro = 1
  ORDER BY h.DiaNumero ASC, h.HoraInicio ASC, h.Orden ASC;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_desactivar_ciclo_curso$$
CREATE PROCEDURE sp_admin_ciclos_desactivar_ciclo_curso(
  IN p_id_ciclo INT
)
BEGIN
  UPDATE CicloCurso SET EstadoRegistro = 0 WHERE IdCiclo = p_id_ciclo AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_registrar_ciclo_curso$$
CREATE PROCEDURE sp_admin_ciclos_registrar_ciclo_curso(
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_orden INT
)
BEGIN
  INSERT INTO CicloCurso (IdCiclo, IdCurso, Orden, EstadoRegistro) VALUES (p_id_ciclo, p_id_curso, p_orden, 1)
         ON DUPLICATE KEY UPDATE Orden = VALUES(Orden), EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_obtener_ciclo_por_nombre$$
CREATE PROCEDURE sp_admin_ciclos_obtener_ciclo_por_nombre(
  IN p_id_academia INT,
  IN p_nombre VARCHAR(255)
)
BEGIN
  SELECT IdCiclo
  FROM Ciclo
  WHERE IdAcademia = p_id_academia
    AND EstadoRegistro IN (0, 1)
    AND LOWER(TRIM(Nombre)) = LOWER(TRIM(p_nombre))
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_registrar_ciclo$$
CREATE PROCEDURE sp_admin_ciclos_registrar_ciclo(
  IN p_id_academia INT,
  IN p_nombre VARCHAR(100),
  IN p_prefijo_codigo VARCHAR(20),
  IN p_fecha_inicio DATE,
  IN p_fecha_fin DATE,
  IN p_estado_registro TINYINT,
  IN p_turno VARCHAR(50),
  IN p_horario VARCHAR(100),
  IN p_precio DECIMAL(8,2),
  IN p_precio_inscripcion DECIMAL(8,2),
  IN p_precio_mensual DECIMAL(8,2),
  IN p_dias_clase VARCHAR(100),
  IN p_universidad_objetivo VARCHAR(50),
  IN p_capacidad INT
)
BEGIN
  INSERT INTO Ciclo
    (IdAcademia, Nombre, PrefijoCodigo, FechaInicio, FechaFin, EstadoRegistro,
     Turno, Horario, Precio, PrecioInscripcion, PrecioMensual, DiasClase, UniversidadObjetivo, Capacidad)
  VALUES (p_id_academia, p_nombre, p_prefijo_codigo, p_fecha_inicio, p_fecha_fin, p_estado_registro, p_turno, p_horario, p_precio, p_precio_inscripcion, p_precio_mensual, p_dias_clase, p_universidad_objetivo, p_capacidad);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_bloquear_ciclo$$
CREATE PROCEDURE sp_admin_ciclos_bloquear_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdCiclo FROM Ciclo WHERE IdCiclo = p_id_ciclo AND IdAcademia = p_id_academia FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_obtener_ciclo_por_id_ciclo_y_nombre$$
CREATE PROCEDURE sp_admin_ciclos_obtener_ciclo_por_id_ciclo_y_nombre(
  IN p_id_academia INT,
  IN p_id_ciclo INT,
  IN p_nombre VARCHAR(255)
)
BEGIN
  SELECT IdCiclo
  FROM Ciclo
  WHERE IdAcademia = p_id_academia
    AND IdCiclo <> p_id_ciclo
    AND EstadoRegistro IN (0, 1)
    AND LOWER(TRIM(Nombre)) = LOWER(TRIM(p_nombre))
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_actualizar_ciclo$$
CREATE PROCEDURE sp_admin_ciclos_actualizar_ciclo(
  IN p_nombre VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_prefijo_codigo VARCHAR(20),
  IN p_fecha_inicio DATE,
  IN p_fecha_fin DATE,
  IN p_turno VARCHAR(50),
  IN p_horario VARCHAR(100),
  IN p_precio DECIMAL(8,2),
  IN p_precio_inscripcion DECIMAL(8,2),
  IN p_precio_mensual DECIMAL(8,2),
  IN p_dias_clase VARCHAR(100),
  IN p_universidad_objetivo VARCHAR(50),
  IN p_capacidad INT,
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE Ciclo
  SET
    Nombre = p_nombre,
    PrefijoCodigo = p_prefijo_codigo,
    FechaInicio = p_fecha_inicio,
    FechaFin = p_fecha_fin,
    Turno = p_turno,
    Horario = p_horario,
    Precio = p_precio,
    PrecioInscripcion = p_precio_inscripcion,
    PrecioMensual = p_precio_mensual,
    DiasClase = p_dias_clase,
    UniversidadObjetivo = p_universidad_objetivo,
    Capacidad = p_capacidad
  WHERE IdCiclo = p_id_ciclo
    AND IdAcademia = p_id_academia;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_cambiar_estado_ciclo$$
CREATE PROCEDURE sp_admin_ciclos_cambiar_estado_ciclo(
  IN p_estado_registro INT,
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE Ciclo
  SET EstadoRegistro = p_estado_registro
  WHERE IdCiclo = p_id_ciclo
    AND IdAcademia = p_id_academia;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_admin_ciclos_desactivar_ciclo$$
CREATE PROCEDURE sp_admin_ciclos_desactivar_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE Ciclo
  SET EstadoRegistro = 0
  WHERE IdCiclo = p_id_ciclo
    AND IdAcademia = p_id_academia;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

-- p_cursos: arreglo JSON con los IdCurso que el ciclo conserva, por ejemplo [1, 2, 3].
DROP PROCEDURE IF EXISTS sp_admin_ciclos_buscar_curso_en_uso$$
CREATE PROCEDURE sp_admin_ciclos_buscar_curso_en_uso(
  IN p_id_ciclo INT,
  IN p_cursos JSON
)
BEGIN
  SELECT IdCurso FROM HorarioCurso
  WHERE IdCiclo = p_id_ciclo AND EstadoRegistro = 1 AND IdCurso IS NOT NULL
    AND NOT (IdCurso MEMBER OF (p_cursos))
  UNION ALL
  SELECT IdCurso FROM Asignacion_Aula
  WHERE IdCiclo = p_id_ciclo AND EstadoRegistro = 1 AND IdCurso IS NOT NULL
    AND NOT (IdCurso MEMBER OF (p_cursos))
  UNION ALL
  SELECT IdCurso FROM MaterialAcademico
  WHERE IdCiclo = p_id_ciclo AND EstadoRegistro = 1 AND IdCurso IS NOT NULL
    AND NOT (IdCurso MEMBER OF (p_cursos))
  UNION ALL
  SELECT IdCurso FROM Matricula
  WHERE IdCiclo = p_id_ciclo AND EstadoRegistro = 1 AND IdCurso IS NOT NULL
    AND NOT (IdCurso MEMBER OF (p_cursos))
  LIMIT 1;
END$$

-- p_cursos: arreglo JSON de IdCurso.
DROP PROCEDURE IF EXISTS sp_admin_ciclos_listar_cursos_validos$$
CREATE PROCEDURE sp_admin_ciclos_listar_cursos_validos(
  IN p_cursos JSON
)
BEGIN
  SELECT IdCurso, UniversidadObjetivo FROM Curso
  WHERE EstadoRegistro = 1 AND IdCurso MEMBER OF (p_cursos);
END$$

DELIMITER ;
