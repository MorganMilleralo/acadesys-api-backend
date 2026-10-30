# Entrega local de Torito — 30/10/2026

Informe vigente de las cinco responsabilidades de la sección 5.2. Sustituye los estados anteriores de esquema desconocido y capacidad propuesta. Rama `david/torito-ciclos-oferta`, base integrada `6944740`. Tras `git fetch origin`, no hay commits nuevos de `origin/main` por integrar. La referencia local `main` sigue en `2e24822`; esto no acredita qué versión está desplegada.

El mensaje más reciente y su archivo adjunto autorizan completar backend y generar un commit **local** después de validar. No autorizan push, despliegue, frontend ni escrituras en Aiven. La aprobación técnica del usuario no sustituye la aprobación formal del Product Backlog por Morgan.

## A. Estado de las cinco tareas

| Tarea | Implementación funcional local | Pendiente o bloqueo concreto |
| --- | --- | --- |
| Precios por ciclo | CRUD y catálogo usan ambos conceptos; validación de importes y NULL; alias compatible con checkout; Precio histórico conservado al editar. | Inventario real y aprobación de importes por IdCiclo; QA MySQL/React. No se activaron tarifas estimadas. |
| Capacidad | Rango 1–120, inicial 100 al omitir en altas; rechazos estrictos; conservación de históricos; disponibilidad común con checkout; prueba concurrente de última vacante. | Decidir saneamiento individual de históricos y registrar ampliación del backlog. SQL/locks reales por comprobar. |
| Auditoría de pagos | Consultas de lectura y generador offline de respaldo, vista previa, aplicación y reversión condicional. | Diagnóstico sobre exportación real y regularización autorizada por fila. Preparar scripts no significa haber saneado pagos. |
| Asignaciones docentes | Validación existente de docente/academia/ciclo/curso preservada; conflictos de docente/aula al crear asignación o crear/editar horario; cobertura por ciclo. | QA relacional/concurrente; política de publicación y revalidación de conflictos tras cambiar fechas o reactivar entidades. |
| Dashboard | Filtros operativos por academia/ciclo, cobertura docente y vacantes consistentes; sin promedio entre escalas distintas. | Serie académica semanal bloqueada por identificación/escala no acreditadas; adaptación y QA React con Luis. |

**Listo para revisión de código. No listo para publicación.** Se completó el alcance local compatible con las decisiones y el esquema confirmados; los pendientes anteriores no se presentan como funcionalidades productivas terminadas.

## B. Evidencia de Aiven y compatibilidad de precios

Fuente: confirmación del usuario del 30/10/2026, obtenida mediante SHOW CREATE TABLE en DBeaver después de su modificación satisfactoria:

- `Precio DECIMAL(8,2) NULL`: columna histórica conservada.
- `PrecioInscripcion DECIMAL(8,2) NULL`: existe.
- `PrecioMensual DECIMAL(8,2) NULL`: existe.
- `Capacidad INT DEFAULT 0`: sin modificación de esquema.

El riesgo anterior de columna inexistente queda resuelto **para ese esquema confirmado**. No se ha verificado que otros entornos tengan las columnas. No se preparó ni ejecutó otro ALTER; tampoco se presume un backfill. La ausencia de valores sigue siendo relevante.

Se intentó obtener el inventario con una consulta exclusivamente SELECT, pero se detuvo antes de conectar porque este entorno no tiene `DB_HOST` configurado. No hubo conexión a Aiven ni lectura de filas reales. El inventario parametrizado está preparado en `database/DIAGNOSTICO_TORITO_SOLO_LECTURA.sql`.

### Contrato de precios y NULL

- `precioInscripcion` y `precioMensual` aceptan números/cadenas decimales no negativos, hasta dos decimales, máximo de negocio existente S/ 9 999,99; también NULL. Se admiten alias PascalCase. Se rechazan vacíos, booleanos, arrays, negativos, exceso de precisión y alias contradictorios.
- En POST, omitir ambos deja ambos NULL. No configura una tarifa gratuita. El alias antiguo `precio` configura inscripción y, solo al crear, también el campo legado `Precio`.
- En PUT, omitir conserva el valor existente; NULL explícito deja el concepto sin configurar. El campo almacenado `Precio` se conserva siempre. Un cliente antiguo que envíe `precio` actualiza `PrecioInscripcion`, sin sobrescribir el histórico.
- Se reutiliza sin cambios `utils/pagos.js` de Morgan: inscripción válida en `PrecioInscripcion` tiene prioridad; si falta o no es válida, recurre a `Precio`. Cero explícito es válido. Con ambos ausentes, no existe tarifa de inscripción.
- **NULL en inscripción no deshabilita el checkout si hay Precio legado válido**: reactiva su respaldo heredado. Para cerrar inscripciones debe utilizarse el estado del ciclo. No se infiere que Precio sea mensualidad.
- Mensualidad NULL permanece NULL; la ruta de Morgan responde `409 PRECIO_MENSUAL_NO_CONFIGURADO`. No hay copia de Precio ni de inscripción. Cero explícito conserva el comportamiento actual de Morgan.
- La salida pública mantiene `precio` como inscripción efectiva y añade `precioHistorico`, `precioInscripcion`, `precioInscripcionEfectivo`, `precioMensual`, `origenPrecioInscripcion`. Administración utiliza las mismas claves en PascalCase: `Precio` es un alias de respuesta; `PrecioHistorico` es el valor de la columna conservada.
- Editar un ciclo no modifica `PagosMensualidad`. El checkout y la generación mensual continúan obteniendo importes del servidor. Los importes indicativos de Morgan no se escribieron en código ni datos.

### Rutas y consultas: origin/main frente a cambios locales

| Ubicación | Uso exacto de columnas | Estado |
| --- | --- | --- |
| `routes/matriculas.routes.js`, `obtenerCicloDisponible` | SELECT explícito de PrecioInscripcion, PrecioMensual y Precio; utilizado por POST `/api/matriculas/verificar`, `/checkout` y `/confirmar-correo-matricula`, incluida la solicitud de verificación. La inscripción usa el helper canónico. | Ya en origin/main `6944740`; archivo intacto. |
| `routes/pagos.routes.js` | POST `/api/pagos/ciclo/:idCiclo/mensualidades`: SELECT PrecioMensual con lock de Ciclo; valida NULL y crea cuotas con tarifa del servidor. | Ya en origin/main `6944740`; archivo intacto. |
| `routes/ciclos.routes.js` | GET `/api/ciclos/publicos` y `/api/ciclos/publicos/:id/detalle`: SELECT de ambos precios y del legado. | Nuevas lecturas y respuestas solo en esta rama. |
| `routes/admin-ciclos.routes.js` | GET listado/detalle y helper `obtenerCicloAcademia` leen ambos conceptos; POST INSERT y PUT UPDATE los persisten. PATCH estado y DELETE reutilizan el helper y también dependen del esquema. | Cambios solo en esta rama. |
| Diagnóstico SQL | SELECT de configuración, conceptos y diferencias con cuotas actuales. | Artefacto preparado, no ejecutado. |

Estar en origin/main no demuestra publicación. Los monitores de pagos, comprobantes y portal siguen leyendo sus cuotas históricas; no se cambiaron para recalcularlas desde Ciclo.

## C. Archivos y contratos entregados

| Grupo | Archivos |
| --- | --- |
| Rutas modificadas | `routes/academico.routes.js`, `routes/admin-ciclos.routes.js`, `routes/ciclos.routes.js`, `routes/dashboard.routes.js` |
| Reglas | `utils/reglas-matricula.js` modificado; nuevos `utils/capacidad-ciclo.js`, `utils/precios-ciclo.js`, `utils/cobertura-docente.js`, `utils/conflictos-docentes.js` |
| Auditoría | `database/DIAGNOSTICO_TORITO_SOLO_LECTURA.sql`, `scripts/plan-regularizacion-pagos.js` |
| Pruebas nuevas | `tests/torito-capacidad.test.js`, `tests/torito-precios.test.js`, `tests/torito-ciclos-oferta.test.js` |
| Regresiones adaptadas/conservadas | `tests/admin-ciclos.detalle.test.js`, `tests/correcciones-backend.test.js`, `tests/escalas.test.js`, `tests/reglas-matricula.test.js`, `tests/seguridad.test.js`, `tests/soporte.js` |
| Documentación | Este informe, `docs/TRAZABILIDAD_TORITO_HU.md`, auditoría inicial y `propuestas/README.md` |
| Evidencia previa conservada localmente, fuera del commit | `propuestas/CAPACIDAD_120_PENDIENTE_MORGAN.patch`: archivo histórico, ya incorporado y adaptado; no volver a aplicarlo. |

No se modificaron rutas de pagos, matrícula o alumno, `utils/pagos.js`, los regularizadores originales, dependencias ni frontend. `.vscode/extensions.json` es ajeno a esta entrega y queda fuera del commit. También se conserva sin seguimiento el parche histórico ya incorporado: contiene espacios de contexto propios del formato patch y no se altera para satisfacer el chequeo de whitespace. Todo su código y pruebas vigentes sí quedan en el commit.

Capacidad: el default 100 se aplica en la API, no cambia el default SQL 0. Valores históricos 0/NULL/>120 se conservan, marcan revisión y no permiten nuevas matrículas ni anuncian cupos ilimitados. Los alumnos y pagos existentes permanecen. La edición que omite capacidad conserva el histórico, incluso si tiene más de 120 inscritos; un cambio explícito exige rango y no bajar de inscritos. React debe omitir el campo si no pretende corregirlo. El contador administrativo se alinea con checkout al exigir academia del alumno igual a la del ciclo.

Asignaciones: locks de Academia serializan los escritores de asignación y horario; 409 `CONFLICTO_HORARIO_ASIGNACION` revierte antes de insertar. Los intervalos contiguos son compatibles y las fechas desconocidas se consideran potencialmente coincidentes. Se conservan aulas y asistencia. `GET /api/ciclos/:id/cobertura` devuelve cursos, pendientes y contadores a administración; no certifica que el histórico esté libre de conflictos. Un ciclo sin cursos no tiene cobertura completa.

Dashboard: `GET /api/admin/dashboard/overview?idCiclo=...` filtra dentro de la academia de sesión. Respuestas 400 para filtros inválidos y 404 para ciclo ajeno. Mantiene claves principales y `actualizadoEn`; añade `coberturaDocente`, `filtros`, `definiciones`, `rendimientoEstado`. `resumen.promedioInstitucional=null`, `rendimientoPorCiclo=[]`, código `IDENTIFICACION_SEMANAL_PENDIENTE`. El parámetro periodo no acredita una semana y no filtra métricas operativas: es contexto, explicitado en respuesta. No se deducen semanas de FechaCreacion ni de General. La métrica heredada `estudiantesMorosos` incluye estados pendiente/moroso/vencido, no demuestra vencimiento efectivo; no se cambia aquí el contrato financiero de Morgan.

React/Luis deben verificar: NULL nunca se muestra como S/ 0 o promedio cero; precios editados coinciden con checkout; formularios envían el concepto correcto; capacidad histórica no se reenvía inadvertidamente; flags, cobertura y series vacías se renderizan correctamente. No se ejecutaron pruebas frontend.

## D. Decisiones concretas para Morgan

Preguntas preparadas, no enviadas:

1. ¿Qué importe exacto de inscripción y mensualidad apruebas para cada IdCiclo real y desde cuándo? Falta exportar el inventario; no se pueden asociar rangos a IDs todavía. Referencias recibidas: inscripción ~S/200, verano ~S/350–400 mensuales, repaso ~S/450–500, semestral/anual menores sin monto definido. Son referencias, no tarifas activadas.
2. ¿Confirmas el contrato documentado de Precio histórico, alias de inscripción efectiva y NULL con respaldo solo para inscripción, incluidos ciclos gratuitos explícitos? ¿Qué criterios registramos formalmente en HU-09/20?
3. ¿Cómo resolver individualmente ciclos 0/NULL/>120, especialmente con >120 inscritos? La implementación bloquea nuevas matrículas y conserva los existentes; no reduce ni expulsa automáticamente. Falta aprobación del saneamiento por IdCiclo y registro de 1–120/inicial 100 en las HU.
4. ¿Qué filas de cuotas pendientes son errores comprobados y qué importe corresponde a cada una? Una diferencia con la tarifa actual no prueba error histórico. Se requiere autorización por IdPago, vigencia, respaldo y QA; pagos confirmados quedan fuera.
5. ¿Qué datos son críticos para publicar y cómo se completa un borrador si las rutas de configuración requieren ciclo activo? La cobertura es diagnóstica; no se inventó un estado nuevo. Falta resolver este criterio de HU-09 y acordar revalidación tras reactivaciones/cambios de fechas.
6. Con Luis, ¿se acepta el contrato de NULL, cobertura y serie vacía, y cuál es la identificación semanal/escala verificable para reactivar rendimiento conforme a HU-12? ¿En qué MySQL de QA se validarán consultas, locks y rollback antes de publicar?

### Regularización preparada, nunca aplicada

El generador offline exige exportación revisada con IdPago/IdUsuario/IdCiclo/IdAcademia, Mes, Monto, MontoAprobado, Estado, FechaPago, EstadoRegistro y referencia `decisionMorgan`. Solo acepta Pendiente activo sin FechaPago y concepto Inscripcion o periodo 20xx-MM. Prepara `respaldo.json`, `vista-previa.json`, `aplicar.sql`, `revertir.sql`, `bitacora.json` en directorio nuevo. Los SQL terminan en ROLLBACK y comparan identidad, monto/estado originales y academia. Si una fila no afecta exactamente un registro, se revierte todo el lote. La reversión tampoco modifica una cuota pagada posteriormente.

`respaldo.json` no sustituye un backup completo. La referencia textual no verifica autorización por sí sola. Para aplicar en el futuro: aprobación de filas/importes, backup restaurable, QA y ejecución supervisada con bitácora; todo fuera de esta entrega. No se propone eliminar columnas nuevas para revertir backend, porque Morgan ya depende de ellas. La reversión local del código debe coordinar el contrato de catálogo/checkout, conservando columnas, tarifas y pagos históricos.

## E. Product Backlog

Confirmado el documento de Descargas `Product_Backlog_AcadeSys_Formato_Academico_Equipo9.docx`: contiene **HU-01 a HU-20**, incluidas HU-09, HU-11, HU-12, HU-13 y HU-20. Se leyó junto al Plan Integral. Es un inventario documental del 21/10, no una consulta al Trello actual. La matriz [TRAZABILIDAD_TORITO_HU.md](TRAZABILIDAD_TORITO_HU.md) conserva enlaces y criterios exactos.

Actualizar formalmente: HU-09/20 para precios separados y compatibilidad; HU-09/13 y criterios relacionados HU-01/20 para 1–120/inicial100 e históricos; HU-03/20 para pago pendiente/aprobación y cualquier regularización retrospectiva; HU-09/11 para publicación/cobertura; HU-12 para KPI de cobertura y transición del contrato académico. Relación temática no equivale a aprobación de estos criterios nuevos. No se cambió Trello ni se inventó aprobación Scrum.

## F. Verificación y commit local

- **216 pruebas aprobadas: 186 node:test + 4 autenticación + 5 cierre + 21 notas/actas; cero fallos y omitidos.** Se conservan las 206 anteriores y se incorporan 4 de capacidad y 6 de precios. Fallos SQL impresos por pruebas de rollback son simulados e intencionales.
- Prueba concurrente de última vacante: respuestas 201/409, una matrícula y una cuota con importe del servidor; no acredita locks de MySQL real.
- Contratos nuevos prueban NULL/cero/respaldo, conceptos separados, preservación del histórico al editar, mensualidad no configurada en la ruta intacta de Morgan, conflictos, cobertura, aislamiento de academia y dashboard no comparable.
- Dependencias: instalación previa conforme a package-lock con `npm.cmd ci --ignore-scripts --no-audit --no-fund`; `npm.cmd ls --depth=0` válido. No se cambiaron manifiestos ni lockfile ni se declara una auditoría de vulnerabilidades.
- Verificación de sintaxis de 75 archivos JavaScript versionados y nuevos de la entrega; `git diff --check` y revisión del contenido preparado para commit sin errores.
- Las suites precargan `tests/aislamiento.js`, bloquean MySQL/dotenv y sustituyen correo. Pendientes: motor MySQL real, índices/locks/rollback, históricos, React y revisión del equipo.

Se guarda el conjunto de backend, pruebas y documentación en un commit local sobre `6944740`; el identificador se entrega al finalizar y se consulta con `git log -1 --oneline`. No se hace push ni merge a main. Un commit local no modifica producción, aunque estos cambios requieren QA y aprobaciones antes de integrarse/desplegarse.

## Daily Scrum preparados sin inventar actividad pasada

| Día | Avance verificable | Siguiente trabajo | Impedimento |
| --- | --- | --- | --- |
| Lunes 26, propuesta de planificación, no acta ejecutada | No consta actividad de esta sesión en esa fecha. | Revisar rama, Plan Integral, HU y contratos del equipo. | Documentos y DDL actualizado. |
| Miércoles 28, propuesta de planificación, no acta ejecutada | No consta implementación de esta sesión en esa fecha. | Preparar diagnóstico, controles académicos y pruebas aisladas. | Decisiones de negocio y entorno QA. |
| Viernes 30, avance real | Conservado avance previo; origin/main ya integrado; esquema confirmado por usuario; precios, capacidad, auditoría offline, cobertura y dashboard implementados localmente; 216 pruebas aprobadas. | Revisión del equipo, importes por ID, actualización HU, QA MySQL/React y decisión de publicación. | Inventario real/tarifas exactas, históricos, publicación académica, identificación semanal y QA pendientes. |
