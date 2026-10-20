# Simulacros semanales: contrato de produccion pendiente de confirmar

## Decisiones confirmadas por Morgan

- AcadeSys evalua exclusivamente mediante **simulacros semanales generales**.
  Los cursos siguen existiendo para gestion academica, horarios y materiales;
  no tienen calificaciones.
- Cada simulacro tiene fecha o semana identificable. Su puntaje maximo depende
  de la universidad objetivo del ciclo.
- No corresponde migrar `Evaluacion.IdCurso`. La propuesta fue retirada y su
  archivo SQL es inerte. Tampoco corresponde una escala 0-20 para cursos.
- Render utiliza `main` con **Auto-Deploy activado**. Aiven es la unica base y
  DBeaver consulta esa misma produccion; no existe staging.
- No se ejecutaron SQL, migraciones, conexiones a Aiven, push ni despliegues.

## Bloqueo comprobado en el repositorio

`database/MIGRACION_PREU_COMPATIBLE.sql` define Evaluacion con IdEvaluacion,
IdMatricula, TipoEvaluacion, Calificacion DECIMAL(6,2), campos de auditoria de
creacion/modificacion y EstadoRegistro. No define Periodo ni fecha/semana de
simulacro. `MIGRACION_P1_09_ESCALA_NOTAS.sql` propone convertir Calificacion a
INT, pero su existencia no demuestra que se haya ejecutado. No hay un DDL de
Auditoria_Cierres versionado que acredite sus columnas, restricciones o indices.

Esto no demuestra que esos elementos falten en Aiven: demuestra que **no tenemos
su contrato real**. Las consultas de las rutas y los mocks tampoco prueban el
esquema de produccion. Las propuestas DDL anteriores de este documento se han
retirado; no autorizan crear Periodo, RegistrosAfectados ni ninguna otra columna.

Se necesita, sin datos personales ni filas reales:

1. `SHOW CREATE TABLE Evaluacion;` y `SHOW CREATE TABLE Auditoria_Cierres;`.
   Si existe una tabla propia de simulacros, tambien su DDL.
2. Nombre del campo que identifica el simulacro y su significado: fecha del
   examen, semana con anio o identificador de otra tabla. Un ejemplo ficticio
   del valor que envia React y del cuerpo de registro/cierre permite comprobar
   su contrato sin usar datos reales.
3. Tipos y restricciones de Calificacion, estados de evaluacion y claves de la
   auditoria. Los DDL permiten comprobar si admiten decimales y como se identifica
   un cierre; no se decidira eso a partir de una migracion sin ejecutar.

`VERIFICACION_ESQUEMA_ACADEMICO.sql` contiene solo consultas de metadatos
preparadas para revision. No ha sido ejecutado por el agente.

## Reglas para la adaptacion, una vez confirmado el esquema

- Eliminar de registro, consulta, historial, dashboard, cierre y contexto de
  Tutor IA las referencias funcionales a Evaluacion.IdCurso. Mantener las
  relaciones de Curso usadas legitimamente por horarios y materiales.
- No usar `Periodo = General` como identificador semanal. No derivar la semana
  de FechaCreacion: puede ser fecha de carga y no del examen. No inventar fechas
  para historicos ni confundir semanas de anios diferentes.
- Registrar y cerrar exactamente el mismo simulacro de un ciclo/academia usando
  la clave existente comprobada. Preservar la comprobacion transaccional de
  cierre al insertar/editar y el aislamiento de academia. No sustituir una
  auditoria desconocida por un cierre global o solo por EstadoRegistro.
- Usar exclusivamente las columnas reales de Auditoria_Cierres. No presuponer
  RegistrosAfectados, IdCurso nullable, Periodo ni nuevas restricciones.
- Conservar JWT, perfiles vigentes, coincidencia exacta normalizada y equivalencia
  de Administrador/Recursos Humanos. No ampliar permisos docentes sin verificar
  asignaciones legitimas.
- Mantener las escalas universitarias existentes mientras se valida su contrato;
  universidad desconocida no recibe un maximo inventado. La precision numerica
  debe concordar con el DDL y la regla funcional confirmada.

## Impacto React y pruebas pendientes

El codigo actual sigue usando el contrato anterior. Sus 114 pruebas simuladas
pasan, pero incluyen notas por curso y no certifican este nuevo alcance.
No se eliminaron ni debilitaron pruebas para aparentar una adaptacion completa.

Antes de desplegar hay que revisar el payload de registro/cierre semanal y las
respuestas de historial, alumno, dashboard y Tutor IA. Campos como promedioCursos,
escalaMaximaCurso y clasificacion por IdCurso son heredados y requieren acordar
su retirada o compatibilidad con React. Debe distinguirse:

- 403: permisos insuficientes, sin conceder acceso por un simple nombre de rol.
- 409: simulacro cerrado u otro conflicto de estado comprobado; revisar aparte
  el bloqueo ya existente de asistencia por falta de relacion alumno-aula.
- 503: actualmente puede responder por IdCurso ausente; ese requisito debe
  desaparecer de evaluaciones. No debe recomendar una migracion por curso.

Actualizar las pruebas con dos simulacros de un mismo ciclo, separacion por
academia/ciclo y anio, rechazo de un identificador ausente, puntajes y precision
validos por universidad, aislamiento de cierres, preservacion de historicos,
visibilidad de notas cerradas y rollback. Los mocks deben reflejar el DDL real,
no construir uno supuesto. Probar las consultas en MySQL local aislado con datos
ficticios cuando se disponga de ese entorno; nunca usar Aiven como banco de pruebas.

## Estado de entrega

**NO APTO PARA AUTO-DEPLOY.** Se detuvo la implementacion funcional antes de
inventar el identificador semanal o la auditoria, conforme a la instruccion del
usuario. La rama y sus 13 commits remotos integrados se conservan. Tambien sigue
pendiente la verificacion de identidad antes de la reinscripcion publica.
