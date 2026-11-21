# AcadeSys API

API REST de **AcadeSys**, plataforma de gestión para academias preuniversitarias: catálogo de ciclos, matrícula en línea, intranet del alumno, gestión académica (notas, asistencia, materiales), pagos con Mercado Pago, boleta electrónica SUNAT y Tutor IA.

- **Stack:** Node.js 18+, Express 5, MySQL 8 (`mysql2`), JWT, bcrypt.
- **Despliegue:** Render (despliegue automático desde `main`) con base de datos MySQL en Aiven.
- **Frontend:** [acadesys-web-frontend](https://github.com/LuisFern2a/acadesys-web-frontend).

## Puesta en marcha

```bash
npm install
cp .env.example .env    # completar las variables
npm run dev             # http://localhost:3000
```

Para una base de datos nueva, ejecutar `database/esquema_inicial.sql`, después los archivos de `database/migraciones/` en orden numérico y, por último, todos los archivos de `database/procedimientos/`.

## Scripts

| Comando | Descripción |
|---|---|
| `npm start` | Inicia la API. |
| `npm run dev` | Inicia la API y la reinicia al guardar cambios. |
| `npm test` | Ejecuta todas las pruebas automatizadas (sin conexión a MySQL ni a servicios externos). |
| `npm run verificar:sintaxis` | Comprueba la sintaxis de todos los archivos JavaScript. |
| `npm run verificar:entorno` | Revisa que el `.env` tenga las variables obligatorias, sin mostrar sus valores. |
| `npm run cuotas:generar` | Genera las cuotas mensuales pendientes (tarea programada). |

## Estructura

```
config/        Conexión MySQL, llamada a procedimientos, CORS y carpetas de archivos
middlewares/   Autenticación JWT, roles, cierre de actas y manejo de errores
routes/        Endpoints agrupados por módulo
services/      Integración con Mercado Pago, boletas electrónicas (fact_api) y transacciones de pago
utils/         Reglas de negocio reutilizables (precios, capacidad, escalas, validaciones)
database/      Esquema inicial, migraciones y procedimientos almacenados
scripts/       Pruebas, verificaciones y tareas programadas
tests/         Pruebas unitarias y de integración (node:test)
docs/          Colección de Postman
```

## Acceso a datos: procedimientos almacenados

La API no contiene consultas SQL. Toda la lectura y escritura en MySQL (CRUD, reportes, pagos y matrícula) se realiza con procedimientos almacenados definidos en `database/procedimientos/`, un archivo por módulo:

| Archivo | Módulo |
|---|---|
| `academico.sql` | Aulas, cursos, horarios, asignaciones y asistencia |
| `admin_ciclos.sql`, `ciclos.sql` | Administración y catálogo público de ciclos |
| `alumno.sql` | Intranet del alumno |
| `auth.sql`, `recuperacion.sql` | Inicio de sesión, registro y recuperación de contraseña |
| `comunicados.sql`, `menu.sql`, `perfil.sql`, `usuario.sql` | Comunicados, menús, perfiles y usuarios |
| `matriculas.sql`, `pagos.sql`, `cuotas.sql`, `transacciones.sql` | Matrícula, pagos manuales, cuotas mensuales y pagos con Mercado Pago |
| `boletas.sql` | Boleta electrónica SUNAT de cada cuota pagada |
| `materiales.sql`, `notas.sql`, `actas.sql`, `dashboard.sql`, `tutor_ia.sql` | Materiales, notas, cierre de actas, dashboard y Tutor IA |

- Los nombres siguen el formato `sp_<modulo>_<accion>_<entidad>`, por ejemplo `sp_academico_registrar_curso`.
- El código invoca los procedimientos con `config/procedimientos.js` (`consultar` para lecturas y `ejecutar` para escrituras, que devuelve `affectedRows` e `insertId`).
- Las transacciones (matrícula, pagos, cierres de actas) se abren en la API y cada paso es un procedimiento, de modo que se confirman o revierten juntos.
- Para instalarlos o actualizarlos, ejecutar cada archivo en la base de datos (por ejemplo, con DBeaver). Cada procedimiento se elimina y se vuelve a crear, así que pueden ejecutarse las veces que haga falta.

## Módulos principales

| Módulo | Rutas | Acceso |
|---|---|---|
| Autenticación y recuperación de contraseña | `/api/login`, `/api/auth/recuperar-password` | Público |
| Catálogo y matrícula | `/api/ciclos`, `/api/matriculas` | Público |
| Intranet del alumno | `/api/alumno` | Alumno |
| Pagos del alumno (Mercado Pago) y boletas | `/api/alumno/pagos`, `/api/alumno/boletas` | Alumno |
| Webhook de Mercado Pago | `/api/webhooks/mercadopago` | Mercado Pago (firma HMAC) |
| Administración de ciclos, pagos y dashboard | `/api/admin/...` | Administrador |
| Aulas, cursos, horarios, asignaciones y asistencia | `/api/aulas`, `/api/cursos`, `/api/horarios`, `/api/asignaciones`, `/api/asistencias` | Personal académico |
| Notas y cierre de actas | `/api/notas`, `/api/actas` | Personal académico |
| Pagos manuales y comprobantes | `/api/pagos` | Administrador |
| Comunicados | `/api/comunicados` | Administrador (publica) y usuarios (lectura) |
| Materiales | `/api/materiales` | Administrador (gestión) y usuarios autorizados (descarga) |
| Usuarios, perfiles y menús | `/api/usuarios`, `/api/perfiles`, `/api/menus` | Administrador |
| Tutor IA | `/api/tutor-ia` | Alumno |

Todas las rutas privadas exigen `Authorization: Bearer <token>`. Cada consulta se limita a la academia del usuario autenticado.

## Seguridad y datos

- Las contraseñas se guardan con bcrypt y las sesiones usan JWT con verificación del usuario en cada petición.
- Los permisos se validan en el backend por rol y por academia; el frontend no decide accesos.
- Los materiales en PDF y las fotos de perfil se guardan en MySQL (`MaterialArchivo`, `FotoPerfil`), así no se pierden en los despliegues.
- Los materiales solo se descargan con sesión: administración de la academia, alumnos matriculados en el ciclo o docentes asignados al curso.
- Los pagos online se confirman únicamente con la consulta al proveedor (webhook o conciliación), nunca con datos del navegador. Cada cambio queda registrado en `PagoAuditoria`.

## Pruebas

```bash
npm test
```

Las pruebas sustituyen MySQL y los servicios externos por dobles locales, por lo que pueden ejecutarse en cualquier equipo sin credenciales.

## Boleta electrónica SUNAT

Cuando una cuota queda pagada (Mercado Pago confirmado o comprobante aprobado), la API emite una boleta (tipo 03) en el servicio [fact_api](https://github.com/angelitosystems/fact_api) y guarda el PDF y el XML en `BoletaElectronica`. La emisión ocurre después de confirmar el pago y nunca lo bloquea: si el servicio falla, la boleta queda en `ERROR` y se reintenta cada 10 minutos (máximo 5 intentos). El alumno la descarga desde `GET /api/alumno/pagos/:idPago/boleta`; la administración la consulta, descarga o reintenta en `GET|POST /api/pagos/:id/boleta`. La configuración y el despliegue están en `docs/FACTURACION_SUNAT.md`.

