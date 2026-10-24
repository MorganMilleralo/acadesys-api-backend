-- ============================================================================
-- SEED DEMO · CATÁLOGO DE CICLOS POR UNIVERSIDAD (AcadeSys)  ·  v2 CORREGIDO
-- ============================================================================
-- ESTADO: PREPARADO — NO EJECUTADO EN PRODUCCIÓN.
--
-- Entorno detectado: MySQL remoto Aiven (acadesys-mysql-morgan-a82b.l.aivencloud.com)
-- servido por el backend desplegado en Render (https://acadesys-api.onrender.com).
-- Esa base es la de PRODUCCIÓN: no existe staging ni base local configurada.
-- Por ese motivo este script NO se ha ejecutado. Queda listo para revisión y
-- aprobación explícita.
--
-- v2 — CORRECCIÓN (por qué cambia respecto a la versión anterior):
--   La versión anterior reutilizaba los 17 cursos de San Marcos (SM-*) para
--   los ciclos de UNALM, UPCH, ULIMA, UPC, USMP y UTP. Eso CONTRADICE el
--   modelo real de datos:
--     * `Curso.UniversidadObjetivo` es el campo estructurado que declara la
--       universidad de cada curso (única relación Universidad ↔ Curso del
--       esquema; no existen tablas de Plan/Malla/Universidad).
--     * Un curso SM-* tiene UniversidadObjetivo = 'UNMSM': vincularlo a un
--       ciclo de otra universidad crea la mezcla de oferta que se observó en
--       el paso 4 del wizard (Álgebra SM-ALG + UNAC-ALG + FV-ALG...) y ahora
--       además es rechazada por el backend al guardar ciclos (código
--       CICLO_CURSOS_UNIVERSIDAD: "Uno o más cursos no corresponden a la
--       universidad seleccionada.").
--   Esta versión crea, para cada universidad demo, SU PROPIO catálogo de
--   cursos demo (códigos <SIGLA>-*) con UniversidadObjetivo = <SIGLA> y
--   vincula cada ciclo únicamente a los cursos de su universidad.
--
-- OBJETIVO
--   Ampliar el catálogo público de ciclos (vitrina de la Landing) con ciclos
--   demo de seis universidades que hoy no tienen ninguna oferta publicada:
--   UNALM, UPCH, ULIMA, UPC, USMP y UTP.
--
-- MODELO REAL (verificado con SHOW CREATE / INFORMATION_SCHEMA, sin asumir):
--   - No existe tabla `Universidad`: la universidad es el campo de texto
--     `Ciclo.UniversidadObjetivo` (VARCHAR(50)) y el campo
--     `Curso.UniversidadObjetivo` (VARCHAR(50)) en el catálogo de cursos.
--     La COHERENCIA de la relación es por IGUALDAD de ambos campos.
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
--   3. NO modifica cursos existentes: se crean SOLO cursos nuevos demo
--      (códigos UNALM-*, UPCH-*, ULIMA-*, UPC-*, USMP-*, UTP-*), nunca
--      reutilizando SM-*, UNI-* o el plan de otra universidad.
--   4. No crea tablas, columnas, índices ni constraints.
--   5. Es IDEMPOTENTE: se puede ejecutar N veces y nunca duplica ciclos,
--      cursos ni horarios (guardas `NOT EXISTS` + variables de control por
--      Código del curso).
--   6. Fechas relativas a CURDATE(): los ciclos demo siempre quedan vigentes
--      sin importar cuándo se ejecute el script.
--
-- 7. TODOS LOS DATOS SON DE DEMOSTRACION (catalogo demo de AcadeSys):
--      - PRECIOS: tarifas internas de demostracion de la academia.
--        NO son tarifas oficiales de ninguna universidad.
--      - TURNOS, HORARIOS Y DIAS: propuesta interna de la academia.
--      - CURSOS: cada universidad demo recibe un plan de PREPARACION DEMO
--        ACADESYS (17 materias con codigos <SIGLA>-*). SON cursos de
--        preparacion de la academia para esa universidad objetivo; NO son la
--        malla curricular oficial de UNALM, UPCH, ULIMA, UPC, USMP ni UTP.
--      - INSCRITOS: 0. El contador lo calcula el backend desde Matricula.
--
-- CÓMO EJECUTAR (solo tras autorización explícita)
--   mysql --default-character-set=utf8mb4 -h <host> -P <puerto> -u <user> -p <db> \
--         < SEED_CICLOS_DEMO_UNIVERSIDADES.sql
--
-- CÓMO DESHACER (si se aplicó y se quiere revertir; baja lógica, sin borrar):
--   UPDATE Ciclo SET EstadoRegistro = 0
--    WHERE Nombre IN ('Ciclo Regular Agraria La Molina',
--                     'Ciclo Regular Cayetano Heredia',
--                     'Ciclo Regular Universidad de Lima',
--                     'Ciclo Regular Ciencias Aplicadas',
--                     'Ciclo Regular San Martin de Porres',
--                     'Ciclo Regular Tecnologica del Peru');
--   UPDATE Curso SET EstadoRegistro = 0
--    WHERE Codigo LIKE 'UNALM-%' OR Codigo LIKE 'UPCH-%' OR Codigo LIKE 'ULIMA-%'
--       OR Codigo LIKE 'UPC-%' OR Codigo LIKE 'USMP-%' OR Codigo LIKE 'UTP-%';
--    (solo si esos cursos demo no quedaron vinculados a ciclos activos)
-- ============================================================================

SET @id_academia := 1;
SET @desc_demo := 'Curso de preparación DEMO de AcadeSys. No representa la malla curricular oficial de la universidad.';

-- ---------------------------------------------------------------------------
-- 1) UNALM · Universidad Nacional Agraria La Molina
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan de preparación DEMO ACADESYS para UNALM (códigos UNALM-*).
--    NO es la malla curricular oficial de UNALM.
-- ---------------------------------------------------------------------------
INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT t.Nombre, t.Codigo, @desc_demo, 'UNALM', 1
FROM (
  SELECT 'Habilidad Verbal' AS Nombre, 'UNALM-HV' AS Codigo, 1 AS orden UNION ALL
  SELECT 'Habilidad Lógico-Matemática', 'UNALM-HLM', 2 UNION ALL
  SELECT 'Aritmética', 'UNALM-ARI', 3 UNION ALL
  SELECT 'Álgebra', 'UNALM-ALG', 4 UNION ALL
  SELECT 'Geometría', 'UNALM-GEO', 5 UNION ALL
  SELECT 'Trigonometría', 'UNALM-TRI', 6 UNION ALL
  SELECT 'Física', 'UNALM-FIS', 7 UNION ALL
  SELECT 'Química', 'UNALM-QUI', 8 UNION ALL
  SELECT 'Historia del Perú y Universal', 'UNALM-HIS', 9 UNION ALL
  SELECT 'Lenguaje', 'UNALM-LEN', 10 UNION ALL
  SELECT 'Literatura', 'UNALM-LIT', 11 UNION ALL
  SELECT 'Biología', 'UNALM-BIO', 12 UNION ALL
  SELECT 'Geografía', 'UNALM-GGR', 13 UNION ALL
  SELECT 'Economía', 'UNALM-ECO', 14 UNION ALL
  SELECT 'Filosofía', 'UNALM-FIL', 15 UNION ALL
  SELECT 'Psicología', 'UNALM-PSI', 16 UNION ALL
  SELECT 'Educación Cívica', 'UNALM-EDC', 17
) t
WHERE NOT EXISTS (SELECT 1 FROM Curso cu WHERE cu.Codigo = t.Codigo);

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
SELECT @id_ciclo, cu.IdCurso, t.orden, 1
FROM (
  SELECT 'UNALM-HV' AS codigo, 1 AS orden UNION ALL
  SELECT 'UNALM-HLM', 2 UNION ALL
  SELECT 'UNALM-ARI', 3 UNION ALL
  SELECT 'UNALM-ALG', 4 UNION ALL
  SELECT 'UNALM-GEO', 5 UNION ALL
  SELECT 'UNALM-TRI', 6 UNION ALL
  SELECT 'UNALM-FIS', 7 UNION ALL
  SELECT 'UNALM-QUI', 8 UNION ALL
  SELECT 'UNALM-HIS', 9 UNION ALL
  SELECT 'UNALM-LEN', 10 UNION ALL
  SELECT 'UNALM-LIT', 11 UNION ALL
  SELECT 'UNALM-BIO', 12 UNION ALL
  SELECT 'UNALM-GGR', 13 UNION ALL
  SELECT 'UNALM-ECO', 14 UNION ALL
  SELECT 'UNALM-FIL', 15 UNION ALL
  SELECT 'UNALM-PSI', 16 UNION ALL
  SELECT 'UNALM-EDC', 17
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'UNALM'
WHERE @cursos_existentes = 0;

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, cu.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 'UNALM-HV' AS codigo, 1 AS dia, 'Lunes' AS dia_semana, '08:00' AS hora_inicio, '10:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 'UNALM-HLM', 2, 'Martes', '08:00', '10:00', 2 UNION ALL
  SELECT 'UNALM-ARI', 3, 'Miércoles', '08:00', '10:00', 3 UNION ALL
  SELECT 'UNALM-ALG', 4, 'Jueves', '08:00', '10:00', 4 UNION ALL
  SELECT 'UNALM-GEO', 5, 'Viernes', '08:00', '10:00', 5 UNION ALL
  SELECT 'UNALM-TRI', 6, 'Sábado', '10:00', '12:00', 6
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'UNALM'
WHERE @horarios_existentes = 0;

-- ---------------------------------------------------------------------------
-- 2) UPCH · Universidad Peruana Cayetano Heredia
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan de preparación DEMO ACADESYS para UPCH (códigos UPCH-*).
--    NO es la malla curricular oficial de UPCH.
-- ---------------------------------------------------------------------------
INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT t.Nombre, t.Codigo, @desc_demo, 'UPCH', 1
FROM (
  SELECT 'Habilidad Verbal' AS Nombre, 'UPCH-HV' AS Codigo, 1 AS orden UNION ALL
  SELECT 'Habilidad Lógico-Matemática', 'UPCH-HLM', 2 UNION ALL
  SELECT 'Aritmética', 'UPCH-ARI', 3 UNION ALL
  SELECT 'Álgebra', 'UPCH-ALG', 4 UNION ALL
  SELECT 'Geometría', 'UPCH-GEO', 5 UNION ALL
  SELECT 'Trigonometría', 'UPCH-TRI', 6 UNION ALL
  SELECT 'Física', 'UPCH-FIS', 7 UNION ALL
  SELECT 'Química', 'UPCH-QUI', 8 UNION ALL
  SELECT 'Historia del Perú y Universal', 'UPCH-HIS', 9 UNION ALL
  SELECT 'Lenguaje', 'UPCH-LEN', 10 UNION ALL
  SELECT 'Literatura', 'UPCH-LIT', 11 UNION ALL
  SELECT 'Biología', 'UPCH-BIO', 12 UNION ALL
  SELECT 'Geografía', 'UPCH-GGR', 13 UNION ALL
  SELECT 'Economía', 'UPCH-ECO', 14 UNION ALL
  SELECT 'Filosofía', 'UPCH-FIL', 15 UNION ALL
  SELECT 'Psicología', 'UPCH-PSI', 16 UNION ALL
  SELECT 'Educación Cívica', 'UPCH-EDC', 17
) t
WHERE NOT EXISTS (SELECT 1 FROM Curso cu WHERE cu.Codigo = t.Codigo);

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
SELECT @id_ciclo, cu.IdCurso, t.orden, 1
FROM (
  SELECT 'UPCH-HV' AS codigo, 1 AS orden UNION ALL
  SELECT 'UPCH-HLM', 2 UNION ALL
  SELECT 'UPCH-ARI', 3 UNION ALL
  SELECT 'UPCH-ALG', 4 UNION ALL
  SELECT 'UPCH-GEO', 5 UNION ALL
  SELECT 'UPCH-TRI', 6 UNION ALL
  SELECT 'UPCH-FIS', 7 UNION ALL
  SELECT 'UPCH-QUI', 8 UNION ALL
  SELECT 'UPCH-HIS', 9 UNION ALL
  SELECT 'UPCH-LEN', 10 UNION ALL
  SELECT 'UPCH-LIT', 11 UNION ALL
  SELECT 'UPCH-BIO', 12 UNION ALL
  SELECT 'UPCH-GGR', 13 UNION ALL
  SELECT 'UPCH-ECO', 14 UNION ALL
  SELECT 'UPCH-FIL', 15 UNION ALL
  SELECT 'UPCH-PSI', 16 UNION ALL
  SELECT 'UPCH-EDC', 17
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'UPCH'
WHERE @cursos_existentes = 0;

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, cu.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 'UPCH-HV' AS codigo, 1 AS dia, 'Lunes' AS dia_semana, '08:00' AS hora_inicio, '10:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 'UPCH-HLM', 2, 'Martes', '08:00', '10:00', 2 UNION ALL
  SELECT 'UPCH-ARI', 3, 'Miércoles', '10:15', '12:15', 3 UNION ALL
  SELECT 'UPCH-ALG', 4, 'Jueves', '08:00', '10:00', 4 UNION ALL
  SELECT 'UPCH-GEO', 5, 'Viernes', '10:15', '12:15', 5 UNION ALL
  SELECT 'UPCH-TRI', 6, 'Sábado', '08:00', '10:00', 6
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'UPCH'
WHERE @horarios_existentes = 0;

-- ---------------------------------------------------------------------------
-- 3) ULIMA · Universidad de Lima
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan de preparación DEMO ACADESYS para ULIMA (códigos ULIMA-*).
--    NO es la malla curricular oficial de ULIMA.
-- ---------------------------------------------------------------------------
INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT t.Nombre, t.Codigo, @desc_demo, 'ULIMA', 1
FROM (
  SELECT 'Habilidad Verbal' AS Nombre, 'ULIMA-HV' AS Codigo, 1 AS orden UNION ALL
  SELECT 'Habilidad Lógico-Matemática', 'ULIMA-HLM', 2 UNION ALL
  SELECT 'Aritmética', 'ULIMA-ARI', 3 UNION ALL
  SELECT 'Álgebra', 'ULIMA-ALG', 4 UNION ALL
  SELECT 'Geometría', 'ULIMA-GEO', 5 UNION ALL
  SELECT 'Trigonometría', 'ULIMA-TRI', 6 UNION ALL
  SELECT 'Física', 'ULIMA-FIS', 7 UNION ALL
  SELECT 'Química', 'ULIMA-QUI', 8 UNION ALL
  SELECT 'Historia del Perú y Universal', 'ULIMA-HIS', 9 UNION ALL
  SELECT 'Lenguaje', 'ULIMA-LEN', 10 UNION ALL
  SELECT 'Literatura', 'ULIMA-LIT', 11 UNION ALL
  SELECT 'Biología', 'ULIMA-BIO', 12 UNION ALL
  SELECT 'Geografía', 'ULIMA-GGR', 13 UNION ALL
  SELECT 'Economía', 'ULIMA-ECO', 14 UNION ALL
  SELECT 'Filosofía', 'ULIMA-FIL', 15 UNION ALL
  SELECT 'Psicología', 'ULIMA-PSI', 16 UNION ALL
  SELECT 'Educación Cívica', 'ULIMA-EDC', 17
) t
WHERE NOT EXISTS (SELECT 1 FROM Curso cu WHERE cu.Codigo = t.Codigo);

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
SELECT @id_ciclo, cu.IdCurso, t.orden, 1
FROM (
  SELECT 'ULIMA-HV' AS codigo, 1 AS orden UNION ALL
  SELECT 'ULIMA-HLM', 2 UNION ALL
  SELECT 'ULIMA-ARI', 3 UNION ALL
  SELECT 'ULIMA-ALG', 4 UNION ALL
  SELECT 'ULIMA-GEO', 5 UNION ALL
  SELECT 'ULIMA-TRI', 6 UNION ALL
  SELECT 'ULIMA-FIS', 7 UNION ALL
  SELECT 'ULIMA-QUI', 8 UNION ALL
  SELECT 'ULIMA-HIS', 9 UNION ALL
  SELECT 'ULIMA-LEN', 10 UNION ALL
  SELECT 'ULIMA-LIT', 11 UNION ALL
  SELECT 'ULIMA-BIO', 12 UNION ALL
  SELECT 'ULIMA-GGR', 13 UNION ALL
  SELECT 'ULIMA-ECO', 14 UNION ALL
  SELECT 'ULIMA-FIL', 15 UNION ALL
  SELECT 'ULIMA-PSI', 16 UNION ALL
  SELECT 'ULIMA-EDC', 17
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'ULIMA'
WHERE @cursos_existentes = 0;

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, cu.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 'ULIMA-HV' AS codigo, 1 AS dia, 'Lunes' AS dia_semana, '14:00' AS hora_inicio, '16:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 'ULIMA-HLM', 2, 'Martes', '14:00', '16:00', 2 UNION ALL
  SELECT 'ULIMA-ARI', 3, 'Miércoles', '16:15', '18:15', 3 UNION ALL
  SELECT 'ULIMA-ALG', 4, 'Jueves', '14:00', '16:00', 4 UNION ALL
  SELECT 'ULIMA-GEO', 5, 'Viernes', '16:15', '18:15', 5 UNION ALL
  SELECT 'ULIMA-TRI', 6, 'Sábado', '14:00', '16:00', 6
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'ULIMA'
WHERE @horarios_existentes = 0;

-- ---------------------------------------------------------------------------
-- 4) UPC · Universidad Peruana de Ciencias Aplicadas
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan de preparación DEMO ACADESYS para UPC (códigos UPC-*).
--    NO es la malla curricular oficial de UPC.
-- ---------------------------------------------------------------------------
INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT t.Nombre, t.Codigo, @desc_demo, 'UPC', 1
FROM (
  SELECT 'Habilidad Verbal' AS Nombre, 'UPC-HV' AS Codigo, 1 AS orden UNION ALL
  SELECT 'Habilidad Lógico-Matemática', 'UPC-HLM', 2 UNION ALL
  SELECT 'Aritmética', 'UPC-ARI', 3 UNION ALL
  SELECT 'Álgebra', 'UPC-ALG', 4 UNION ALL
  SELECT 'Geometría', 'UPC-GEO', 5 UNION ALL
  SELECT 'Trigonometría', 'UPC-TRI', 6 UNION ALL
  SELECT 'Física', 'UPC-FIS', 7 UNION ALL
  SELECT 'Química', 'UPC-QUI', 8 UNION ALL
  SELECT 'Historia del Perú y Universal', 'UPC-HIS', 9 UNION ALL
  SELECT 'Lenguaje', 'UPC-LEN', 10 UNION ALL
  SELECT 'Literatura', 'UPC-LIT', 11 UNION ALL
  SELECT 'Biología', 'UPC-BIO', 12 UNION ALL
  SELECT 'Geografía', 'UPC-GGR', 13 UNION ALL
  SELECT 'Economía', 'UPC-ECO', 14 UNION ALL
  SELECT 'Filosofía', 'UPC-FIL', 15 UNION ALL
  SELECT 'Psicología', 'UPC-PSI', 16 UNION ALL
  SELECT 'Educación Cívica', 'UPC-EDC', 17
) t
WHERE NOT EXISTS (SELECT 1 FROM Curso cu WHERE cu.Codigo = t.Codigo);

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
SELECT @id_ciclo, cu.IdCurso, t.orden, 1
FROM (
  SELECT 'UPC-HV' AS codigo, 1 AS orden UNION ALL
  SELECT 'UPC-HLM', 2 UNION ALL
  SELECT 'UPC-ARI', 3 UNION ALL
  SELECT 'UPC-ALG', 4 UNION ALL
  SELECT 'UPC-GEO', 5 UNION ALL
  SELECT 'UPC-TRI', 6 UNION ALL
  SELECT 'UPC-FIS', 7 UNION ALL
  SELECT 'UPC-QUI', 8 UNION ALL
  SELECT 'UPC-HIS', 9 UNION ALL
  SELECT 'UPC-LEN', 10 UNION ALL
  SELECT 'UPC-LIT', 11 UNION ALL
  SELECT 'UPC-BIO', 12 UNION ALL
  SELECT 'UPC-GGR', 13 UNION ALL
  SELECT 'UPC-ECO', 14 UNION ALL
  SELECT 'UPC-FIL', 15 UNION ALL
  SELECT 'UPC-PSI', 16 UNION ALL
  SELECT 'UPC-EDC', 17
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'UPC'
WHERE @cursos_existentes = 0;

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, cu.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 'UPC-HV' AS codigo, 1 AS dia, 'Lunes' AS dia_semana, '14:00' AS hora_inicio, '16:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 'UPC-HLM', 2, 'Martes', '16:15', '18:15', 2 UNION ALL
  SELECT 'UPC-ARI', 3, 'Miércoles', '14:00', '16:00', 3 UNION ALL
  SELECT 'UPC-ALG', 4, 'Jueves', '16:15', '18:15', 4 UNION ALL
  SELECT 'UPC-GEO', 5, 'Viernes', '14:00', '16:00', 5 UNION ALL
  SELECT 'UPC-TRI', 6, 'Sábado', '14:00', '16:00', 6
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'UPC'
WHERE @horarios_existentes = 0;

-- ---------------------------------------------------------------------------
-- 5) USMP · Universidad de San Martin de Porres
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan de preparación DEMO ACADESYS para USMP (códigos USMP-*).
--    NO es la malla curricular oficial de USMP.
-- ---------------------------------------------------------------------------
INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT t.Nombre, t.Codigo, @desc_demo, 'USMP', 1
FROM (
  SELECT 'Habilidad Verbal' AS Nombre, 'USMP-HV' AS Codigo, 1 AS orden UNION ALL
  SELECT 'Habilidad Lógico-Matemática', 'USMP-HLM', 2 UNION ALL
  SELECT 'Aritmética', 'USMP-ARI', 3 UNION ALL
  SELECT 'Álgebra', 'USMP-ALG', 4 UNION ALL
  SELECT 'Geometría', 'USMP-GEO', 5 UNION ALL
  SELECT 'Trigonometría', 'USMP-TRI', 6 UNION ALL
  SELECT 'Física', 'USMP-FIS', 7 UNION ALL
  SELECT 'Química', 'USMP-QUI', 8 UNION ALL
  SELECT 'Historia del Perú y Universal', 'USMP-HIS', 9 UNION ALL
  SELECT 'Lenguaje', 'USMP-LEN', 10 UNION ALL
  SELECT 'Literatura', 'USMP-LIT', 11 UNION ALL
  SELECT 'Biología', 'USMP-BIO', 12 UNION ALL
  SELECT 'Geografía', 'USMP-GGR', 13 UNION ALL
  SELECT 'Economía', 'USMP-ECO', 14 UNION ALL
  SELECT 'Filosofía', 'USMP-FIL', 15 UNION ALL
  SELECT 'Psicología', 'USMP-PSI', 16 UNION ALL
  SELECT 'Educación Cívica', 'USMP-EDC', 17
) t
WHERE NOT EXISTS (SELECT 1 FROM Curso cu WHERE cu.Codigo = t.Codigo);

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
SELECT @id_ciclo, cu.IdCurso, t.orden, 1
FROM (
  SELECT 'USMP-HV' AS codigo, 1 AS orden UNION ALL
  SELECT 'USMP-HLM', 2 UNION ALL
  SELECT 'USMP-ARI', 3 UNION ALL
  SELECT 'USMP-ALG', 4 UNION ALL
  SELECT 'USMP-GEO', 5 UNION ALL
  SELECT 'USMP-TRI', 6 UNION ALL
  SELECT 'USMP-FIS', 7 UNION ALL
  SELECT 'USMP-QUI', 8 UNION ALL
  SELECT 'USMP-HIS', 9 UNION ALL
  SELECT 'USMP-LEN', 10 UNION ALL
  SELECT 'USMP-LIT', 11 UNION ALL
  SELECT 'USMP-BIO', 12 UNION ALL
  SELECT 'USMP-GGR', 13 UNION ALL
  SELECT 'USMP-ECO', 14 UNION ALL
  SELECT 'USMP-FIL', 15 UNION ALL
  SELECT 'USMP-PSI', 16 UNION ALL
  SELECT 'USMP-EDC', 17
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'USMP'
WHERE @cursos_existentes = 0;

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, cu.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 'USMP-HV' AS codigo, 1 AS dia, 'Lunes' AS dia_semana, '08:00' AS hora_inicio, '10:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 'USMP-HLM', 2, 'Martes', '10:15', '12:15', 2 UNION ALL
  SELECT 'USMP-ARI', 3, 'Miércoles', '08:00', '10:00', 3 UNION ALL
  SELECT 'USMP-ALG', 4, 'Jueves', '10:15', '12:15', 4 UNION ALL
  SELECT 'USMP-GEO', 5, 'Viernes', '08:00', '10:00', 5 UNION ALL
  SELECT 'USMP-TRI', 6, 'Sábado', '10:15', '12:15', 6
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'USMP'
WHERE @horarios_existentes = 0;

-- ---------------------------------------------------------------------------
-- 6) UTP · Universidad Tecnologica del Peru
--    DATOS DEMO ACADESYS: precio, turno, horario y dias son propuesta
--    interna de la academia (NO son tarifas oficiales de la universidad).
--    Cursos: plan de preparación DEMO ACADESYS para UTP (códigos UTP-*).
--    NO es la malla curricular oficial de UTP.
-- ---------------------------------------------------------------------------
INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT t.Nombre, t.Codigo, @desc_demo, 'UTP', 1
FROM (
  SELECT 'Habilidad Verbal' AS Nombre, 'UTP-HV' AS Codigo, 1 AS orden UNION ALL
  SELECT 'Habilidad Lógico-Matemática', 'UTP-HLM', 2 UNION ALL
  SELECT 'Aritmética', 'UTP-ARI', 3 UNION ALL
  SELECT 'Álgebra', 'UTP-ALG', 4 UNION ALL
  SELECT 'Geometría', 'UTP-GEO', 5 UNION ALL
  SELECT 'Trigonometría', 'UTP-TRI', 6 UNION ALL
  SELECT 'Física', 'UTP-FIS', 7 UNION ALL
  SELECT 'Química', 'UTP-QUI', 8 UNION ALL
  SELECT 'Historia del Perú y Universal', 'UTP-HIS', 9 UNION ALL
  SELECT 'Lenguaje', 'UTP-LEN', 10 UNION ALL
  SELECT 'Literatura', 'UTP-LIT', 11 UNION ALL
  SELECT 'Biología', 'UTP-BIO', 12 UNION ALL
  SELECT 'Geografía', 'UTP-GGR', 13 UNION ALL
  SELECT 'Economía', 'UTP-ECO', 14 UNION ALL
  SELECT 'Filosofía', 'UTP-FIL', 15 UNION ALL
  SELECT 'Psicología', 'UTP-PSI', 16 UNION ALL
  SELECT 'Educación Cívica', 'UTP-EDC', 17
) t
WHERE NOT EXISTS (SELECT 1 FROM Curso cu WHERE cu.Codigo = t.Codigo);

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
SELECT @id_ciclo, cu.IdCurso, t.orden, 1
FROM (
  SELECT 'UTP-HV' AS codigo, 1 AS orden UNION ALL
  SELECT 'UTP-HLM', 2 UNION ALL
  SELECT 'UTP-ARI', 3 UNION ALL
  SELECT 'UTP-ALG', 4 UNION ALL
  SELECT 'UTP-GEO', 5 UNION ALL
  SELECT 'UTP-TRI', 6 UNION ALL
  SELECT 'UTP-FIS', 7 UNION ALL
  SELECT 'UTP-QUI', 8 UNION ALL
  SELECT 'UTP-HIS', 9 UNION ALL
  SELECT 'UTP-LEN', 10 UNION ALL
  SELECT 'UTP-LIT', 11 UNION ALL
  SELECT 'UTP-BIO', 12 UNION ALL
  SELECT 'UTP-GGR', 13 UNION ALL
  SELECT 'UTP-ECO', 14 UNION ALL
  SELECT 'UTP-FIL', 15 UNION ALL
  SELECT 'UTP-PSI', 16 UNION ALL
  SELECT 'UTP-EDC', 17
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'UTP'
WHERE @cursos_existentes = 0;

SET @horarios_existentes := (SELECT COUNT(*) FROM HorarioCurso WHERE IdCiclo = @id_ciclo);

INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Orden, EstadoRegistro)
SELECT @id_ciclo, cu.IdCurso, t.dia, t.dia_semana, t.hora_inicio, t.hora_fin, t.orden, 1
FROM (
  SELECT 'UTP-HV' AS codigo, 1 AS dia, 'Lunes' AS dia_semana, '18:00' AS hora_inicio, '20:00' AS hora_fin, 1 AS orden UNION ALL
  SELECT 'UTP-HLM', 2, 'Martes', '20:15', '22:00', 2 UNION ALL
  SELECT 'UTP-ARI', 3, 'Miércoles', '18:00', '20:00', 3 UNION ALL
  SELECT 'UTP-ALG', 4, 'Jueves', '20:15', '22:00', 4 UNION ALL
  SELECT 'UTP-GEO', 5, 'Viernes', '18:00', '20:00', 5 UNION ALL
  SELECT 'UTP-TRI', 6, 'Sábado', '18:00', '20:00', 6
) t
INNER JOIN Curso cu ON cu.Codigo = t.codigo AND cu.EstadoRegistro = 1 AND cu.UniversidadObjetivo = 'UTP'
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

-- CHEQUEO DE COHERENCIA Universidad ↔ Curso (esperado: 0 filas).
-- Si el seed respetó el modelo (cada ciclo solo con cursos de SU universidad
-- objetivo), ninguna relación Ciclo-Curso debe estar cruzada.
SELECT c.IdCiclo, c.Nombre AS ciclo, c.UniversidadObjetivo AS uniCiclo,
       cu.Codigo, cu.Nombre AS curso, cu.UniversidadObjetivo AS uniCurso
FROM Ciclo c
INNER JOIN CicloCurso cc ON cc.IdCiclo = c.IdCiclo AND cc.EstadoRegistro = 1
INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
WHERE c.Nombre LIKE 'Ciclo Regular %'
  AND c.UniversidadObjetivo <> cu.UniversidadObjetivo;
