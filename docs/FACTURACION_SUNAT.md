# Boleta electrónica SUNAT con fact_api

AcadeSys emite una **boleta de venta electrónica (tipo 03)** por cada cuota pagada, usando el servicio
[fact_api](https://github.com/angelitosystems/fact_api) (Laravel 12 + Greenter). El servicio corre aparte
(es PHP) y AcadeSys se conecta a él por HTTP.

## Flujo

1. La cuota pasa a **Pagado** (Mercado Pago acreditado o comprobante aprobado por administración).
2. Después del commit, la API llama a `sp_boletas_reclamar_emision` y, en fact_api:
   `POST /api/v1/boletas` → `POST /boletas/{id}/send-sunat` → `POST /boletas/{id}/generate-pdf` →
   `GET /boletas/{id}/download-pdf` y `GET /boletas/{id}/download-xml`.
3. El PDF y el XML firmado se guardan en `BoletaElectronica` (MySQL), así la descarga no depende de fact_api.
4. Si algo falla, la boleta queda en `ERROR` con el motivo y se reintenta cada 10 minutos (5 intentos).
   El pago **nunca** se revierte por un fallo de facturación.

| Quién | Endpoint |
|---|---|
| Alumno | `GET /api/alumno/boletas` (lista) y `GET /api/alumno/pagos/:idPago/boleta?formato=pdf\|xml` |
| Administración | `GET /api/pagos/:id/boleta` (estado), `GET /api/pagos/:id/boleta?formato=pdf` (archivo), `POST /api/pagos/:id/boleta` (emitir o reintentar) |

## Ambiente de pruebas (beta SUNAT)

AcadeSys no tiene RUC propio, así que se trabaja en **beta**, igual que Mercado Pago en modo TEST.
fact_api incluye un certificado de prueba en `ejemplos-postman/certificado_prueba/`:

- RUC de prueba: `20161515648`, clave del certificado: `123456`
- Usuario SOL beta: `MODDATOS`, clave SOL beta: `moddatos`

Las boletas beta no tienen validez tributaria. Para producción hace falta el RUC de la academia,
su usuario SOL secundario y su certificado digital; luego `POST /api/v1/companies/{id}/toggle-production`.

## 1. Desplegar fact_api en Render

1. Hacer fork de `angelitosystems/fact_api` y agregar en la raíz este `Dockerfile`:

```dockerfile
FROM php:8.2-apache
RUN apt-get update && apt-get install -y --no-install-recommends \
      libzip-dev libpng-dev libxml2-dev libicu-dev unzip git \
  && docker-php-ext-install pdo_mysql zip gd soap intl bcmath \
  && a2enmod rewrite && rm -rf /var/lib/apt/lists/*
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
  && sed -ri 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www/html
COPY . .
RUN composer install --no-dev --optimize-autoloader --no-interaction \
  && chown -R www-data:www-data storage bootstrap/cache
CMD php artisan config:cache && php artisan storage:link || true; apache2-foreground
```

2. En Aiven crear una base aparte para fact_api (no mezclar con `defaultdb`):
   `CREATE DATABASE facturacion CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
3. En Render: **New → Web Service → Docker**, con estas variables:
   `APP_KEY` (salida de `php artisan key:generate --show`), `APP_ENV=production`, `APP_DEBUG=false`,
   `APP_URL=https://<servicio>.onrender.com`, `DB_CONNECTION=mysql`, `DB_HOST`, `DB_PORT`,
   `DB_DATABASE=facturacion`, `DB_USERNAME`, `DB_PASSWORD`, `MYSQL_ATTR_SSL_CA` si Aiven lo exige,
   `SESSION_DRIVER=database`, `CACHE_STORE=database`, `QUEUE_CONNECTION=sync`.

## 2. Configurar fact_api (una sola vez, con la colección de Postman del repositorio)

1. `POST /api/setup/migrate` y `POST /api/setup/seed`.
2. `POST /api/auth/initialize` para crear el usuario administrador (contraseña con mayúsculas, minúsculas y números).
3. `POST /api/auth/login` y usar el `access_token` en las siguientes llamadas.
4. `POST /api/v1/companies` (form-data): RUC `20161515648`, razón social de la academia, dirección, ubigeo,
   `usuario_sol=MODDATOS`, `clave_sol=moddatos`, `certificado_pem` = `certificado.pem` de prueba,
   `certificado_password=123456`, `modo_produccion=false`.
5. `POST /api/v1/branches` (sucursal principal) y `POST /api/v1/branches/{id}/correlatives/batch` con la serie `B001` para tipo `03`.
6. Anotar el `company_id` y el `branch_id`.

## 3. Conectar AcadeSys (variables en Render del backend)

| Variable | Valor |
|---|---|
| `FACT_API_URL` | `https://<servicio-fact-api>.onrender.com` |
| `FACT_API_EMAIL` / `FACT_API_PASSWORD` | usuario creado en el paso 2.2 |
| `FACT_API_COMPANY_ID` / `FACT_API_BRANCH_ID` | ids del paso 2.6 |
| `FACT_API_SERIE_BOLETA` | `B001` |
| `FACT_API_AFECTACION_IGV` | `10` (gravado, el monto de la cuota incluye IGV) o `20` (exonerado) |
| `FACT_API_TIMEOUT_MS` | `20000` (el plan gratuito de Render tarda en despertar) |

Si `FACT_API_URL` está vacío, la emisión queda desactivada y los pagos funcionan igual.

## 4. Base de datos de AcadeSys

En DBeaver, sobre `defaultdb`: ejecutar `database/migraciones/08_boleta_electronica.sql` y después
`database/procedimientos/boletas.sql`.

Para emitir la boleta de una cuota que ya estaba pagada antes de activar la integración:
`POST /api/pagos/:id/boleta` con la sesión de administrador.
