# Contrato de integración Morgan ↔ Torito: Mercado Pago

## Alcance

Morgan implementa la reserva de transacción interna, valida la titularidad de la cuota, toma el importe desde MySQL, evita checkouts duplicados, expone el estado al alumno y actualiza la mensualidad/auditoría cuando recibe una confirmación ya verificada.

Torito implementa el adaptador real de Mercado Pago y el endpoint de webhook público.
La entrega local del 2026-11-03 usa Checkout Pro Preferences con SDK oficial 3.6.1.
El detalle vigente de seguridad, estados, pruebas y configuración está en
[INTEGRACION_MERCADOPAGO.md](INTEGRACION_MERCADOPAGO.md). Sin configuración sigue devolviendo 503.

## Contrato requerido para el adaptador de Torito

Archivo: `backend/services/mercadopago.adapter.js`

Debe exportar:

```js
async function crearOrdenPago({
  idTransaccion,
  referenciaInterna,
  idempotencyKey,
  monto,
  moneda,             // PEN
  concepto,
  ciclo,
  alumno,
  payerEmail,
  notificationUrl,    // HTTPS, webhook público
  returnUrl,          // URL de retorno del frontend
}) {
  return {
    idOrdenProveedor: 'ID de la preferencia de Mercado Pago',
    checkoutUrl: 'https://checkout-proveedor/...',
    estado: 'pending',
  };
}

module.exports = { crearOrdenPago };
```

Reglas:
- Usar el token privado solo en backend.
- Usar `idempotencyKey` como clave idempotente enviada al proveedor.
- Enviar `referenciaInterna` como referencia externa/metadato que permita localizar la transacción.
- Crear la orden por el importe `monto` que llega desde la reserva de MySQL; nunca leer un importe del navegador.
- Exigir moneda PEN.
- Configurar webhook HTTPS y URLs de retorno.
- Devolver solo ID de orden, URL de checkout y estado normalizado. No devolver credenciales ni respuesta privada completa.
- Si una llamada falla de forma definitiva y el proveedor garantiza que NO creó la orden, marcar el error con `error.safeToMarkError = true`. En timeouts o errores de red ambiguos, no marcarlo: la reserva permanece en `CREANDO` para evitar una segunda orden/cobro.
- La confirmación del pago se hace en el webhook, no en esta función ni en la URL de retorno.

## Contrato requerido para el webhook de Torito

El webhook debe:
1. Validar firma/autenticidad según la documentación vigente del proveedor.
2. Consultar la operación directamente en Mercado Pago usando credenciales backend.
3. Verificar el ID de orden, `external_reference`/`referenciaInterna`, monto, moneda PEN y estado realmente aprobado.
4. Solo después llamar a `confirmarPagoProveedor` de `services/transacciones-pago.service.js`:

```js
const { confirmarPagoProveedor, actualizarEstadoNoAprobado } = require('../services/transacciones-pago.service');

await confirmarPagoProveedor({
  proveedor: 'MERCADOPAGO',
  referenciaInterna,
  idOrdenProveedor,
  monto,
  moneda: 'PEN',
  estadoProveedor: 'approved',
  estado: 'APROBADA',
  idPagoProveedor,                // Payment.id; NO es el ID de preferencia
  idTransaccion,                 // Contrastado con metadata de Preference
  fechaActualizacionProveedor,   // Payment.date_last_updated en milisegundos
});
```

Si el proveedor informa que el pago no fue aprobado, se llama a
`actualizarEstadoNoAprobado` con el mismo conjunto de datos verificados, incluyendo
preferencia, pago, transacción, monto, moneda y versión. Estos campos son obligatorios
para poder deduplicar y ordenar sin inventar columnas. El adaptador normaliza a
`PENDIENTE`, `RECHAZADA` o `CANCELADA`; reembolsos/contracargos generan revisión auditada
y no revierten una mensualidad pagada. No hay otro consumidor de estas funciones
en el repositorio ni se expone un endpoint para invocarlas desde React.

El endpoint de webhook debe montarse antes de `app.use('/api', verificarToken)` porque el proveedor no envía el JWT de un alumno. Debe responder 200/201 cuando procese correctamente o cuando la notificación ya se haya procesado; así evita reintentos innecesarios.

## Rutas de Morgan

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/alumno/pagos/:idPago/checkout` | Reserva/reutiliza transacción y devuelve checkout URL. |
| GET | `/api/alumno/pagos/:idPago/estado` | Consulta cuota y última transacción del alumno autenticado. |

Montar `routes/alumno-checkout.routes.js` en `index.js` junto a las otras rutas privadas:

```js
app.use('/api/alumno', require('./routes/alumno-checkout.routes'));
```

El middleware JWT global del proyecto ya protege estas rutas; el router agrega la restricción Alumno/Estudiante.

## Estados

`CREANDO`: reserva interna creada, el adaptador aún genera la orden.
`PENDIENTE`: orden creada, esperando el pago.
`APROBADA`: webhook verificado, cuota actualizada a Pagado.
`RECHAZADA`, `CANCELADA`, `EXPIRADA`: estados no aprobados informados por proveedor.
`ERROR`: no se pudo crear la orden.
`PAGO_DUPLICADO`: el proveedor aprobó otra operación para una cuota que ya figuraba pagada; no se vuelve a marcar la cuota y requiere revisión administrativa.

## Garantías

- El navegador nunca determina importe, moneda, titular ni estado de pago.
- La cuota se bloquea al reservar checkout y se reutiliza la transacción pendiente.
- La cuota cambia a Pagado únicamente desde `confirmarPagoProveedor`, que está documentada para uso exclusivo después de validar el webhook.
- La actualización de la transacción, la cuota y la auditoría ocurre dentro de una misma transacción SQL.
- Notificaciones repetidas son idempotentes.
- Si ya existía un pago manual confirmado, otra aprobación del proveedor se registra como `PAGO_DUPLICADO` y no duplica la confirmación.
