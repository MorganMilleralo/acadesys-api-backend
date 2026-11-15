-- AcadeSys | Procedimientos almacenados: Dashboard administrativo

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_dashboard_contar_estudiantes$$
CREATE PROCEDURE sp_dashboard_contar_estudiantes(
  IN p_id_academia INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT COUNT(DISTINCT u.IdUsuario) AS TotalEstudiantes
  FROM Usuario u
  INNER JOIN Usuario_Perfiles up
    ON up.IdUsuario = u.IdUsuario
   AND up.EstadoRegistro = 1
  INNER JOIN perfil p
    ON p.IdPerfil = up.IdPerfil
   AND p.EstadoRegistro = 1
  WHERE u.IdAcademia = p_id_academia
    AND u.EstadoRegistro = 1
    AND LOWER(TRIM(p.Nombre)) IN ('alumno', 'estudiante')
    AND (p_id_ciclo IS NULL OR EXISTS (
      SELECT 1 FROM Matricula m
      INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo AND c.IdAcademia = u.IdAcademia
      WHERE m.IdUsuario = u.IdUsuario AND m.EstadoRegistro = 1 AND c.IdCiclo = p_id_ciclo
    ));
END$$

DROP PROCEDURE IF EXISTS sp_dashboard_contar_matriculas$$
CREATE PROCEDURE sp_dashboard_contar_matriculas(
  IN p_id_academia INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT COUNT(*) AS MatriculasActivas
  FROM Matricula m
  INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
  INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo AND c.IdAcademia = u.IdAcademia
  WHERE u.IdAcademia = p_id_academia
    AND u.EstadoRegistro = 1
    AND m.EstadoRegistro = 1
    AND c.EstadoRegistro = 1
    AND (p_id_ciclo IS NULL OR c.IdCiclo = p_id_ciclo);
END$$

DROP PROCEDURE IF EXISTS sp_dashboard_listar_ciclos$$
CREATE PROCEDURE sp_dashboard_listar_ciclos(
  IN p_id_academia INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT
    c.IdCiclo,
    c.Nombre,
    c.UniversidadObjetivo,
    c.FechaInicio,
    c.FechaFin,
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
      FROM Evaluacion e
      INNER JOIN Matricula m2 ON m2.IdMatricula = e.IdMatricula
      INNER JOIN Usuario u2 ON u2.IdUsuario = m2.IdUsuario
      WHERE m2.IdCiclo = c.IdCiclo
        AND m2.EstadoRegistro = 1
        AND e.EstadoRegistro IN (1, 2)
        AND u2.IdAcademia = p_id_academia
    ) AS TotalEvaluaciones
  FROM Ciclo c
  WHERE c.IdAcademia = p_id_academia
    AND (p_id_ciclo IS NULL OR c.IdCiclo = p_id_ciclo)
  ORDER BY c.FechaInicio ASC, c.IdCiclo ASC;
END$$

DROP PROCEDURE IF EXISTS sp_dashboard_contar_morosos$$
CREATE PROCEDURE sp_dashboard_contar_morosos(
  IN p_id_academia INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT COUNT(DISTINCT p.IdUsuario) AS TotalMorosos
  FROM PagosMensualidad p
  INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
  INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
  WHERE u.IdAcademia = p_id_academia
    AND u.EstadoRegistro = 1
    AND p.EstadoRegistro = 1
    AND LOWER(TRIM(COALESCE(p.Estado, ''))) IN ('moroso', 'vencido', 'pendiente')
    AND (p_id_ciclo IS NULL OR c.IdCiclo = p_id_ciclo);
END$$

DROP PROCEDURE IF EXISTS sp_dashboard_resumen_pagos$$
CREATE PROCEDURE sp_dashboard_resumen_pagos(
  IN p_id_academia INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT
    COUNT(*) AS TotalPagos,
    SUM(CASE WHEN LOWER(TRIM(COALESCE(p.Estado, ''))) = 'pagado' THEN 1 ELSE 0 END) AS Pagados,
    SUM(CASE WHEN LOWER(TRIM(COALESCE(p.Estado, ''))) IN ('moroso', 'vencido', 'pendiente') THEN 1 ELSE 0 END) AS Pendientes
  FROM PagosMensualidad p
  INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
  INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
  WHERE u.IdAcademia = p_id_academia
    AND u.EstadoRegistro = 1
    AND p.EstadoRegistro = 1
    AND (p_id_ciclo IS NULL OR c.IdCiclo = p_id_ciclo);
END$$

DROP PROCEDURE IF EXISTS sp_dashboard_cobertura_docente$$
CREATE PROCEDURE sp_dashboard_cobertura_docente(
  IN p_id_academia INT,
  IN p_id_ciclo INT
)
BEGIN
  SELECT c.IdCiclo, c.Nombre AS Ciclo, cu.IdCurso, cu.Nombre AS Curso,
    EXISTS (
      SELECT 1 FROM Asignacion_Aula aa
      INNER JOIN Usuario docente ON docente.IdUsuario = aa.IdUsuario
        AND docente.IdAcademia = c.IdAcademia AND docente.EstadoRegistro = 1
      INNER JOIN Aula a ON a.IdAula = aa.IdAula
        AND a.IdAcademia = c.IdAcademia AND a.EstadoRegistro = 1
      WHERE aa.IdCiclo = c.IdCiclo AND aa.IdCurso = cu.IdCurso
        AND aa.IdAcademia = c.IdAcademia AND aa.EstadoRegistro = 1
        AND EXISTS (SELECT 1 FROM Usuario_Perfiles up INNER JOIN perfil p ON p.IdPerfil = up.IdPerfil
          WHERE up.IdUsuario = docente.IdUsuario AND up.EstadoRegistro = 1 AND p.EstadoRegistro = 1
            AND LOWER(TRIM(p.Nombre)) IN ('docente', 'tutor de aula'))
    ) AS TieneDocente,
    EXISTS (SELECT 1 FROM HorarioCurso h
      WHERE h.IdCiclo = c.IdCiclo AND h.IdCurso = cu.IdCurso AND h.EstadoRegistro = 1
        AND h.DiaNumero BETWEEN 1 AND 7 AND h.HoraInicio < h.HoraFin) AS TieneHorario
  FROM Ciclo c
  INNER JOIN CicloCurso cc ON cc.IdCiclo = c.IdCiclo AND cc.EstadoRegistro = 1
  INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso AND cu.EstadoRegistro = 1
  WHERE c.IdAcademia = p_id_academia
    AND ((p_id_ciclo IS NULL AND c.EstadoRegistro = 1) OR c.IdCiclo = p_id_ciclo)
  GROUP BY c.IdCiclo, c.Nombre, cu.IdCurso, cu.Nombre
  ORDER BY c.IdCiclo, cu.Nombre;
END$$

DELIMITER ;
