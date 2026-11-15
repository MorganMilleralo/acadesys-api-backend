-- AcadeSys | Procedimientos almacenados: Gestión académica: aulas, cursos, horarios, asignaciones y asistencia

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_academico_listar_aula_todos$$
CREATE PROCEDURE sp_academico_listar_aula_todos(
  IN p_id_academia INT
)
BEGIN
  SELECT IdAula AS idAula, Nombre AS nombre, Nivel AS nivel,
                Capacidad AS capacidad, EstadoRegistro AS estadoRegistro
         FROM Aula
         WHERE IdAcademia = p_id_academia AND EstadoRegistro = 1
         ORDER BY Nombre ASC;
END$$

DROP PROCEDURE IF EXISTS sp_academico_listar_aula_por_nombre$$
CREATE PROCEDURE sp_academico_listar_aula_por_nombre(
  IN p_id_academia INT,
  IN p_nombre VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  SELECT IdAula, EstadoRegistro FROM Aula WHERE IdAcademia = p_id_academia AND Nombre = p_nombre;
END$$

DROP PROCEDURE IF EXISTS sp_academico_reactivar_aula$$
CREATE PROCEDURE sp_academico_reactivar_aula(
  IN p_nivel VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_capacidad INT,
  IN p_id_aula INT
)
BEGIN
  UPDATE Aula SET EstadoRegistro = 1, Nivel = p_nivel, Capacidad = p_capacidad WHERE IdAula = p_id_aula;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_registrar_aula$$
CREATE PROCEDURE sp_academico_registrar_aula(
  IN p_id_academia INT,
  IN p_nombre VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_nivel VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_capacidad INT
)
BEGIN
  INSERT INTO Aula (IdAcademia, Nombre, Nivel, Capacidad, EstadoRegistro)
         VALUES (p_id_academia, p_nombre, p_nivel, p_capacidad, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_buscar_aula_duplicada$$
CREATE PROCEDURE sp_academico_buscar_aula_duplicada(
  IN p_id_academia INT,
  IN p_nombre VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_id_aula INT
)
BEGIN
  SELECT IdAula FROM Aula WHERE IdAcademia = p_id_academia AND Nombre = p_nombre AND IdAula <> p_id_aula AND EstadoRegistro = 1 LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_academico_actualizar_aula$$
CREATE PROCEDURE sp_academico_actualizar_aula(
  IN p_nombre VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_nivel VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_capacidad INT,
  IN p_id_aula INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE Aula SET Nombre = p_nombre, Nivel = p_nivel, Capacidad = p_capacidad
         WHERE IdAula = p_id_aula AND IdAcademia = p_id_academia AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_obtener_asignacion$$
CREATE PROCEDURE sp_academico_obtener_asignacion(
  IN p_id_aula INT,
  IN p_id_academia INT
)
BEGIN
  SELECT aa.IdAula FROM Asignacion_Aula aa INNER JOIN Aula a ON a.IdAula = aa.IdAula
        WHERE aa.IdAula = p_id_aula AND a.IdAcademia = p_id_academia AND aa.EstadoRegistro = 1
        UNION ALL SELECT ast.IdAula FROM Asistencia ast INNER JOIN Aula a ON a.IdAula = ast.IdAula
        WHERE ast.IdAula = p_id_aula AND a.IdAcademia = p_id_academia AND ast.EstadoRegistro = 1 LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_academico_desactivar_aula$$
CREATE PROCEDURE sp_academico_desactivar_aula(
  IN p_id_aula INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE Aula SET EstadoRegistro = 0 WHERE IdAula = p_id_aula AND IdAcademia = p_id_academia AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_listar_curso_todos$$
CREATE PROCEDURE sp_academico_listar_curso_todos()
BEGIN
  SELECT IdCurso AS idCurso, Nombre AS nombre, Codigo AS codigo,
                Descripcion AS descripcion, UniversidadObjetivo AS universidadObjetivo,
                EstadoRegistro AS estadoRegistro
         FROM Curso
         WHERE EstadoRegistro = 1
         ORDER BY Nombre ASC;
END$$

DROP PROCEDURE IF EXISTS sp_academico_listar_curso_por_codigo$$
CREATE PROCEDURE sp_academico_listar_curso_por_codigo(
  IN p_codigo VARCHAR(50)
)
BEGIN
  SELECT IdCurso, EstadoRegistro FROM Curso WHERE Codigo = p_codigo;
END$$

DROP PROCEDURE IF EXISTS sp_academico_reactivar_curso$$
CREATE PROCEDURE sp_academico_reactivar_curso(
  IN p_nombre VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_descripcion VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
  IN p_universidad_objetivo VARCHAR(50),
  IN p_id_curso INT
)
BEGIN
  UPDATE Curso SET EstadoRegistro = 1, Nombre = p_nombre, Descripcion = p_descripcion, UniversidadObjetivo = p_universidad_objetivo WHERE IdCurso = p_id_curso;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_registrar_curso$$
CREATE PROCEDURE sp_academico_registrar_curso(
  IN p_nombre VARCHAR(100),
  IN p_codigo VARCHAR(50),
  IN p_descripcion VARCHAR(255),
  IN p_universidad_objetivo VARCHAR(50)
)
BEGIN
  INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
         VALUES (p_nombre, p_codigo, p_descripcion, p_universidad_objetivo, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_obtener_curso_por_id_curso$$
CREATE PROCEDURE sp_academico_obtener_curso_por_id_curso(
  IN p_id_curso INT
)
BEGIN
  SELECT UniversidadObjetivo FROM Curso WHERE IdCurso = p_id_curso AND EstadoRegistro = 1 LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_academico_obtener_curso_por_codigo$$
CREATE PROCEDURE sp_academico_obtener_curso_por_codigo(
  IN p_codigo VARCHAR(50),
  IN p_id_curso INT
)
BEGIN
  SELECT IdCurso FROM Curso WHERE Codigo = p_codigo AND IdCurso <> p_id_curso AND EstadoRegistro = 1 LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_academico_actualizar_curso$$
CREATE PROCEDURE sp_academico_actualizar_curso(
  IN p_nombre VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_codigo VARCHAR(50),
  IN p_descripcion VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
  IN p_universidad_objetivo VARCHAR(50),
  IN p_id_curso INT
)
BEGIN
  UPDATE Curso SET Nombre = p_nombre, Codigo = p_codigo, Descripcion = p_descripcion, UniversidadObjetivo = p_universidad_objetivo
         WHERE IdCurso = p_id_curso AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_obtener_ciclo_curso$$
CREATE PROCEDURE sp_academico_obtener_ciclo_curso(
  IN p_id_curso INT
)
BEGIN
  SELECT IdCurso FROM CicloCurso WHERE IdCurso = p_id_curso AND EstadoRegistro = 1
        UNION ALL SELECT IdCurso FROM HorarioCurso WHERE IdCurso = p_id_curso AND EstadoRegistro = 1
        UNION ALL SELECT IdCurso FROM Asignacion_Aula WHERE IdCurso = p_id_curso AND EstadoRegistro = 1
        UNION ALL SELECT IdCurso FROM MaterialAcademico WHERE IdCurso = p_id_curso AND EstadoRegistro = 1
        UNION ALL SELECT IdCurso FROM Matricula WHERE IdCurso = p_id_curso AND EstadoRegistro = 1 LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_academico_desactivar_curso$$
CREATE PROCEDURE sp_academico_desactivar_curso(
  IN p_id_curso INT
)
BEGIN
  UPDATE Curso SET EstadoRegistro = 0 WHERE IdCurso = p_id_curso AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_listar_asignacion$$
CREATE PROCEDURE sp_academico_listar_asignacion(
  IN p_id_academia INT,
  IN p_rol VARCHAR(255),
  IN p_id_usuario INT
)
BEGIN
  SELECT aa.IdAsignacion AS idAsignacion, aa.IdUsuario AS idUsuario,
                aa.IdCiclo AS idCiclo, aa.IdCurso AS idCurso, aa.IdAula AS idAula,
                aa.Horas AS horas, aa.IdAcademia AS idAcademia,
                CONCAT(u.Nombres, ' ', u.ApellidoPaterno, ' ', COALESCE(u.ApellidoMaterno, '')) AS docente,
                cu.Nombre AS curso, cu.Codigo AS codigoCurso, a.Nombre AS aula, c.Nombre AS ciclo
         FROM Asignacion_Aula aa
         INNER JOIN Usuario u ON u.IdUsuario = aa.IdUsuario
         INNER JOIN Aula a ON a.IdAula = aa.IdAula
         INNER JOIN Curso cu ON cu.IdCurso = aa.IdCurso
         INNER JOIN Ciclo c ON c.IdCiclo = aa.IdCiclo
         INNER JOIN CicloCurso cc ON cc.IdCiclo = aa.IdCiclo AND cc.IdCurso = aa.IdCurso
         WHERE aa.IdAcademia = p_id_academia AND aa.EstadoRegistro = 1
           AND u.IdAcademia = aa.IdAcademia AND a.IdAcademia = aa.IdAcademia
           AND c.IdAcademia = aa.IdAcademia AND cc.EstadoRegistro = 1
           AND (p_rol = 1 OR aa.IdUsuario = p_id_usuario)
           AND u.EstadoRegistro = 1 AND a.EstadoRegistro = 1
           AND cu.EstadoRegistro = 1 AND c.EstadoRegistro = 1
         ORDER BY c.Nombre, a.Nombre, cu.Nombre, docente;
END$$

DROP PROCEDURE IF EXISTS sp_academico_listar_ciclo$$
CREATE PROCEDURE sp_academico_listar_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdCiclo FROM Ciclo WHERE IdCiclo = p_id_ciclo AND IdAcademia = p_id_academia;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_academia$$
CREATE PROCEDURE sp_academico_bloquear_academia(
  IN p_id_academia INT
)
BEGIN
  SELECT IdAcademia FROM Academia WHERE IdAcademia = p_id_academia FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_obtener_usuario$$
CREATE PROCEDURE sp_academico_obtener_usuario(
  IN p_id_usuario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT u.IdUsuario
         FROM Usuario u
         INNER JOIN Usuario_Perfiles up ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
         INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil AND p.EstadoRegistro = 1
         WHERE u.IdUsuario = p_id_usuario AND u.IdAcademia = p_id_academia AND u.EstadoRegistro = 1
           AND LOWER(TRIM(p.Nombre)) IN ('docente', 'tutor de aula')
         LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_ciclo_nombre$$
CREATE PROCEDURE sp_academico_bloquear_ciclo_nombre(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdCiclo, Nombre FROM Ciclo WHERE IdCiclo = p_id_ciclo AND IdAcademia = p_id_academia AND EstadoRegistro = 1 LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_curso_por_id_curso$$
CREATE PROCEDURE sp_academico_bloquear_curso_por_id_curso(
  IN p_id_curso INT
)
BEGIN
  SELECT IdCurso FROM Curso WHERE IdCurso = p_id_curso AND EstadoRegistro = 1 LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_ciclo_curso$$
CREATE PROCEDURE sp_academico_bloquear_ciclo_curso(
  IN p_id_ciclo INT,
  IN p_id_curso INT
)
BEGIN
  SELECT IdCiclo FROM CicloCurso WHERE IdCiclo = p_id_ciclo AND IdCurso = p_id_curso AND EstadoRegistro = 1 LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_obtener_aula_por_nombre$$
CREATE PROCEDURE sp_academico_obtener_aula_por_nombre(
  IN p_id_academia INT,
  IN p_nombre VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  SELECT IdAula, EstadoRegistro FROM Aula WHERE IdAcademia = p_id_academia AND Nombre = p_nombre LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_academico_reactivar_aula_preuniversitaria$$
CREATE PROCEDURE sp_academico_reactivar_aula_preuniversitaria(
  IN p_nivel VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_id_aula INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE Aula SET EstadoRegistro = 1, Nivel = p_nivel, Capacidad = 100 WHERE IdAula = p_id_aula AND IdAcademia = p_id_academia;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_registrar_aula_preuniversitaria$$
CREATE PROCEDURE sp_academico_registrar_aula_preuniversitaria(
  IN p_id_academia INT,
  IN p_nombre VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  INSERT INTO Aula (IdAcademia, Nombre, Nivel, Capacidad, EstadoRegistro)
             VALUES (p_id_academia, p_nombre, 'Preuniversitario', 100, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_obtener_aula_por_id_aula$$
CREATE PROCEDURE sp_academico_obtener_aula_por_id_aula(
  IN p_id_aula INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdAula FROM Aula WHERE IdAula = p_id_aula AND IdAcademia = p_id_academia AND EstadoRegistro = 1 LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_asignacion_por_id_usuario$$
CREATE PROCEDURE sp_academico_bloquear_asignacion_por_id_usuario(
  IN p_id_academia INT,
  IN p_id_usuario INT,
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_id_aula INT
)
BEGIN
  SELECT IdAsignacion FROM Asignacion_Aula
         WHERE IdAcademia = p_id_academia AND IdUsuario = p_id_usuario AND IdCiclo = p_id_ciclo AND IdCurso = p_id_curso AND IdAula = p_id_aula AND EstadoRegistro = 1
         LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_registrar_asignacion$$
CREATE PROCEDURE sp_academico_registrar_asignacion(
  IN p_id_usuario INT,
  IN p_id_ciclo INT,
  IN p_id_academia INT,
  IN p_id_aula INT,
  IN p_id_curso INT,
  IN p_horas TINYINT UNSIGNED
)
BEGIN
  INSERT INTO Asignacion_Aula (IdUsuario, IdCiclo, IdAcademia, IdAula, IdCurso, Horas, EstadoRegistro)
         VALUES (p_id_usuario, p_id_ciclo, p_id_academia, p_id_aula, p_id_curso, p_horas, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_desactivar_asignacion$$
CREATE PROCEDURE sp_academico_desactivar_asignacion(
  IN p_id_asignacion INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE Asignacion_Aula SET EstadoRegistro = 0 WHERE IdAsignacion = p_id_asignacion AND IdAcademia = p_id_academia AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_ciclo_universidad$$
CREATE PROCEDURE sp_academico_bloquear_ciclo_universidad(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdCiclo, UniversidadObjetivo FROM Ciclo WHERE IdCiclo = p_id_ciclo AND IdAcademia = p_id_academia AND EstadoRegistro = 1 LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_curso_por_id_curso_y_id_ciclo$$
CREATE PROCEDURE sp_academico_bloquear_curso_por_id_curso_y_id_ciclo(
  IN p_id_curso INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT cu.IdCurso, cu.UniversidadObjetivo AS CursoUniversidad FROM Curso cu INNER JOIN CicloCurso cc ON cc.IdCurso = cu.IdCurso
         WHERE cu.IdCurso = p_id_curso AND cc.IdCiclo = p_id_ciclo AND cu.EstadoRegistro = 1 AND cc.EstadoRegistro = 1 LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_horario_por_id_horario$$
CREATE PROCEDURE sp_academico_bloquear_horario_por_id_horario(
  IN p_id_horario INT,
  IN p_id_academia INT
)
BEGIN
  SELECT h.IdHorario FROM HorarioCurso h INNER JOIN Ciclo c ON c.IdCiclo = h.IdCiclo
           WHERE h.IdHorario = p_id_horario AND c.IdAcademia = p_id_academia AND h.EstadoRegistro = 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_horario_por_id_ciclo$$
CREATE PROCEDURE sp_academico_bloquear_horario_por_id_ciclo(
  IN p_id_ciclo INT,
  IN p_dia_numero TINYINT,
  IN p_id_horario INT,
  IN p_hora_inicio TIME,
  IN p_hora_fin TIME
)
BEGIN
  SELECT IdHorario FROM HorarioCurso WHERE IdCiclo = p_id_ciclo AND DiaNumero = p_dia_numero AND EstadoRegistro = 1
         AND IdHorario <> p_id_horario AND HoraInicio < p_hora_inicio AND HoraFin > p_hora_fin LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_actualizar_horario$$
CREATE PROCEDURE sp_academico_actualizar_horario(
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_dia_numero TINYINT,
  IN p_dia_semana VARCHAR(30),
  IN p_hora_inicio TIME,
  IN p_hora_fin TIME,
  IN p_orden INT,
  IN p_id_horario INT
)
BEGIN
  UPDATE HorarioCurso SET IdCiclo = p_id_ciclo, IdCurso = p_id_curso, DiaNumero = p_dia_numero, DiaSemana = p_dia_semana, HoraInicio = p_hora_inicio, HoraFin = p_hora_fin, Orden = p_orden
           WHERE IdHorario = p_id_horario AND EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_registrar_horario$$
CREATE PROCEDURE sp_academico_registrar_horario(
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_dia_numero TINYINT,
  IN p_dia_semana VARCHAR(30),
  IN p_hora_inicio TIME,
  IN p_hora_fin TIME,
  IN p_orden INT
)
BEGIN
  INSERT INTO HorarioCurso
            (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
          VALUES (p_id_ciclo, p_id_curso, p_dia_numero, p_dia_semana, p_hora_inicio, p_hora_fin, p_orden, 1);
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_desactivar_horario$$
CREATE PROCEDURE sp_academico_desactivar_horario(
  IN p_id_horario INT,
  IN p_id_academia INT
)
BEGIN
  UPDATE HorarioCurso h
         INNER JOIN Ciclo c ON c.IdCiclo = h.IdCiclo
         SET h.EstadoRegistro = 0
         WHERE h.IdHorario = p_id_horario AND c.IdAcademia = p_id_academia AND h.EstadoRegistro = 1;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_obtener_ciclo$$
CREATE PROCEDURE sp_academico_obtener_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT IdCiclo FROM Ciclo WHERE IdCiclo = p_id_ciclo AND IdAcademia = p_id_academia AND EstadoRegistro = 1 LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_aula$$
CREATE PROCEDURE sp_academico_bloquear_aula(
  IN p_id_academia INT,
  IN p_nombre VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  SELECT IdAula, EstadoRegistro FROM Aula WHERE IdAcademia = p_id_academia AND Nombre = p_nombre LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_registrar_asistencia$$
CREATE PROCEDURE sp_academico_registrar_asistencia(
  IN p_id_matricula INT,
  IN p_id_aula INT,
  IN p_fecha DATE,
  IN p_estado VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_hora_llegada TIME,
  IN p_usuario_registro INT
)
BEGIN
  INSERT INTO Asistencia
             (IdMatricula, IdAula, Fecha, Estado, HoraLlegada, UsuarioRegistro, EstadoRegistro)
           VALUES (p_id_matricula, p_id_aula, p_fecha, p_estado, p_hora_llegada, p_usuario_registro, 1)
           ON DUPLICATE KEY UPDATE
             Estado = VALUES(Estado), HoraLlegada = VALUES(HoraLlegada),
             UsuarioRegistro = VALUES(UsuarioRegistro), EstadoRegistro = 1,
             FechaModificacion = CURRENT_TIMESTAMP;
  SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_horario_por_id_usuario$$
CREATE PROCEDURE sp_academico_bloquear_horario_por_id_usuario(
  IN p_id_academia INT,
  IN p_id_usuario INT,
  IN p_id_aula INT,
  IN p_id_ciclo INT,
  IN p_id_curso INT
)
BEGIN
  SELECT otro.IdHorario AS ConflictoDocente
  FROM HorarioCurso nuevo
  INNER JOIN Ciclo destino ON destino.IdCiclo = nuevo.IdCiclo AND destino.IdAcademia = p_id_academia
  INNER JOIN Asignacion_Aula aa ON (aa.IdUsuario = p_id_usuario OR aa.IdAula = p_id_aula) AND aa.IdAcademia = destino.IdAcademia AND aa.EstadoRegistro = 1
  INNER JOIN Ciclo c ON c.IdCiclo = aa.IdCiclo AND c.IdAcademia = aa.IdAcademia AND c.EstadoRegistro = 1
  INNER JOIN CicloCurso cc ON cc.IdCiclo = c.IdCiclo AND cc.IdCurso = aa.IdCurso AND cc.EstadoRegistro = 1
  INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso AND cu.EstadoRegistro = 1
  INNER JOIN HorarioCurso otro ON otro.IdCiclo = aa.IdCiclo AND otro.IdCurso = aa.IdCurso AND otro.EstadoRegistro = 1
  WHERE nuevo.IdCiclo = p_id_ciclo AND nuevo.IdCurso = p_id_curso AND nuevo.EstadoRegistro = 1
    AND NOT (aa.IdCiclo = nuevo.IdCiclo AND aa.IdCurso = nuevo.IdCurso)
    AND otro.DiaNumero = nuevo.DiaNumero AND otro.HoraInicio < nuevo.HoraFin AND otro.HoraFin > nuevo.HoraInicio
    AND COALESCE(c.FechaInicio, '1000-01-01') <= COALESCE(destino.FechaFin, '9999-12-31')
    AND COALESCE(destino.FechaInicio, '1000-01-01') <= COALESCE(c.FechaFin, '9999-12-31')
  LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_bloquear_asignacion_por_id_ciclo$$
CREATE PROCEDURE sp_academico_bloquear_asignacion_por_id_ciclo(
  IN p_id_academia INT,
  IN p_id_ciclo INT,
  IN p_id_curso INT,
  IN p_id_horario INT,
  IN p_dia_numero TINYINT,
  IN p_hora_inicio TIME,
  IN p_hora_fin TIME
)
BEGIN
  SELECT h.IdHorario AS ConflictoDocente
  FROM Asignacion_Aula actual
  INNER JOIN Usuario u ON u.IdUsuario = actual.IdUsuario AND u.IdAcademia = actual.IdAcademia AND u.EstadoRegistro = 1
  INNER JOIN Ciclo destino ON destino.IdCiclo = actual.IdCiclo AND destino.IdAcademia = actual.IdAcademia
  INNER JOIN Asignacion_Aula otra ON (otra.IdUsuario = actual.IdUsuario OR otra.IdAula = actual.IdAula)
    AND otra.IdAcademia = actual.IdAcademia AND otra.EstadoRegistro = 1
  INNER JOIN Ciclo c ON c.IdCiclo = otra.IdCiclo AND c.IdAcademia = otra.IdAcademia AND c.EstadoRegistro = 1
  INNER JOIN CicloCurso cc ON cc.IdCiclo = c.IdCiclo AND cc.IdCurso = otra.IdCurso AND cc.EstadoRegistro = 1
  INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso AND cu.EstadoRegistro = 1
  INNER JOIN HorarioCurso h ON h.IdCiclo = otra.IdCiclo AND h.IdCurso = otra.IdCurso AND h.EstadoRegistro = 1
  WHERE actual.IdAcademia = p_id_academia AND actual.IdCiclo = p_id_ciclo AND actual.IdCurso = p_id_curso AND actual.EstadoRegistro = 1
    AND h.IdHorario <> p_id_horario AND h.DiaNumero = p_dia_numero AND h.HoraInicio < p_hora_inicio AND h.HoraFin > p_hora_fin
    AND EXISTS (SELECT 1 FROM Usuario_Perfiles up INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil
      WHERE up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1 AND p.EstadoRegistro = 1
        AND LOWER(TRIM(p.Nombre)) IN ('docente', 'tutor de aula'))
    AND COALESCE(c.FechaInicio, '1000-01-01') <= COALESCE(destino.FechaFin, '9999-12-31')
    AND COALESCE(destino.FechaInicio, '1000-01-01') <= COALESCE(c.FechaFin, '9999-12-31')
  LIMIT 1 FOR UPDATE;
END$$

DROP PROCEDURE IF EXISTS sp_academico_listar_horarios$$
CREATE PROCEDURE sp_academico_listar_horarios(
  IN p_id_academia INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT h.IdHorario AS idHorario, h.IdCiclo AS idCiclo, h.IdCurso AS idCurso,
         h.DiaNumero AS diaNumero, h.DiaSemana AS diaSemana,
         TIME_FORMAT(h.HoraInicio, '%H:%i') AS horaInicio,
         TIME_FORMAT(h.HoraFin, '%H:%i') AS horaFin,
         h.Orden AS orden, h.EstadoRegistro AS estadoRegistro,
         c.Nombre AS ciclo, cu.Nombre AS curso,
         c.UniversidadObjetivo AS universidadCiclo,
         cu.UniversidadObjetivo AS universidadCurso
  FROM HorarioCurso h
  INNER JOIN Ciclo c ON c.IdCiclo = h.IdCiclo
  INNER JOIN Curso cu ON cu.IdCurso = h.IdCurso
  WHERE c.IdAcademia = p_id_academia AND h.EstadoRegistro = 1
    AND c.EstadoRegistro = 1 AND cu.EstadoRegistro = 1
    AND (p_id_ciclo IS NULL OR h.IdCiclo = p_id_ciclo)
  ORDER BY h.IdCiclo, h.DiaNumero, h.Orden, h.HoraInicio;
END$$

DROP PROCEDURE IF EXISTS sp_academico_listar_asistencia$$
CREATE PROCEDURE sp_academico_listar_asistencia(
  IN p_fecha DATE,
  IN p_id_academia INT,
  IN p_id_ciclo INT,
  IN p_id_aula INT
)
BEGIN
  SELECT
    m.IdMatricula AS idMatricula,
    m.IdMatricula AS idAlumno,
    u.IdUsuario AS idUsuario,
    CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, NULLIF(u.ApellidoMaterno, '')) AS nombre,
    COALESCE((SELECT DATE_FORMAT(ast.HoraLlegada, '%H:%i')
              FROM Asistencia ast
              WHERE ast.IdMatricula = m.IdMatricula AND ast.Fecha = p_fecha AND ast.EstadoRegistro = 1
              ORDER BY ast.IdAsistencia DESC LIMIT 1), '--') AS horaLlegada,
    COALESCE((SELECT ast.Estado
              FROM Asistencia ast
              WHERE ast.IdMatricula = m.IdMatricula AND ast.Fecha = p_fecha AND ast.EstadoRegistro = 1
              ORDER BY ast.IdAsistencia DESC LIMIT 1), 'pendiente') AS estado
  FROM Matricula m
  INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
  INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo AND c.IdAcademia = u.IdAcademia
  WHERE m.EstadoRegistro = 1
    AND u.EstadoRegistro = 1
    AND u.IdAcademia = p_id_academia
    AND c.EstadoRegistro = 1
    AND (p_id_ciclo IS NULL OR m.IdCiclo = p_id_ciclo)
    AND (p_id_aula IS NULL OR EXISTS (
      SELECT 1 FROM Asignacion_Aula aa
      WHERE aa.IdCiclo = m.IdCiclo AND aa.IdAula = p_id_aula AND aa.IdAcademia = p_id_academia
        AND aa.EstadoRegistro = 1 AND (aa.IdCurso IS NULL OR m.IdCurso IS NULL OR m.IdCurso = aa.IdCurso)
    ))
  ORDER BY nombre ASC;
END$$

-- p_matriculas: arreglo JSON de IdMatricula, por ejemplo [10, 11, 12].
DROP PROCEDURE IF EXISTS sp_academico_validar_matriculas_asistencia$$
CREATE PROCEDURE sp_academico_validar_matriculas_asistencia(
  IN p_id_academia INT,
  IN p_id_ciclo INT,
  IN p_id_aula INT,
  IN p_matriculas JSON
)
BEGIN
  SELECT DISTINCT m.IdMatricula
  FROM Matricula m
  INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
  INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo AND c.IdAcademia = u.IdAcademia
  WHERE u.IdAcademia = p_id_academia AND u.EstadoRegistro = 1 AND m.EstadoRegistro = 1
    AND c.EstadoRegistro = 1
    AND (p_id_ciclo IS NULL OR m.IdCiclo = p_id_ciclo)
    AND m.IdMatricula MEMBER OF (p_matriculas)
    AND (p_id_ciclo IS NOT NULL OR p_id_aula IS NULL OR EXISTS (
      SELECT 1 FROM Asignacion_Aula aa
      WHERE aa.IdCiclo = m.IdCiclo AND aa.IdAula = p_id_aula AND aa.IdAcademia = u.IdAcademia
        AND aa.EstadoRegistro = 1 AND (aa.IdCurso IS NULL OR m.IdCurso IS NULL OR m.IdCurso = aa.IdCurso)
    ));
END$$

DELIMITER ;
