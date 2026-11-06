# Entrega Morgan — backend/fullstack de pagos AcadeSys

Este paquete contiene **archivos completos de reemplazo** y archivos nuevos para la parte asignada a Morgan: integración checkout/precio de inscripción, cuotas mensuales, endpoints del alumno, comprobantes, confirmación administrativa, auditoría, diagnóstico de datos y pruebas puras. No es un reemplazo del repositorio completo.

## Contenido

- `routes/matriculas.routes.js`: usa `PrecioInscripcion` como campo canónico con fallback temporal a `Precio`; crea como máximo una cuota `Inscripcion` activa por alumno/ciclo y registra auditoría cuando crea una cuota nueva.
- `routes/alumno.routes.js`: añade consulta de pagos propios, instrucciones de pago manual y registro de referencia/comprobante con aislamiento por usuario/academia.
- `routes/pagos.routes.js`: generación idempotente de mensualidades, listado administrativo, cola de comprobantes, aprobación/rechazo auditados y bloqueo de confirmación directa.
- `utils/pagos.js`: validaciones compartidas de precio, periodo, vencimiento, referencia y ruta de comprobante.
- `database/diagnostico_morgan_pagos.sql`: solo lectura.
- `database/migrations/20261028_morgan_pagos.sql`: migración aditiva de precios, vencimiento, comprobantes y auditoría.
- `scripts/regularizar-inscripciones-pendientes.js`: vista previa por defecto de cuotas pendientes desalineadas (inscripción y mensualidades); para aplicar requiere lista explícita de IDs, `CONFIRMAR_AJUSTE_PAGOS=SI` y el ID de un administrador activo que aprueba el ajuste (`PAGO_AJUSTE_ACTOR_ID`).
- `docs/CONTRATO_PAGOS_MORGAN.md`: contrato para integración con Yan, Luis y Torito.
- `tests/pagos-utilidades.test.js`: pruebas unitarias puras de validación.
- `tests/correcciones-backend.test.js`: incluye actualización del fixture de checkout para la auditoría y consulta idempotente nueva.

## Variables opcionales de transferencia manual

```dotenv
PAYMENT_ACADEMY_ID=
PAYMENT_BANK_NAME=
PAYMENT_ACCOUNT_HOLDER=
PAYMENT_ACCOUNT_NUMBER=
PAYMENT_CCI=
PAYMENT_INSTRUCTIONS=
```

`PAYMENT_ACADEMY_ID` debe ser el ID validado de la academia dueña de la cuenta. El código no muestra estas instrucciones a sesiones de otra academia. Como estas variables son globales al despliegue, no rellenarlas si el mismo backend gestiona varias academias con cuentas bancarias diferentes; en ese caso debe implementarse configuración por academia en base de datos antes de activar el pago manual.

## Antes de copiar

1. Confirma el commit y los cambios locales reales de backend. Haz una rama de trabajo y revisa `git diff`; no copies sobre cambios simultáneos de Torito.
2. Ejecuta `database/diagnostico_morgan_pagos.sql` con autorización de solo lectura. Guarda `SHOW CREATE TABLE` e índices de las tablas. El diagrama adjunto no certifica que Aiven tenga el mismo esquema.
3. Haz backup y prueba la migración en QA/copia aislada. La migración crea columnas/tablas nuevas y no puede ser revertida con solo `ROLLBACK` porque MySQL puede hacer commit implícito con DDL.
4. Configura `PrecioMensual` para los ciclos antes de generar mensualidades. La migración lo deja `NULL` deliberadamente; no inventa importes.
5. Revisa/autoriza las tarifas de inscripción. La migración copia `Ciclo.Precio` a `PrecioInscripcion`; no decide si los importes actuales de cada ciclo son comercialmente correctos.
6. Instala dependencias en la copia del repositorio (`npm ci`) y ejecuta `npm test`. El script ya descubre las pruebas `*.test.js` automáticamente.
7. Ejecuta las pruebas de integración con la base de QA, las cuentas reales de cada rol y transferencias/comprobantes ficticios. No envíes dinero ni correos a usuarios reales durante QA.

## Validación ejecutada en la preparación de este paquete

- `node --check` pasó para los tres archivos de ruta completos, el script de regularización y las pruebas incluidas modificadas.
- `node --test tests/pagos-utilidades.test.js`: 6/6 pruebas pasaron.
- No se pudo ejecutar aquí la suite backend completa porque el entorno de preparación no incluye `node_modules` (Express/MySQL2/Bcrypt/JWT). La suite completa debe ejecutarse después de `npm ci` en el repositorio.
- No se conectó a Aiven/producción, no se ejecutaron migraciones ni se cambió el despliegue.

## Estado de producción

Este paquete **no declara un cobro real**: el checkout continúa en estado pendiente y el método manual requiere una revisión administrativa. Una pasarela real solo debe activarse cuando el proveedor y su mecanismo de verificación servidor-a-servidor estén definidos.
