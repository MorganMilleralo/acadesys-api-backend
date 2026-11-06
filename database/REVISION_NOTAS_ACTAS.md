# Notas y actas: contrato conservado de main

Estado de integración del 2026-10-20. Base `6ce9331`; consultar
[CONSOLIDACION_BACKEND.md](../CONSOLIDACION_BACKEND.md) para la validación completa.

## Alcance autorizado

AcadeSys registra simulacros semanales. Para completar esta integración se
conserva la implementación existente de Morgan sin diseñar un modelo semanal
nuevo. Se retiraron las dependencias locales de Evaluacion.IdCurso y de
Auditoria_Cierres.RegistrosAfectados. No se requieren esas columnas ni se propone
una migración para crearlas. La propuesta MIGRACION_EVALUACION_CURSO.sql sigue inerte.

El contrato legado utiliza Evaluacion.Periodo, TipoEvaluacion, Calificacion entera,
EstadoRegistro y campos de auditoría. El cierre existente usa Matricula.IdCurso
nullable y las columnas IdAdministrador, IdCiclo, IdCurso, Periodo, TipoEvaluacion,
FechaCierre de Auditoria_Cierres. Son dependencias preexistentes en main, no nuevas
columnas añadidas por esta consolidación. No se implementó un cierre semanal nuevo.

## Duplicados e históricos

Se conserva la comprobación de main por IdMatricula + Periodo + TipoEvaluacion,
dentro de la transacción y bajo bloqueo del ciclo. El lote rechaza duplicados
internos y registros existentes abiertos o cerrados con 409.

COALESCE(Periodo, 'General') considera equivalentes NULL y General. Esa clave no
identifica una semana: un nuevo simulacro con General puede colisionar con otro
anterior. No se cambian históricos, no se deriva una fecha de FechaCreacion y no
se introduce una clave alternativa sin evidencia del modelo real.

Los tipos y campos de respuesta heredados de main se conservan por compatibilidad
con React. No implican agregar notas por curso. También se conserva su fallback
de escala y sus promedios; revisar su significado antes de la adaptación semanal.

## Evidencia de esquema y límites

El informe INFORME_CORRECCIONES_BACKEND.md registra la verificación previa del
equipo sobre Aiven, incluida Calificacion INT y la existencia de Periodo. En esta
sesión el intento de obtener metadatos devolvió ER_ACCESS_DENIED_ERROR. No se
obtuvieron DDL ni se verificaron las consultas contra la base viva.

La revisión estática confirma que las rutas activas no consultan Evaluacion.IdCurso
ni RegistrosAfectados. Las pruebas aisladas verifican permisos, parámetros, errores,
duplicados, visibilidad de cerradas, cierre legado y rollback simulado. No sustituyen
FK, índices, collation, carreras reales ni validación de pantallas React.

No se ejecutaron migraciones ni escrituras SQL. Aiven continúa siendo producción.
Los scripts verificar-esquema, verificar-sql, verificar-indices y auditar-duplicados
no se ejecutan para sortear el rechazo de acceso; tampoco se ejecutan scripts de
migración o aplicación de cambios.

## Antes de publicar o desplegar

- Confirmar el esquema real con acceso de lectura autorizado y comprobar las
  consultas sobre ese esquema; obtener contrato semanal de React con datos ficticios.
- Verificar el alcance de usuarios/perfiles y los límites de gestión de notas;
  la consolidación no concede acceso docente a alumnos por el simple nombre del rol.
- Validar el flujo de asistencia por ciclo de Morgan, conservado por autorización.
- Resolver los pendientes funcionales de simulacros, recuperación y pagos.
- No publicar con Auto-Deploy activo. No se modificó ni activó Render.


