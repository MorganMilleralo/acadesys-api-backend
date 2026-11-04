# Verificación para publicar Mercado Pago sin habilitar cobros

Revalidación: 2026-11-04. Base de trabajo: `747e758`, rama `david/mercadopago-seguro`.

## Resultado

Preparación local terminada; **push detenido hasta que el usuario confirme
Auto-Deploy Off y autorice expresamente la publicación**.
No se consultó ni ejecutó SQL en Aiven, no se modificó Render y no se activaron
credenciales, webhooks del proveedor ni cobros. La publicación de código solicitada
se distingue de habilitar el servicio: las pruebas oficiales de Mercado Pago,
React y MySQL quedan para antes de esa habilitación.

## Git y conservación

`git fetch origin` mantiene `origin/main` en `c9bf07a`, que ya está contenido en
`747e758` a través de `796d951`. También se conserva el commit local `6a20a3f`.
No fue necesaria otra integración de cambios remotos. Las 98 pruebas originales
de Mercado Pago se conservan; se refuerza una y se añaden dos regresiones.

La corrección posterior se identifica por el mensaje
`fix: bloquear checkout sin credenciales antes de reservar o reutilizar`.
El hash candidato se informa al finalizar. La integración local a main se puede
hacer por fast-forward; no requiere reescribir el historial.

## Comprobaciones realizadas

| Comprobación | Resultado |
| --- | --- |
| Suite antes de la revisión adicional | 316 aprobadas, 0 fallos. |
| Suite completa final | 318 aprobadas, 0 fallos: 288 node:test + 4 autenticación + 5 cierre + 21 notas/actas. |
| Sintaxis | `node scripts/check-sintaxis.js`: 84 archivos JS correctos. |
| Dependencias | `npm.cmd ls --depth=0` correcto; SDK 3.6.1. |
| Vulnerabilidades | `npm.cmd audit --omit=dev`: 0 vulnerabilidades reportadas. |
| Credenciales ausentes | 503 `PASARELA_NO_CONFIGURADA`, sin acceder a tablas de pagos, modificar cuotas, devolver URLs existentes ni llamar al proveedor. |
| Webhook | Firma inválida: 401 sin consultas al proveedor ni BD. API inválida/temporal: error sin confirmar. Confirmación válida requiere consulta y commit. |
| DDL respecto a origin/main | Sin cambios en `database`, SQL inicial ni configuración de BD; sin migración añadida por esta rama. |
| Secretos | Revisión del contenido a publicar; sin archivos `.env` reales ni patrones de credenciales reales detectados. |
| Espacios | Cambios de Mercado Pago y corrección: limpios. El diff total incluye avisos del parche histórico descrito abajo. |

Los dobles de prueba bloquean conexiones reales a MySQL y llamadas externas al
proveedor. No se verifican las variables activas ni el esquema vivo de Render/Aiven.

## Corrección acotada descubierta en esta revisión

En `747e758`, si existía una URL de checkout pendiente, el endpoint la reutilizaba
antes de comprobar las credenciales. Una prueba nueva reprodujo `200` al retirar
el token, cuando la condición de publicación solicitada exige `503`.

Se añadió `verificarConfiguracion()` al adaptador y se invoca antes de reservar
o reutilizar una transacción. Solo valida configuración local; no llama a la API.
Ahora la ausencia de token, secreto o vendedor bloquea también URLs guardadas.
La prueba previa de configuración ausente comprueba además que no se crea una
reserva; dos casos nuevos cubren URLs existentes y tablas de pago inaccesibles.
También se verifica que restaurar la configuración permite volver a reutilizar
el checkout guardado, sin crear otra preferencia ni modificar pagos.

Este bloqueo es local: **no cancela ni invalida una preferencia ya creada en
Mercado Pago**. Una URL entregada previamente puede seguir siendo utilizable
en el proveedor. No se ha solicitado ni ejecutado ninguna operación remota para
cancelarla. La comprobación previa valida presencia/configuración local; no
certifica que un token presente continúe siendo válido en la API.

Archivos de código: `services/mercadopago.adapter.js`,
`routes/alumno-checkout.routes.js`, `tests/mercadopago-flujo.test.js`.
No se reconstruye la integración ni se modifica el mecanismo de confirmación.

## SQL y diferencia histórica

El DDL de `PagoTransaccion` pertenece a `c9bf07a`, ya publicado por Morgan. Esta
entrega no añade ni ejecuta migraciones. El modo sin credenciales devuelve 503
antes de consultar esa tabla, por lo que publicar el código deshabilitado no
requiere ejecutar una migración de esta rama. El esquema real y sus restricciones
siguen pendientes de verificación antes de habilitar pagos, según lo solicitado.

`git diff origin/main...HEAD --check` señala 21 espacios al final de líneas de
`propuestas/CAPACIDAD_120_PENDIENTE_MORGAN.patch`, incluido en `6a20a3f`. Son líneas
vacías de contexto del formato unified diff. El archivo se conserva íntegro como
evidencia; `git apply --numstat` comprueba que se puede leer como parche, sin aplicarlo.
El diff excluyendo únicamente ese archivo histórico no presenta errores. No es
una migración ni una tarea pendiente de instalación; véase `propuestas/README.md`.

## Única comprobación externa que detiene el push

No hay acceso autenticado disponible a Render: el plugin existe pero no está
conectado; tampoco se encontró CLI ni configuración/credencial Render local
utilizable. La documentación del repositorio no demuestra el estado actual del
servicio. Por tanto **no se puede afirmar que Auto-Deploy esté desactivado**.

Falta leer, en el servicio backend de AcadeSys vinculado a
`MorganMilleralo/acadesys-api-backend` y rama `main`, el ajuste **Settings →
Auto-Deploy = Off**. `After CI Checks Pass` sigue siendo despliegue automático.
Esta distinción está documentada por [Render](https://render.com/docs/deploys#configuring-auto-deploys).
La comprobación debe ser de solo lectura; no está autorizada una modificación de
la configuración. Conectar Render permitiría consultar el servicio.

Solo tras la confirmación de `Off` y la autorización del usuario, repetir fetch,
integrar cualquier avance nuevo sin force y revalidar si cambió el código.
Con el árbol limpio, ejecutar `git switch main`,
`git merge --ff-only david/mercadopago-seguro` y `git push origin main`.
Si main ya no admite fast-forward, integrar primero las novedades sin sobrescribirlas.
Después del push,
verificar que `origin/main` contiene `747e758` y el commit correctivo, e informar
el hash efectivamente publicado y su enlace de GitHub. Hasta entonces, un hash
local candidato no debe presentarse como publicado.
