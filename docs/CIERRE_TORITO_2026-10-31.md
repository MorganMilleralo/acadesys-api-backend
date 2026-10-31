# Cierre e integración de Torito — 31/10/2026

**Actualización posterior de la misma fecha:** el usuario confirmó tarifas en
DBeaver y autorizó el posible despliegue automático del push. También pidió
conservar la operación histórica de capacidad. Ver
[registro de publicación](PUBLICACION_TORITO_2026-10-31.md). El bloqueo y la
política de históricos descritos a continuación son el estado anterior.

Estado: **backend preparado para revisión e integración; publicación bloqueada**.
Se conserva íntegramente el commit `d16a183` en `david/torito-ciclos-oferta`.
La autorización más reciente solicita publicar en main solo cuando estén
comprobadas las condiciones de producción; reemplaza la prohibición absoluta
anterior de push, pero no permite ignorar esas condiciones.

El usuario confirmó durante esta sesión: Auto-Deploy sin evidencia actual,
ausencia de integración completa React/MySQL y tarifas aún sin asignar en Aiven.
Por esa condición explícita **no se hizo push ni se disparó despliegue**.
No se ejecutó SQL en Aiven, no se cambió frontend ni código productivo de Morgan.

## A. Cinco responsabilidades

| Tarea | Entrega local conservada y comprobada | Límite pendiente |
| --- | --- | --- |
| Precios | CRUD y catálogo con inscripción/mensualidad, validación, alias y NULL compatibles con el código de checkout; propuesta por ID y SQL de asignación preparados. | No se asignaron importes. Falta revisar valores reales, Id 4 e integración checkout. |
| Capacidad | 1–120, inicial 100 en altas, validación estricta, control concurrente y conservación de alumnos históricos. | Los ciclos inválidos no admiten nuevas matrículas; no se corrige su capacidad automáticamente. Decisión por ciclo y QA real pendientes. |
| Auditoría de pagos | Diagnóstico de lectura y generador offline de vista previa, respaldo y reversión de ajustes autorizados. | Auditoría de datos reales y saneamiento no ejecutados; pagos históricos intactos. |
| Docentes | Validación de docente/academia/curso, conflictos de docente y aula, cobertura por ciclo. | Revalidación tras cambios de fechas/reactivación, política de publicación y SQL/locks reales pendientes. |
| Dashboard | Filtros operativos, vacantes coherentes y cobertura; sin promedio entre escalas. | Rendimiento semanal sin modelo acreditado; probar con Luis NULL/series vacías y nuevas claves en React. |

El alcance local compatible está implementado. No se declara cumplida la QA
productiva ni los criterios funcionales que todavía requieren decisión del PO.

## B. Verificación

- **217 pruebas aprobadas: 187 node:test + 4 autenticación + 5 cierre + 21 notas/actas; cero fallos/omitidos.**
- Se conserva la suite anterior de 216; se añade una regresión de checkout sin
  PrecioInscripcion ni Precio legado: solicitud pública y confirmación devuelven
  409, no crean cuota ni confirman cobro; la confirmación revierte su transacción.
- Se refuerza la prueba existente de mensualidades: cambiar tarifa de 300 a 500
  y repetir periodo no modifica ni duplica las cuotas emitidas originalmente a 300.
- Continúan pasando pruebas de importe del servidor, pago Pendiente, comprobantes,
  referencias, aprobación administrativa, última vacante y cobertura/dashboard.
- Sintaxis correcta en 75 archivos JavaScript; dependencias instaladas válidas
  según `npm.cmd ls --depth=0`; manifiestos y lockfile intactos.
- Revisión de diferencias y whitespace; escaneo local de claves privadas,
  formatos de tokens conocidos y URLs MySQL con credenciales sin coincidencias.
  No se incluyeron archivos .env privados. Revisión acotada, no certificación de
  ausencia de todo secreto ni auditoría de vulnerabilidades.
- Pruebas aisladas con MySQL/dotenv bloqueados; no hubo cobros, correos reales ni
  escrituras de integración. El SQL nuevo se revisó estáticamente, **no se probó
  con un motor MySQL**.

## C. Tarifas y evidencia por ID

Morgan delegó la definición según confirmación del usuario. Propuesta aprobada:

| Universidades | Inscripción única | Verano/mes | Repaso/mes | Semestral/mes | Anual/mes |
| --- | ---: | ---: | ---: | ---: | ---: |
| UNMSM, UNI, PUCP | 200 | 400 | 500 | 350 | 330 |
| UNFV, UNAC, UNT | 170 | 350 | 450 | 300 | 280 |

Lectura pública real el 31/10 mediante GET de
`https://acadesys-api.onrender.com/api/ciclos/publicos`. Evidencia mínima guardada
en [CATALOGO_PUBLICO_2026-10-31.json](CATALOGO_PUBLICO_2026-10-31.json), sin alumnos
ni datos de pagos. Esta lectura no es QA de la versión local ni confirma su hash.

| IdCiclo | Nombre observado | Universidad | Inscripción propuesta | Mensual propuesta |
| --- | --- | --- | ---: | ---: |
| 1 | Semestral San Marcos | UNMSM | 200 | 350 |
| 2 | Repaso UNI | UNI | 200 | 500 |
| 3 | Veranito San Marcos | UNMSM | 200 | 400 |
| 4 | No aparece en catálogo público: identidad pendiente | Sin confirmar | 170 | 350 |
| 5 | Anual Católica (PUCP) | PUCP | 200 | 330 |
| 6 | Semestral Callao (UNAC) | UNAC | 170 | 300 |
| 10 | Repaso San Marcos | UNMSM | 200 | 500 |
| 11 | Anual UNI | UNI | 200 | 330 |
| 12 | Veranito San Marcos (II) | UNMSM | 200 | 400 |
| 13 | Ciclo Semestral UNFV 2026 | UNFV | 170 | 300 |

Los nueve observados pertenecen a IdAcademia 1; sus nombres/universidades son
coherentes con la propuesta (Veranito se corresponde con la modalidad verano).
La ausencia de Id 4 no prueba inexistencia: podría estar oculto o en otra academia.
No se infiere su identidad ni se copia la de otro ciclo. Id 14 se publica como
«Ciclo UNFV 2026» y 15 como «Ciclo UNMSM 2026»: no revelan modalidad, quedan fuera.
Cualquier otro ID también queda fuera de las asignaciones.

El catálogo desplegado **omite** PrecioInscripcion y PrecioMensual; no devuelve
NULL para esos campos. No se conocen sus valores almacenados. Los precios
publicados del catálogo tampoco acreditan la tarifa canónica de checkout.
Se mantiene la evidencia del usuario: ambas columnas DECIMAL(8,2) NULL existen,
Precio histórico se conserva y Capacidad sigue con default SQL 0. No hay otro ALTER.

### SQL entregado, no ejecutado

[ASIGNACION_PRECIOS_TORITO_2026-10-31.sql](../database/ASIGNACION_PRECIOS_TORITO_2026-10-31.sql):

1. Verifica DDL, inventario y triggers; inicia transacción y bloquea los IDs.
2. Presenta estado anterior, identidad esperada y tarifas propuestas para exportar
   antes de escribir. Requiere backup restaurable y conexión dedicada con permisos
   de lectura de metadatos, sin continuar tras un error.
3. Incluye los diez importes propuestos. Nueve identidades usan los datos públicos;
   Id 4 usa variables NULL y queda excluido hasta confirmar academia, nombre,
   universidad y modalidad real. Su tarifa 170/350 exige verano de UNFV/UNAC/UNT.
4. Solo actualiza ambos campos nuevos, con identidad exacta por ID/academia/nombre/
   universidad. Completa NULL o conserva el importe ya propuesto. Una tarifa
   existente distinta queda excluida para revisión; no se pisa automáticamente.
5. Usa autorización local desactivada por defecto y exige InnoDB/sin triggers
   no revisados. Compara filas esperadas/actualizadas y presenta resultado posterior.
6. Termina en ROLLBACK. No incluye COMMIT. Para aplicar: primero ensayo QA y
   revisión del lote, autorización de ejecución y control de cada resultado en
   la misma conexión. Ante discrepancia, rollback; nunca continuar por error.

No modifica Precio histórico, capacidades, matrículas ni cuotas emitidas. Tampoco
activa cobros ni recalcula mensualidades anteriores. Para revertir una aplicación
futura, utilizar el respaldo aprobado y guardas sobre los valores actuales; no
borrar columnas que Morgan ya utiliza. No se ejecutó ese proceso.

## D–F. Integración, publicación y hash

`git fetch origin` completado: origin/main permanece en `6944740`; no existen
commits remotos pendientes respecto de la rama. Se conserva la base integrada,
sin conflictos ni sustitución de archivos. El commit adicional incluye el SQL,
la evidencia pública, regresión y documentación; su hash se informa al finalizar.

**main local permanece en `2e24822`; origin/main en `6944740`.** La rama de trabajo
contiene origin/main y los avances de Torito, preparada para fast-forward cuando
se satisfaga la condición de publicación. No se requiere un merge con contenido
nuevo ahora. No hay hash publicado ni enlace de una entrega subida a GitHub.

Bloqueos concretos confirmados:

- Auto-Deploy no verificado y sin autorización de despliegue que satisfaga las
  condiciones previas. No se cambia Render ni se usa una marca para omitir deploy.
- Sin integración React/MySQL de esta versión; el frontend no está disponible
  en el workspace y no hay configuración DB_HOST ni acceso configurado a Render.
- Tarifas todavía sin asignar. El helper intacto de Morgan respalda inscripción
  NULL con Precio legado; no respalda mensualidad. El catálogo muestra importes
  legados distintos de la propuesta (p. ej. Id 1: 350 frente a inscripción 200;
  Id 12: 1050 frente a 200). **Si el precio canónico está NULL**, una nueva cuota
  podría usar el legado, aunque siga Pendiente. No se ha demostrado ese estado
  en BD y no se declara que haya ocurrido un cobro. Hay que verificar/aplicar las
  tarifas antes de habilitar el flujo. La API mensual rechaza NULL con 409.
- Capacidades publicadas incompatibles: IDs 2, 3, 5, 6, 10 y 11 en 0; 13 y 15 en
  250. La nueva regla impediría nuevas matrículas en esos ocho, sin expulsar a
  inscritos. Confirmar el tratamiento operativo antes de desplegar.

Comandos finales preparados, **no ejecutados**. Solo después de QA, tarifas
verificadas y confirmación del estado de Auto-Deploy y autorización del despliegue:

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'No se pudo actualizar origin; detenerse.' }
git merge-base --is-ancestor origin/main david/torito-ciclos-oferta
if ($LASTEXITCODE -ne 0) { throw 'Main cambio: integrar en la rama y repetir la verificacion antes de continuar.' }
git switch main
if ($LASTEXITCODE -ne 0) { throw 'No se pudo cambiar a main.' }
git merge --ff-only david/torito-ciclos-oferta
if ($LASTEXITCODE -ne 0) { throw 'No es fast-forward; detenerse sin forzar.' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'Push rechazado; revisar sin force push.' }
git rev-parse main
git ls-remote origin refs/heads/main
# Ambos hashes deben coincidir. Revisar despues el despliegue autorizado en Render.
```

## G. Archivos, HU y pendientes de aceptación

Delta de esta sesión: SQL de asignación, JSON de evidencia pública, este cierre,
actualización de `docs/ENTREGA_TORITO_2026-10-30.md` y
`docs/TRAZABILIDAD_TORITO_HU.md`, y `tests/correcciones-backend.test.js`.
Los 24 archivos anteriores se conservan. El código productivo no se reescribió.
Las rutas de pagos/matrícula/alumno, utils/pagos, referencias/comprobantes y
dependencias son idénticos a origin/main. El parche previo y `.vscode/extensions.json`
permanecen locales sin seguimiento.

HU-01/09/13/20: registrar capacidad 1–120/inicial 100 e históricos.
HU-09/13/20: dos conceptos, NULL/cero, importe del servidor, respaldo legado y
preservación de cuotas emitidas. Los montos están aprobados por delegación, pero
su registro y aceptación en el backlog siguen pendientes del PO.
HU-03/20: precisar pago pendiente/aprobación y regularización retrospectiva.
HU-09/11: definición de datos críticos y publicación/cobertura.
HU-12: transición NULL/serie vacía, KPI de cobertura y modelo semanal.
Se conserva la lectura documental HU-01 a HU-20; no se modificó Trello.

React pendiente: formularios de conceptos separados, no convertir NULL a cero,
precio mostrado igual a inscripción efectiva, errores 409, capacidades históricas,
comprobantes pendientes, filtros y cobertura, ausencia de promedios inventados.
MySQL pendiente: consultas, índices/locks/rollback reales, inventario de precios,
Id 4, modalidades 14/15 y aprobación de ajustes históricos por fila.

## H. Daily Scrum real, sin atribuir avances a fechas distintas

| Día | Hechos verificables | Próximo trabajo | Impedimento |
| --- | --- | --- | --- |
| Lunes 26/10 | No consta actividad ejecutada ese día en esta sesión; se conserva propuesta de planificación, no acta retrospectiva. | Revisar Plan, HU y contratos. | Documentos/esquema en la planificación original. |
| Miércoles 28/10 | No consta implementación ejecutada ese día en esta sesión; no se inventan avances. | Preparar validaciones y diagnóstico. | Decisiones y entorno QA. |
| Viernes 30/10 | Cinco responsabilidades trabajadas localmente; 216 pruebas y commit d16a183, sin publicar. | Revisión, precios por ID y QA. | Tarifas/QA/publicación pendientes entonces. |
| Sábado 31/10, actualización actual | Tarifas recibidas, nueve identidades contrastadas por GET, SQL protegido preparado, suite de 217 y origin/main comprobado. | Validar/aplicar lote por persona autorizada, QA y despliegue autorizado. | Auto-Deploy desconocido y sin integración real, confirmados por usuario. |
