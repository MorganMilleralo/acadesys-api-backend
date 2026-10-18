# Notas y actas: contrato pendiente de integrar con MySQL

Estado: **ninguna migración ejecutada**. `defaultdb` en Aiven es producción.
No se ha conectado con esa base ni se han usado datos reales. No hay un entorno
aislado de integración configurado en este trabajo.

## Requisitos de esquema

La migración `MIGRACION_EVALUACION_CURSO.sql` agrega únicamente `Evaluacion.IdCurso`,
su índice y su FK a `Curso`. No es idempotente: ejecutarla dos veces falla.
No debe ejecutarse como parte del arranque o de las pruebas.

| Tabla | Contrato que usa el backend |
| --- | --- |
| Evaluacion | IdEvaluacion, IdMatricula, **IdCurso nullable**, **Periodo**, TipoEvaluacion, Calificacion entera, EstadoRegistro, UsuarioCreacion/Modificacion, FechaCreacion/Modificacion |
| Auditoria_Cierres | IdCierre, IdAdministrador, **IdCiclo**, **IdCurso nullable**, **Periodo**, **TipoEvaluacion**, **RegistrosAfectados**, FechaCierre |
| Matricula | IdMatricula, IdUsuario, IdCiclo, EstadoRegistro. Su IdCurso actual NULL no identifica cursos evaluados. |
| CicloCurso | Relación activa IdCiclo–IdCurso. El curso también debe estar activo. |
| Usuario_Perfiles | IdUsuarioPerfil como identificador de fila, IdUsuario, IdPerfil, EstadoRegistro. La API mantiene un solo perfil activo por usuario. |

Los SQL de inicialización disponibles no crean `Evaluacion.Periodo` ni
`Auditoria_Cierres`. Tampoco documentan completamente `Asignacion_Aula` y
`Asistencia`. No se puede afirmar que estos elementos falten en producción:
su esquema no se ha consultado.

`VERIFICACION_ESQUEMA_ACADEMICO.sql` contiene exclusivamente consultas de metadatos,
preparadas y no ejecutadas. Con un esquema confirmado se debe preparar el ALTER
exacto y ensayarlo en una base aislada con datos ficticios. Verificar también
`Perfil` frente a `perfil`: el script inicial y las rutas usan distinta capitalización.

## Preparación de SQL complementario, aún no ejecutable como migración definitiva

Para una instalación nueva o una tabla sin periodo, la propuesta inicial es:

```sql
ALTER TABLE Evaluacion ADD COLUMN Periodo VARCHAR(50) NULL;
```

El NULL inicial evita atribuir un periodo inventado a datos históricos. Primero
clasificar los registros con información comprobable, luego decidir si corresponde
NOT NULL. No usar un DEFAULT 'General' para reclasificar automáticamente el pasado.

Si `Auditoria_Cierres` no existe, este es el contrato propuesto (revisar tipos de FK,
collations, versión MySQL y convenciones de auditoría antes de convertirlo en DDL):

```sql
CREATE TABLE Auditoria_Cierres (
  IdCierre INT AUTO_INCREMENT PRIMARY KEY,
  IdAdministrador INT NOT NULL,
  IdCiclo INT NOT NULL,
  IdCurso INT NULL,
  CursoAlcance INT GENERATED ALWAYS AS (COALESCE(IdCurso, 0)) STORED,
  Periodo VARCHAR(50) NOT NULL,
  TipoEvaluacion VARCHAR(100) NOT NULL,
  RegistrosAfectados INT NOT NULL,
  FechaCierre DATETIME NOT NULL,
  UNIQUE KEY UQ_Cierre_Alcance (IdCiclo, CursoAlcance, Periodo, TipoEvaluacion),
  FOREIGN KEY (IdAdministrador) REFERENCES Usuario(IdUsuario),
  FOREIGN KEY (IdCiclo) REFERENCES Ciclo(IdCiclo),
  FOREIGN KEY (IdCurso) REFERENCES Curso(IdCurso)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Si ya existe, preservar todas sus filas y adaptar mediante ALTER según el esquema
real. No recrearla. `IdAdministrador` registra tanto Administrador como RRHH.
El valor 0 de `CursoAlcance` se reserva para simulacros generales; confirmar que los
identificadores reales de curso sean positivos. Un UNIQUE con IdCurso nullable
directamente no impediría duplicados de simulacros NULL.

Revisar índices de Evaluacion por matrícula/curso/periodo/tipo/estado y de Matricula
por ciclo antes de añadirlos. Revisar FKs y CHECK existentes: el script de escala
anterior presupone que `CHK_Calificacion` ya existe. No ejecutarlo a ciegas.

## Históricos y cierre

- Curso: `Evaluacion.IdCurso` válido y tipo de evaluación de curso.
- Simulacro general: IdCurso NULL y TipoEvaluacion = Simulacro.
- Otro registro sin curso: pendiente de clasificación, visible en historial pero
  excluido de promedios y bloqueado para edición. No completar desde Matricula.IdCurso.
- Un periodo histórico NULL tampoco permite editar. No reasignarlo a General.
- Estado 2 sigue visible y no permite edición. La auditoría impide inserciones
  nuevas en el mismo alcance, incluso si alguna evaluación queda en estado 1.
- POST notas, PUT nota y cierre bloquean primero el ciclo antes de la lectura
  definitiva del cierre. Requiere InnoDB y pruebas de concurrencia reales.
- El alcance actual incluye **ciclo + curso/general + periodo + tipo**. Cerrar
  Practica no cierra Examen. Confirmar con Morgan si el cierre debe abarcar todos
  los tipos; no se ha cambiado esa regla existente sin una decisión funcional.
- El cierre sin evaluaciones abiertas devuelve 409 y no registra auditoría.
- Confirmar el tratamiento de notas de matrículas inactivas al cerrar: hoy el
  cierre afecta solo matrículas activas, pero la auditoría bloquea futuras ediciones.

## Decisiones pendientes de Morgan

1. Confirmar la escala provisional **0–20 entera** para cursos y las escalas de
   simulacros existentes. Universidad desconocida bloquea la escritura del simulacro.
2. Definir relación verificable alumno–aula y alcance docente/tutor. Asignacion_Aula
   relaciona personal, ciclo, curso y aula; no prueba qué alumnos pertenecen al aula.
3. Confirmar alcance del cierre por tipo, periodos admitidos, reapertura y política
   de múltiples evaluaciones/reintentos dentro del mismo periodo.
4. Determinar cómo clasificar históricos sin curso/periodo y qué ranking usar entre
   simulacros de fechas diferentes. El ranking actual sigue siendo provisional.
5. Coordinar con React los estados bloqueados de asistencia y los valores null para
   escalas o promedios no comparables. Confirmar el uso de promedioGeneral como
   alias del promedio bruto de simulacros en la consulta de historial.

## Integración necesaria antes de desplegar

Probar en MySQL aislado: migración con datos ficticios históricos, FK y CHECK,
unicidad de cierre general, errores parciales, rollback real y carreras entre
inserción/edición/cierre con dos conexiones. Verificar bajas concurrentes de cursos,
matrículas y perfiles, y comportamiento de collation para Periodo/TipoEvaluacion.
Probar las pantallas React con los contratos documentados. Las simulaciones de
este repositorio no verifican el motor SQL ni sustituyen estas pruebas.
