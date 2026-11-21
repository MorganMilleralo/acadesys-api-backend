-- API de integración de clientes (alumnos) para aplicativos externos.
-- Ejecutar UNA vez en defaultdb. Solo crea tablas nuevas: no modifica datos.
-- Después ejecutar database/procedimientos/integracion.sql.

-- Aplicativos autorizados. La clave nunca se guarda: solo su SHA-256.
CREATE TABLE IF NOT EXISTS IntegracionConsumidor (
  IdConsumidor INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  IdAcademia INT NOT NULL,
  Nombre VARCHAR(100) NOT NULL,
  Prefijo VARCHAR(16) NOT NULL,
  ClaveHash CHAR(64) NOT NULL,
  LimitePorMinuto SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  Activo TINYINT NOT NULL DEFAULT 1,
  UsuarioCreacion INT NULL,
  FechaCreacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FechaRevocacion DATETIME NULL,
  UltimoUso DATETIME NULL,
  UNIQUE KEY UX_IntegracionConsumidor_Clave (ClaveHash),
  KEY IX_IntegracionConsumidor_Academia (IdAcademia, Activo),
  CONSTRAINT FK_IntegracionConsumidor_Academia FOREIGN KEY (IdAcademia) REFERENCES Academia (IdAcademia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Qué versión de cada cliente confirmó haber guardado cada aplicativo.
-- Evita que una sincronización repetida entregue duplicados.
CREATE TABLE IF NOT EXISTS IntegracionEntrega (
  IdConsumidor INT NOT NULL,
  IdUsuario INT NOT NULL,
  Version CHAR(64) NOT NULL,
  FechaPrimeraConfirmacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FechaConfirmacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Confirmaciones INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (IdConsumidor, IdUsuario),
  CONSTRAINT FK_IntegracionEntrega_Consumidor FOREIGN KEY (IdConsumidor) REFERENCES IntegracionConsumidor (IdConsumidor),
  CONSTRAINT FK_IntegracionEntrega_Usuario FOREIGN KEY (IdUsuario) REFERENCES Usuario (IdUsuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Bitácora de cada solicitud recibida (también las rechazadas).
CREATE TABLE IF NOT EXISTS IntegracionAuditoria (
  IdAuditoria BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  IdConsumidor INT NULL,
  IdSolicitud CHAR(36) NOT NULL,
  Metodo VARCHAR(10) NOT NULL,
  Ruta VARCHAR(200) NOT NULL,
  EstadoHttp SMALLINT UNSIGNED NOT NULL,
  Codigo VARCHAR(60) NULL,
  Registros INT UNSIGNED NOT NULL DEFAULT 0,
  Ip VARCHAR(45) NULL,
  DuracionMs INT UNSIGNED NULL,
  FechaCreacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY IX_IntegracionAuditoria_Consumidor (IdConsumidor, FechaCreacion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SELECT 'Tablas de integración creadas' AS Resultado;
