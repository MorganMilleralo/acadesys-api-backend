-- HU-19: almacenamiento persistente de los PDF de materiales.
-- El disco de Render se borra en cada despliegue; MySQL (Aiven) no.
-- Ejecutar UNA vez en defaultdb ANTES de desplegar el backend que lo usa.
-- Solo crea una tabla nueva: no modifica ni borra datos existentes.

-- 1) Comprobación previa: debe devolver un valor >= 16777216 (16 MB).
SELECT @@max_allowed_packet AS max_allowed_packet;

-- 2) Tabla nueva (un PDF por material, máximo 10 MB lo valida la API).
CREATE TABLE IF NOT EXISTS MaterialArchivo (
  IdMaterial INT NOT NULL PRIMARY KEY,
  Contenido LONGBLOB NOT NULL,
  TamanoBytes INT UNSIGNED NOT NULL,
  Sha256 CHAR(64) NOT NULL,
  FechaCreacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_materialarchivo_material
    FOREIGN KEY (IdMaterial) REFERENCES MaterialAcademico (IdMaterial)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Verificación: debe listar la tabla vacía.
SELECT COUNT(*) AS PdfGuardados FROM MaterialArchivo;
