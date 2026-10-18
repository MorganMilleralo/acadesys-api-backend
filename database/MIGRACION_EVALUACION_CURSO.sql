
-- ACADESYS
-- Migracion: notas por curso y simulacros generales
-- IMPORTANTE: NO EJECUTAR EN PRODUCCION SIN RESPALDO.
-- PENDIENTE: este archivo NO ha sido ejecutado. Ver REVISION_NOTAS_ACTAS.md.
-- Solo agrega IdCurso; no resuelve Periodo, Auditoria_Cierres ni historicos.
-- Matricula.IdCurso es NULL en las matriculas actuales: NO usarlo para rellenar notas.

ALTER TABLE Evaluacion
    ADD COLUMN IdCurso INT NULL
        AFTER IdMatricula,

    ADD INDEX IX_Evaluacion_IdCurso (IdCurso),

    ADD CONSTRAINT FK_Evaluacion_Curso
        FOREIGN KEY (IdCurso)
        REFERENCES Curso(IdCurso)
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
