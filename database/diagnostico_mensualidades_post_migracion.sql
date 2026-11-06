-- Ejecutar SOLO después de aplicar la migración aditiva en QA.
-- Consultas de solo lectura: detectan cuotas mensuales pendientes cuyo monto difiere de PrecioMensual.
SELECT p.IdPago, p.IdUsuario, p.IdCiclo, c.Nombre AS Ciclo,
       p.Mes AS Periodo, p.Monto AS MontoRegistrado,
       c.PrecioMensual AS PrecioMensualCanonico, p.Estado, p.FechaVencimiento
FROM PagosMensualidad p
INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo
INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario AND u.IdAcademia = c.IdAcademia
WHERE LOWER(TRIM(COALESCE(p.Estado, ''))) = 'pendiente'
  AND p.FechaPago IS NULL AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
  AND LOWER(TRIM(p.Mes)) <> 'inscripcion'
  AND c.PrecioMensual IS NOT NULL
  AND ROUND(p.Monto, 2) <> ROUND(c.PrecioMensual, 2)
ORDER BY p.IdCiclo, p.Mes, p.IdPago;
