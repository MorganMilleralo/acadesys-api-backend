# Consolidación local de seguridad, notas y actas

## Estado vigente: solo simulacros semanales

Morgan confirmó que AcadeSys **no registra calificaciones por curso**. Cada
simulacro tiene una fecha o semana identificable y su nota máxima depende de la
universidad objetivo. La propuesta de migrar `Evaluacion.IdCurso` queda retirada;
su archivo SQL ahora es inerte. La escala provisional 0–20 para cursos deja de
ser un requisito o una decisión pendiente.

También está confirmado que Render despliega **main con Auto-Deploy activado** y
que existe una sola base Aiven de producción, consultada también desde DBeaver.
No hay staging. Un push a main activaría el despliegue: **NO APTO para Auto-Deploy**.

La adaptación funcional está **bloqueada por falta de evidencia del esquema**.
El SQL local no define la fecha/semana del simulacro ni `Evaluacion.Periodo`;
el repositorio tampoco incluye el DDL de `Auditoria_Cierres`. No se puede asumir
que `FechaCreacion` sea fecha del examen, que `General` identifique una semana,
ni que la auditoría tenga `RegistrosAfectados`. Se solicitaron los DDL reales y
el campo/valor semanal enviado por React, sin solicitar datos de alumnos.

Se mantiene `david/consolidacion-backend` en `cafdfd1`, incluidos los 13 commits
remotos y las mejoras de seguridad. No se modificaron las rutas ni las pruebas
funcionales mientras falta ese contrato: **el código aún depende de IdCurso**
en notas, actas, cierre, alumno, dashboard y contexto de Tutor IA. No debe
desplegarse este estado. Ver [la revisión vigente](database/REVISION_NOTAS_ACTAS.md).

Verificación de este estado: `npm.cmd test` aprueba 114 casos (84 node:test y 30
casos de scripts). Esas pruebas todavía verifican el contrato anterior; **no
demuestran compatibilidad con simulacros semanales ni con producción**. Se
mantienen los dobles locales y el bloqueo de carga de mysql2/dotenv; no se hizo
ninguna conexión a Aiven, migración, push ni despliegue.

## Antecedentes de la consolidación e integración

Lo que sigue documenta el trabajo anterior a la aclaración de Morgan. Los
requisitos de evaluaciones por curso, sus migraciones y las dudas anteriores
sobre la rama de Render están sustituidos por el estado vigente de arriba.

Se conservaron los cambios locales previos, incluyendo `package-lock.json` y
`.vscode/extensions.json`. No se hizo reset, clean, push, despliegue, conexión a
Aiven ni ejecución de SQL. La migración de Evaluacion.IdCurso continúa pendiente.

## Archivos y correcciones

| Archivos | Cambio |
| --- | --- |
| middlewares/auth.middleware.js; routes/auth.routes.js | Identidad válida, perfil vigente, rechazo de perfiles activos múltiples; login consulta perfiles activos y usa ocho parámetros para ocho placeholders. Conserva /login y /auth/login. |
| middlewares/roles.middleware.js | Coincidencia exacta normalizada; Administrador y Recursos Humanos equivalentes sin fusionar perfiles ni autorizar por ID numérico. |
| routes/perfil.routes.js; routes/menu.routes.js | Gestión reservada a ambos perfiles administrativos. Se evita una segunda autenticación global desde el router de menús. |
| routes/usuario.routes.js | Listado administrativo, perfil destino activo, cambio transaccional a una única asignación de perfil activa sin borrar historial. |
| routes/academico.routes.js | Docente/tutor solo consulta sus asignaciones activas y coherentes con academia/ciclo/curso. Crear asignación exige curso activo del ciclo. Asistencia queda bloqueada hasta definir la relación alumno–aula. |
| routes/notas.routes.js; middlewares/cierre.middleware.js | Evaluacion.IdCurso, validación sin coerciones de booleanos/arrays, curso activo, clasificación histórica, comprobación transaccional del cierre y errores explícitos de esquema pendiente. |
| routes/actas.routes.js | Cierre por alcance, conserva auditoría del número de registros, validación compartida y rollback ante error de auditoría. |
| routes/alumno.routes.js; routes/dashboard.routes.js; utils/evaluaciones.js | Escalas compartidas, separación de cursos/simulacros/históricos, aislamiento del ciclo del alumno, notas cerradas visibles. |
| routes/materiales.routes.js | Cambios acotados a aislamiento por academia en lectura, validación previa a subida y baja. |
| routes/comunicados.routes.js | Publicación institucional administrativa; el esquema no acredita alcance docente sobre destinatarios. |
| package.json; scripts/probar-local.js; tests/*; prueba-*-local.js | Suite local reproducible, bloqueo de carga de MySQL/.env, mocks con conteo de parámetros y casos de regresión actualizados. |
| database/MIGRACION_EVALUACION_CURSO.sql | Solo comentarios sobre dependencias e históricos; su DDL original se conserva sin ejecutar. |
| database/VERIFICACION_ESQUEMA_ACADEMICO.sql; database/REVISION_NOTAS_ACTAS.md | Consultas preparadas de metadatos, contrato de esquema y SQL complementario propuesto, decisiones e integración pendientes. |

## Compatibilidad

Se mantienen métodos y URLs. Las respuestas exitosas conservan las claves usadas
por las rutas actuales; hay campos informativos nuevos. No se dispone del código
React dentro de este repositorio y no se afirma compatibilidad funcional completa
sin probar sus pantallas. Cambios observables que debe manejar React:

| Ruta/comportamiento | Resultado |
| --- | --- |
| Notas y cierres sin columna/tabla requerida | 503 con codigo ESQUEMA_ACADEMICO_PENDIENTE; sin ejecutar migraciones automáticas. |
| GET/POST /api/asistencias | 409 con codigo RELACION_ALUMNO_AULA_PENDIENTE para roles autorizados; sin consultas ni escritura de asistencia. |
| Gestión de notas por docente/tutor | 403 hasta demostrar el acceso a los alumnos concretos. |
| GET /api/asignaciones docente/tutor | Solo sus asignaciones activas y consistentes. |
| POST /api/comunicados docente | 403 por falta de un modelo de destinatarios ligado a sus asignaciones. |
| Perfiles, escritura de menús y listado de usuarios | Requieren Administrador o Recursos Humanos. |
| GET /api/notas/alumno/:id | promedioGeneral refleja simulacros; promedioCursos permanece separado. Escalas incompatibles o desconocidas producen null, sin mezclar puntajes brutos. |
| Dashboard | Conserva valores numéricos; agrega escalaConocida y excluye escalas desconocidas del promedio institucional. |
| Histórico sin curso y distinto de Simulacro | Visible como pendiente de clasificación; no se modifica ni suma a promedios. |

## Verificación local

Ejecutar `npm.cmd test` en PowerShell (o `npm test` donde npm.ps1 esté permitido).
El lanzador precarga `tests/aislamiento.js` en cada proceso: no permite cargar
mysql2 ni dotenv. Los servidores de prueba escuchan solo en 127.0.0.1 con puerto
aleatorio y las identidades son ficticias.

Resultados antes de integrar main: **71 casos aprobados**: 41 pruebas node:test y
30 casos en los tres scripts existentes (4 de autenticación, 5 de cierre y 21 de
notas/actas). Incluyen permisos, sesión vigente, SQL parametrizado,
alcance por academia, cierres, validación de lotes, rollback solicitado, respuestas
de alumno/dashboard y rechazo ante esquema ausente. Los errores registrados de
inserción/auditoría/BD son fallos inducidos por las pruebas, con respuesta comprobada.

Además, `git diff --check` no reportó errores, se comprobó la sintaxis de 30 archivos
JavaScript y el inventario estático encontró las mismas 61 combinaciones de método
y ruta que HEAD. Esto verifica las URLs declaradas, no el comportamiento de React.

La prueba de notas/actas también verifica que su estado en memoria se restaura
después de un fallo de inserción o auditoría, y que cerrar simulacros no cierra
otros cursos/tipos. Límites: los mocks no ejecutan SQL, no prueban FKs/CHECK ni
exclusión entre conexiones; su rollback no sustituye el rollback real de MySQL.

## Bloqueos y riesgos pendientes

- Seguir el contrato y las decisiones de Morgan en `database/REVISION_NOTAS_ACTAS.md`.
- La migración IdCurso por sí sola no habilita todo el esquema requerido. Sin ella,
  las rutas dependientes responden 503; este estado no debe presentarse como listo
  para producción.
- La asistencia y las operaciones docentes sobre notas requieren una relación de
  alumnos verificable. Se ha optado por denegar antes que inferir alumnos por ciclo.
- Hallazgo fuera del cambio de notas/actas, a coordinar con el responsable de
  matrícula/React: `/api/matriculas/verificar` expone identidad y ciclos al recibir
  un correo sin autenticar; `/api/matriculas/checkout` actualiza nombres y reinscribe
  a una cuenta existente sin verificar control del correo o sesión. No se modificó
  ese flujo público. Requiere una solución de autenticación/verificación antes de
  considerar segura la publicación completa del sistema.
- Login conserva la compatibilidad existente con contraseñas antiguas en texto
  plano. La integración incorpora su conversión a bcrypt después de un login
  válido, sin sobrescribir una recuperación concurrente. No se ejecutó
  `scripts/migrar-claves.js`; la retirada de esa compatibilidad necesita un plan
  separado y verificado.

## Integración local de origin/main

Rama: `david/consolidacion-backend`. Los 29 archivos originales quedaron guardados
en `f7f379a` (`Consolidar seguridad notas y actas`). Se integra el snapshot remoto
`23a891eac1ea1a98b049dd96fe26f524bd4868b3`: **13 commits** que no estaban en nuestra
rama. `main` local permanece en `a1a9c0c`; no se ejecutó push ni despliegue.
`.vscode/extensions.json` permanece fuera de los commits y `.env` continúa ignorado.

Hubo conflictos de contenido en 11 archivos: los middlewares auth, roles y cierre;
package.json; y las rutas academico, actas, auth, menu, notas, perfil y usuario.
Se resolvieron por bloques, conservando las reglas expresamente autorizadas:

| Área | Resultado de la combinación |
| --- | --- |
| Autenticación | JWT HS256, identidad/academia válidas, perfil activo único y secreto mínimo de 32 caracteres; conversión remota de claves legadas a bcrypt con comparación del valor anterior. Los tokens de recuperación no sirven como sesión. |
| Roles y usuarios | Administrador y Recursos Humanos equivalentes por nombre exacto normalizado. Se conservan autoservicio `/usuarios/me`, actualizaciones parciales y protecciones remotas del último administrador. El cambio de perfil mantiene una sola relación activa y su historial. |
| Perfiles y menús | Validaciones remotas, protección de perfiles con usuarios y nueva consulta de menús por perfil. Administración reservada a ambos perfiles administrativos. POST de creación usa el 201 de main. |
| Notas y actas | Evaluacion.IdCurso y auditoría RegistrosAfectados. Se incorpora el tipo `Evaluacion` sin eliminar los tipos locales, alias IdCiclo/IdCurso y ambos formatos de respuesta del cierre. La escala 0–20 entera sigue provisional. |
| Docentes y tutores | No se adopta acceso a notas por simple rol/academia. El directorio devuelve solo su propia entrada y los pagos requieren rol administrativo mientras no exista alcance verificable. Asistencias siguen respondiendo 409. |
| Gestión académica | Se conservan horarios CRUD, capacidad hasta 500 y docentes derivados de Asignacion_Aula. Se restaura horaValida, que el CRUD nuevo necesitaba. La creación remota de un aula interna para asignaciones de personal no acredita pertenencia de alumnos ni habilita asistencia. |
| Tutor IA | Se conserva el servicio remoto; su contexto usa Evaluacion.IdCurso, incluye notas cerradas y separa cursos, simulacros e históricos. promedioGeneral/ranking corresponden solo a simulacros; no se inventa una escala desconocida. No se hicieron llamadas a Gemini. |
| Matrícula | Se conservan recuperación por correo, generación criptográfica de claves y pagos Pendiente del checkout simulado. La recuperación de contraseña no verifica la identidad antes de reinscribir. |

También se incorporan CORS para frontend local, documentación/pruebas remotas y la
eliminación remota de `database/MIGRACION_PREU.sql`. El SQL compatible permanece.
El script remoto `scripts/aplicar-avance.js` se conserva como antecedente: el
middleware ya está integrado y no debe volver a aplicarse.

Validación de la integración: **114 casos** (84 node:test + 30 de scripts locales).
El lanzador descubre todas las suites y conserva el bloqueo de mysql2/dotenv;
HTTP solo en loopback, datos ficticios y SDK de IA sustituido. Se verifican
dependencias instaladas, sintaxis y diferencias de Git. El inventario estático
conserva las **71 rutas** declaradas de main (10 nuevas respecto a f7f379a), sin
eliminar ninguna URL. Esto no sustituye las pruebas de las pantallas React.

Pendientes antes de considerar main/despliegue:

- Aplicar y probar el esquema únicamente cuando exista MySQL aislado. IdCurso
  sigue sin ejecutarse. Periodo, Auditoria_Cierres y RegistrosAfectados necesitan
  verificación; también PagosMensualidad.Estado = Pendiente. Los documentos remotos
  mencionan tres migraciones que no están como archivos en este repositorio.
- Sin IdCurso fallan notas, actas, alumno/dashboard y ahora el contexto académico
  de Tutor IA; las rutas manejadas devuelven 503 de esquema pendiente.
- Morgan debe confirmar escala de cursos, alcance docente/alumno–aula, periodos,
  cierre por tipo, históricos y ranking. No se modificaron esas decisiones.
- React debe enviar IdCurso para notas de curso y manejar 403/409/503, null en
  promedios no comparables y el directorio limitado de docentes/tutores.
- Sigue pendiente verificar identidad antes de la reinscripción pública y limitar
  la exposición de `/matriculas/verificar`. El enlace de recuperación no lo resuelve.
- Faltan pruebas SQL reales (FK, CHECK, collation, rollback y concurrencia),
  recuperación/correo/pagos completos e integración real con el proveedor de IA.
  Las protecciones remotas del último administrador/perfil también requieren
  validar carreras entre solicitudes; los mocks no demuestran exclusión real.
- No se ha confirmado qué rama despliega Render. No se autoriza ni recomienda
  publicar basándose únicamente en esta integración y sus pruebas simuladas.
