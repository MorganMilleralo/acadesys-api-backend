-- ============================================================================
-- SEED DEMO · CATÁLOGO DE CICLOS POR UNIVERSIDAD (AcadeSys)
-- ============================================================================
-- ESTADO: PREPARADO — NO EJECUTADO EN PRODUCCIÓN.
--
-- Entorno detectado: MySQL remoto Aiven (acadesys-mysql-morgan-a82b.l.aivencloud.com)
-- servido por el backend desplegado en Render (https://acadesys-api.onrender.com).
-- Esa base es la de PRODUCCIÓN: no existe staging ni base local configurada.
-- Por ese motivo este script NO se ha ejecutado. Queda listo para revisión y
-- aprobación explícita.
--
-- OBJETIVO
--   Ampliar el catálogo público de ciclos (vitrina de la Landing) con ciclos
--   demo de seis universidades que hoy no tienen ninguna oferta publicada:
--   UNALM, UPCH, ULIMA, UPC, USMP y UTP.
--
-- MODELO REAL (verificado con SHOW CREATE / INFORMATION_SCHEMA, sin asumir):
--   - No existe tabla `Universidad`: la universidad es el campo de texto
--     `Ciclo.UniversidadObjetivo` (VARCHAR(50)).
--   - `Ciclo` -> `CicloCurso` (PK compuesta IdCiclo+IdCurso) -> `Curso`.
--   - `Ciclo` -> `HorarioCurso` (IdCiclo, IdCurso, DiaNumero, DiaSemana,
--     HoraInicio, HoraFin, Orden).
--   - Los inscritos NO se guardan: se calculan desde `Matricula` (el backend
--     cuenta matrículas activas de usuarios activos).
--   - Las vacantes se calculan como `Capacidad - TotalAlumnos`.
--   - El precio se guarda en `Ciclo.Precio` (el servidor es la autoridad).
--   - `Ciclo.EstadoRegistro = 1` es lo que hace visible un ciclo en
--     `GET /api/ciclos/publicos` (no se filtra por fecha).
--
-- REGLAS QUE RESPETA ESTE SCRIPT
--   1. NO borra nada: no toca ciclos, alumnos, matrículas, notas, asistencia
--      ni pagos existentes.
--   2. NO altera los ciclos actuales (Semestral San Marcos, Repaso UNI,
--      Veranito San Marcos, Veranito San Marcos (II), Anual Católica (PUCP),
--      Semestral Callao (UNAC), Repaso San Marcos, Anual UNI, Ciclo Semestral
--      UNFV 2026, Ciclo UNFV 2026, Veranito UNT).
--   3. NO crea tablas, columnas, índices ni constraints.
--   4. Es IDEMPOTENTE: se puede ejecutar N veces y nunca duplica ciclos,
--      cursos ni horarios (guardas `NOT EXISTS` + variables de control).
--   5. Reutiliza el catálogo de cursos EXISTENTE (plan SM de 17 materias).
--      No se crean cursos duplicados por universidad.
--   6. Fechas relativas a CURDATE(): los ciclos demo siempre quedan vigentes
--      sin importar cuándo se ejecute el script.
--
-- 7. TODOS LOS DATOS SON DE DEMOSTRACION (catalogo demo de AcadeSys):
--      - PRECIOS: tarifas internas de demostracion de la academia.
--        NO son tarifas oficiales de ninguna universidad.
--      - TURNOS, HORARIOS Y DIAS: propuesta interna de la academia.
--      - CURSOS: se reutiliza el plan interno de AcadeSys ya existente
--        (17 materias del catalogo de cursos, codigos SM-*). NO es la malla
--        curricular oficial de la universidad: son cursos demo del sistema.
--      - INSCRITOS: 0. El contador lo calcula el backend desde Matricula.
--
-- CÓMO EJECUTAR (solo tras autorización explícita)
--   mysql --default-character-set=utf8mb4 -h <host> -P <puerto> -u <user> -p <db> \
--         < SEED_CICLOS_DEMO_UNIVERSIDADES.sql
--
-- CÓMO DESHACER (si se aplicó y se quiere revertir)
--   UPDATE Ciclo SET EstadoRegistro = 0
--    WHERE Nombre IN ('Ciclo Regular Agraria La Molina',
--                      'Ciclo Regular Cayetano Heredia',
--                      'Ciclo Regular Universidad de Lima',
--                      'Ciclo Regular Ciencias Aplicadas',
--                      'Ciclo Regular San Martin de Porres',
--                      'Ciclo Regular Tecnologica del Peru');
--   (baja lógica; no borra historial)
-- ============================================================================

SET @id_academia := 1;

-- ---------------------------------------------------------------------------
-- 1) UNALM · Universidad Nacional Agraria La Molina
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan interno de AcadeSys reusado (17 materias, codigos SM-*),
--    no la malla curricular oficial de UNALM.
-- ---------------------------------------------------------------------------
INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, FechaInicio, FechaFin, EstadoRegistro,
   Turno, Horario, Precio, DiasClase, UniversidadObjetivo, Capacidad)
SELECT @id_academia, 'Ciclo Regular Agraria La Molina', 'UNALM',
       DATE_ADD(CURDATE(), INTERVAL 14 DAY),
       DATE_ADD(CURDATE(), INTERVAL 134 DAY),
       1, 'Mañana', '08:00 - 13:00', 380.00, 'Lunes a Sábado', 'UNALM', 40
FROM DUAL
WHERE EXISTS (SELECT 1 FROM Academia WHERE IdAcademia = @id_academia AND EstadoRegistro = 1)
  AND NOT EXISTS (
    SELECT 1 FROM Ciclo
    WHERE IdAcademia = @id_academia
      AND Nombre = 'Ciclo Regular Agraria La Molina'
      AND EstadoRegistro IN (0, 1)
  );

SET @id_ciclo := (SELECT IdCiclo FROM Ciclo WHERE IdAcademia = @id_academia AND Nombre = 'Ciclo Regular Agraria La Molina' AND EstadoRegistro = 1 ORDER BY IdCiclo DESC LIMIT 1);
SET @cursos_existentes := (SELECT COUNT(*) FROM CicloCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO CicloCurso (IdCiclo, IdCurso, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS orden UNION ALL
  SELECT 3, 2 UNION ALL
  SELECT 4, 3 UNION ALL
  SELECT 5, 4 UNION ALL
  SELECT 6, 5 UNION ALL
  SELECT 7, 6 UNION ALL
  SELECT 8, 7 UNION ALL
  SELECT 9, 8 UNION ALL
  SELECT 10, 9 UNION ALL
  SELECT 72, 10 UNION ALL
  SELECT 73, 11 UNION ALL
  SELECT 74, 12 UNION ALL
  SELECT 75, 13 UNION ALL
  SELECT 76, 14 UNION ALL
  SELECT 77, 15 UNION ALL
  SELECT 78, 16 UNION ALL
  SELECT 79, 17
) t
WHERE @cursos_existentes = 0
  AND EXISTS (SELECT 1 FROM Curso cu WHERE cu.IdCurso = t.IdCurso AND cu.EstadoRegistro = 1);

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS dia, 'Lunes' AS dia_semana, '08:00' AS hora_inicio, '10:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 3, 2, 'Martes', '08:00', '10:00', 2 UNION ALL
  SELECT 4, 3, 'Miércoles', '08:00', '10:00', 3 UNION ALL
  SELECT 5, 4, 'Jueves', '08:00', '10:00', 4 UNION ALL
  SELECT 6, 5, 'Viernes', '08:00', '10:00', 5 UNION ALL
  SELECT 7, 6, 'Sábado', '10:00', '12:00', 6
) t
WHERE @horarios_existentes = 0;

-- ---------------------------------------------------------------------------
-- 2) UPCH · Universidad Peruana Cayetano Heredia
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan interno de AcadeSys reusado (17 materias, codigos SM-*),
--    no la malla curricular oficial de UPCH.
-- ---------------------------------------------------------------------------
INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, FechaInicio, FechaFin, EstadoRegistro,
   Turno, Horario, Precio, DiasClase, UniversidadObjetivo, Capacidad)
SELECT @id_academia, 'Ciclo Regular Cayetano Heredia', 'UPCH',
       DATE_ADD(CURDATE(), INTERVAL 14 DAY),
       DATE_ADD(CURDATE(), INTERVAL 134 DAY),
       1, 'Mañana', '08:00 - 14:00', 420.00, 'Lunes a Sábado', 'UPCH', 40
FROM DUAL
WHERE EXISTS (SELECT 1 FROM Academia WHERE IdAcademia = @id_academia AND EstadoRegistro = 1)
  AND NOT EXISTS (
    SELECT 1 FROM Ciclo
    WHERE IdAcademia = @id_academia
      AND Nombre = 'Ciclo Regular Cayetano Heredia'
      AND EstadoRegistro IN (0, 1)
  );

SET @id_ciclo := (SELECT IdCiclo FROM Ciclo WHERE IdAcademia = @id_academia AND Nombre = 'Ciclo Regular Cayetano Heredia' AND EstadoRegistro = 1 ORDER BY IdCiclo DESC LIMIT 1);
SET @cursos_existentes := (SELECT COUNT(*) FROM CicloCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO CicloCurso (IdCiclo, IdCurso, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS orden UNION ALL
  SELECT 3, 2 UNION ALL
  SELECT 4, 3 UNION ALL
  SELECT 5, 4 UNION ALL
  SELECT 6, 5 UNION ALL
  SELECT 7, 6 UNION ALL
  SELECT 8, 7 UNION ALL
  SELECT 9, 8 UNION ALL
  SELECT 10, 9 UNION ALL
  SELECT 72, 10 UNION ALL
  SELECT 73, 11 UNION ALL
  SELECT 74, 12 UNION ALL
  SELECT 75, 13 UNION ALL
  SELECT 76, 14 UNION ALL
  SELECT 77, 15 UNION ALL
  SELECT 78, 16 UNION ALL
  SELECT 79, 17
) t
WHERE @cursos_existentes = 0
  AND EXISTS (SELECT 1 FROM Curso cu WHERE cu.IdCurso = t.IdCurso AND cu.EstadoRegistro = 1);

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS dia, 'Lunes' AS dia_semana, '08:00' AS hora_inicio, '10:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 3, 2, 'Martes', '08:00', '10:00', 2 UNION ALL
  SELECT 4, 3, 'Miércoles', '10:15', '12:15', 3 UNION ALL
  SELECT 5, 4, 'Jueves', '08:00', '10:00', 4 UNION ALL
  SELECT 6, 5, 'Viernes', '10:15', '12:15', 5 UNION ALL
  SELECT 7, 6, 'Sábado', '08:00', '10:00', 6
) t
WHERE @horarios_existentes = 0;

-- ---------------------------------------------------------------------------
-- 3) ULIMA · Universidad de Lima
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan interno de AcadeSys reusado (17 materias, codigos SM-*),
--    no la malla curricular oficial de ULIMA.
-- ---------------------------------------------------------------------------
INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, FechaInicio, FechaFin, EstadoRegistro,
   Turno, Horario, Precio, DiasClase, UniversidadObjetivo, Capacidad)
SELECT @id_academia, 'Ciclo Regular Universidad de Lima', 'ULIMA',
       DATE_ADD(CURDATE(), INTERVAL 21 DAY),
       DATE_ADD(CURDATE(), INTERVAL 141 DAY),
       1, 'Tarde', '14:00 - 19:00', 450.00, 'Lunes a Sábado', 'ULIMA', 36
FROM DUAL
WHERE EXISTS (SELECT 1 FROM Academia WHERE IdAcademia = @id_academia AND EstadoRegistro = 1)
  AND NOT EXISTS (
    SELECT 1 FROM Ciclo
    WHERE IdAcademia = @id_academia
      AND Nombre = 'Ciclo Regular Universidad de Lima'
      AND EstadoRegistro IN (0, 1)
  );

SET @id_ciclo := (SELECT IdCiclo FROM Ciclo WHERE IdAcademia = @id_academia AND Nombre = 'Ciclo Regular Universidad de Lima' AND EstadoRegistro = 1 ORDER BY IdCiclo DESC LIMIT 1);
SET @cursos_existentes := (SELECT COUNT(*) FROM CicloCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO CicloCurso (IdCiclo, IdCurso, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS orden UNION ALL
  SELECT 3, 2 UNION ALL
  SELECT 4, 3 UNION ALL
  SELECT 5, 4 UNION ALL
  SELECT 6, 5 UNION ALL
  SELECT 7, 6 UNION ALL
  SELECT 8, 7 UNION ALL
  SELECT 9, 8 UNION ALL
  SELECT 10, 9 UNION ALL
  SELECT 72, 10 UNION ALL
  SELECT 73, 11 UNION ALL
  SELECT 74, 12 UNION ALL
  SELECT 75, 13 UNION ALL
  SELECT 76, 14 UNION ALL
  SELECT 77, 15 UNION ALL
  SELECT 78, 16 UNION ALL
  SELECT 79, 17
) t
WHERE @cursos_existentes = 0
  AND EXISTS (SELECT 1 FROM Curso cu WHERE cu.IdCurso = t.IdCurso AND cu.EstadoRegistro = 1);

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS dia, 'Lunes' AS dia_semana, '14:00' AS hora_inicio, '16:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 3, 2, 'Martes', '14:00', '16:00', 2 UNION ALL
  SELECT 4, 3, 'Miércoles', '16:15', '18:15', 3 UNION ALL
  SELECT 5, 4, 'Jueves', '14:00', '16:00', 4 UNION ALL
  SELECT 6, 5, 'Viernes', '16:15', '18:15', 5 UNION ALL
  SELECT 7, 6, 'Sábado', '14:00', '16:00', 6
) t
WHERE @horarios_existentes = 0;

-- ---------------------------------------------------------------------------
-- 4) UPC · Universidad Peruana de Ciencias Aplicadas
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan interno de AcadeSys reusado (17 materias, codigos SM-*),
--    no la malla curricular oficial de UPC.
-- ---------------------------------------------------------------------------
INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, FechaInicio, FechaFin, EstadoRegistro,
   Turno, Horario, Precio, DiasClase, UniversidadObjetivo, Capacidad)
SELECT @id_academia, 'Ciclo Regular Ciencias Aplicadas', 'UPC',
       DATE_ADD(CURDATE(), INTERVAL 21 DAY),
       DATE_ADD(CURDATE(), INTERVAL 141 DAY),
       1, 'Tarde', '14:00 - 19:00', 460.00, 'Lunes a Sábado', 'UPC', 36
FROM DUAL
WHERE EXISTS (SELECT 1 FROM Academia WHERE IdAcademia = @id_academia AND EstadoRegistro = 1)
  AND NOT EXISTS (
    SELECT 1 FROM Ciclo
    WHERE IdAcademia = @id_academia
      AND Nombre = 'Ciclo Regular Ciencias Aplicadas'
      AND EstadoRegistro IN (0, 1)
  );

SET @id_ciclo := (SELECT IdCiclo FROM Ciclo WHERE IdAcademia = @id_academia AND Nombre = 'Ciclo Regular Ciencias Aplicadas' AND EstadoRegistro = 1 ORDER BY IdCiclo DESC LIMIT 1);
SET @cursos_existentes := (SELECT COUNT(*) FROM CicloCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO CicloCurso (IdCiclo, IdCurso, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS orden UNION ALL
  SELECT 3, 2 UNION ALL
  SELECT 4, 3 UNION ALL
  SELECT 5, 4 UNION ALL
  SELECT 6, 5 UNION ALL
  SELECT 7, 6 UNION ALL
  SELECT 8, 7 UNION ALL
  SELECT 9, 8 UNION ALL
  SELECT 10, 9 UNION ALL
  SELECT 72, 10 UNION ALL
  SELECT 73, 11 UNION ALL
  SELECT 74, 12 UNION ALL
  SELECT 75, 13 UNION ALL
  SELECT 76, 14 UNION ALL
  SELECT 77, 15 UNION ALL
  SELECT 78, 16 UNION ALL
  SELECT 79, 17
) t
WHERE @cursos_existentes = 0
  AND EXISTS (SELECT 1 FROM Curso cu WHERE cu.IdCurso = t.IdCurso AND cu.EstadoRegistro = 1);

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS dia, 'Lunes' AS dia_semana, '14:00' AS hora_inicio, '16:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 3, 2, 'Martes', '16:15', '18:15', 2 UNION ALL
  SELECT 4, 3, 'Miércoles', '14:00', '16:00', 3 UNION ALL
  SELECT 5, 4, 'Jueves', '16:15', '18:15', 4 UNION ALL
  SELECT 6, 5, 'Viernes', '14:00', '16:00', 5 UNION ALL
  SELECT 7, 6, 'Sábado', '14:00', '16:00', 6
) t
WHERE @horarios_existentes = 0;

-- ---------------------------------------------------------------------------
-- 5) USMP · Universidad de San Martin de Porres
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan interno de AcadeSys reusado (17 materias, codigos SM-*),
--    no la malla curricular oficial de USMP.
-- ---------------------------------------------------------------------------
INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, FechaInicio, FechaFin, EstadoRegistro,
   Turno, Horario, Precio, DiasClase, UniversidadObjetivo, Capacidad)
SELECT @id_academia, 'Ciclo Regular San Martin de Porres', 'USMP',
       DATE_ADD(CURDATE(), INTERVAL 28 DAY),
       DATE_ADD(CURDATE(), INTERVAL 148 DAY),
       1, 'Mañana', '08:00 - 13:00', 400.00, 'Lunes a Sábado', 'USMP', 40
FROM DUAL
WHERE EXISTS (SELECT 1 FROM Academia WHERE IdAcademia = @id_academia AND EstadoRegistro = 1)
  AND NOT EXISTS (
    SELECT 1 FROM Ciclo
    WHERE IdAcademia = @id_academia
      AND Nombre = 'Ciclo Regular San Martin de Porres'
      AND EstadoRegistro IN (0, 1)
  );

SET @id_ciclo := (SELECT IdCiclo FROM Ciclo WHERE IdAcademia = @id_academia AND Nombre = 'Ciclo Regular San Martin de Porres' AND EstadoRegistro = 1 ORDER BY IdCiclo DESC LIMIT 1);
SET @cursos_existentes := (SELECT COUNT(*) FROM CicloCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO CicloCurso (IdCiclo, IdCurso, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS orden UNION ALL
  SELECT 3, 2 UNION ALL
  SELECT 4, 3 UNION ALL
  SELECT 5, 4 UNION ALL
  SELECT 6, 5 UNION ALL
  SELECT 7, 6 UNION ALL
  SELECT 8, 7 UNION ALL
  SELECT 9, 8 UNION ALL
  SELECT 10, 9 UNION ALL
  SELECT 72, 10 UNION ALL
  SELECT 73, 11 UNION ALL
  SELECT 74, 12 UNION ALL
  SELECT 75, 13 UNION ALL
  SELECT 76, 14 UNION ALL
  SELECT 77, 15 UNION ALL
  SELECT 78, 16 UNION ALL
  SELECT 79, 17
) t
WHERE @cursos_existentes = 0
  AND EXISTS (SELECT 1 FROM Curso cu WHERE cu.IdCurso = t.IdCurso AND cu.EstadoRegistro = 1);

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS dia, 'Lunes' AS dia_semana, '08:00' AS hora_inicio, '10:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 3, 2, 'Martes', '10:15', '12:15', 2 UNION ALL
  SELECT 4, 3, 'Miércoles', '08:00', '10:00', 3 UNION ALL
  SELECT 5, 4, 'Jueves', '10:15', '12:15', 4 UNION ALL
  SELECT 6, 5, 'Viernes', '08:00', '10:00', 5 UNION ALL
  SELECT 7, 6, 'Sábado', '10:15', '12:15', 6
) t
WHERE @horarios_existentes = 0;

-- ---------------------------------------------------------------------------
-- 6) UTP · Universidad Tecnologica del Peru
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan interno de AcadeSys reusado (17 materias, codigos SM-*),
--    no la malla curricular oficial de UTP.
-- ---------------------------------------------------------------------------
INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, FechaInicio, FechaFin, EstadoRegistro,
   Turno, Horario, Precio, DiasClase, UniversidadObjetivo, Capacidad)
SELECT @id_academia, 'Ciclo Regular Tecnologica del Peru', 'UTP',
       DATE_ADD(CURDATE(), INTERVAL 28 DAY),
       DATE_ADD(CURDATE(), INTERVAL 148 DAY),
       1, 'Noche', '18:00 - 22:00', 390.00, 'Lunes a Sábado', 'UTP', 30
FROM DUAL
WHERE EXISTS (SELECT 1 FROM Academia WHERE IdAcademia = @id_academia AND EstadoRegistro = 1)
  AND NOT EXISTS (
    SELECT 1 FROM Ciclo
    WHERE IdAcademia = @id_academia
      AND Nombre = 'Ciclo Regular Tecnologica del Peru'
      AND EstadoRegistro IN (0, 1)
  );

SET @id_ciclo := (SELECT IdCiclo FROM Ciclo WHERE IdAcademia = @id_academia AND Nombre = 'Ciclo Regular Tecnologica del Peru' AND EstadoRegistro = 1 ORDER BY IdCiclo DESC LIMIT 1);
SET @cursos_existentes := (SELECT COUNT(*) FROM CicloCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO CicloCurso (IdCiclo, IdCurso, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS orden UNION ALL
  SELECT 3, 2 UNION ALL
  SELECT 4, 3 UNION ALL
  SELECT 5, 4 UNION ALL
  SELECT 6, 5 UNION ALL
  SELECT 7, 6 UNION ALL
  SELECT 8, 7 UNION ALL
  SELECT 9, 8 UNION ALL
  SELECT 10, 9 UNION ALL
  SELECT 72, 10 UNION ALL
  SELECT 73, 11 UNION ALL
  SELECT 74, 12 UNION ALL
  SELECT 75, 13 UNION ALL
  SELECT 76, 14 UNION ALL
  SELECT 77, 15 UNION ALL
  SELECT 78, 16 UNION ALL
  SELECT 79, 17
) t
WHERE @cursos_existentes = 0
  AND EXISTS (SELECT 1 FROM Curso cu WHERE cu.IdCurso = t.IdCurso AND cu.EstadoRegistro = 1);

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, t.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 2 AS IdCurso, 1 AS dia, 'Lunes' AS dia_semana, '18:00' AS hora_inicio, '20:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 3, 2, 'Martes', '20:15', '22:00', 2 UNION ALL
  SELECT 4, 3, 'Miércoles', '18:00', '20:00', 3 UNION ALL
  SELECT 5, 4, 'Jueves', '20:15', '22:00', 4 UNION ALL
  SELECT 6, 5, 'Viernes', '18:00', '20:00', 5 UNION ALL
  SELECT 7, 6, 'Sábado', '18:00', '20:00', 6
) t
WHERE @horarios_existentes = 0;

-- ============================================================================
-- VERIFICACIÓN (solo lectura)
-- ============================================================================
SELECT UniversidadObjetivo,
       COUNT(*) AS ciclos_publicados,
       SUM(Capacidad) AS capacidad_total,
       MIN(Precio) AS precio_min,
       MAX(Precio) AS precio_max
FROM Ciclo
WHERE IdAcademia = @id_academia AND EstadoRegistro = 1
GROUP BY UniversidadObjetivo
ORDER BY UniversidadObjetivo;

SELECT c.Nombre AS ciclo,
       c.UniversidadObjetivo,
       c.Turno,
       c.Horario,
       c.Precio,
       c.Capacidad,
       c.FechaInicio,
       c.FechaFin,
       (SELECT COUNT(*) FROM CicloCurso cc WHERE cc.IdCiclo = c.IdCiclo AND cc.EstadoRegistro = 1) AS cursos,
       (SELECT COUNT(*) FROM HorarioCurso h WHERE h.IdCiclo = c.IdCiclo AND h.EstadoRegistro = 1) AS horarios,
       (SELECT COUNT(*) FROM Matricula m WHERE m.IdCiclo = c.IdCiclo AND m.EstadoRegistro = 1) AS inscritos
FROM Ciclo c
WHERE c.IdAcademia = @id_academia
  AND c.Nombre LIKE 'Ciclo Regular %'
ORDER BY c.UniversidadObjetivo;
