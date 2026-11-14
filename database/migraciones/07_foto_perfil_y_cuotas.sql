-- 14/11/2026. Ejecutar en defaultdb ANTES de desplegar el backend de fotos.
-- No borra datos. Cada bloque se puede volver a ejecutar sin problema
-- salvo el ALTER del índice único (si ya existe, MySQL avisa y no cambia nada).

-- 1) Fotos de perfil en MySQL (el disco de Render se borra en cada despliegue).
CREATE TABLE IF NOT EXISTS defaultdb.FotoPerfil (
  NombreArchivo VARCHAR(120) NOT NULL PRIMARY KEY,
  IdUsuario INT NOT NULL,
  Contenido MEDIUMBLOB NOT NULL,
  TipoMime VARCHAR(20) NOT NULL,
  TamanoBytes INT UNSIGNED NOT NULL,
  FechaCreacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_fotoperfil_usuario (IdUsuario),
  CONSTRAINT fk_fotoperfil_usuario FOREIGN KEY (IdUsuario)
    REFERENCES defaultdb.Usuario (IdUsuario) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) PagosMensualidad: estado por defecto 'Pendiente'.
ALTER TABLE defaultdb.PagosMensualidad ALTER COLUMN Estado SET DEFAULT 'Pendiente';

-- 3) PagosMensualidad: una sola cuota ACTIVA por alumno, ciclo y mes.
--    Debe devolver 0 filas; si devuelve algo, NO ejecutar el paso 3b.
SELECT IdUsuario, IdCiclo, Mes, COUNT(*) AS Repetidas
FROM defaultdb.PagosMensualidad
WHERE EstadoRegistro = 1
GROUP BY IdUsuario, IdCiclo, Mes
HAVING COUNT(*) > 1;

-- 3b) Columna auxiliar: vale 1 solo en cuotas activas y NULL en anuladas,
--     así las cuotas anuladas no bloquean volver a generar la del mismo mes.
ALTER TABLE defaultdb.PagosMensualidad
  ADD COLUMN CuotaActiva TINYINT GENERATED ALWAYS AS (IF(EstadoRegistro = 1, 1, NULL)) VIRTUAL,
  ADD UNIQUE KEY UX_PagosMensualidad_Activa (IdUsuario, IdCiclo, Mes, CuotaActiva);

-- 4) Capacidad: el sistema solo acepta 1–120 (por defecto 100).
--    0 se trataba como "sin límite"; 250 queda fuera del máximo.
--    Todos los ciclos tienen 13 alumnos o menos, así que nadie queda fuera.
UPDATE defaultdb.Ciclo SET Capacidad = 100 WHERE Capacidad = 0 OR Capacidad IS NULL;
UPDATE defaultdb.Ciclo SET Capacidad = 120 WHERE Capacidad > 120;

-- 5) Verificación
SELECT IdCiclo, Nombre, Capacidad FROM defaultdb.Ciclo ORDER BY IdCiclo;
SHOW INDEX FROM defaultdb.PagosMensualidad WHERE Key_name = 'UX_PagosMensualidad_Activa';
SELECT COUNT(*) AS fotos_guardadas FROM defaultdb.FotoPerfil;
