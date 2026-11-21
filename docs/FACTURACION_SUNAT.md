# Boleta electrónica SUNAT con fact_api

AcadeSys emite una **boleta de venta electrónica (tipo 03)** por cada cuota pagada usando
[fact_api](https://github.com/angelitosystems/fact_api) (Laravel 12 + Greenter). fact_api es PHP, así que
corre como un servicio aparte: el repositorio `acadesys-facturacion` es una copia preparada para Render
(ver su `README_ACADESYS.md`).

## Flujo

1. La cuota pasa a **Pagado** (Mercado Pago acreditado o comprobante aprobado por administración).
2. Después del commit, la API reserva la boleta (`sp_boletas_reclamar_emision`) y en fact_api:
   `POST /api/v1/boletas` → `POST /boletas/{id}/send-sunat` → `POST /boletas/{id}/generate-pdf` →
   `GET /boletas/{id}/download-pdf` y `GET /boletas/{id}/download-xml`.
3. El PDF y el XML firmado se guardan en `BoletaElectronica`; la descarga no depende de fact_api.
4. Si algo falla (por ejemplo, SUNAT beta caído), la boleta queda en `ERROR` con el motivo y se
   reintenta cada 10 minutos, hasta 5 veces. El pago **nunca** se revierte por la facturación.

| Quién | Endpoint |
|---|---|
| Alumno | `GET /api/alumno/boletas` y `GET /api/alumno/pagos/:idPago/boleta?formato=pdf\|xml` |
| Administración | `GET /api/pagos/:id/boleta` (estado), `GET /api/pagos/:id/boleta?formato=pdf` (archivo), `POST /api/pagos/:id/boleta` (emitir o reintentar) |

## Ambiente beta de SUNAT

Sin RUC propio se usa el beta, igual que Mercado Pago en modo TEST: RUC de prueba `20161515648`,
usuario SOL `MODDATOS`, certificado de prueba incluido en fact_api. Las boletas beta no tienen
validez tributaria. Para producción hace falta el RUC, el usuario SOL y el certificado de la academia.

## Puesta en marcha

1. **Base de datos.** En DBeaver, sobre el servicio de Aiven:
   `CREATE DATABASE facturacion CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
2. **Render → New → Web Service → Public Git Repository** con la URL de `acadesys-facturacion`.
   Render detecta el `Dockerfile`. Plan Free. Variables (detalle en `README_ACADESYS.md`):
   `APP_KEY` (cualquier secreto largo), `APP_URL`, `DB_CONNECTION=mysql`, `DB_HOST`, `DB_PORT`,
   `DB_DATABASE=facturacion`, `DB_USERNAME`, `DB_PASSWORD`, `DB_CA_CERT` (CA certificate de Aiven),
   `SESSION_DRIVER=database`, `CACHE_STORE=database`, `QUEUE_CONNECTION=sync`,
   `FACT_ADMIN_EMAIL`, `FACT_ADMIN_PASSWORD`.
3. Al arrancar, el log muestra `AcadeSys listo: FACT_API_COMPANY_ID=1 FACT_API_BRANCH_ID=1`.
   Migraciones, ubigeos, usuario, empresa beta, sucursal y certificado se configuran solos.
4. **Backend de AcadeSys (Render → Environment):**

| Variable | Valor |
|---|---|
| `FACT_API_URL` | `https://<servicio-de-facturacion>.onrender.com` |
| `FACT_API_EMAIL` / `FACT_API_PASSWORD` | los mismos `FACT_ADMIN_EMAIL` / `FACT_ADMIN_PASSWORD` |
| `FACT_API_COMPANY_ID` / `FACT_API_BRANCH_ID` | `1` / `1` (los del log) |
| `FACT_API_SERIE_BOLETA` | `B001` |
| `FACT_API_AFECTACION_IGV` | `10` (el monto de la cuota incluye IGV) o `20` (exonerado) |
| `FACT_API_TIMEOUT_MS` | `60000` (el plan gratuito tarda en despertar) |

Si `FACT_API_URL` está vacío, la emisión queda desactivada y los pagos funcionan igual.

5. Para emitir la boleta de una cuota que ya estaba pagada: `POST /api/pagos/:id/boleta` como administrador.
