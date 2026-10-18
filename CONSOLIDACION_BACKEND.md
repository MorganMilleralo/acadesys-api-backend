# Consolidación local de seguridad, notas y actas

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

Resultados de la ejecución final: **71 casos aprobados**: 41 pruebas node:test y
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
  plano. No se ejecutó `scripts/migrar-claves.js`; la retirada de esa compatibilidad
  necesita un plan separado y verificado.
