-- ============================================================
-- AcadeSys - Migración funcional Academia Preuniversitaria
-- Objetivo:
--   1) Un alumno ve SOLO su matrícula/ciclo activo.
--   2) Los ciclos tienen turno, horario, días y universidad objetivo.
--   3) Los cursos se vinculan a cada ciclo mediante CicloCurso.
--   4) Los materiales PDF se vinculan a ciclo + curso.
--   5) Se mantienen las cuentas existentes siempre que sea posible.
--
-- Ejecutar sobre la base de datos actual de AcadeSys.
-- NO elimina información.
-- NOTA: se evita ALTER TABLE ... ADD COLUMN IF NOT EXISTS por compatibilidad con esta instancia SQL.
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- ACADEMIA
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Academia (
  IdAcademia INT AUTO_INCREMENT PRIMARY KEY,
  NombreAcademia VARCHAR(150) NOT NULL,
  ColorTema VARCHAR(20) DEFAULT '#2563eb',
  LogoUrl VARCHAR(500) DEFAULT '',
  EstadoRegistro TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO Academia (IdAcademia, NombreAcademia, ColorTema, EstadoRegistro)
SELECT 1, 'AcadeSys Pre-U', '#2563eb', 1
WHERE NOT EXISTS (SELECT 1 FROM Academia WHERE IdAcademia = 1);

-- ------------------------------------------------------------
-- PERFIL
-- Compatible con las variantes existentes de AcadeSys:
-- algunas bases usan NombrePerfil y otras usan Nombre.
SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'perfil' AND COLUMN_NAME = 'Nombre'),
  'SELECT 1',
  'ALTER TABLE `perfil` ADD COLUMN `Nombre` VARCHAR(100) NULL'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'perfil' AND COLUMN_NAME = 'Descripcion'),
  'SELECT 1',
  'ALTER TABLE `perfil` ADD COLUMN `Descripcion` VARCHAR(255) NULL'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Si existe la columna histórica NombrePerfil, copiamos sus valores a Nombre
-- usando SQL dinámico para evitar errores cuando la columna no existe.
SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'perfil' AND COLUMN_NAME = 'NombrePerfil'),
  CONCAT(
    'UPDATE `perfil` SET `Nombre` = COALESCE(NULLIF(TRIM(`Nombre`), ', CHAR(39), CHAR(39), '), `NombrePerfil`) ',
    'WHERE (`Nombre` IS NULL OR TRIM(`Nombre`) = ', CHAR(39), CHAR(39), ') AND `NombrePerfil` IS NOT NULL'
  ),
  'SELECT 1'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO perfil (Nombre, Descripcion, EstadoRegistro)
SELECT 'Administrador',
       'Administración general, usuarios, ciclos y materiales.', 1
WHERE NOT EXISTS (
  SELECT 1 FROM perfil WHERE LOWER(TRIM(COALESCE(Nombre, ''))) = 'administrador'
);

INSERT INTO perfil (Nombre, Descripcion, EstadoRegistro)
SELECT 'Docente',
       'Control de asistencia y registro de evaluaciones.', 1
WHERE NOT EXISTS (
  SELECT 1 FROM perfil WHERE LOWER(TRIM(COALESCE(Nombre, ''))) = 'docente'
);

INSERT INTO perfil (Nombre, Descripcion, EstadoRegistro)
SELECT 'Tutor de Aula',
       'Seguimiento académico y administrativo de estudiantes.', 1
WHERE NOT EXISTS (
  SELECT 1 FROM perfil WHERE LOWER(TRIM(COALESCE(Nombre, ''))) = 'tutor de aula'
);

INSERT INTO perfil (Nombre, Descripcion, EstadoRegistro)
SELECT 'Alumno',
       'Acceso exclusivo al expediente, ciclo, horario, cursos, notas y materiales propios.', 1
WHERE NOT EXISTS (
  SELECT 1 FROM perfil WHERE LOWER(TRIM(COALESCE(Nombre, ''))) = 'alumno'
);

INSERT INTO perfil (Nombre, Descripcion, EstadoRegistro)
SELECT 'Recursos Humanos',
       'Acceso al portal administrativo para gestión institucional y de usuarios.', 1
WHERE NOT EXISTS (
  SELECT 1 FROM perfil WHERE LOWER(TRIM(COALESCE(Nombre, ''))) IN ('recursos humanos', 'rrhh')
);

-- ------------------------------------------------------------
-- USUARIO
-- ------------------------------------------------------------
SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Usuario' AND COLUMN_NAME = 'CodigoUsuario'),
  'SELECT 1',
  'ALTER TABLE `Usuario` ADD COLUMN `CodigoUsuario` VARCHAR(100) NULL'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Usuario' AND COLUMN_NAME = 'IdAcademia'),
  'SELECT 1',
  'ALTER TABLE `Usuario` ADD COLUMN `IdAcademia` INT NULL'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Se permite que el checkout cree alumnos sin DNI todavía.
ALTER TABLE Usuario MODIFY COLUMN DNI VARCHAR(8) NULL;

UPDATE Usuario
SET IdAcademia = 1
WHERE IdAcademia IS NULL;

UPDATE Usuario
SET CodigoUsuario = CONCAT('USR-', IdUsuario)
WHERE CodigoUsuario IS NULL OR TRIM(CodigoUsuario) = '';

-- ------------------------------------------------------------
-- CICLOS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Ciclo (
  IdCiclo INT AUTO_INCREMENT PRIMARY KEY,
  IdAcademia INT NOT NULL DEFAULT 1,
  Nombre VARCHAR(150) NOT NULL,
  PrefijoCodigo VARCHAR(30) DEFAULT 'ACAD',
  Turno VARCHAR(50) DEFAULT 'Mañana',
  Horario VARCHAR(100) DEFAULT '08:00 - 13:00',
  DiasClase VARCHAR(100) DEFAULT 'Lunes a Sábado',
  UniversidadObjetivo VARCHAR(50) DEFAULT 'Preuniversitario',
  FechaInicio DATE NULL,
  FechaFin DATE NULL,
  Capacidad INT DEFAULT 0,
  Precio DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  EstadoRegistro TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ciclo' AND COLUMN_NAME = 'PrefijoCodigo'),
  'SELECT 1',
  CONCAT('ALTER TABLE `Ciclo` ADD COLUMN `PrefijoCodigo` VARCHAR(30) DEFAULT ', CHAR(39), 'ACAD', CHAR(39))
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ciclo' AND COLUMN_NAME = 'Turno'),
  'SELECT 1',
  CONCAT('ALTER TABLE `Ciclo` ADD COLUMN `Turno` VARCHAR(50) DEFAULT ', CHAR(39), 'Mañana', CHAR(39))
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ciclo' AND COLUMN_NAME = 'Horario'),
  'SELECT 1',
  CONCAT('ALTER TABLE `Ciclo` ADD COLUMN `Horario` VARCHAR(100) DEFAULT ', CHAR(39), '08:00 - 13:00', CHAR(39))
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ciclo' AND COLUMN_NAME = 'DiasClase'),
  'SELECT 1',
  CONCAT('ALTER TABLE `Ciclo` ADD COLUMN `DiasClase` VARCHAR(100) DEFAULT ', CHAR(39), 'Lunes a Sábado', CHAR(39))
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ciclo' AND COLUMN_NAME = 'UniversidadObjetivo'),
  'SELECT 1',
  CONCAT('ALTER TABLE `Ciclo` ADD COLUMN `UniversidadObjetivo` VARCHAR(50) DEFAULT ', CHAR(39), 'Preuniversitario', CHAR(39))
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ciclo' AND COLUMN_NAME = 'FechaInicio'),
  'SELECT 1',
  'ALTER TABLE `Ciclo` ADD COLUMN `FechaInicio` DATE NULL'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ciclo' AND COLUMN_NAME = 'FechaFin'),
  'SELECT 1',
  'ALTER TABLE `Ciclo` ADD COLUMN `FechaFin` DATE NULL'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ciclo' AND COLUMN_NAME = 'Capacidad'),
  'SELECT 1',
  'ALTER TABLE `Ciclo` ADD COLUMN `Capacidad` INT DEFAULT 0'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ciclo' AND COLUMN_NAME = 'EstadoRegistro'),
  'SELECT 1',
  'ALTER TABLE `Ciclo` ADD COLUMN `EstadoRegistro` TINYINT NOT NULL DEFAULT 1'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Si ya existen ciclos pero dejaron Horario vacío, se completa según el turno.
UPDATE Ciclo
SET Turno = 'Tarde'
WHERE LOWER(Nombre) LIKE '%tarde%'
  AND (Turno IS NULL OR TRIM(Turno) = '' OR LOWER(Turno) = 'mañana');

UPDATE Ciclo
SET Turno = 'Noche'
WHERE LOWER(Nombre) LIKE '%noche%'
  AND (Turno IS NULL OR TRIM(Turno) = '' OR LOWER(Turno) = 'mañana');

UPDATE Ciclo
SET Turno = 'Mañana'
WHERE LOWER(Nombre) LIKE '%mañana%'
  AND (Turno IS NULL OR TRIM(Turno) = '');

UPDATE Ciclo
SET Horario = CASE
  WHEN LOWER(COALESCE(Turno, '')) LIKE '%mañana%'
       OR LOWER(COALESCE(Turno, '')) LIKE '%manana%'
    THEN '08:00 - 13:00'
  WHEN LOWER(COALESCE(Turno, '')) LIKE '%tarde%'
    THEN '14:00 - 19:00'
  WHEN LOWER(COALESCE(Turno, '')) LIKE '%noche%'
    THEN '18:00 - 22:00'
  ELSE '08:00 - 13:00'
END
WHERE Horario IS NULL
   OR TRIM(Horario) = ''
   OR (
     TRIM(Horario) = '08:00 - 13:00'
     AND (
       LOWER(COALESCE(Turno, '')) LIKE '%tarde%'
       OR LOWER(COALESCE(Turno, '')) LIKE '%noche%'
     )
   );

UPDATE Ciclo
SET DiasClase = 'Lunes a Sábado'
WHERE DiasClase IS NULL OR TRIM(DiasClase) = '';

UPDATE Ciclo
SET UniversidadObjetivo = 'UNMSM'
WHERE (UniversidadObjetivo IS NULL OR TRIM(UniversidadObjetivo) = '' OR UniversidadObjetivo = 'Preuniversitario')
  AND (
    LOWER(Nombre) LIKE '%san marcos%'
    OR LOWER(Nombre) LIKE '%unmsm%'
  );

UPDATE Ciclo
SET UniversidadObjetivo = 'UNI'
WHERE (UniversidadObjetivo IS NULL OR TRIM(UniversidadObjetivo) = '' OR UniversidadObjetivo = 'Preuniversitario')
  AND (
    LOWER(Nombre) LIKE '%uni%'
    OR LOWER(Nombre) LIKE '%ingenier%'
  );

UPDATE Ciclo
SET UniversidadObjetivo = 'PUCP'
WHERE (UniversidadObjetivo IS NULL OR TRIM(UniversidadObjetivo) = '' OR UniversidadObjetivo = 'Preuniversitario')
  AND (
    LOWER(Nombre) LIKE '%catolica%'
    OR LOWER(Nombre) LIKE '%católica%'
    OR LOWER(Nombre) LIKE '%pucp%'
  );

UPDATE Ciclo
SET UniversidadObjetivo = 'UNFV'
WHERE (UniversidadObjetivo IS NULL OR TRIM(UniversidadObjetivo) = '' OR UniversidadObjetivo = 'Preuniversitario')
  AND (
    LOWER(Nombre) LIKE '%villarreal%'
    OR LOWER(Nombre) LIKE '%unfv%'
  );

-- Ciclos base adicionales. No duplican los que ya existan por nombre.
INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, Turno, Horario, DiasClase, UniversidadObjetivo,
   FechaInicio, FechaFin, Capacidad, Precio, EstadoRegistro)
SELECT 1, 'Anual San Marcos 2026 - Mañana', 'SM-ANUAL', 'Mañana',
       '08:00 - 13:00', 'Lunes a Sábado', 'UNMSM',
       '2026-01-05', '2026-12-19', 500, 0.00, 1
WHERE NOT EXISTS (SELECT 1 FROM Ciclo WHERE Nombre = 'Anual San Marcos 2026 - Mañana');

INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, Turno, Horario, DiasClase, UniversidadObjetivo,
   FechaInicio, FechaFin, Capacidad, Precio, EstadoRegistro)
SELECT 1, 'Semestral San Marcos II 2026 - Tarde', 'SM-SEM2', 'Tarde',
       '14:00 - 19:00', 'Lunes a Sábado', 'UNMSM',
       '2026-07-01', '2026-12-19', 350, 0.00, 1
WHERE NOT EXISTS (SELECT 1 FROM Ciclo WHERE Nombre = 'Semestral San Marcos II 2026 - Tarde');

INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, Turno, Horario, DiasClase, UniversidadObjetivo,
   FechaInicio, FechaFin, Capacidad, Precio, EstadoRegistro)
SELECT 1, 'Ciclo Intensivo UNI 2026 - Mañana', 'UNI-INT', 'Mañana',
       '08:00 - 13:00', 'Lunes a Sábado', 'UNI',
       '2026-09-01', '2026-12-19', 300, 0.00, 1
WHERE NOT EXISTS (SELECT 1 FROM Ciclo WHERE Nombre = 'Ciclo Intensivo UNI 2026 - Mañana');

INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, Turno, Horario, DiasClase, UniversidadObjetivo,
   FechaInicio, FechaFin, Capacidad, Precio, EstadoRegistro)
SELECT 1, 'Anual UNI 2026 - Noche', 'UNI-ANUAL', 'Noche',
       '18:00 - 22:00', 'Lunes a Sábado', 'UNI',
       '2026-01-05', '2026-12-19', 400, 0.00, 1
WHERE NOT EXISTS (SELECT 1 FROM Ciclo WHERE Nombre = 'Anual UNI 2026 - Noche');

INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, Turno, Horario, DiasClase, UniversidadObjetivo,
   FechaInicio, FechaFin, Capacidad, Precio, EstadoRegistro)
SELECT 1, 'Repaso Villarreal 2026 - Tarde', 'FV-REP', 'Tarde',
       '14:00 - 19:00', 'Lunes a Sábado', 'UNFV',
       '2026-09-15', '2026-12-19', 250, 0.00, 1
WHERE NOT EXISTS (SELECT 1 FROM Ciclo WHERE Nombre = 'Repaso Villarreal 2026 - Tarde');

INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, Turno, Horario, DiasClase, UniversidadObjetivo,
   FechaInicio, FechaFin, Capacidad, Precio, EstadoRegistro)
SELECT 1, 'Semestral Villarreal 2026 - Noche', 'FV-SEM', 'Noche',
       '18:00 - 22:00', 'Lunes a Sábado', 'UNFV',
       '2026-07-01', '2026-12-19', 300, 0.00, 1
WHERE NOT EXISTS (SELECT 1 FROM Ciclo WHERE Nombre = 'Semestral Villarreal 2026 - Noche');

INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, Turno, Horario, DiasClase, UniversidadObjetivo,
   FechaInicio, FechaFin, Capacidad, Precio, EstadoRegistro)
SELECT 1, 'Ciclo Católica 2026 - Mañana', 'PUCP-MAN', 'Mañana',
       '08:00 - 13:00', 'Lunes a Sábado', 'PUCP',
       '2026-03-02', '2026-12-19', 250, 0.00, 1
WHERE NOT EXISTS (SELECT 1 FROM Ciclo WHERE Nombre = 'Ciclo Católica 2026 - Mañana');

INSERT INTO Ciclo
  (IdAcademia, Nombre, PrefijoCodigo, Turno, Horario, DiasClase, UniversidadObjetivo,
   FechaInicio, FechaFin, Capacidad, Precio, EstadoRegistro)
SELECT 1, 'Repaso Católica 2026 - Tarde', 'PUCP-REP', 'Tarde',
       '14:00 - 19:00', 'Lunes a Sábado', 'PUCP',
       '2026-09-15', '2026-12-19', 220, 0.00, 1
WHERE NOT EXISTS (SELECT 1 FROM Ciclo WHERE Nombre = 'Repaso Católica 2026 - Tarde');

-- ------------------------------------------------------------
-- CURSOS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Curso (
  IdCurso INT AUTO_INCREMENT PRIMARY KEY,
  Nombre VARCHAR(150) NOT NULL,
  Codigo VARCHAR(50) DEFAULT '',
  Descripcion VARCHAR(255) DEFAULT '',
  UniversidadObjetivo VARCHAR(50) DEFAULT 'Preuniversitario',
  EstadoRegistro TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Curso' AND COLUMN_NAME = 'Codigo'),
  'SELECT 1',
  CONCAT('ALTER TABLE `Curso` ADD COLUMN `Codigo` VARCHAR(50) DEFAULT ', CHAR(39), CHAR(39))
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Curso' AND COLUMN_NAME = 'Descripcion'),
  'SELECT 1',
  CONCAT('ALTER TABLE `Curso` ADD COLUMN `Descripcion` VARCHAR(255) DEFAULT ', CHAR(39), CHAR(39))
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Curso' AND COLUMN_NAME = 'UniversidadObjetivo'),
  'SELECT 1',
  CONCAT('ALTER TABLE `Curso` ADD COLUMN `UniversidadObjetivo` VARCHAR(50) DEFAULT ', CHAR(39), 'Preuniversitario', CHAR(39))
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Curso' AND COLUMN_NAME = 'EstadoRegistro'),
  'SELECT 1',
  'ALTER TABLE `Curso` ADD COLUMN `EstadoRegistro` TINYINT NOT NULL DEFAULT 1'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Cursos UNMSM
INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Habilidad Verbal', 'SM-HV', 'Comprensión y razonamiento verbal.', 'UNMSM', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Habilidad Verbal' AND UniversidadObjetivo = 'UNMSM');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Habilidad Lógico-Matemática', 'SM-HLM', 'Razonamiento lógico y resolución de problemas.', 'UNMSM', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Habilidad Lógico-Matemática' AND UniversidadObjetivo = 'UNMSM');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Aritmética', 'SM-ARI', 'Fundamentos aritméticos y problemas de admisión.', 'UNMSM', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Aritmética' AND UniversidadObjetivo = 'UNMSM');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Álgebra', 'SM-ALG', 'Ecuaciones, funciones y polinomios.', 'UNMSM', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Álgebra' AND UniversidadObjetivo = 'UNMSM');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Geometría', 'SM-GEO', 'Geometría plana y espacial.', 'UNMSM', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Geometría' AND UniversidadObjetivo = 'UNMSM');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Trigonometría', 'SM-TRI', 'Relaciones y funciones trigonométricas.', 'UNMSM', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Trigonometría' AND UniversidadObjetivo = 'UNMSM');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Física', 'SM-FIS', 'Mecánica, electricidad y física general.', 'UNMSM', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Física' AND UniversidadObjetivo = 'UNMSM');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Química', 'SM-QUI', 'Química general y fundamentos para admisión.', 'UNMSM', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Química' AND UniversidadObjetivo = 'UNMSM');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Historia del Perú y Universal', 'SM-HIS', 'Historia para preparación preuniversitaria.', 'UNMSM', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Historia del Perú y Universal' AND UniversidadObjetivo = 'UNMSM');

-- Cursos UNI
INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Razonamiento Matemático', 'UNI-RM', 'Problemas de aptitud y razonamiento matemático.', 'UNI', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Razonamiento Matemático' AND UniversidadObjetivo = 'UNI');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Álgebra', 'UNI-ALG', 'Álgebra para examen de admisión UNI.', 'UNI', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Álgebra' AND UniversidadObjetivo = 'UNI');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Aritmética', 'UNI-ARI', 'Aritmética y problemas de admisión UNI.', 'UNI', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Aritmética' AND UniversidadObjetivo = 'UNI');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Geometría', 'UNI-GEO', 'Geometría plana y del espacio.', 'UNI', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Geometría' AND UniversidadObjetivo = 'UNI');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Trigonometría', 'UNI-TRI', 'Trigonometría para examen de admisión UNI.', 'UNI', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Trigonometría' AND UniversidadObjetivo = 'UNI');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Física', 'UNI-FIS', 'Física orientada al examen de admisión.', 'UNI', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Física' AND UniversidadObjetivo = 'UNI');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Química', 'UNI-QUI', 'Química general y aplicada al examen UNI.', 'UNI', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Química' AND UniversidadObjetivo = 'UNI');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Razonamiento Verbal', 'UNI-RV', 'Comprensión y razonamiento verbal.', 'UNI', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Razonamiento Verbal' AND UniversidadObjetivo = 'UNI');

-- Cursos PUCP
INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Comprensión Lectora', 'PUCP-CL', 'Lectura y comprensión de textos.', 'PUCP', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Comprensión Lectora' AND UniversidadObjetivo = 'PUCP');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Comunicación', 'PUCP-COM', 'Lenguaje y comunicación.', 'PUCP', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Comunicación' AND UniversidadObjetivo = 'PUCP');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Matemática', 'PUCP-MAT', 'Matemática general para admisión.', 'PUCP', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Matemática' AND UniversidadObjetivo = 'PUCP');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Álgebra', 'PUCP-ALG', 'Álgebra y funciones.', 'PUCP', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Álgebra' AND UniversidadObjetivo = 'PUCP');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Geometría', 'PUCP-GEO', 'Geometría y razonamiento espacial.', 'PUCP', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Geometría' AND UniversidadObjetivo = 'PUCP');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Física', 'PUCP-FIS', 'Física para preparación universitaria.', 'PUCP', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Física' AND UniversidadObjetivo = 'PUCP');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Química', 'PUCP-QUI', 'Química general.', 'PUCP', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Química' AND UniversidadObjetivo = 'PUCP');

-- Cursos UNFV
INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Habilidad Verbal', 'FV-HV', 'Comprensión y razonamiento verbal.', 'UNFV', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Habilidad Verbal' AND UniversidadObjetivo = 'UNFV');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Razonamiento Matemático', 'FV-RM', 'Resolución de problemas de admisión.', 'UNFV', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Razonamiento Matemático' AND UniversidadObjetivo = 'UNFV');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Aritmética', 'FV-ARI', 'Aritmética para examen de admisión.', 'UNFV', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Aritmética' AND UniversidadObjetivo = 'UNFV');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Álgebra', 'FV-ALG', 'Álgebra y funciones.', 'UNFV', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Álgebra' AND UniversidadObjetivo = 'UNFV');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Geometría', 'FV-GEO', 'Geometría para admisión.', 'UNFV', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Geometría' AND UniversidadObjetivo = 'UNFV');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Historia', 'FV-HIS', 'Historia y cultura general.', 'UNFV', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Historia' AND UniversidadObjetivo = 'UNFV');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Física', 'FV-FIS', 'Física general.', 'UNFV', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Física' AND UniversidadObjetivo = 'UNFV');

INSERT INTO Curso (Nombre, Codigo, Descripcion, UniversidadObjetivo, EstadoRegistro)
SELECT 'Química', 'FV-QUI', 'Química general.', 'UNFV', 1
WHERE NOT EXISTS (SELECT 1 FROM Curso WHERE Nombre = 'Química' AND UniversidadObjetivo = 'UNFV');

-- ------------------------------------------------------------
-- MATRÍCULA / EVALUACIÓN / PAGOS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Matricula (
  IdMatricula INT AUTO_INCREMENT PRIMARY KEY,
  IdUsuario INT NOT NULL,
  IdCiclo INT NOT NULL,
  IdCurso INT NULL,
  FechaMatricula DATETIME DEFAULT CURRENT_TIMESTAMP,
  EstadoRegistro TINYINT NOT NULL DEFAULT 1,
  INDEX idx_matricula_usuario (IdUsuario),
  INDEX idx_matricula_ciclo (IdCiclo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Matricula' AND COLUMN_NAME = 'IdCurso'),
  'SELECT 1',
  'ALTER TABLE `Matricula` ADD COLUMN `IdCurso` INT NULL'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Matricula' AND COLUMN_NAME = 'FechaMatricula'),
  'SELECT 1',
  'ALTER TABLE `Matricula` ADD COLUMN `FechaMatricula` DATETIME NULL'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE Matricula
SET FechaMatricula = COALESCE(FechaMatricula, CURRENT_TIMESTAMP)
WHERE FechaMatricula IS NULL;

CREATE TABLE IF NOT EXISTS Evaluacion (
  IdEvaluacion INT AUTO_INCREMENT PRIMARY KEY,
  IdMatricula INT NOT NULL,
  TipoEvaluacion VARCHAR(100) NOT NULL,
  Calificacion DECIMAL(6,2) NOT NULL DEFAULT 0,
  UsuarioCreacion INT NULL,
  UsuarioModificacion INT NULL,
  FechaCreacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FechaModificacion DATETIME NULL,
  EstadoRegistro TINYINT NOT NULL DEFAULT 1,
  INDEX idx_eval_matricula (IdMatricula)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS PagosMensualidad (
  IdPago INT AUTO_INCREMENT PRIMARY KEY,
  IdUsuario INT NOT NULL,
  IdCiclo INT NOT NULL,
  Mes VARCHAR(50) NOT NULL,
  Monto DECIMAL(10,2) NOT NULL DEFAULT 0,
  Estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
  FechaPago DATETIME NULL,
  EstadoRegistro TINYINT NOT NULL DEFAULT 1,
  INDEX idx_pago_ciclo_usuario (IdCiclo, IdUsuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- RELACIÓN CICLO - CURSO
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS CicloCurso (
  IdCiclo INT NOT NULL,
  IdCurso INT NOT NULL,
  Orden INT NOT NULL DEFAULT 1,
  EstadoRegistro TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (IdCiclo, IdCurso),
  INDEX idx_ciclocurso_curso (IdCurso)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ciclos UNMSM
INSERT INTO CicloCurso (IdCiclo, IdCurso, Orden, EstadoRegistro)
SELECT c.IdCiclo, cu.IdCurso, ROW_NUMBER() OVER (PARTITION BY c.IdCiclo ORDER BY cu.IdCurso), 1
FROM Ciclo c
INNER JOIN Curso cu
  ON cu.UniversidadObjetivo = 'UNMSM'
WHERE c.EstadoRegistro = 1
  AND (
    c.UniversidadObjetivo = 'UNMSM'
    OR LOWER(c.Nombre) LIKE '%san marcos%'
    OR LOWER(c.Nombre) LIKE '%unmsm%'
  )
  AND cu.EstadoRegistro = 1
  AND NOT EXISTS (
    SELECT 1 FROM CicloCurso cc
    WHERE cc.IdCiclo = c.IdCiclo AND cc.IdCurso = cu.IdCurso
  );

-- Ciclos UNI
INSERT INTO CicloCurso (IdCiclo, IdCurso, Orden, EstadoRegistro)
SELECT c.IdCiclo, cu.IdCurso, ROW_NUMBER() OVER (PARTITION BY c.IdCiclo ORDER BY cu.IdCurso), 1
FROM Ciclo c
INNER JOIN Curso cu
  ON cu.UniversidadObjetivo = 'UNI'
WHERE c.EstadoRegistro = 1
  AND (
    c.UniversidadObjetivo = 'UNI'
    OR LOWER(c.Nombre) LIKE '%uni%'
  )
  AND cu.EstadoRegistro = 1
  AND NOT EXISTS (
    SELECT 1 FROM CicloCurso cc
    WHERE cc.IdCiclo = c.IdCiclo AND cc.IdCurso = cu.IdCurso
  );

-- Ciclos PUCP
INSERT INTO CicloCurso (IdCiclo, IdCurso, Orden, EstadoRegistro)
SELECT c.IdCiclo, cu.IdCurso, ROW_NUMBER() OVER (PARTITION BY c.IdCiclo ORDER BY cu.IdCurso), 1
FROM Ciclo c
INNER JOIN Curso cu
  ON cu.UniversidadObjetivo = 'PUCP'
WHERE c.EstadoRegistro = 1
  AND (
    c.UniversidadObjetivo = 'PUCP'
    OR LOWER(c.Nombre) LIKE '%catolica%'
    OR LOWER(c.Nombre) LIKE '%católica%'
    OR LOWER(c.Nombre) LIKE '%pucp%'
  )
  AND cu.EstadoRegistro = 1
  AND NOT EXISTS (
    SELECT 1 FROM CicloCurso cc
    WHERE cc.IdCiclo = c.IdCiclo AND cc.IdCurso = cu.IdCurso
  );

-- Ciclos UNFV
INSERT INTO CicloCurso (IdCiclo, IdCurso, Orden, EstadoRegistro)
SELECT c.IdCiclo, cu.IdCurso, ROW_NUMBER() OVER (PARTITION BY c.IdCiclo ORDER BY cu.IdCurso), 1
FROM Ciclo c
INNER JOIN Curso cu
  ON cu.UniversidadObjetivo = 'UNFV'
WHERE c.EstadoRegistro = 1
  AND (
    c.UniversidadObjetivo = 'UNFV'
    OR LOWER(c.Nombre) LIKE '%villarreal%'
    OR LOWER(c.Nombre) LIKE '%unfv%'
  )
  AND cu.EstadoRegistro = 1
  AND NOT EXISTS (
    SELECT 1 FROM CicloCurso cc
    WHERE cc.IdCiclo = c.IdCiclo AND cc.IdCurso = cu.IdCurso
  );

-- ------------------------------------------------------------
-- HORARIO DETALLADO OPCIONAL
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS HorarioCurso (
  IdHorario INT AUTO_INCREMENT PRIMARY KEY,
  IdCiclo INT NOT NULL,
  IdCurso INT NOT NULL,
  DiaNumero TINYINT NOT NULL DEFAULT 1,
  DiaSemana VARCHAR(30) NOT NULL,
  HoraInicio TIME NOT NULL,
  HoraFin TIME NOT NULL,
  Docente VARCHAR(150) DEFAULT 'Por asignar',
  Orden INT NOT NULL DEFAULT 1,
  EstadoRegistro TINYINT NOT NULL DEFAULT 1,
  INDEX idx_horario_ciclo (IdCiclo),
  INDEX idx_horario_curso (IdCurso)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Programación referencial de horarios por ciclo-curso.
-- Evita que el alumno vea "por definir" y deja una agenda básica
-- incluso antes de que la academia realice la asignación docente definitiva.
-- Se usan dos bloques por día: la cantidad de cursos se reparte entre
-- lunes y sábado de acuerdo con el orden del plan del ciclo.
INSERT INTO HorarioCurso
  (IdCiclo, IdCurso, DiaNumero, DiaSemana, HoraInicio, HoraFin, Docente, Orden, EstadoRegistro)
SELECT
  x.IdCiclo,
  x.IdCurso,
  MOD(FLOOR((x.rn - 1) / 2), 6) + 1 AS DiaNumero,
  CASE MOD(FLOOR((x.rn - 1) / 2), 6)
    WHEN 0 THEN 'Lunes'
    WHEN 1 THEN 'Martes'
    WHEN 2 THEN 'Miércoles'
    WHEN 3 THEN 'Jueves'
    WHEN 4 THEN 'Viernes'
    ELSE 'Sábado'
  END AS DiaSemana,
  CASE MOD(x.rn - 1, 2)
    WHEN 0 THEN CASE
      WHEN LOWER(COALESCE(x.Turno, '')) LIKE '%tarde%' THEN '14:00:00'
      WHEN LOWER(COALESCE(x.Turno, '')) LIKE '%noche%' THEN '18:00:00'
      ELSE '08:00:00'
    END
    ELSE CASE
      WHEN LOWER(COALESCE(x.Turno, '')) LIKE '%tarde%' THEN '16:15:00'
      WHEN LOWER(COALESCE(x.Turno, '')) LIKE '%noche%' THEN '20:15:00'
      ELSE '10:15:00'
    END
  END AS HoraInicio,
  CASE MOD(x.rn - 1, 2)
    WHEN 0 THEN CASE
      WHEN LOWER(COALESCE(x.Turno, '')) LIKE '%tarde%' THEN '16:00:00'
      WHEN LOWER(COALESCE(x.Turno, '')) LIKE '%noche%' THEN '20:00:00'
      ELSE '10:00:00'
    END
    ELSE CASE
      WHEN LOWER(COALESCE(x.Turno, '')) LIKE '%tarde%' THEN '18:15:00'
      WHEN LOWER(COALESCE(x.Turno, '')) LIKE '%noche%' THEN '22:00:00'
      ELSE '12:15:00'
    END
  END AS HoraFin,
  'Por asignar' AS Docente,
  x.rn AS Orden,
  1 AS EstadoRegistro
FROM (
  SELECT
    cc.IdCiclo,
    cc.IdCurso,
    c.Turno,
    ROW_NUMBER() OVER (PARTITION BY cc.IdCiclo ORDER BY cc.Orden, cc.IdCurso) AS rn
  FROM CicloCurso cc
  INNER JOIN Ciclo c ON c.IdCiclo = cc.IdCiclo
  WHERE cc.EstadoRegistro = 1
) x
WHERE NOT EXISTS (
  SELECT 1 FROM HorarioCurso h
  WHERE h.IdCiclo = x.IdCiclo AND h.IdCurso = x.IdCurso AND h.EstadoRegistro = 1
);

-- ------------------------------------------------------------
-- MATERIALES PDF
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS MaterialAcademico (
  IdMaterial INT AUTO_INCREMENT PRIMARY KEY,
  IdCiclo INT NOT NULL,
  IdCurso INT NOT NULL,
  Titulo VARCHAR(200) NOT NULL,
  Descripcion VARCHAR(500) DEFAULT '',
  NombreArchivo VARCHAR(255) NOT NULL,
  UrlArchivo VARCHAR(600) NOT NULL,
  TipoMime VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  IdUsuarioCreacion INT NULL,
  FechaPublicacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  EstadoRegistro TINYINT NOT NULL DEFAULT 1,
  INDEX idx_material_ciclo (IdCiclo),
  INDEX idx_material_curso (IdCurso)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- REVISIÓN RÁPIDA
-- ------------------------------------------------------------
SELECT 'MIGRACIÓN COMPLETADA' AS Resultado;
SELECT IdCiclo, Nombre, UniversidadObjetivo, Turno, Horario, DiasClase, Capacidad
FROM Ciclo
WHERE EstadoRegistro = 1
ORDER BY IdCiclo;

SELECT c.Nombre AS Ciclo, COUNT(cc.IdCurso) AS CursosVinculados
FROM Ciclo c
LEFT JOIN CicloCurso cc ON cc.IdCiclo = c.IdCiclo AND cc.EstadoRegistro = 1
WHERE c.EstadoRegistro = 1
GROUP BY c.IdCiclo, c.Nombre
ORDER BY c.IdCiclo;
