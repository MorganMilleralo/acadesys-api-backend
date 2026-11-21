# API de integración de clientes de AcadeSys (v1)

Permite que el aplicativo de otro equipo **lea los clientes (alumnos) de AcadeSys y los guarde en su
propia base de datos**, tantas veces como quiera, **sin duplicados**.

- **URL base:** `https://acadesys-api.onrender.com/api/integracion/v1`
- **Formato:** JSON (UTF-8). Fechas en ISO 8601 (UTC).
- **Autenticación:** encabezado `X-API-Key: acs_...` (también se acepta `Authorization: Bearer acs_...`).
  La clave la entrega un administrador de AcadeSys y se muestra una sola vez.
- **Especificación OpenAPI:** `docs/api-integracion-clientes.openapi.yaml`.

## Flujo recomendado (sincronización sin duplicados)

1. `GET /clientes/pendientes` → clientes que tu aplicativo **todavía no confirmó** o que **cambiaron**
   desde la última confirmación.
2. Guarda cada uno en tu base con un *upsert* por `idCliente` (o `numeroDocumento`), nunca un `INSERT` ciego.
3. `POST /clientes/confirmaciones` con `idCliente` y `version` de los que guardaste.
4. Repite hasta que `GET /clientes/pendientes` devuelva `datos: []`.

Si el proceso se corta a mitad, vuelve a empezar: lo confirmado no se repite y lo no confirmado vuelve
a salir en pendientes. Si un alumno cambia sus datos, su `version` cambia y vuelve a pendientes.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/estado` | Salud del servicio. No requiere clave. |
| GET | `/clientes?limite=50&cursor=` | Todos los clientes, paginados. |
| GET | `/clientes/pendientes?limite=50&cursor=` | Solo los no confirmados o modificados. |
| GET | `/clientes/{idCliente}` | Un cliente. |
| POST | `/clientes/confirmaciones` | Confirma qué versiones guardaste. Idempotente. |

**Paginación:** `limite` entre 1 y 100 (50 por defecto). Si `paginacion.hayMas` es `true`, repite la
consulta con `cursor=<paginacion.siguienteCursor>`.

### Cliente

```json
{
  "idCliente": "ACAD-7038",
  "tipoDocumento": "DNI",
  "numeroDocumento": "74125896",
  "nombres": "Alexandra",
  "apellidoPaterno": "Inocente",
  "apellidoMaterno": "Rojas",
  "nombreCompleto": "Alexandra Inocente Rojas",
  "correo": "alexandra@correo.pe",
  "celular": "987654321",
  "ciclos": ["Veranito San Marcos"],
  "fechaRegistro": "2026-11-01T15:00:00.000Z",
  "version": "0111ce0b0b51abb5b43df57722bd26b439a46f1c02b4292273cbd9b90db32de2",
  "confirmadoEn": null
}
```

- `idCliente` es único y estable: úsalo como clave en tu tabla.
- `version` es la huella (SHA-256) de los datos; cambia solo si cambian los datos.
- `tipoDocumento`, `numeroDocumento`, `apellidoMaterno`, `correo` y `celular` pueden ser `null`.
- Nunca se exponen contraseñas, fotos ni identificadores internos.

### Respuesta de lista

```json
{
  "datos": [ { "idCliente": "ACAD-7038", "...": "..." } ],
  "paginacion": { "limite": 50, "cantidad": 2, "hayMas": false, "siguienteCursor": null },
  "meta": { "idSolicitud": "uuid", "generadoEn": "2026-11-21T16:00:00.000Z", "consumidor": "Equipo Morán" }
}
```

### Confirmaciones

Solicitud (máximo 100 por envío; los repetidos en el mismo envío se cuentan una vez):

```json
{ "clientes": [ { "idCliente": "ACAD-7038", "version": "0111ce0b...2de2" } ] }
```

Respuesta (`200` aunque algún elemento no se haya podido confirmar):

```json
{
  "resultados": [
    { "idCliente": "ACAD-7038", "resultado": "NUEVO" },
    { "idCliente": "ACAD-7039", "resultado": "YA_CONFIRMADO" },
    { "idCliente": "ACAD-7040", "resultado": "VERSION_DESACTUALIZADA", "versionVigente": "ed8a...c50" },
    { "idCliente": "ACAD-9999", "resultado": "NO_ENCONTRADO" }
  ],
  "resumen": { "recibidos": 4, "procesados": 4, "NUEVO": 1, "YA_CONFIRMADO": 1, "VERSION_DESACTUALIZADA": 1, "NO_ENCONTRADO": 1 }
}
```

`VERSION_DESACTUALIZADA`: el cliente cambió después de que lo leíste; vuelve a leerlo y guárdalo de nuevo.

## Errores

Todos los errores tienen la misma forma y un `idSolicitud` para rastrearlos:

```json
{ "error": { "codigo": "LIMITE_INVALIDO", "mensaje": "limite debe ser un entero entre 1 y 100." },
  "meta": { "idSolicitud": "uuid" } }
```

| HTTP | Código | Qué hacer |
|---|---|---|
| 400 | `LIMITE_INVALIDO`, `CURSOR_INVALIDO`, `PARAMETRO_NO_PERMITIDO`, `ID_CLIENTE_INVALIDO`, `JSON_INVALIDO`, `CUERPO_INVALIDO`, `CAMPO_NO_PERMITIDO`, `SIN_CLIENTES`, `CLIENTES_INVALIDOS` | Corregir la solicitud. |
| 401 | `CLAVE_REQUERIDA`, `CLAVE_INVALIDA` | Revisar la clave; pudo ser revocada. |
| 404 | `CLIENTE_NO_ENCONTRADO`, `RUTA_NO_ENCONTRADA` | — |
| 413 | `DEMASIADOS_CLIENTES`, `CUERPO_DEMASIADO_GRANDE` | Enviar en lotes de 100 o menos. |
| 415 | `TIPO_NO_SOPORTADO` | Enviar `Content-Type: application/json`. |
| 429 | `LIMITE_EXCEDIDO`, `DEMASIADOS_INTENTOS` | Esperar los segundos de `Retry-After`. |
| 503 | `SERVICIO_NO_DISPONIBLE` | Reintentar con espera creciente (1 s, 2 s, 4 s…). |

El plan gratuito de Render tarda hasta un minuto en despertar: usa un tiempo de espera de 60 s.

## Seguridad

| Medida | Detalle |
|---|---|
| Clave por aplicativo | 256 bits aleatorios; AcadeSys guarda solo su SHA-256. Se puede revocar al instante. |
| Alcance | Cada clave solo ve los alumnos activos de su academia. |
| Límite de solicitudes | 60 por minuto por clave (configurable); encabezados `X-RateLimit-*` y `Retry-After`. |
| Fuerza bruta | 10 claves inválidas desde una IP la bloquean 15 minutos. |
| Validación estricta | Parámetros y campos desconocidos se rechazan; cuerpo máximo de 32 KB y 100 clientes. |
| Datos mínimos | Sin contraseñas, fotos ni IDs internos. Respuestas con `Cache-Control: no-store`. |
| Base de datos | Todo el acceso es por procedimientos almacenados con parámetros (sin SQL en el código). |
| Errores | Sin trazas ni detalles internos; si la base falla, 503 y la API sigue en pie. |
| Trazabilidad | Cada solicitud (también las rechazadas) queda en `IntegracionAuditoria` con su `idSolicitud`. |
| Transporte | Solo HTTPS en producción. |

## Ejemplos

```bash
curl -H "X-API-Key: $CLAVE" "https://acadesys-api.onrender.com/api/integracion/v1/clientes/pendientes?limite=50"

curl -X POST -H "X-API-Key: $CLAVE" -H "Content-Type: application/json" \
  -d '{"clientes":[{"idCliente":"ACAD-7038","version":"0111ce0b..."}]}' \
  https://acadesys-api.onrender.com/api/integracion/v1/clientes/confirmaciones
```

Sincronización completa en JavaScript (Node 18+):

```js
const BASE = 'https://acadesys-api.onrender.com/api/integracion/v1';
const headers = { 'X-API-Key': process.env.ACADESYS_API_KEY, 'Content-Type': 'application/json' };

async function pedir(ruta, opciones = {}, intento = 0) {
  const r = await fetch(BASE + ruta, { ...opciones, headers, signal: AbortSignal.timeout(60_000) });
  if ((r.status === 429 || r.status === 503) && intento < 5) {
    const espera = Number(r.headers.get('retry-after')) || 2 ** intento;
    await new Promise((ok) => setTimeout(ok, espera * 1000));
    return pedir(ruta, opciones, intento + 1);
  }
  const datos = await r.json();
  if (!r.ok) throw new Error(`${datos.error.codigo}: ${datos.error.mensaje}`);
  return datos;
}

async function sincronizar(guardarCliente) {
  for (;;) {
    const { datos } = await pedir('/clientes/pendientes?limite=100');
    if (datos.length === 0) return;
    for (const cliente of datos) await guardarCliente(cliente); // UPSERT por idCliente
    await pedir('/clientes/confirmaciones', {
      method: 'POST',
      body: JSON.stringify({ clientes: datos.map(({ idCliente, version }) => ({ idCliente, version })) }),
    });
  }
}
```

## Administración (solo administradores de AcadeSys, con sesión)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/admin/integraciones` | `{ "nombre": "Equipo Morán", "limitePorMinuto": 60 }` → devuelve la clave una sola vez. |
| GET | `/api/admin/integraciones` | Lista aplicativos, último uso y clientes confirmados. |
| DELETE | `/api/admin/integraciones/{id}` | Revoca la clave. |
