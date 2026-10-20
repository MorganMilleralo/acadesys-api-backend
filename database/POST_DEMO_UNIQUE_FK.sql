-- =============================================================================
-- POST-DEMO: unicidad y claves foráneas (NO EJECUTAR sobre la BD viva)
-- =============================================================================
-- Motivo
-- ------
-- La aplicación ya impide duplicados en código (bloqueos + comprobaciones con
-- SELECT ... FOR UPDATE), pero sin restricciones en la base de datos la
-- concurrencia o un script externo pueden seguir creando duplicados.
--
-- Este script SOLO se aplica en staging, con backup verificado y ventana de
-- mantenimiento. Antes de aplicarlo hay que:
--
--   1. Respaldar la base de datos (dump completo verificado).
--   2. Auditar duplicados existentes (correo, DNI, Evaluacion, HorarioCurso).
--   3. Limpiar los duplicados manualmente, con aprobación del responsable.
--   4. Probar en una copia restaurada de staging.
--   5. Aplicar en producción dentro de la ventana de mantenimiento.
--
-- En este repositorio NO se ha ejecutado. La aplicación funciona sin él.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Auditoría previa (solo lectura). Ejecutar y revisar el resultado antes de
--    continuar. Si hay filas, detenerse: primero hay que limpiar duplicados.
-- -----------------------------------------------------------------------------
SELECT 'Usuario: correo duplicado' AS Auditoria, LOWER(TRIM(CorreoElectronico)) AS Clave, COUNT(*) AS Filas
  FROM Usuario GROUP BY LOWER(TRIM(CorreoElectronico)) HAVING COUNT(*) > 1;

SELECT 'Usuario: DNI duplicado' AS Auditoria, DNI AS Clave, COUNT(*) AS Filas
  FROM Usuario WHERE DNI IS NOT NULL AND TRIM(DNI) <> '' GROUP BY DNI HAVING COUNT(*) > 1;

SELECT 'Usuario: código duplicado' AS Auditoria, CodigoUsuario AS Clave, COUNT(*) AS Filas
  FROM Usuario GROUP BY CodigoUsuario HAVING COUNT(*) > 1;

SELECT 'Evaluacion: misma matricula/periodo/tipo' AS Auditoria,
       IdMatricula, Periodo, TipoEvaluacion, COUNT(*) AS Filas
  FROM Evaluacion WHERE EstadoRegistro IN (1, 2)
  GROUP BY IdMatricula, Periodo, TipoEvaluacion HAVING COUNT(*) > 1;

SELECT 'HorarioCurso: mismo ciclo/curso/dia/hora' AS Auditoria,
       IdCiclo, IdCurso, DiaNumero, HoraInicio, HoraFin, COUNT(*) AS Filas
  FROM HorarioCurso WHERE EstadoRegistro = 1
  GROUP BY IdCiclo, IdCurso, DiaNumero, HoraInicio, HoraFin HAVING COUNT(*) > 1;

-- -----------------------------------------------------------------------------
-- 1. Unicidad de identidad de usuario.
--    LOWER(TRIM(...)) no admite UNIQUE sobre columna directamente en MySQL:
--    se usan columnas generadas (MySQL 5.7+).
-- -----------------------------------------------------------------------------
ALTER TABLE Usuario
  ADD COLUMN IdentidadCorreo VARCHAR(150)
    GENERATED ALWAYS AS (LOWER(TRIM(CorreoElectronico))) STORED,
  ADD COLUMN IdentidadDni VARCHAR(8)
    GENERATED ALWAYS AS (NULLIF(TRIM(DNI), '')) STORED;

CREATE UNIQUE INDEX UX_Usuario_Correo ON Usuario (IdentidadCorreo);
CREATE UNIQUE INDEX UX_Usuario_Dni ON Usuario (IdentidadDni);
CREATE UNIQUE INDEX UX_Usuario_Codigo ON Usuario (CodigoUsuario);

-- -----------------------------------------------------------------------------
-- 2. Unicidad de evaluación: una nota por alumno/periodo/tipo.
--    Se incluye EstadoRegistro para permitir el histórico de notas cerradas
--    (EstadoRegistro = 2) y la baja lógica (-1) sin colisionar.
-- -----------------------------------------------------------------------------
ALTER TABLE Evaluacion
  ADD UNIQUE INDEX UX_Evaluacion_Alumno_Periodo_Tipo (IdMatricula, Periodo, TipoEvaluacion, EstadoRegistro);

-- -----------------------------------------------------------------------------
-- 3. Unicidad de horario: mismo ciclo/curso/día y franja.
-- -----------------------------------------------------------------------------
ALTER TABLE HorarioCurso
  ADD UNIQUE INDEX UX_HorarioCurso_Ciclo_Curso_Dia_Hora (IdCiclo, IdCurso, DiaNumero, HoraInicio, HoraFin);

-- -----------------------------------------------------------------------------
-- 4. Claves foráneas. Se añaden solo las que no existe información huérfana.
--    Verificar con las consultas de huérfanos antes de aplicarlas.
-- -----------------------------------------------------------------------------
-- SELECT 'Matricula huérfana' AS Caso, COUNT(*) FROM Matricula m
--   LEFT JOIN Usuario u ON u.IdUsuario = m.IdUsuario WHERE u.IdUsuario IS NULL;
-- SELECT 'Evaluacion huérfana' AS Caso, COUNT(*) FROM Evaluacion e
--   LEFT JOIN Matricula m ON m.IdMatricula = e.IdMatricula WHERE m.IdMatricula IS NULL;
-- SELECT 'HorarioCurso huérfano' AS Caso, COUNT(*) FROM HorarioCurso h
--   LEFT JOIN Ciclo c ON c.IdCiclo = h.IdCiclo WHERE c.IdCiclo IS NULL;

-- ALTER TABLE Matricula
--   ADD CONSTRAINT FK_Matricula_Usuario FOREIGN KEY (IdUsuario) REFERENCES Usuario (IdUsuario),
--   ADD CONSTRAINT FK_Matricula_Ciclo FOREIGN KEY (IdCiclo) REFERENCES Ciclo (IdCiclo);

-- ALTER TABLE Evaluacion
--   ADD CONSTRAINT FK_Evaluacion_Matricula FOREIGN KEY (IdMatricula) REFERENCES Matricula (IdMatricula);

-- ALTER TABLE HorarioCurso
--   ADD CONSTRAINT FK_HorarioCurso_Ciclo FOREIGN KEY (IdCiclo) REFERENCES Ciclo (IdCiclo),
--   ADD CONSTRAINT FK_HorarioCurso_Curso FOREIGN KEY (IdCurso) REFERENCES Curso (IdCurso);
