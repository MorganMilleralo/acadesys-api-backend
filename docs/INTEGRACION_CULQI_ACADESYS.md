# Integración Culqi — AcadeSys

## Objetivo

Sustituir el proveedor de checkout de las mensualidades por Culqi para mostrar pagos
con billeteras móviles (Yape, Plin y otras opciones habilitadas para el comercio),
conservando la reserva interna, el control de duplicados, el historial y el medio de
transferencia manual de AcadeSys.

La integración usa Culqi Custom Checkout multipago con una orden creada previamente.
Para el flujo QR se habilita `billetera` (Yape/Plin y otras billeteras móviles admitidas
por el comercio) y se deshabilita el método separado `yape` de código de aprobación.
Culqi documenta que `settings.order` y `settings.amount` son necesarios para mostrar
los medios de pago alternativos; `paymentMethods.yape` y `paymentMethods.billetera`
permiten habilitar Yape y las billeteras. El QR lo presenta Culqi dentro del checkout.

Los pagos QR por billeteras móviles están documentados para importes de S/ 6 a S/ 500, en PEN.
El backend valida ese rango antes de crear una orden. Una cuota de S/ 400 está dentro
 del rango documentado.

## Archivos del paquete

### Backend — reemplazar

- `backend/services/transacciones-pago.service.js` → `backend/services/transacciones-pago.service.js`
- `backend/routes/alumno-checkout.routes.js` → `backend/routes/alumno-checkout.routes.js`
- `backend/utils/pagos-proveedor.js` → `backend/utils/pagos-proveedor.js`

### Backend — agregar

- `backend/services/culqi.adapter.js`
- `backend/routes/culqi-webhook.routes.js`
- `.env.culqi.example` (solo plantilla; no es un `.env` operativo)

### Frontend — reemplazar

- `frontend/src/services/pagosOnline.api.js` → `src/services/pagosOnline.api.js`
- `frontend/src/components/BotonPagoOnline.jsx` → `src/components/BotonPagoOnline.jsx`
- `frontend/src/components/PanelPagosAlumno.jsx` → `src/components/PanelPagosAlumno.jsx`

Los archivos de Mercado Pago se conservan en el repositorio para permitir una reversión
controlada. El proveedor se selecciona por `PAYMENT_PROVIDER` en Render.

## Variables de Render

Configurar en el servicio backend de Render:

```env
PAYMENT_PROVIDER=CULQI
CULQI_PUBLIC_KEY=pk_test_REEMPLAZAR
CULQI_SECRET_KEY=sk_test_REEMPLAZAR
CULQI_WEBHOOK_USERNAME=acadesys-culqi
CULQI_WEBHOOK_PASSWORD=REEMPLAZAR-POR-UNA-CLAVE-SEGURA-DE-32-CARACTERES
CULQI_ORDER_EXPIRATION_MINUTES=30
```

Los valores `REEMPLAZAR` son marcadores, no credenciales. El `PUBLIC_KEY` y el
`SECRET_KEY` deben ser de la misma cuenta y del mismo entorno. La integración acepta
claves test (`pk_test_...` y `sk_test_...`) o live (`pk_live_...` y `sk_live_...`).

La llave privada permanece exclusivamente en Render. El frontend recibe del backend
solo la llave pública, el ID de orden, el importe en céntimos y los datos básicos del
cliente que Culqi requiere.

El backend usa `fetch` nativo de Node.js, por lo que no se requiere instalar una nueva
dependencia de Culqi. Render debe ejecutar Node.js 18 o superior.

## Montaje de rutas

Ver `backend/INTEGRAR_EN_INDEX_JS.txt`. El webhook debe montarse después de
`express.json(...)` y antes del JWT global:

```js
app.use('/api/webhooks', require('./routes/culqi-webhook.routes'));
```

Conserva el montaje existente de `routes/alumno-checkout.routes.js` bajo
`/api/alumno`. No montes el webhook detrás de la autenticación JWT de alumnos.

## Configuración de CulqiPanel

Un representante autorizado de la academia debe gestionar la cuenta comercial y las
credenciales de producción. Para pruebas, utilizar las llaves y entorno de integración.

Crear el webhook con:

- Evento: `order.status.changed`
- URL: `https://acadesys-api.onrender.com/api/webhooks/culqi`
- Activar autenticación: sí
- Usuario y contraseña: los mismos valores de `CULQI_WEBHOOK_USERNAME` y
  `CULQI_WEBHOOK_PASSWORD` configurados en Render.

El endpoint comprueba Basic Auth, valida el tipo y formato del evento, y luego consulta
la orden directamente a Culqi usando la llave privada. No confía en el importe ni el
estado que llegan en el cuerpo del webhook.

## Flujo técnico

1. React envía únicamente el ID de la cuota al endpoint existente.
2. El backend comprueba la sesión, titularidad, academia, estado e importe en MySQL.
3. El backend reserva `PagoTransaccion` con `Proveedor='CULQI'` y estado `CREANDO`.
4. Crea una orden Culqi en soles, con `confirm:false`, referencia y metadata AcadeSys.
5. Guarda el ID de orden en MySQL antes de confirmarla. Así, un reintento puede recuperar
   la misma orden y no generar una nueva por un timeout de confirmación.
6. Confirma la orden desde el backend con la llave privada y entrega a React el ID de
   orden y la llave pública.
7. React abre Culqi Custom Checkout con Yape y billeteras móviles habilitados.
8. Culqi envía `order.status.changed`. El webhook autentica la notificación y consulta
   la orden real con la API de Culqi.
9. El servicio de transacciones compara proveedor, orden, referencia, metadata, cuota,
   titular, importe y moneda. Solo un estado `paid` verificado cambia la cuota a
   `Pagado`, junto con transacción y auditoría dentro de la misma transacción SQL.
10. El botón de consultar estado realiza una reconciliación con la API de Culqi si el
    webhook todavía no se refleja. No se usan parámetros de retorno del navegador.

## Matrícula e inscripción

- El formulario público registra la matrícula y no cobra dentro del formulario.
- `Ciclo.PrecioInscripcion > 0`: se crea una cuota `PagosMensualidad.Mes='Inscripcion'`
  pendiente, independiente de las mensualidades.
- `Ciclo.PrecioInscripcion = 0`: no se crea una fila artificial de S/ 0.00.
- Una cuota de inscripción existente se conserva aunque el administrador cambie el
  precio del ciclo posteriormente; la modificación del precio no borra deudas ya
  publicadas. Los cambios retroactivos deben revisarse administrativamente.
- `Ciclo.PrecioMensual` se usa para las mensualidades. Estas se generan por periodo
  mediante el endpoint administrativo existente; no se inventa el mes de cobro ni
  una prorrata al registrar al alumno.

## Base de datos Aiven

La migración existente `20261103_morgan_pago_transaccion.sql` ya define
`PagoTransaccion.Proveedor` como `VARCHAR(30)`, junto con `IdOrdenProveedor`,
`UrlCheckout` y `CodigoEstadoProveedor`. Culqi se registra como `CULQI` en esa misma
columna; el paquete no añade tablas ni modifica cuotas históricas.

Antes de activar el flujo, confirmar el esquema REAL de Aiven (no basta con que el SQL
esté en Git):

```sql
SHOW CREATE TABLE PagoTransaccion;
SHOW COLUMNS FROM PagoTransaccion;
```

Si `PagoTransaccion` todavía no existe, revisar y aplicar la migración existente en
una base de QA primero. No ejecutar una migración a ciegas sobre la base de producción.

## Seguridad y estados

- El navegador no decide importe, moneda, cuota ni resultado.
- La llave privada nunca se envía a React.
- `Culqi.order` en el callback del checkout NO se interpreta como pago aprobado.
- Solo `order.state === 'paid'`, consultado desde el servidor, permite confirmar la cuota.
- Los eventos repetidos se registran idempotentemente mediante auditoría.
- Un pago manual ya confirmado no se marca otra vez ni se sobrescribe.
- Las órdenes vencidas/canceladas no se reutilizan; el alumno puede iniciar un nuevo intento.
- Ante timeout ambiguo se conserva la reserva para evitar órdenes duplicadas. Debe
  conciliarse antes de crear manualmente otra orden.

## Requisitos del titular

Culqi requiere correo, nombres, apellidos y teléfono para formar `client_details`.
El adaptador solo acepta teléfonos peruanos de nueve dígitos iniciados en 9, ya sea
como `9XXXXXXXX` o `+519XXXXXXXX` (también se normaliza `519XXXXXXXX`). Si falta un
dato, el sistema informa al alumno que actualice su perfil; no inventa información.

## Pruebas ejecutadas en este paquete

- `node --check` de los archivos de backend incluidos: correcto.
- Parser TypeScript de los componentes JSX y servicio frontend: sin errores de sintaxis.
- `node --test tests/culqi-adapter.test.js`: 9 pruebas aprobadas.

Estas pruebas simulan las respuestas HTTP del proveedor. No son una prueba de extremo
a extremo con Culqi, no han usado credenciales reales, no han accedido a Aiven y no
confirman que el esquema de producción esté actualizado. Antes de producción, ejecutar
las pruebas de QA con cuenta autorizada y una cuota de prueba.

## Reversión

Para volver temporalmente al flujo anterior, restaurar los archivos de frontend y
backend respaldados y configurar `PAYMENT_PROVIDER=MERCADOPAGO` en Render. No borres
transacciones con `Proveedor='CULQI'`: forman parte del historial y la auditoría.
