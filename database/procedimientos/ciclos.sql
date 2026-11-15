-- AcadeSys | Procedimientos almacenados: Catálogo público de ciclos

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_ciclos_listar_publicos$$
CREATE PROCEDURE sp_ciclos_listar_publicos(
  IN p_id_academia INT
)
BEGIN
  SELECT
    c.IdCiclo,
    c.IdAcademia,
    c.Nombre,
    c.PrefijoCodigo,
    c.Turno,
    c.Horario,
    c.DiasClase,
    c.UniversidadObjetivo,
    c.FechaInicio,
    c.FechaFin,
    c.Precio,
    c.PrecioInscripcion,
    c.PrecioMensual,
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
    AND c.EstadoRegistro = 1
  ORDER BY
    CASE WHEN c.FechaInicio IS NULL THEN 1 ELSE 0 END,
    c.FechaInicio ASC,
    c.IdCiclo ASC;
END$$

DROP PROCEDURE IF EXISTS sp_ciclos_obtener_ciclo$$
CREATE PROCEDURE sp_ciclos_obtener_ciclo(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
    c.IdCiclo,
    c.IdAcademia,
    c.Nombre,
    c.PrefijoCodigo,
    c.Turno,
    c.Horario,
    c.DiasClase,
    c.UniversidadObjetivo,
    c.FechaInicio,
    c.FechaFin,
    c.Precio,
    c.PrecioInscripcion,
    c.PrecioMensual,
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
    AND c.EstadoRegistro = 1
  LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS sp_ciclos_listar_ciclo_curso$$
CREATE PROCEDURE sp_ciclos_listar_ciclo_curso(
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

DROP PROCEDURE IF EXISTS sp_ciclos_listar_horario$$
CREATE PROCEDURE sp_ciclos_listar_horario(
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
  ORDER BY
    h.DiaNumero ASC,
    h.HoraInicio ASC,
    h.Orden ASC,
    cu.Nombre ASC;
END$$

DROP PROCEDURE IF EXISTS sp_ciclos_obtener_publico$$
CREATE PROCEDURE sp_ciclos_obtener_publico(
  IN p_id_ciclo INT,
  IN p_id_academia INT
)
BEGIN
  SELECT
    cc.IdCiclo,
    cc.IdCurso,
    cc.Orden,
    cu.Nombre,
    cu.Codigo,
    cu.Descripcion,
    doc.Docentes
  FROM Ciclo ci
  INNER JOIN CicloCurso cc ON cc.IdCiclo = ci.IdCiclo
  INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
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
    ON doc.IdCiclo = cc.IdCiclo
   AND doc.IdCurso = cc.IdCurso
  WHERE cc.IdCiclo = p_id_ciclo
    AND ci.IdAcademia = p_id_academia
    AND ci.EstadoRegistro = 1
    AND cc.EstadoRegistro = 1
    AND cu.EstadoRegistro = 1
  ORDER BY cc.Orden ASC, cu.Nombre ASC;
END$$

DELIMITER ;
