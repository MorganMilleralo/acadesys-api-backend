# Contrato de pagos AcadeSys — Morgan

Versión propuesta para coordinar con Torito (campos del ciclo) y Yan/Luis (interfaz). Está basado en las rutas del backend exportado y requiere aplicar la migración aditiva incluida en `database/migrations/20261028_morgan_pagos.sql` en una base de QA antes de probarlo.

## Reglas fijas

- `Ciclo.PrecioInscripcion` es el importe canónico de inscripción. `Ciclo.Precio` se conserva por compatibilidad durante la transición y se copia a la nueva columna en la migración.
- `Ciclo.PrecioMensual` es la tarifa mensual canónica. No se reutiliza `Precio` para mensualidades.
- El navegador nunca define el monto final. El checkout y la generación de cuotas calculan el importe en el servidor.
- `PagosMensualidad.Estado` solo pasa a `Pagado` cuando se aprueba un comprobante en el backend. El endpoint heredado `PUT /api/pagos/:id/estado` rechaza `Pagado` con 409.
- El checkout público sigue siendo un flujo sin pasarela: registra la inscripción con estado `Pendiente`. No realiza un cobro de tarjeta ni confirma un pago real.
- La ruta de comprobante recibe una referencia de transferencia y, opcionalmente, una ruta interna ya cargada en `/uploads/comprobantes/`. La subida de archivos debe usar almacenamiento controlado; esta entrega no acepta URLs externas.
- Los pagos confirmados históricos no se modifican con el script de regularización. Solo permite ajustes aprobados, por lista explícita, de cuotas de inscripción o mensualidades que sigan en `Pendiente` y no tengan `FechaPago`, usando el precio canónico correspondiente al concepto.

## Endpoints

### Alumno (sesión requerida, rol `Alumno`/`Estudiante`)

`GET /api/alumno/pagos`

Devuelve solo cuotas del usuario autenticado:

```json
{
  "cuotas": [
    {
      "idPago": 18,
      "idCiclo": 2,
      "ciclo": "Semestral San Marcos",
      "concepto": "Mensualidad",
      "periodo": "2026-10",
      "monto": 300.00,
      "estado": "Pendiente",
      "fechaPago": null,
      "fechaVencimiento": "2026-10-31",
      "comprobante": null
    }
  ],
  "resumen": {
    "cantidad": 1,
    "pagadas": 0,
    "pendientes": 1,
    "montoPagado": 0,
    "montoPendiente": 300
  }
}
```

`POST /api/alumno/pagos/:idPago/iniciar`

Comprueba titularidad y devuelve el monto del servidor y las instrucciones de transferencia disponibles en las variables de entorno. No escribe una confirmación de pago. Si faltan las instrucciones, devuelve un mensaje para contactar a administración sin simular una transacción.

`POST /api/alumno/pagos/:idPago/comprobante`

Body:

```json
{
  "referencia": "OP-12345678",
  "urlComprobante": "/uploads/comprobantes/op-12345678.png"
}
```

`urlComprobante` es opcional. Respuesta `201`: comprobante en `EN_REVISION`, cuota todavía `Pendiente`. Repetir la misma referencia o enviar un segundo comprobante mientras exista uno en revisión devuelve `409`.

### Administración (sesión requerida, rol `Administrador`)

`POST /api/pagos/ciclo/:idCiclo/mensualidades`

Body:

```json
{
  "periodo": "2026-10",
  "fechaVencimiento": "2026-10-31"
}
```

Genera una cuota por cada matrícula activa, usando `Ciclo.PrecioMensual`. Bloquea el ciclo en una transacción y omite cuotas existentes para ese alumno/ciclo/periodo. No cambia importes de cuotas ya creadas.

`GET /api/pagos/ciclo/:idCiclo`

Mantiene los alias PascalCase de la vista administrativa y añade vencimiento y datos del comprobante más reciente.

`GET /api/pagos/comprobantes?estado=EN_REVISION`

Devuelve la cola de comprobantes de la academia del administrador. Filtros permitidos: `EN_REVISION`, `APROBADO`, `RECHAZADO`.

`PUT /api/pagos/comprobantes/:idComprobante/estado`

Aprobar:

```json
{ "Estado": "APROBADO" }
```

Rechazar:

```json
{ "Estado": "RECHAZADO", "motivo": "La referencia no coincide con el abono recibido." }
```

La aprobación cambia comprobante y cuota a `Pagado` y asigna `FechaPago` dentro de una transacción; ambas operaciones y la auditoría deben confirmarse juntas. Rechazar mantiene la cuota en su estado actual y guarda el motivo.

`PUT /api/pagos/:id/estado`

Se conserva para marcar `Moroso`; marcar `Pagado` directamente responde `409 PAGO_REQUIERE_CONFIRMACION`. La interfaz debe llevar al administrador a la cola de comprobantes para aprobar una referencia válida.

## Variables de entorno nuevas (opcionales)

```dotenv
PAYMENT_ACADEMY_ID=
PAYMENT_BANK_NAME=
PAYMENT_ACCOUNT_HOLDER=
PAYMENT_ACCOUNT_NUMBER=
PAYMENT_CCI=
PAYMENT_INSTRUCTIONS=
```

No rellenar con cuentas ficticias en producción. `PAYMENT_ACADEMY_ID` debe coincidir con el `IdAcademia` autorizado para esos datos; por seguridad la API no muestra esa cuenta a estudiantes de otra academia. Esta configuración de entorno es apta solo para una academia configurada por despliegue; si varias academias deben cobrar, cada una necesita configuración propia administrable en la base de datos. Sin coincidencia/configuración, la API informa que no hay instrucciones disponibles. Para pasarela real todavía debe elegirse proveedor e implementar/verificar su webhook; no declarar cobros reales desde el navegador.

## Códigos HTTP que debe manejar la UI

- `200`: consulta o lectura de instrucciones completada.
- `201`: cuota(s) generadas o comprobante recibido; **no significa que se haya pagado**.
- `400`: ID, periodo, fecha, referencia o estado no válido.
- `401`: sesión/academia no válida.
- `403`: rol no autorizado.
- `404`: cuota, comprobante o ciclo no encontrado dentro de la academia.
- `409`: cuota pagada, comprobante duplicado/en revisión, precio mensual no configurado, estado ya revisado o intento de marcar `Pagado` sin verificación.
- `500`: error genérico; el detalle SQL solo queda en el log del servidor.

## Contrato con Torito y Yan

Torito debe desplegar `PrecioInscripcion` y `PrecioMensual` en la gestión de ciclos, con capacidad 1–120 en su parte. Yan integra `GET /api/alumno/pagos`, `POST .../iniciar` y `POST .../comprobante`. Luis adapta los botones del panel administrativo para revisar y aprobar/rechazar comprobantes en lugar de marcar `Pagado` directamente. Los tres revisan la misma rama y los cambios de contrato antes del merge.
