-- Tarifas confirmadas el 14/11/2026 para los ciclos sin precio propio.
-- Sin estas columnas la inscripción usaba el Precio histórico (S/ 1000 y S/ 100).
--   4  Veranito UNT (oculto) : inscripción 170, mensualidad 350
--   14 Ciclo UNFV 2026 (anual): inscripción 170, mensualidad 280
--   15 Ciclo UNMSM 2026 (semestral): inscripción 200, mensualidad 350
-- Solo actualiza filas que siguen sin precio (IS NULL); no toca cuotas ya generadas.
-- Hacer respaldo de la tabla Ciclo antes de ejecutar.

SELECT IdCiclo, Nombre, Precio, PrecioInscripcion, PrecioMensual
FROM Ciclo WHERE IdCiclo IN (4, 14, 15);

UPDATE Ciclo SET PrecioInscripcion = 170.00, PrecioMensual = 350.00
WHERE IdCiclo = 4 AND PrecioInscripcion IS NULL AND PrecioMensual IS NULL;
UPDATE Ciclo SET PrecioInscripcion = 170.00, PrecioMensual = 280.00
WHERE IdCiclo = 14 AND PrecioInscripcion IS NULL AND PrecioMensual IS NULL;
UPDATE Ciclo SET PrecioInscripcion = 200.00, PrecioMensual = 350.00
WHERE IdCiclo = 15 AND PrecioInscripcion IS NULL AND PrecioMensual IS NULL;

-- Resultado esperado: 4 -> 170/350, 14 -> 170/280, 15 -> 200/350.
SELECT IdCiclo, Nombre, Precio, PrecioInscripcion, PrecioMensual
FROM Ciclo WHERE IdCiclo IN (4, 14, 15);
