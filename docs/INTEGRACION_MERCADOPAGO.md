# Integración de Mercado Pago — entrega local, 2026-11-03

La revisión posterior para publicar el código sin habilitar cobros está en
[VERIFICACION_PUBLICACION_MERCADOPAGO.md](VERIFICACION_PUBLICACION_MERCADOPAGO.md).
Ese informe registra la comprobación previa de credenciales, las 318 pruebas
finales y la condición pendiente de Auto-Deploy. Los resultados y condiciones
de esta entrega original describen el commit `747e758`.

Implementación preparada para QA con simulaciones. No se hicieron cobros, conexiones
a Aiven, migraciones, push ni despliegues. La validación oficial de cuenta y pagos
sigue pendiente de credenciales y un entorno de QA independiente.

## Base y conservación del trabajo del equipo

Se ejecutaron `git status` y `git fetch origin`. El remoto avanzó desde `2de9a05`
hasta `c9bf07a` (`feat: integrar mejoras del sistema de pagos`). Localmente existía
`6a20a3f` (`docs: retirar informes`), todavía no publicado. Ambos historiales se
conservaron mediante el merge `796d951` en `david/mercadopago-seguro`, sin conflictos.
No se repusieron los informes retirados por el commit local.

Se reutilizan las rutas de Morgan, su reserva de checkout, `PagoTransaccion`,
`PagoAuditoria` y `PagosMensualidad`. Se inspeccionaron los DDL versionados
`20261103_morgan_pago_transaccion.sql` y `20261028_morgan_pagos.sql`.
No se crea ni altera ninguna tabla. No se modifican los módulos académicos, las
cinco responsabilidades anteriores, las rutas de matrícula ni el flujo manual
de `PagoComprobante`. El DDL versionado no certifica el esquema vivo de Aiven.

## Archivos entregados

| Archivo | Cambio |
| --- | --- |
| `services/mercadopago.adapter.js` | SDK oficial, preferencias, firma y lectura verificada del pago. |
| `services/transacciones-pago.service.js` | Reserva existente reforzada, confirmación y estados bajo lock, control de versiones y auditoría. |
| `routes/alumno-checkout.routes.js` | Conserva contrato HTTP y oculta detalles privados de errores SQL/SDK. |
| `routes/mercadopago-webhook.routes.js` | Nuevo endpoint público autenticado por firma; errores y reintentos. |
| `utils/pagos-proveedor.js` | Errores seguros, céntimos exactos, IDs y URLs de checkout. |
| `index.js` | Monta webhook antes de JWT y limita su JSON a 32 KiB. |
| `package.json`, `package-lock.json` | Dependencia exacta `mercadopago@3.6.1`. |
| `.env.mercadopago.example` | Configuración documentada sin secretos. |
| `tests/mercadopago-adapter.test.js` | SDK real con transporte HTTP simulado y firma real. |
| `tests/mercadopago-flujo.test.js` | Flujos HTTP, concurrencia, deduplicación y rollback simulados. |
| `tests/mercadopago-montaje.test.js` | Arranque de `index.js`, orden de middleware, JWT y parser. |
| `tests/mercadopago-soporte.js` | Proveedor y BD simulados; mutex en lectura de cuota bloqueante. |
| `docs/CONTRATO_CHECKOUT_MERCADOPAGO_MORGAN.md`, este informe | Contrato definitivo y guía de QA/operación. |

## Adaptador y contratos HTTP

Se eligió **Checkout Pro mediante Preferences API**, compatible con el contrato
genérico de Morgan y su botón de redirección. No se mezclan preferencias con
Checkout API Orders ni se implementa un segundo checkout.

`crearOrdenPago` mantiene sus argumentos y devuelve exactamente
`{ idOrdenProveedor, checkoutUrl, estado: 'pending' }`. Usa `Preference.create`
del SDK oficial. La referencia externa y `metadata.acadesys_transaction_id`
provienen de la reserva. La moneda es PEN y el importe proviene de la cuota en BD.
Una preferencia creada nunca confirma la mensualidad.

| Método y ruta | Comportamiento |
| --- | --- |
| `POST /api/alumno/pagos/:idPago/checkout` | JWT + Alumno/Estudiante. 201 al crear, 200 al reutilizar, 409 en preparación o conflicto, 503 sin configuración, 502 ante fallo de proveedor. |
| `GET /api/alumno/pagos/:idPago/estado` | JWT + titularidad. Solo lee BD; ignora estados e IDs recibidos por query de retorno. |
| `POST /api/webhooks/mercadopago?data.id=ID&type=payment` | Sin JWT; exige HMAC, timestamp reciente y evento `payment`. |

Antes de crear, `User.get` verifica `seller_id`, `site_id=MPE`, `country_id=PE`
y la etiqueta `test_user` según el entorno. El retorno utiliza `init_point` del
proveedor, limitado a HTTPS y dominios oficiales exactos de checkout, incluyendo
el dominio global y el peruano. No se deduce el entorno del prefijo del token.
La guía oficial de pruebas usa cuentas de comprador y vendedor de prueba:
[pruebas de Checkout Pro Preferences](https://www.mercadopago.com.pe/developers/es/docs/checkout-pro-preferences/integration-test/introduction?scope=prod).

## Webhook y condiciones para confirmar

1. Exige `x-signature`, `x-request-id` únicos y `data.id` de query numérico, sin
   arrays ni coerciones. Si el cuerpo aporta ID, debe coincidir. Solo acepta `payment`.
2. Verifica HMAC mediante `WebhookSignatureValidator.validate` del SDK oficial.
   Aplica tolerancia absoluta de 300 segundos y rechaza firmas antiguas o futuras.
   Se acepta `ts` de 10 dígitos (segundos) o 13 (milisegundos); el valor firmado
   nunca se modifica. Este control temporal es propio porque SDK 3.6.1 interpreta
   su opción `toleranceSeconds` solo en segundos, mientras la documentación muestra
   ejemplos en milisegundos. Véanse la [guía oficial del SDK](https://github.com/mercadopago/sdk-nodejs/blob/master/docs/webhooks.md)
   y la [configuración de notificaciones](https://www.mercadopago.com.pe/developers/es/docs/checkout-pro-preferences/payment-notifications).
3. Consulta, en orden, `Payment.get`, `MerchantOrder.get` y `Preference.get`.
   El ID del pago, el ID de la orden comercial y el ID de la preferencia son distintos.
   **`PagoTransaccion.IdOrdenProveedor` almacena el ID de preferencia.**
4. Contrasta vendedor, `live_mode`, pertenencia del pago a la orden, preferencia,
   referencia externa exacta, metadata de transacción, importe completo, PEN,
   cantidad de ítems, captura y ausencia de reembolso para aprobar.
5. Localiza la transacción; bloquea primero la cuota y luego la transacción con
   `SELECT ... FOR UPDATE`. Revalida alumno, academia, referencia, preferencia,
   importe reservado e importe actual de cuota antes de escribir.
6. Solo `approved` capturado puede ejecutar el UPDATE condicional de
   `Pendiente`/`Moroso` a `Pagado`. Comprueba filas afectadas; escribe transacción,
   auditoría de confirmación y recibo de versión dentro del mismo COMMIT.
7. Devuelve 200 únicamente después del COMMIT, también para duplicados o versiones
   atrasadas ya registradas. Un error de escritura o commit nunca se responde como éxito.

Si el webhook llega mientras la preferencia aún se guarda, solo puede vincular un
ID faltante a una reserva `CREANDO` cuya referencia y metadata hayan sido verificadas.
Una respuesta tardía de creación no reemplaza otra preferencia ni degrada `APROBADA`.

## Idempotencia, concurrencia y estados

La cuota se bloquea al reservar. Un intento abierto se reutiliza y una reserva
`CREANDO` impide nuevas creaciones. La clave persistida `ClaveIdempotencia` se envía
en `X-Idempotency-Key`. No se presupone una garantía de deduplicación de Preferences
solo por enviar esa cabecera: el control local también impide repetir el POST.
El SDK está configurado con `maxRetries: 0`.

Tras timeout, desconexión, 429, error 5xx, respuesta inválida o fallo de persistencia,
la reserva permanece `CREANDO`. No hay caducidad que libere automáticamente un intento
ambiguo. Solo fallos previos a crear y rechazos definitivos 400/401/403/422 permiten
marcar `ERROR`. Véase el criterio de [reintentos del SDK](https://github.com/mercadopago/sdk-nodejs/blob/master/docs/request-options.md).

Los pagos rechazados/cancelados mantienen su preferencia para reintentar dentro del
mismo checkout. No generan otra preferencia. Una cuota cuyo importe cambió desde
la reserva requiere conciliación en vez de reutilizar una URL por otro importe.

El evento `MERCADOPAGO_EVENTO` de `PagoAuditoria` guarda en `Motivo` un JSON compacto:
`{v, transaccion, pago, preferencia, actualizado, estado}`. `actualizado` es el
`date_last_updated` consultado por API, en milisegundos. Los campos caben en los
VARCHAR existentes. No se almacena la notificación completa, datos bancarios ni secretos.
Este recibo durable controla repetición y orden por payment ID bajo el lock de cuota;
no depende de memoria del proceso ni del ID de notificación enviado en el cuerpo.
No se deben depurar estos recibos mientras existan pagos asociados.

| Estado del proveedor | Resultado |
| --- | --- |
| `pending`, `in_process`, `authorized`, `in_mediation` inicial | Transacción pendiente; cuota sin confirmar. |
| `rejected` | Transacción rechazada; cuota sin confirmar. |
| `cancelled` | Transacción cancelada; cuota sin confirmar. |
| `approved` capturado por el total y sin reembolso | Confirmación transaccional o registro de pago adicional. |
| `refunded`, `charged_back` | Auditoría de revisión; nunca revierte automáticamente una cuota ya pagada. |
| Desconocido, parcial, identidad/importe/moneda inconsistentes | Error; ninguna confirmación. |

Una versión antigua no pisa otra más reciente; un mismo payment ID en estado final
no retrocede por un aviso. Las transiciones contradictorias, incluida una disputa
posterior que requiera conciliación, responden error. Otro pago aprobado para una
cuota ya pagada genera `PAGO_DUPLICADO_PROVEEDOR`; conserva fecha y estado de la cuota.
Si ya estaba aprobada la misma preferencia, mantiene `APROBADA` y audita el pago extra.
Cuando la cuota estaba pagada manualmente, marca la transacción `PAGO_DUPLICADO`.

## Configuración y operación pendientes

| Variable | Valor requerido |
| --- | --- |
| `MERCADOPAGO_ENV` | `test` por defecto; `production` solo para la activación deliberada posterior. |
| `MERCADOPAGO_ACCESS_TOKEN` | Token privado del vendedor correspondiente al entorno. |
| `MERCADOPAGO_WEBHOOK_SECRET` | Secreto de firma de la aplicación/entorno que enviará notificaciones. |
| `MERCADOPAGO_SELLER_ID` | ID numérico de la cuenta vendedora. |
| `MERCADOPAGO_WEBHOOK_URL` | HTTPS público, ruta exacta `/api/webhooks/mercadopago`, sin query. El adaptador añade `source_news=webhooks`. |
| `PAYMENT_RETURN_URL` | URL HTTPS de React que muestra el estado consultado al backend. |

No se abrieron ni modificaron archivos `.env` reales. La falta de configuración
mantiene 503 y permite continuar usando el flujo manual existente.

En Mercado Pago: preparar aplicación Checkout Pro Preferences, vendedor y comprador
de prueba peruanos separados, sus credenciales y tarjetas oficiales de prueba.
Configurar únicamente el tópico de pagos de esta integración y el secreto del entorno.
Probar con recursos asociados a una preferencia creada por este backend; un ID ficticio
del simulador que no exista en la API será rechazado intencionalmente.

En Render: preparar servicio QA y BD QA separados, cargar las seis variables,
usar una versión Node compatible (SDK requiere >=18; ejecución local: 24.22.0),
instalar con `npm ci` y comprobar alcance HTTPS del webhook sin JWT. Mantener reloj
sincronizado. Validar en React el retorno pendiente, consulta posterior de estado,
doble clic, 409/502/503 y continuidad del comprobante manual.

El timeout de transporte es 4 s; cada llamada SDK tiene además límite integral de
5 s, incluyendo el JSON. Las tres lecturas secuenciales del webhook pueden consumir
15 s antes de BD. No se mantiene un lock SQL durante llamadas externas.
No hay cola durable añadida: las fallas devuelven 502/503 y `Retry-After: 60` como
indicación, aunque el calendario efectivo lo decide Mercado Pago. Su documentación
indica acuse en 22 s, intentos iniciales cada 15 minutos y luego intervalos mayores.
Ver [entrega y reintentos oficiales](https://www.mercadopago.com.pe/developers/es/docs/checkout-pro-preferences/payment-notifications).
La latencia y contención SQL deben medirse en QA; si venciera el request tras un
COMMIT, el siguiente aviso se reconoce por el recibo persistido.

Ante una reserva `CREANDO` sin respuesta: revisar por `ReferenciaInterna` con la API
de búsqueda de preferencias y consultar la preferencia encontrada. No cambiar a
`ERROR`, borrar la fila ni crear otro intento para desbloquear la pantalla sin
conciliar primero. Si existe un pago, reenviar su notificación desde el proveedor:
el webhook puede completar la vinculación de la reserva. Si solo existe preferencia,
recuperar ID/URL mediante la operación interna `guardarOrdenCreada` después de
verificar vendedor, referencia, metadata, moneda e importe; no hay endpoint público
para forzar este paso. La ausencia en una búsqueda aislada no prueba que no se creó.
Este procedimiento es operativo; no se automatiza una nueva creación ambigua.

## Verificación local

La suite completa pasa: **316 casos, 0 fallos** (286 `node:test`, más 4 de
autenticación, 5 de cierre y 21 de notas/actas). Son las 218 pruebas previas
más 98 casos nuevos. Los errores impresos durante los casos de fallo son inducidos.

| Requisitos solicitados | Cobertura |
| --- | --- |
| 1–3: preferencia, credenciales, errores/timeouts | `mercadopago-adapter.test.js`, SDK real con transporte simulado. |
| 4–6: duplicados, cuota ajena y pagada | `mercadopago-flujo.test.js`, HTTP y reserva con mutex. |
| 7–9: firma válida/inválida y repetición | Ambas suites; HMAC del SDK sin mocks del validador. |
| 10–13: pendiente, aprobado, rechazado, cancelado | Flujos que verifican estado de cuota y auditoría. |
| 14–16: monto, moneda y referencia | Validación de API y revalidación contra la BD simulada. |
| 17: notificaciones concurrentes | Dos conexiones simuladas, lock de cuota, una confirmación; también consultas que terminan en orden inverso. |
| 18: retorno sin confirmación | Query `status=approved` no genera consultas al proveedor ni escrituras. |
| 19: flujo manual | Regresiones existentes de comprobantes en `correcciones-backend.test.js`; pago manual previo no se confirma otra vez. |
| 20: fallo de escritura | Rollback de cuota/transacción/auditoría/commit y rechazo de `affectedRows=0`; reintento posterior correcto. |

Comandos: `npm.cmd test`, `node scripts/check-sintaxis.js`, comprobación explícita
de sintaxis de archivos nuevos, `npm.cmd ls --depth=0`, `npm.cmd audit --omit=dev`
y `git diff --check`. La revisión de secretos se limita al contenido que se añade
al commit; los tests usan valores ficticios y bloquean red externa real.
Resultado: sintaxis correcta en 84 archivos JavaScript, árbol de dependencias
válido, 0 vulnerabilidades reportadas por npm audit y diff sin errores de espacios.
Los 15 archivos de entrega se revisaron sin encontrar patrones de credenciales reales.
El segundo fetch mantuvo `origin/main` en `c9bf07a`.

Los mocks comprueban parámetros, estados, exclusión y restauración; **no prueban
el SQL ejecutándose en MySQL**, sus índices, aislamiento, triggers ni durabilidad.
El montaje real de Express usa pool ficticio y sustituye dotenv sin abrir `.env`.

## Commit local y condiciones de publicación

Rama: `david/mercadopago-seguro`. El commit de implementación se identifica por
`feat: integrar Mercado Pago con webhook verificado y auditoría transaccional`;
su hash se entrega en el resumen final del trabajo. El merge previo es `796d951`.
No se hizo push y no se cambió Render.

Para publicar a main:

1. Revisar este diff y el flujo de confirmación con Morgan.
2. Verificar en QA `SHOW CREATE TABLE` de las tres tablas existentes, engine InnoDB,
   tipos, columnas, longitud de `Motivo`, índices únicos y permisos de escritura.
   No ejecutar de nuevo los CREATE de las tablas ya existentes.
3. Probar con las cuentas oficiales de prueba: aprobación, rechazo, pendiente,
   reenvíos, timeout, doble click y concurrencia SQL real; revisar cuota y auditoría.
4. Verificar el contrato React/Render y resolver cualquier diferencia real de
   la cuenta peruana, URL de checkout, firma o payload. No se certifican sin credenciales.
5. Mantener deshabilitados pagos combinados/parciales para esta entrega: requiere
   un solo pago capturado por el importe completo, no agrega importes de varios pagos.
6. Repetir fetch, integrar avances adicionales y ejecutar la suite antes de publicar.
   Desactivar Auto-Deploy de Render antes del push, conforme a la restricción existente
   del repositorio, y obtener autorización de publicación/despliegue posterior.
