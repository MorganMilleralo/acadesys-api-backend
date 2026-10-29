-- ACADESYS / Morgan / DIAGNOSTICO DE SOLO LECTURA
-- Ejecutar primero con una conexión autorizada a QA o Aiven.
-- Este archivo NO modifica datos. Guarda los resultados y confirma nombres/tipos antes de migrar.

SHOW CREATE TABLE Ciclo;
SHOW CREATE TABLE Matricula;
SHOW CREATE TABLE PagosMensualidad;
SHOW CREATE TABLE Usuario;
SHOW CREATE TABLE Usuario_Perfiles;
SHOW CREATE TABLE perfil;
SHOW CREATE TABLE Curso;
SHOW CREATE TABLE CicloCurso;
SHOW CREATE TABLE Asignacion_Aula;
SHOW CREATE TABLE Aula;
SHOW CREATE TABLE HorarioCurso;

SHOW INDEX FROM Ciclo;
SHOW INDEX FROM Matricula;
SHOW INDEX FROM PagosMensualidad;
SHOW INDEX FROM Asignacion_Aula;

-- Capacidad por ciclo e inscritos activos. No modifica registros.
SELECT c.IdCiclo, c.Nombre, c.Precio, c.Capacidad,
       COUNT(DISTINCT CASE WHEN m.EstadoRegistro = 1 AND u.EstadoRegistro = 1 THEN m.IdMatricula END) AS MatriculasActivas
FROM Ciclo c
LEFT JOIN Matricula m ON m.IdCiclo = c.IdCiclo
LEFT JOIN Usuario u ON u.IdUsuario = m.IdUsuario AND u.IdAcademia = c.IdAcademia
GROUP BY c.IdCiclo, c.Nombre, c.Precio, c.Capacidad
ORDER BY c.IdCiclo;

-- Distribución de cobros por ciclo, concepto/periodo, estado e importe.
SELECT c.IdCiclo, c.Nombre AS Ciclo, p.Mes, p.Estado,
       COUNT(*) AS Cantidad, MIN(p.Monto) AS MontoMinimo,
       MAX(p.Monto) AS MontoMaximo,
       SUM(CASE WHEN p.FechaPago IS NOT NULL THEN 1 ELSE 0 END) AS ConFechaPago
FROM PagosMensualidad p
INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo
INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario AND u.IdAcademia = c.IdAcademia
WHERE p.EstadoRegistro = 1
GROUP BY c.IdCiclo, c.Nombre, p.Mes, p.Estado
ORDER BY c.IdCiclo, p.Mes, p.Estado;

-- Cuotas de inscripción pendientes cuyo importe no coincide con el precio legado del ciclo.
-- No asumir que la diferencia debe corregirse: revisar y aprobar cada IdPago.
SELECT p.IdPago, p.IdUsuario, p.IdCiclo, c.Nombre AS Ciclo,
       p.Monto AS MontoRegistrado, c.Precio AS PrecioLegado,
       p.Estado, p.FechaPago
FROM PagosMensualidad p
INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = (
  SELECT u.IdAcademia FROM Usuario u WHERE u.IdUsuario = p.IdUsuario LIMIT 1
)
WHERE LOWER(TRIM(p.Mes)) = 'inscripcion'
  AND LOWER(TRIM(COALESCE(p.Estado, ''))) = 'pendiente'
  AND p.FechaPago IS NULL
  AND p.EstadoRegistro = 1
  AND p.Monto <> c.Precio
ORDER BY p.IdCiclo, p.IdPago;

-- Alumnos matriculados sin cuota de inscripción activa.
SELECT m.IdMatricula, m.IdUsuario, m.IdCiclo, c.Nombre AS Ciclo
FROM Matricula m
INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario AND u.EstadoRegistro = 1
INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo AND c.IdAcademia = u.IdAcademia
LEFT JOIN PagosMensualidad p
  ON p.IdUsuario = m.IdUsuario AND p.IdCiclo = m.IdCiclo
 AND LOWER(TRIM(p.Mes)) = 'inscripcion' AND p.EstadoRegistro = 1
WHERE m.EstadoRegistro = 1 AND p.IdPago IS NULL
ORDER BY m.IdCiclo, m.IdUsuario;

-- Cursos por ciclo sin asignación docente activa (según el modelo del diagrama).
SELECT cc.IdCiclo, c.Nombre AS Ciclo, cc.IdCurso, cu.Nombre AS Curso
FROM CicloCurso cc
INNER JOIN Ciclo c ON c.IdCiclo = cc.IdCiclo
INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
LEFT JOIN Asignacion_Aula aa
  ON aa.IdCiclo = cc.IdCiclo AND aa.IdCurso = cc.IdCurso
 AND aa.IdAcademia = c.IdAcademia AND aa.EstadoRegistro = 1
LEFT JOIN Usuario docente
  ON docente.IdUsuario = aa.IdUsuario AND docente.IdAcademia = aa.IdAcademia
 AND docente.EstadoRegistro = 1
WHERE cc.EstadoRegistro = 1 AND cu.EstadoRegistro = 1
GROUP BY cc.IdCiclo, c.Nombre, cc.IdCurso, cu.Nombre
HAVING COUNT(docente.IdUsuario) = 0
ORDER BY cc.IdCiclo, cu.Nombre;
