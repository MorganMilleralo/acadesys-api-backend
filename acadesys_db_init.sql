-- ==================================================
-- BASE DE DATOS: ACADESYS
-- Script de Inicialización y Estructura
-- ==================================================

-- 1. TABLA: Perfil
CREATE TABLE IF NOT EXISTS Perfil (
    IdPerfil INT AUTO_INCREMENT PRIMARY KEY,
    NombrePerfil VARCHAR(100) NOT NULL,
    EstadoRegistro TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. TABLA: Usuario
CREATE TABLE IF NOT EXISTS Usuario (
    IdUsuario INT AUTO_INCREMENT PRIMARY KEY,
    DNI VARCHAR(8) NOT NULL UNIQUE,
    Nombres VARCHAR(100) NOT NULL,
    ApellidoPaterno VARCHAR(100) NOT NULL,
    ApellidoMaterno VARCHAR(100) DEFAULT '',
    Celular VARCHAR(20) DEFAULT '',
    CorreoElectronico VARCHAR(150) NOT NULL UNIQUE,
    Clave VARCHAR(255) NOT NULL,
    UsuarioCreacion VARCHAR(100) DEFAULT 'sistema',
    FechaCreacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    EstadoRegistro TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. TABLA INTERMEDIA: Usuario_Perfiles
CREATE TABLE IF NOT EXISTS Usuario_Perfiles (
    IdUsuarioPerfil INT AUTO_INCREMENT PRIMARY KEY,
    IdUsuario INT NOT NULL,
    IdPerfil INT NOT NULL,
    EstadoRegistro TINYINT NOT NULL DEFAULT 1,
    CONSTRAINT FK_UsuarioPerfiles_Usuario 
        FOREIGN KEY (IdUsuario) REFERENCES Usuario(IdUsuario) ON DELETE CASCADE,
    CONSTRAINT FK_UsuarioPerfiles_Perfil 
        FOREIGN KEY (IdPerfil) REFERENCES Perfil(IdPerfil) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. TABLA: OpcionesMenu
CREATE TABLE IF NOT EXISTS OpcionesMenu (
    IdOpcionMenu INT AUTO_INCREMENT PRIMARY KEY,
    Nombre VARCHAR(100) NOT NULL,
    UrlMenu VARCHAR(255) DEFAULT '',
    Descripcion VARCHAR(255) DEFAULT '',
    IdPadre INT NULL,
    EstadoRegistro TINYINT NOT NULL DEFAULT 1,
    CONSTRAINT FK_OpcionesMenu_Padre 
        FOREIGN KEY (IdPadre) REFERENCES OpcionesMenu(IdOpcionMenu) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. TABLA INTERMEDIA: OpcionesMenu_Perfiles
CREATE TABLE IF NOT EXISTS OpcionesMenu_Perfiles (
    IdMenuPerfil INT AUTO_INCREMENT PRIMARY KEY,
    IdOpcionMenu INT NOT NULL,
    IdPerfil INT NOT NULL,
    Orden INT DEFAULT 1,
    EstadoRegistro TINYINT NOT NULL DEFAULT 1,
    CONSTRAINT FK_MenuPerfiles_Menu 
        FOREIGN KEY (IdOpcionMenu) REFERENCES OpcionesMenu(IdOpcionMenu) ON DELETE CASCADE,
    CONSTRAINT FK_MenuPerfiles_Perfil 
        FOREIGN KEY (IdPerfil) REFERENCES Perfil(IdPerfil) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ==================================================
-- DATOS INICIALES (SEED DATA)
-- ==================================================

-- Perfiles institucionales base
INSERT INTO Perfil (IdPerfil, NombrePerfil, EstadoRegistro) VALUES
(1, 'Administrador', 1),
(2, 'Docente', 1),
(3, 'Alumno', 1),
(4, 'Padre de Familia', 1)
ON DUPLICATE KEY UPDATE NombrePerfil = VALUES(NombrePerfil);

-- Opciones de menú iniciales
INSERT INTO OpcionesMenu (IdOpcionMenu, Nombre, UrlMenu, Descripcion, IdPadre, EstadoRegistro) VALUES
(1, 'Dashboard', '/dashboard', 'Panel general', NULL, 1),
(2, 'Asistencia', '/asistencia', 'Registro y control diario', NULL, 1),
(3, 'Registrar Notas', '/registro-notas', 'Evaluaciones por curso', NULL, 1),
(4, 'Comunicados', '/comunicados', 'Avisos institucionales', NULL, 1),
(5, 'Académico', '/academico', 'Aulas y mallas curriculares', NULL, 1),
(6, 'Calificaciones', '/calificaciones', 'Boleta y rendimiento', NULL, 1),
(7, 'Tutor IA', '/tutor-ia', 'Diagnóstico pedagógico', NULL, 1),
(8, 'Perfiles', '/perfiles', 'Gestión de roles', NULL, 1),
(9, 'Usuarios', '/usuarios', 'Directorio institucional', NULL, 1)
ON DUPLICATE KEY UPDATE Nombre = VALUES(Nombre);

-- Usuario administrador inicial por defecto
-- DNI: 00000001 | Correo: admin@acadesys.edu | Clave: Admin123
INSERT INTO Usuario (IdUsuario, DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, UsuarioCreacion, EstadoRegistro)
VALUES (1, '00000001', 'Admin', 'AcadeSys', 'Principal', '999999999', 'admin@acadesys.edu', 'Admin123', 'sistema', 1)
ON DUPLICATE KEY UPDATE CorreoElectronico = VALUES(CorreoElectronico);

-- Asignación de rol Administrador (1) al Usuario (1)
INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro)
VALUES (1, 1, 1)
ON DUPLICATE KEY UPDATE EstadoRegistro = VALUES(EstadoRegistro);