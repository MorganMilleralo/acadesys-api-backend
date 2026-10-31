# Trazabilidad de las cinco tareas de Torito

Fuente leída: `Product_Backlog_AcadeSys_Formato_Academico_Equipo9.docx`,
en Descargas del usuario. Inventario documental de 20 HU, consolidado al 21/10/2026.
Se contrastó con el Plan Integral v1.0 del 26/10 y el código `6944740`.
Los enlaces siguientes proceden del DOCX; **no se consultó ni cambió el tablero
en vivo**. DONE es un estado histórico del documento, no una certificación de QA.

Actualización del 31/10: el usuario confirma delegación de Morgan y tarifas
exactas por universidad/modalidad e IdCiclo. Ya no falta definir esos importes.
Se preparó SQL protegido para los diez IDs propuestos: nueve identidades
contrastadas con el catálogo público, Id 4 sin identidad comprobada y excluido
hasta revisión. Ids 14/15 siguen sin modalidad. Ver [cierre vigente](CIERRE_TORITO_2026-10-31.md).
El usuario confirmó que no hay evidencia actual de Auto-Deploy ni integración
React/MySQL; publicación condicionada y no realizada. Aprobación de tarifas no
equivale a aceptación de historias ni autorización para escribir Aiven.

Los criterios se identifican por su orden en cada ficha; no se inventan nuevos
IDs de aceptación ni se interpretan términos generales como aprobación de una
regla numérica, esquema o proceso financiero concreto.

## Relación verificada

| Responsabilidad 5.2 | HU y criterio comprobado en el documento | Cobertura real y límite |
| --- | --- | --- |
| Precios por ciclo | [HU-09](https://trello.com/c/NESnYWgM), segundo criterio: validar nomenclatura, fechas, precios y capacidad al crear. [HU-20](https://trello.com/c/gBGvRokG), criterios primero/segundo: validar entrada y conservar relaciones correctas. También [HU-13](https://trello.com/c/544Cavtd), tercero: tipos/rangos de precios. | Relación parcial: no definen dos precios, periodicidad mensual, tarifa igual para alumnos, snapshot del importe ni columnas nuevas. HU-20 menciona pagos inconsistentes en la necesidad, pero no detalla su tarifa canónica. |
| Capacidad | [HU-01](https://trello.com/c/rGhjaOjs), segundo/cuarto: capacidad y vacantes reales; ciclo cerrado/sin cupos bloquea checkout. HU-09, segundo/quinto: validación y disponibilidad. HU-13, tercero/quinto: tipos/rangos, aforo lleno y evidencia. HU-20, tercero/cuarto: sin cupo no deja matrícula/pagos parciales; repetición consistente. | Sí respaldan disponibilidad real, validación, no sobreventa y regresión concurrente. **Ninguna fija 1–120, default 100 ni conversión de históricos 0/NULL.** Esos cambios vienen del Plan Integral y deben actualizar el backlog con aprobación. |
| Auditoría de pagos | [HU-03](https://trello.com/c/7D5ISNES), tercero y observación: simulación claramente identificada, nunca cobro real ficticio. HU-20: datos/relaciones consistentes y no duplicados; HU-13: validación financiera. | Relación parcial. No incluyen regularización retrospectiva, cuotas mensuales, vencimientos, comprobantes ni autorización para cambiar importes. Diagnóstico técnico puede aportar evidencia; reparación necesita decisión explícita y actualización de alcance. |
| Asignaciones docentes | HU-09, tercero/cuarto: rechazar cursos repetidos/conflictos y no publicar si faltan datos críticos. [HU-11](https://trello.com/c/WlR7B05t): CicloCurso, docente activo, no solapar aulas ni docentes, detalle con relaciones reales. | Sí respaldan validación docente, relación curso/ciclo, cruces de docente/aula y detalle veraz. La definición exacta de datos críticos, obligatoriedad de cobertura completa, porcentajes, pendientes y asignación masiva necesita precisarse. No autorizan inventar relaciones ni borrar Aula. |
| Dashboard | [HU-12](https://trello.com/c/mD88eEHS): indicadores reales de la academia; morosidad sin ciclo fijo; solo simulacros semanales; escalas distinguibles; hora/refetch; ausencia o escala desconocida como vacío/no comparable. | Sí respalda retirar cálculos incomparables y mostrar estado pendiente si no se acredita semana/escala. No define un KPI de cobertura docente ni una eliminación contractual concreta de una clave JSON. Esa respuesta debe coordinarse con Luis. |

## Decisiones y propuestas para Morgan (no aprobadas por esta matriz)

Actualización del 30/10: el usuario confirmó las dos columnas en Aiven y autorizó
implementar precios separados, capacidad 1–120/inicial 100 y cobertura en dashboard.
Ya están en el código local. Esa autorización no demuestra que Morgan haya
actualizado formalmente los criterios de las HU; las ampliaciones siguientes
siguen pendientes de registro/aprobación Scrum. No se aplicaron tarifas ni
regularizaciones sobre datos reales.

1. **Capacidad 1–120/default 100.** Actualizar HU-09/HU-13 y compatibilidad
   HU-01/HU-20 con límites exactos, política de 0/NULL y tratamiento de ciclos con
   >120 inscritos. El plan la denomina acordada en 3.3, pero la sección 10 mantiene
   coordinación y las HU no contienen esos valores. Por instrucción del usuario,
   la versión anterior quedó en un parche. Con la instrucción más reciente del
   usuario se incorporó a las rutas: históricos conservados y nuevas matrículas
   bloqueadas hasta revisar capacidad inválida. Falta acordar saneamiento por ID.
2. **Dos precios por concepto.** Ampliar HU-09/HU-20 (o crear historia separada)
   con nombres, tipos, cero/null, conservación de importes emitidos y compatibilidad
   de `Precio`. DDL confirmado por usuario el 30/10: ambos campos existen como
   DECIMAL(8,2) NULL. Backend completado e importes propuestos aprobados el 31/10;
   falta aplicación controlada tras validar identidad (en particular Id 4), QA
   de checkout y aceptación formal del contrato de alias/NULL.
3. **Cuotas, comprobantes y reparación histórica.** Precisar nuevas historias o
   criterios financieros. HU-03 aún describe una matrícula condicionada a éxito
   de simulación, mientras el contrato reciente de Morgan registra inscripción
   Pendiente y aprobación posterior del comprobante. Debe actualizarse el backlog;
   no restaurar el flujo antiguo ni eliminar lo implementado por Morgan.
4. **Cobertura/publicación.** HU-09 ya exige bloquear publicación por datos
   críticos: falta decidir cuáles y cómo completar un borrador si las rutas
   actuales exigen ciclo activo para asignar docentes/horarios. Proponer una
   distinción de preparación/visibilidad sin inventar una columna o estado ahora.
   Asignación masiva y porcentajes son refinamientos no explícitos de HU-11.
5. **Dashboard.** Confirmar con Luis la transición a `promedioInstitucional:null`
   y serie académica vacía con motivo hasta acreditar simulacro/escala. Proponer
   KPI de cobertura como ampliación de HU-12; ya se añadió al dashboard local
   por instrucción expresa del usuario, sin atribuir aprobación formal del backlog.
6. **Semana y escala.** HU-12/13/16 prohíben inferir semanas; General y FechaCreacion
   no bastan. No se desarrolla el modelo semanal como tarea adicional de esta
   sesión ni se inventa una escala para permitir un promedio.

HU-14 a HU-19 se leyeron para contexto; sus responsables no amplían automáticamente
las cinco tareas de esta semana. No se cambiaron JWT, credenciales, CORS, materiales
ni el contrato de cierres.

## Qué queda activo y qué queda preparado

- Implementación activa local: validaciones de cruces docentes/aulas al guardar,
  consulta de cobertura a partir de relaciones reales, filtros operativos y
  cobertura del dashboard, estado no comparable y prueba de última vacante.
- Capacidad aplicada: 1–120/inicial 100; no se modificaron filas históricas ni
  alumnos. El parche anterior se conserva como evidencia, no se vuelve a aplicar.
  Falta registro formal de los criterios y resolución individual de históricos.
- Diagnósticos y regularización: SQL de solo lectura y generador offline preparados
  por solicitud del usuario; nunca ejecutados contra BD. Cualquier aplicación de
  importes es una decisión de negocio pendiente, no una consecuencia de HU-20.
- Precios: CRUD/catálogo completados contra columnas confirmadas; conservan
  Precio histórico, importes emitidos y respaldo de inscripción de Morgan.
  Mensualidad NULL no hereda Precio. La propuesta comercial por IdCiclo ya tiene
  importes aprobados y SQL preparado; no se aplicó sobre datos. El catálogo
  público no expone los precios nuevos, por lo que faltan exportación/QA de
  valores canónicos y validación de Id 4. No se activaron estimaciones.
- Los contratos nuevos de respuesta y ruta siguen sujetos a revisión con el equipo;
  no se publicó ni integró nada en main.
