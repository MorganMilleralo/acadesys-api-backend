# AcadeSys — auditoría inicial de Torito

**Actualización posterior:** el usuario entregó el plan DOCX de 26/10 y se
prepararon cambios locales en `david/torito-ciclos-oferta`, desde `6944740`.
Ver [entrega y contratos](ENTREGA_TORITO_2026-10-30.md). El contenido siguiente
conserva la fotografía de la auditoría inicial; sus bloqueos de documento ausente
y regla 120 sin referencia quedan sustituidos por esa actualización. La entrega
vigente también registra la confirmación del 30/10 de ambas columnas de precios
en Aiven y la implementación de capacidad autorizada posteriormente. Este
documento histórico no describe el estado actual de esas decisiones.

Fecha de sesión: 2026-10-30 (America/Lima). Alcance: cinco responsabilidades
descritas por el usuario. Este informe cierra el primer diagnóstico; no acredita
implementación ni validación productiva de las cinco tareas.

## 1. Estado y cambios del equipo

- Rama local: `main`, commit `2e24822` (2026-10-20).
- `git fetch origin` completado. Remoto auditado: `6944740` (2026-10-28).
  La rama local está 11 commits detrás. No se hizo merge, checkout ni push.
- Cambio local preexistente: `.vscode/extensions.json`, sin seguimiento; conservado.
- No se encontraron archivos AGENTS.md en el repositorio ni en sus directorios
  ascendentes comprobados. No se modificaron módulos funcionales.
- `53a60a4` (Yan): escalas compartidas y preparación de ciclos demo.
- `e21ddb8` (Morgan): avance de matrícula e inscripción; `1ca1f81`: verificación
  de matrícula y almacenamiento de foto; `be3b7c7`/`ee18fdc`: recuperación de acceso.
- `fd6c80c` (Morgan): checkout y entrega actual de pagos, contratos y diagnósticos.
- `6944740` (Morgan): actualización de dependencias.
- Las diferencias también incluyen fotos de perfil y sus pruebas. No se propone
  intervenir esos flujos, el portal del alumno ni los mecanismos de pagos.

Los siguientes hallazgos se refieren a **origin/main en 6944740**, salvo indicación
contraria. Los archivos nuevos del remoto no están todavía en el árbol local.
`CONSOLIDACION_BACKEND.md` contiene antecedentes del 20 de octubre: no describe
por sí solo el estado remoto actual.

## 2. Diagnóstico de las cinco tareas

| Tarea | Estado inicial | Evidencia y trabajo pendiente |
| --- | --- | --- |
| Precios por ciclo | Parcial | `utils/pagos.js` distingue inscripción y precio legado; checkout calcula el importe en el servidor; mensualidades usa `PrecioMensual`. Gestión y catálogo siguen trabajando con `Precio`. Falta alinear lectura/escritura de precios sin romper el contrato de Morgan ni consultar columnas no confirmadas. |
| Capacidad | Parcial | Creación/edición exigen enteros 1–500 y la edición impide bajar de inscritos activos. Checkout bloquea el ciclo y vuelve a leer matrículas con `FOR UPDATE`. Catálogo y utilidades conservan 0/NULL como ilimitado. No existe el valor predeterminado 100 para crear ciclos. Falta resolver 120 frente al contrato vigente 500 y probar concurrencia real. |
| Auditoría de pagos | Parcial | Existen `database/diagnostico_morgan_pagos.sql`, diagnóstico posterior a migración y `scripts/regularizar-inscripciones-pendientes.js`. Hay vista previa, IDs explícitos, actor, transacción y auditoría; no hay un respaldo exportado ni procedimiento de reversión posterior al commit implementados en ese script. Falta completar diagnóstico de huérfanos/históricos y decisiones de regularización. No se ejecutó. |
| Asignaciones docentes | Parcial | Se comprueba usuario/perfil activo de la academia, ciclo y curso activos, pertenencia a `CicloCurso`, aula y duplicado exacto. Horarios rechaza solapamiento por ciclo/día. Falta cobertura completa docente/horario y detección del mismo docente ocupado en distintos ciclos; comprobar el esquema antes de relacionar recursos. |
| Dashboard preuniversitario | Parcial | Hay aislamiento por academia, alumnos, ciclos y pagos pendientes; escalas compartidas con notas. Sigue calculando promedio institucional con promedios normalizados de ciclos y mezcla tipos de evaluación. No hay filtro `idCiclo` en esta ruta ni indicador de cobertura docente. Separar simulacros e indicadores operativos requiere coordinar respuesta con Luis. |

### Hallazgos que condicionan la implementación

1. **Dependencia de esquema ya presente en el remoto.**
   `routes/matriculas.routes.js`, función `obtenerCiclo`, selecciona directamente
   `PrecioInscripcion` y `PrecioMensual`. El fallback de JavaScript a `Precio` no
   evita que falle SQL si faltan esas columnas. El generador de mensualidades
   también consulta `PrecioMensual`. Existe una migración propuesta; su presencia
   no demuestra ejecución en Aiven. No se añadieron consultas nuevas ni se probó
   contra la base productiva.
2. **Posible divergencia de precios.** La gestión administrativa escribe `Precio`,
   mientras checkout prioriza `PrecioInscripcion`. Si esta última contiene un
   valor previo, editar el precio legado puede cambiar el catálogo sin cambiar el
   importe del checkout. Las cuotas existentes conservan su monto al cambiar la
   tarifa; una diferencia histórica no demuestra por sí sola un cobro erróneo.
3. **Reglas de capacidad contradictorias.** El commit `44521d0` y las pruebas
   existentes protegen capacidades de hasta 500, incluida una capacidad 250.
   `docs/CONTRATO_PAGOS_MORGAN.md` propone 1–120, pero se identifica como versión
   propuesta para coordinación. No se debe recortar históricos ni sustituir las
   pruebas para aparentar aprobación. El usuario aportará el plan de reparto.
4. **Relación de horarios.** `HorarioCurso` se usa por ciclo/curso; el docente se
   deriva de `Asignacion_Aula`. No asumir `HorarioCurso.IdDocente`. El duplicado
   de asignación actual incluye aula: cambiar esa definición exige criterio de
   negocio. El diagnóstico remoto ya detecta cursos sin docente activo; falta
   verificar perfil y completar horarios/cobertura.
5. **Dashboard.** La normalización a 20 existe; no se trata de una suma directa
   de escalas brutas. Aun así, el agregado institucional combina universidades
   y tipos de evaluación. Definir retirada/null/separación de ese campo con Luis
   y Morgan; no cambiarlo silenciosamente. La ruta actual no implementa el filtro
   de ciclo que menciona la solicitud.

## 3. HU y aprobaciones

No se encontró `Plan_Integral_Correcciones_y_Reparto_AcadeSys.docx` ni un Product
Backlog con IDs de HU en el inventario local/remoto inspeccionado. Se leyeron
también los DOCX remotos `Guia_Implementacion_Morgan_AcadeSys.docx` y
`Plan_Maestro_QA_AcadeSys_Equipo.docx`: aportan coordinación y QA, pero no sustituyen
la sección 5.2 solicitada ni permiten asignar números de HU verificables.

| Tarea | Relación funcional pendiente de enlazar con HU real |
| --- | --- |
| Precios | Oferta académica, gestión de ciclos y matrícula/checkout. |
| Capacidad | Gestión de ciclos, disponibilidad y matrícula concurrente. |
| Pagos inconsistentes | Control de cuotas/inscripción y auditoría administrativa. |
| Asignaciones | Gestión de docentes, cursos por ciclo y horarios. |
| Dashboard | Indicadores administrativos y resultados preuniversitarios. |

Decisiones para Morgan: aprobar rango/default y tratamiento de capacidades
históricas; confirmar esquema desplegado y transición de precios; definir cuándo
una diferencia de importe es una anomalía; aprobar IDs/importe objetivo antes
de regularización; acordar criterios de cobertura y conflictos entre ciclos;
coordinar contrato del dashboard con Luis. Hasta contar con HU, no se clasifican
estos puntos como requerimientos nuevos aprobados ni se amplía el alcance.

## 4. Archivos candidatos y límites

- `routes/ciclos.routes.js`, `routes/admin-ciclos.routes.js`: precios, capacidad,
  catálogo y edición, con pruebas en `tests/admin-ciclos.detalle.test.js` y suites
  focalizadas de ciclos por preparar cuando se confirme la regla.
- `utils/reglas-matricula.js` y `tests/reglas-matricula.test.js`: coherencia de
  capacidad; verificar compatibilidad del checkout existente sin reconstruirlo.
- `routes/academico.routes.js`, `tests/correcciones-backend.test.js`,
  `tests/seguridad.test.js`: completar solo las validaciones faltantes aprobadas.
- `routes/dashboard.routes.js` y pruebas focalizadas: respuesta y filtros una vez
  acordada la compatibilidad con React.
- SQL de diagnóstico y procedimiento de respaldo/reversión: complementar los
  artefactos de Morgan; no duplicar ni ejecutar sus scripts de pagos.
- `routes/matriculas.routes.js`, `routes/pagos.routes.js`, `routes/alumno.routes.js`
  y `utils/pagos.js`: referencias de compatibilidad; las dependencias de esquema
  detectadas se comunican a Morgan. Sin cambios en esta sesión.

## 5. Evidencia ejecutada y límites

| Verificación | Resultado |
| --- | --- |
| `npm.cmd test` local, `2e24822` | 124 casos node:test + 4 autenticación + 5 cierre + 21 notas/actas = **154 aprobados**, salida 0. |
| `npm.cmd test` sobre copia temporal de `6944740` obtenida con `git archive` | **166 node:test**, 0 fallos/omitidos, más los mismos 30 casos de scripts = **196 aprobados**, salida 0. |
| Sintaxis local, `node scripts/check-sintaxis.js` | 48 archivos JavaScript correctos. |
| Sintaxis de la copia remota, `node --check` | 67 archivos JavaScript correctos. |
| `git diff --check` local | Sin errores. |
| Frontend | No disponible en esta carpeta ni en el directorio padre inspeccionado. Las 100 pruebas reportadas no están verificadas. |

La copia remota usó `NODE_PATH` hacia las dependencias locales, sin instalación ni
cambio de `node_modules`. Por tanto, verifica ese código con las dependencias
disponibles, **no reproduce el lockfile remoto**: este cambia al menos body-parser
y nodemailer. Repetir en un entorno aislado con dependencias exactas antes de integrar.

Las suites bloquean carga de MySQL y dotenv mediante `tests/aislamiento.js`;
las pruebas HTTP usan dobles y datos ficticios. Los errores SQL/rollback impresos
son fallos simulados esperados. No acreditan SQL real, índices, FKs, capacidad bajo
conexiones concurrentes, rollback de MySQL, pagos reales ni compatibilidad React.
No se ejecutaron migraciones, scripts de regularización, llamadas a Aiven, envíos
de correo ni cambios de frontend.

## 6. Daily Scrum — registros tentativos, no actas retroactivas

Las fechas de la semana actual son lunes 26, miércoles 28 y viernes 30 de octubre.
No consta trabajo de esta sesión realizado el lunes o miércoles. Estos son guiones
de planificación; solo el viernes refleja la auditoría ejecutada hoy.

### Lunes 26 — previsto, no realizado por esta sesión

1. ¿Qué hice? No hay actividad verificable previa registrada aquí.
2. ¿Qué haré? Revisar Git, cambios del equipo, esquema documentado, precios,
   capacidad y relación de las cinco tareas con las HU.
3. ¿Impedimentos? Conseguir plan/backlog y confirmar reglas de precios/capacidad.

### Miércoles 28 — previsto, no realizado por esta sesión

1. ¿Qué hice? Actualizar con la evidencia de la auditoría cuando corresponda;
   no se atribuyen implementaciones a esta fecha.
2. ¿Qué haré? Implementar y probar reglas aprobadas; completar consultas de pagos
   y cobertura docente, conservando los mecanismos de Morgan.
3. ¿Impedimentos? Decisiones de capacidad/precios, esquema verificado y un entorno
   aislado para probar concurrencia. Avanzar con pruebas independientes aprobadas.

### Viernes 30 — avance real de esta sesión

1. ¿Qué hice? Audité los cinco módulos y los 11 commits remotos nuevos; confirmé
   154 casos locales y 196 en copia remota con dependencias locales. Verifiqué
   sintaxis y diferencias. Documenté conflictos de capacidad y dependencia de
   columnas nuevas, sin modificar módulos.
2. ¿Qué haré? Contrastar la sección 5.2 y HU cuando lleguen; preparar cambios
   compatibles sobre la base remota en una rama aislada, completar diagnósticos
   y acordar el contrato del dashboard. Ejecutar regresión de cada cambio.
3. ¿Impedimentos? Plan/backlog aún no disponibles, esquema vivo sin verificar,
   rango 120 pendiente de confirmación, frontend y MySQL de QA no disponibles.

## 7. Entrega de esta etapa

Entregable: diagnóstico, mapa de archivos, evidencias y Daily Scrum tentativos.
Implementaciones funcionales realizadas: ninguna, respetando el primer paso del
usuario. Ninguna de las cinco tareas se declara terminada. Quedan pendientes las
decisiones, cambios y pruebas de integración posteriores descritos arriba.
