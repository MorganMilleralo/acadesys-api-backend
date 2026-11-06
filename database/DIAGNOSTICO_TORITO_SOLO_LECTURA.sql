-- Preparado, NO ejecutado. Primero verificar DDL con Morgan/DBeaver.
-- Solo SELECT/SHOW: no modificar capacidades, precios ni pagos desde este archivo.
-- Sustituir :idAcademia y :periodo por parámetros de la herramienta (periodo YYYY-MM).
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
  ('Ciclo','Matricula','PagosMensualidad','Asignacion_Aula','CicloCurso','HorarioCurso','Usuario','Aula')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
SHOW INDEX FROM Ciclo;
SHOW INDEX FROM Matricula;
SHOW INDEX FROM PagosMensualidad;
SHOW INDEX FROM Asignacion_Aula;

-- DDL de Ciclo confirmado por el usuario el 30/10/2026: ambos DECIMAL(8,2) NULL.
-- Inventario para propuesta por IdCiclo REAL. No deducir tarifas del nombre ni aplicar rangos estimados.
SELECT IdCiclo, IdAcademia, Nombre, Precio AS PrecioHistorico,
  PrecioInscripcion, PrecioMensual, Capacidad, EstadoRegistro
FROM Ciclo WHERE IdAcademia = :idAcademia ORDER BY IdCiclo;

-- NULL no es gratis: inscripción usa respaldo legado; mensualidad no usa respaldo.
SELECT IdCiclo, Nombre, Precio, PrecioInscripcion, PrecioMensual,
  CASE WHEN PrecioInscripcion >= 0 THEN PrecioInscripcion
       WHEN Precio >= 0 THEN Precio ELSE NULL END AS InscripcionEfectiva
FROM Ciclo WHERE IdAcademia = :idAcademia
  AND (PrecioInscripcion IS NULL OR PrecioMensual IS NULL
    OR PrecioInscripcion < 0 OR PrecioMensual < 0
    OR (PrecioInscripcion IS NOT NULL AND Precio IS NOT NULL AND PrecioInscripcion <> Precio));

-- Diferencia entre cuota y tarifa ACTUAL: solo evidencia, no prueba un error histórico.
-- Comparar por concepto/periodo y fecha de configuración antes de aprobar cualquier ajuste.
SELECT p.IdPago, p.IdUsuario, p.IdCiclo, p.Mes, p.Estado, p.FechaPago, p.Monto,
  c.Precio AS PrecioHistorico, c.PrecioInscripcion, c.PrecioMensual
FROM PagosMensualidad p
JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = :idAcademia
WHERE p.EstadoRegistro = 1 AND (
  (LOWER(TRIM(p.Mes)) = 'inscripcion' AND p.Monto <> COALESCE(c.PrecioInscripcion, c.Precio))
  OR (p.Mes REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$' AND p.Monto <> c.PrecioMensual)
)
ORDER BY p.IdCiclo, p.Mes, p.IdPago;

-- Capacidades históricas y alumnos actuales; no proponer reducción automática.
SELECT c.IdCiclo, c.Nombre, c.Capacidad, c.Precio,
  COUNT(DISTINCT CASE WHEN m.EstadoRegistro = 1 AND u.EstadoRegistro = 1 THEN m.IdMatricula END) AS Inscritos
FROM Ciclo c
LEFT JOIN Matricula m ON m.IdCiclo = c.IdCiclo
LEFT JOIN Usuario u ON u.IdUsuario = m.IdUsuario AND u.IdAcademia = c.IdAcademia
WHERE c.IdAcademia = :idAcademia
GROUP BY c.IdCiclo, c.Nombre, c.Capacidad, c.Precio
HAVING c.Capacidad IS NULL OR c.Capacidad < 1 OR c.Capacidad > 120
  OR c.Capacidad <> FLOOR(c.Capacidad) OR Inscritos > c.Capacidad
ORDER BY c.IdCiclo;

-- Distribución por ciclo y periodo: una diferencia no prueba un cobro incorrecto.
SELECT p.IdCiclo, p.Mes, p.Estado, p.EstadoRegistro, p.Monto,
  COUNT(*) AS Cantidad, MIN(p.FechaPago) AS PrimeraConfirmacion, MAX(p.FechaPago) AS UltimaConfirmacion
FROM PagosMensualidad p
INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = :idAcademia
GROUP BY p.IdCiclo, p.Mes, p.Estado, p.EstadoRegistro, p.Monto
ORDER BY p.IdCiclo, p.Mes, p.Monto;

-- Importes sospechosos y estados inconsistentes, incluidos confirmados (solo reporte).
SELECT p.IdPago, p.IdUsuario, p.IdCiclo, p.Mes, p.Monto, p.Estado, p.FechaPago, p.EstadoRegistro
FROM PagosMensualidad p
INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = :idAcademia
WHERE p.Monto IS NULL OR p.Monto < 0 OR p.Monto IN (0, 1)
  OR (LOWER(TRIM(p.Estado)) = 'pagado' AND p.FechaPago IS NULL)
  OR (LOWER(TRIM(p.Estado)) <> 'pagado' AND p.FechaPago IS NOT NULL)
ORDER BY p.IdCiclo, p.IdPago;

-- Huérfanos o cruce de academias: limitar por academia del ciclo O del usuario.
SELECT p.IdPago, p.IdUsuario, p.IdCiclo, p.Mes, p.Monto,
  u.IdAcademia AS AcademiaUsuario, c.IdAcademia AS AcademiaCiclo
FROM PagosMensualidad p
LEFT JOIN Usuario u ON u.IdUsuario = p.IdUsuario
LEFT JOIN Ciclo c ON c.IdCiclo = p.IdCiclo
WHERE (c.IdAcademia = :idAcademia OR u.IdAcademia = :idAcademia)
  AND (u.IdUsuario IS NULL OR c.IdCiclo IS NULL OR u.IdAcademia <> c.IdAcademia
    OR NOT EXISTS (SELECT 1 FROM Matricula m WHERE m.IdUsuario = p.IdUsuario AND m.IdCiclo = p.IdCiclo));
-- Los pagos sin usuario Y sin ciclo requieren diagnóstico global autorizado; no se atribuyen a una academia.

-- Matrículas activas sin cuota del periodo indicado (no implica deuda sin decisión de negocio).
SELECT m.IdMatricula, m.IdUsuario, m.IdCiclo
FROM Matricula m
INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo AND c.IdAcademia = :idAcademia
INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario AND u.IdAcademia = c.IdAcademia AND u.EstadoRegistro = 1
WHERE m.EstadoRegistro = 1 AND NOT EXISTS (
  SELECT 1 FROM PagosMensualidad p WHERE p.IdUsuario = m.IdUsuario AND p.IdCiclo = m.IdCiclo
    AND p.Mes = :periodo AND p.EstadoRegistro = 1
);

-- Cuotas duplicadas, sin corregir ni borrar automáticamente.
SELECT p.IdUsuario, p.IdCiclo, p.Mes, COUNT(*) AS Cantidad
FROM PagosMensualidad p
INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = :idAcademia
WHERE p.EstadoRegistro = 1
GROUP BY p.IdUsuario, p.IdCiclo, p.Mes HAVING COUNT(*) > 1;

-- Cursos sin docente válido y/o horario. Mismas relaciones de la API, sin columnas nuevas.
SELECT c.IdCiclo, cc.IdCurso, cu.Nombre,
  NOT EXISTS (SELECT 1 FROM Asignacion_Aula aa
    INNER JOIN Usuario u ON u.IdUsuario = aa.IdUsuario AND u.IdAcademia = c.IdAcademia AND u.EstadoRegistro = 1
    INNER JOIN Aula a ON a.IdAula = aa.IdAula AND a.IdAcademia = c.IdAcademia AND a.EstadoRegistro = 1
    INNER JOIN Usuario_Perfiles up ON up.IdUsuario = u.IdUsuario AND up.EstadoRegistro = 1
    INNER JOIN perfil pf ON pf.IdPerfil = up.IdPerfil AND pf.EstadoRegistro = 1
    WHERE aa.IdCiclo = c.IdCiclo AND aa.IdCurso = cc.IdCurso AND aa.IdAcademia = c.IdAcademia
      AND aa.EstadoRegistro = 1 AND LOWER(TRIM(pf.Nombre)) IN ('docente','tutor de aula')) AS SinDocente,
  NOT EXISTS (SELECT 1 FROM HorarioCurso h WHERE h.IdCiclo = c.IdCiclo AND h.IdCurso = cc.IdCurso
    AND h.EstadoRegistro = 1 AND h.DiaNumero BETWEEN 1 AND 7 AND h.HoraInicio < h.HoraFin) AS SinHorario
FROM Ciclo c
INNER JOIN CicloCurso cc ON cc.IdCiclo = c.IdCiclo AND cc.EstadoRegistro = 1
INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso AND cu.EstadoRegistro = 1
WHERE c.IdAcademia = :idAcademia
GROUP BY c.IdCiclo, cc.IdCurso, cu.Nombre
HAVING SinDocente = 1 OR SinHorario = 1;
