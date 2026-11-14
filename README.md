# AcadeSys API

API REST de **AcadeSys**, plataforma de gestión para academias preuniversitarias: catálogo de ciclos, matrícula en línea, intranet del alumno, gestión académica (notas, asistencia, materiales), pagos con Culqi y Tutor IA.

- **Stack:** Node.js 18+, Express 5, MySQL 8 (`mysql2`), JWT, bcrypt.
- **Despliegue:** Render (despliegue automático desde `main`) con base de datos MySQL en Aiven.
- **Frontend:** [acadesys-web-frontend](https://github.com/LuisFern2a/acadesys-web-frontend).

## Puesta en marcha

```bash
npm install
cp .env.example .env    # completar las variables
npm run dev             # http://localhost:3000
```

Para una base de datos nueva, ejecutar `database/esquema_inicial.sql` y después los archivos de `database/migraciones/` en orden numérico.

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
config/        Conexión MySQL, CORS y carpetas de archivos
middlewares/   Autenticación JWT, roles, cierre de actas y manejo de errores
routes/        Endpoints agrupados por módulo
services/      Integración con Culqi y lógica de transacciones de pago
utils/         Reglas de negocio reutilizables (precios, capacidad, escalas, validaciones)
database/      Esquema inicial y migraciones
scripts/       Pruebas, verificaciones y tareas programadas
tests/         Pruebas unitarias y de integración (node:test)
docs/          Colección de Postman
```

## Módulos principales

| Módulo | Rutas | Acceso |
|---|---|---|
| Autenticación y recuperación de contraseña | `/api/login`, `/api/auth/recuperar-password` | Público |
| Catálogo y matrícula | `/api/ciclos`, `/api/matriculas` | Público |
| Intranet del alumno | `/api/alumno` | Alumno |
| Pagos del alumno (Culqi) | `/api/alumno/pagos` | Alumno |
| Webhook de Culqi | `/api/webhooks/culqi` | Culqi (Basic Auth) |
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
