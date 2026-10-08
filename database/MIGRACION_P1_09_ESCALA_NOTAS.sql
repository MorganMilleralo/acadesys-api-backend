-- P1-09: Escala dinámica de calificaciones
-- Actualiza el esquema antiguo de Evaluacion para admitir
-- las escalas preuniversitarias manejadas por el backend.

ALTER TABLE Evaluacion
    MODIFY COLUMN Calificacion INT NOT NULL;

ALTER TABLE Evaluacion
    DROP CHECK CHK_Calificacion;

ALTER TABLE Evaluacion
    ADD CONSTRAINT CHK_Calificacion
    CHECK (Calificacion >= 0 AND Calificacion <= 2000);
