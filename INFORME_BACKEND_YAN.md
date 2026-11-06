# INFORME_BACKEND_YAN

**Auditoría y mejora del backend de AcadeSys**  
**Responsable:** Yan — Base de datos, integraciones y calidad  
**Fecha:** 2026-11-06  
**Rama auditada:** `main` (sin cambios de rama, sin commits, sin push)  
**Entorno de ejecución:** Node.js `v24.20.0`, npm `11.19.0`, Windows  
**Base de datos auditada:** Aiven MySQL `8.4.11`, esquema `defaultdb` (solo consultas de lectura)

> **Alcance respetado:** no se ejecutaron DDL ni DML sobre la base de datos, no se modificaron credenciales, no se instalaron dependencias nuevas durante esta auditoría, no se alteraron contratos de API y no se implementaron funcionalidades de Morgan ni de Torito. Los únicos cambios de código son correcciones de pruebas automatizadas; el resto son documentos de auditoría y un SQL de diagnóstico de solo lectura.

---

## 1. Arquitectura del backend

### 1.1 Tecnología y estructura

El backend es una API REST en **Node.js + Express 5** con arquitectura por capas, sin ORM ni carpeta `models/` o `controllers/`:

```text
index.js
├── config/         db.js, cors.js, storage.js
├── middlewares/    auth, roles, cierre, notas-acceso, error, autenticacion-opcional
├── routes/         19 routers (públicos, privados y webhook)
├── services/       transacciones-pago.service.js, mercadopago.adapter.js
├── utils/          13 utilidades (validaciones, pagos, escalas, capacidad, etc.)
├── database/       init histórico, migraciones, diagnósticos y seeds
├── scripts/        sintaxis, verificación, auditorías y runner de pruebas
├── tests/          22 archivos *.test.js + 4 soportes
└── uploads/        perfiles/ y materiales/ (servidos estáticamente)
```

Dependencias principales (`package.json`):

- `express@5.2.1`
- `mysql2@3.24.2`
- `jsonwebtoken@9.0.3`
- `bcrypt@6.0.0`
- `mercadopago@3.6.1`
- `@google/generative-ai`, `cors`, `dotenv`, `nodemailer`

Scripts disponibles:

```json
{
  "start": "node index.js",
  "dev": "node index.js",
  "test": "node scripts/probar-local.js"
}
```

### 1.2 Orden de montaje y protección

`index.js` sigue este orden:

1. Valida variables obligatorias (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`) y exige `JWT_SECRET` de al menos 32 caracteres.
2. Aplica CORS con whitelist explícita.
3. Monta el webhook de Mercado Pago **antes** del parser JSON general y antes del JWT, con límite de `32kb`.
4. Monta `express.json({ limit: "15mb" })` para el resto de la API.
5. Sirve `/uploads` como estático.
6. Monta rutas públicas: `/api` (auth y registro), `/api/auth` (recuperación), `/api/ciclos`, `/api/matriculas`.
7. Define `/ping` (health check).
8. Aplica el candado global JWT a todo `/api` declarado después.
9. Monta rutas administrativas y privadas.
10. Devuelve 404 JSON para `/api` y usa un manejador global de errores.

El webhook se autentica con HMAC del proveedor, nunca con JWT. El resto de `/api` exige `Authorization: Bearer <token>`.

### 1.3 Autenticación y autorización

- JWT **HS256**, expiración `8h`.
- El middleware `auth.middleware.js` no confía solo en el token: consulta la base, exige usuario activo, exactamente un perfil activo y que la academia del token coincida con la actual.
- Si hay múltiples perfiles activos → `403`.
- Si el usuario está inactivo o sin perfil → `401`.
- Si la BD falla al verificar → `503`, sin continuar.
- Roles por **nombre normalizado**, no por `IdPerfil` fijo. `Administrador` y `Recursos Humanos` comparten permisos administrativos.
- `notas-acceso.middleware.js` concede gestión de notas solo a perfiles administrativos; no hay lógica de asignación por último dígito del DNI. Se verificó además con pruebas específicas.

### 1.4 Conexión a MySQL/Aiven

`config/db.js` crea un pool `mysql2/promise` con `connectionLimit: 10`, `waitForConnections: true` y `queueLimit: 0`. La conexión de auditoría fue exitosa.

Observaciones:

- No se configura `ssl` explícitamente en el pool.
- La auditoría se conectó con un usuario de servicio con perfil administrativo (`avnadmin`), no con un usuario de mínimos privilegios.
- No se imprimen credenciales ni cadenas de conexión en este informe.

### 1.5 Documentación vs. código real

La documentación **no coincide completamente** con el código actual:

- `README_MORGAN.md` y `docs/PENDIENTES_Y_BLOQUEOS.md` describen Mercado Pago como pendiente de Torito, pero el repositorio ya contiene `services/mercadopago.adapter.js`, `routes/mercadopago-webhook.routes.js` y pruebas del flujo.
- `acadesys_db_init.sql` está desactualizado: usa `Perfil` (la tabla real es `perfil`), no refleja columnas actuales y no contiene las tablas de pagos.
- `docs/INTEGRACION_MERCADOPAGO.md` sí refleja la entrega local del 2026-11-03 y aclara que falta configuración real.

**Conclusión:** la fuente de verdad es el esquema vivo y el código, no el init SQL histórico.

---

## 2. Estado de la base de datos

### 2.1 Inventario real

La base auditada contiene **24 tablas**:

```text
Academia, Asignacion_Aula, Asistencia, Auditoria_Cierres, Aula, Ciclo,
CicloCurso, Comunicado, Comunicado_Lectura, CorreosPendientes, Curso,
Evaluacion, HorarioCurso, MaterialAcademico, Matricula, OpcionesMenu,
OpcionesMenu_Perfiles, PagoAuditoria, PagoComprobante, PagoTransaccion,
PagosMensualidad, Usuario, Usuario_Perfiles, perfil
```

Conteos al 2026-11-06:

| Entidad | Total | Observación |
|---|---:|---|
| Usuarios | 54 | 49 activos |
| Academias | 1 | |
| Ciclos | 12 | 11 activos; 3 con precios nulos |
| Cursos | 71 | |
| Matrículas | 35 | 35 activas |
| Evaluaciones | 32 | 0 cerradas |
| Cuotas (`PagosMensualidad`) | 45 | 31 Pagado, 13 Pendiente, 1 Moroso |
| Transacciones (`PagoTransaccion`) | 1 | 1 en estado `ERROR`, 0 aprobadas |
| Comprobantes (`PagoComprobante`) | 0 | Flujo manual sin registros |
| Auditoría (`PagoAuditoria`) | 13 | Todos `CUOTA_MENSUAL_CREADA` |

Perfiles activos: 9 Administrador, 10 Docente, 1 Tutor de Aula, 30 Alumno, 1 Recursos Humanos.

### 2.2 Claves, relaciones e índices relevantes

#### Usuario

- PK `IdUsuario`.
- FK `IdAcademia → Academia`.
- **Tres índices UNIQUE duplicados sobre `CodigoUsuario`**: `CodigoUsuario`, `CodigoUsuario_2`, `UQ_Usuario_CodigoUsuario`.
- **No hay UNIQUE de `DNI` ni de `CorreoElectronico`**. La unicidad se garantiza solo por código y bloqueos de aplicación.
- Existen duplicados históricos (ver 2.3).

#### Ciclo

- PK `IdCiclo`.
- FK `IdAcademia → Academia`.
- `Capacidad = 0` significa “sin límite definido” según `utils/capacidad-ciclo.js`; no es un error de datos.
- Capacidades históricas mayores a 120 se conservan (por ejemplo, 250), aunque las nuevas altas se limitan a 1–120.

#### Matrícula

- PK `IdMatricula`.
- UNIQUE `UQ_Alumno_Ciclo (IdUsuario, IdCiclo)`.
- FK `IdUsuario → Usuario`.
- FK `IdCurso → Curso`.
- **Dos FK duplicadas sobre `IdCiclo`**: `FK_Matricula_Ciclo` y `FK_Matricula_CicloSeguro`.
- **Las 35 matrículas tienen `IdCurso = NULL`**. La relación alumno–ciclo existe, pero no la asignación a un curso concreto.

#### Evaluación

- PK `IdEvaluacion`.
- FK `IdMatricula → Matricula`.
- No tiene `IdCurso`: el alcance por curso se deriva de `Matricula.IdCurso`.
- No hay índice UNIQUE de negocio para `(IdMatricula, Periodo, TipoEvaluacion, EstadoRegistro)`, aunque la aplicación lo valida con bloqueos.
- No se encontraron evaluaciones fuera de la escala de su universidad; las 32 son de ciclos UNMSM y están entre 23 y 2000 puntos (escala UNMSM = 2000).

#### HorarioCurso

- PK `IdHorario`.
- Índices por `IdCiclo` e `IdCurso`, pero **sin claves foráneas**.
- No había duplicados ni horarios huérfanos al momento de la auditoría.

#### PagosMensualidad

- PK `IdPago` (`INT`).
- FK `IdUsuario → Usuario`.
- FK `IdCiclo → Ciclo`.
- `Monto DECIMAL(8,2)`.
- `Estado ENUM('Pagado','Moroso','Pendiente')`, por defecto `Moroso`.
- **No hay UNIQUE de negocio `(IdUsuario, IdCiclo, Mes)`**; la idempotencia depende del bloqueo de la fila del ciclo y de comprobaciones `FOR UPDATE`.

#### PagoTransaccion, PagoComprobante y PagoAuditoria

- No tienen claves foráneas.
- `PagoTransaccion.IdPago` es `INT`, compatible con `PagosMensualidad.IdPago`.
- `PagoComprobante.IdPago` y `PagoAuditoria.IdPago` son `BIGINT UNSIGNED`, **incompatibles para una FK directa** con `PagosMensualidad.IdPago (INT)`.
- `PagoComprobante` no tiene UNIQUE `(IdPago, Referencia)`.
- No se encontraron huérfanos en pagos, matrículas, evaluaciones ni horarios.

### 2.3 Calidad de datos

| Hallazgo | Evidencia | Impacto |
|---|---|---|
| Correos duplicados | 5 grupos, 20 cuentas adicionales. Casos: `admin@acadesys.com` (2), `ltoccasrojas@gmail.com` (13), `fsdafadf90@gmail.com` (6), `morgan.miller.alo@gmail.com` (2), `johan.cibertz@gmail.com` (2) | Login ambiguo; el sistema responde 403 si hay más de una cuenta; imposibilita UNIQUE de correo |
| DNI duplicados | 3 grupos, 4 cuentas adicionales: `00000000` (2), `75328968` (2), `75556657` (3) | Identidad ambigua; DNI no confiable como identificador único |
| Usuarios activos sin perfil | `IdUsuario` 100, 114, 115, 116 | No pueden iniciar sesión; cuentas incompletas |
| Matrículas sin curso | 35 de 35 | Notas y cierres por curso quedan limitados al alcance “General” |
| Cuotas sin vencimiento | 32 de 45 (31 pagadas y 1 morosa) | No se puede automatizar morosidad ni recordatorios para esas cuotas |
| Ciclos activos sin precios | Ciclos 14 y 15 (`PrecioInscripcion` y `PrecioMensual` nulos) | Checkout online y generación de cuotas fallan con 409 hasta configurarlos |
| Evaluaciones cerradas | 0 de 32 | Cierre de actas aún no ejercitado en datos reales |
| `PagoComprobante` vacío | 0 filas | La transferencia manual no se ha usado en producción o no se ha probado con datos reales |
| `PagoAuditoria` histórica | 13 eventos, todos de creación de cuota | No hay evidencia histórica de confirmaciones de pago online porque no hubo pagos aprobados |

No se encontraron:

- matrículas duplicadas por usuario/ciclo,
- cuotas activas duplicadas por usuario/ciclo/mes,
- evaluaciones duplicadas por matrícula/periodo/tipo,
- horarios duplicados,
- registros huérfanos académicos.

---

## 3. Estado de PagoTransaccion

### 3.1 La tabla existe y está creada

`PagoTransaccion` **ya existe en Aiven**. No se debe volver a crear. La migración `database/migrations/20261103_morgan_pago_transaccion.sql` es aditiva y coincide en lo esencial con la tabla viva.

### 3.2 Estructura real verificada

| Columna | Tipo real | Nulo | Clave / observación |
|---|---|---|---|
| `IdTransaccion` | `BIGINT UNSIGNED` | No | PK, AUTO_INCREMENT |
| `IdPago` | `INT` | No | Índice; compatible con `PagosMensualidad.IdPago` |
| `IdUsuario` | `INT` | No | Índice |
| `IdAcademia` | `INT` | No | Índice |
| `Proveedor` | `VARCHAR(30)` | No | Default `MERCADOPAGO` |
| `ReferenciaInterna` | `VARCHAR(100)` | No | UNIQUE |
| `IdOrdenProveedor` | `VARCHAR(120)` | Sí | UNIQUE junto con `Proveedor` |
| `ClaveIdempotencia` | `VARCHAR(100)` | No | UNIQUE |
| `Monto` | `DECIMAL(10,2)` | No | |
| `Moneda` | `CHAR(3)` | No | Default `PEN` |
| `Estado` | `VARCHAR(24)` | No | Default `CREANDO` |
| `UrlCheckout` | `VARCHAR(1000)` | Sí | |
| `CodigoEstadoProveedor` | `VARCHAR(80)` | Sí | Campo adicional de integración |
| `FechaCreacion` | `DATETIME` | No | Default `CURRENT_TIMESTAMP` |
| `FechaActualizacion` | `DATETIME` | No | `ON UPDATE CURRENT_TIMESTAMP` |
| `FechaConfirmacion` | `DATETIME` | Sí | Campo adicional |
| `EstadoRegistro` | `TINYINT` | No | Default 1 |

Índices:

- `uq_pago_transaccion_idempotencia (ClaveIdempotencia)` UNIQUE
- `uq_pago_transaccion_orden (Proveedor, IdOrdenProveedor)` UNIQUE
- `uq_pago_transaccion_referencia (ReferenciaInterna)` UNIQUE
- `idx_pago_transaccion_cuota_estado (IdPago, Estado, IdTransaccion)`
- `idx_pago_transaccion_alumno (IdUsuario, IdAcademia, IdTransaccion)`
- `idx_pago_transaccion_academia_fecha (IdAcademia, FechaCreacion)`

### 3.3 Correspondencia con el contrato solicitado

| Campo solicitado | Estado | Observación |
|---|---|---|
| `IdTransaccion` | ✅ | PK `BIGINT UNSIGNED` |
| `IdPago` | ✅ | `INT`, coincide con `PagosMensualidad` |
| `Proveedor` | ✅ | `MERCADOPAGO` |
| `IdOrdenProveedor` | ✅ | Preferencia de Mercado Pago |
| `ReferenciaExterna` | ⚠️ | La columna se llama `ReferenciaInterna`; es la que se envía como `external_reference` a Mercado Pago |
| `ClaveIdempotencia` | ✅ | UNIQUE |
| `Monto` | ✅ | `DECIMAL(10,2)` |
| `Moneda` | ✅ | `PEN` |
| `Estado` | ✅ | `CREANDO`, `PENDIENTE`, `APROBADA`, `RECHAZADA`, `CANCELADA`, `REEMBOLSADA`, `CONTRACARGO`, `ERROR`, `PAGO_DUPLICADO` |
| `UrlCheckout` | ✅ | |
| `FechaCreacion` | ✅ | |
| `FechaActualizacion` | ✅ | |

Campos adicionales correctos: `IdUsuario`, `IdAcademia`, `CodigoEstadoProveedor`, `FechaConfirmacion`, `EstadoRegistro`.

### 3.4 Datos actuales

- 1 transacción: `IdTransaccion = 1`, `IdPago = 51`, `Monto = 400.00 PEN`, `Estado = ERROR`, creada el 2026-11-04.
- 0 transacciones aprobadas.
- No hay transacciones huérfanas.
- La fila `ERROR` no bloquea nuevos intentos porque la reserva excluye `Estado = 'ERROR'`.

### 3.5 Riesgos detectados en PagoTransaccion

1. **Sin claves foráneas** a `PagosMensualidad`, `Usuario` y `Academia`. La integridad depende del servicio.
2. **Riesgo de reservas `CREANDO` colgadas**: si el proceso cae después de insertar la transacción y antes de guardar la orden, la cuota queda bloqueada con `409 EN_PREPARACION` hasta una limpieza manual. No hay job de expiración.
3. **Tipo de `IdTransaccion` `BIGINT UNSIGNED`**: el código lo convierte a `Number`; en la práctica no se acerca al límite seguro, pero conviene documentarlo.
4. **No hay FK ni restricción de estado**: los estados válidos se controlan en el servicio.

---

## 4. Estado del módulo de pagos

### 4.1 Verificación de los 10 puntos solicitados

| # | Requisito | Estado | Evidencia |
|---|---|---|---|
| 1 | El alumno solo paga sus propias cuotas | ✅ | `reservarCheckoutAlumno` filtra por `p.IdPago`, `p.IdUsuario` y `u.IdAcademia`; si no coincide responde `404 CUOTA_NO_ENCONTRADA` |
| 2 | No puede pagar cuotas ya canceladas | ✅ | `409 CUOTA_YA_PAGADA` antes de crear transacción |
| 3 | El importe se obtiene de la BD | ✅ | Se lee `p.Monto`; no hay campo de monto en el body |
| 4 | No se confía en el monto del frontend | ✅ | La ruta solo recibe `idPago`; el monto del proveedor se compara en centimos con la cuota y la transacción |
| 5 | No se generan transacciones duplicadas | ✅ | Bloqueo `FOR UPDATE` de la cuota + reutilización de transacción existente + UNIQUE de idempotencia/referencia/orden |
| 6 | Idempotencia correcta | ✅ | `ClaveIdempotencia` única, `idempotencyKey` enviada al SDK, eventos versionados en `PagoAuditoria` |
| 7 | Pendiente no actualiza a Pagado | ✅ | Solo el evento `approved` ejecuta `UPDATE PagosMensualidad ... Estado = 'Pagado'` |
| 8 | Rechazado no actualiza a Pagado | ✅ | `rejected`/`cancelled` actualizan la transacción, no la cuota |
| 9 | Transferencia manual sigue funcionando | ✅/⚠️ | `iniciar` devuelve instrucciones; `comprobante` registra la referencia; el admin aprueba o rechaza. **Falta endpoint de subida de archivo** y `/uploads` es público |
| 10 | Operaciones relacionadas con PagoAuditoria | ✅ | Se audita creación de cuota, envío de comprobante, aprobación/rechazo, marcado moroso y eventos de Mercado Pago |

### 4.2 Flujo online

- `POST /api/alumno/pagos/:idPago/checkout`: crea o reutiliza la transacción. No marca la cuota como pagada.
- `GET /api/alumno/pagos/:idPago/estado`: devuelve cuota y última transacción del propio alumno.
- `POST /api/webhooks/mercadopago`: firmado por HMAC, consulta el pago real en la API de Mercado Pago y aplica una transacción atómica.
- El webhook responde éxito solo después del `COMMIT`.

### 4.3 Por qué responde 503 `PASARELA_NO_CONFIGURADA`

El `.env` auditado **no contiene** las variables de Mercado Pago:

```text
MERCADOPAGO_ENV
MERCADOPAGO_ACCESS_TOKEN
MERCADOPAGO_WEBHOOK_SECRET
MERCADOPAGO_SELLER_ID
MERCADOPAGO_WEBHOOK_URL
PAYMENT_RETURN_URL
```

Se comprobó directamente:

```text
MP_ERROR 503 PASARELA_NO_CONFIGURADA
```

Esto es el comportamiento esperado y seguro: el checkout se bloquea antes de reservar o reutilizar una transacción. El flujo manual de transferencia sigue disponible.

### 4.4 Estado real de Mercado Pago y del webhook

La información recibida decía que el adaptador y el webhook estaban pendientes de Torito. **El código ya está en el repositorio**:

- `services/mercadopago.adapter.js`
- `routes/mercadopago-webhook.routes.js`
- `services/transacciones-pago.service.js`
- Pruebas: `tests/mercadopago-adapter.test.js`, `tests/mercadopago-flujo.test.js`, `tests/mercadopago-montaje.test.js`
- Documentación: `docs/INTEGRACION_MERCADOPAGO.md`

Lo pendiente es **configuración real y validación end-to-end**, no la implementación base. Si Torito vuelve a implementarlo, se duplicaría trabajo.

### 4.5 Brechas funcionales del módulo

1. **No existe endpoint para subir el comprobante**. `POST /api/alumno/pagos/:idPago/comprobante` recibe `urlComprobante` como ruta local `/uploads/comprobantes/...`, pero no hay ruta de carga y la carpeta no existe. El frontend tendría que subir el archivo por fuera del backend o la funcionalidad está incompleta.
2. **`/uploads` es estático y público**. Si en el futuro se guardan comprobantes ahí, quedarían accesibles sin autenticación. No es aceptable para datos bancarios.
3. **Comprobante sin validación de archivo real**: se valida la forma de la ruta, no que el archivo exista, sea PDF/imagen o pertenezca al alumno.
4. **Sin cola durable**: el webhook reintenta vía Mercado Pago; no hay outbox. Es aceptable para el volumen actual, pero debe monitorearse.
5. **Estados de reverso no revierten la cuota automáticamente**: `refunded`/`charged_back` generan `MERCADOPAGO_REQUIERE_REVISION`; es una decisión conservadora correcta, pero requiere operación manual.

---

## 5. Auditoría de seguridad

### 5.1 Controles que están bien implementados

| Control | Resultado |
|---|---|
| JWT | HS256, secreto mínimo de 32 caracteres, expiración 8h, algoritmo fijado en verificación |
| Revalidación de sesión | Consulta usuario, perfil y academia en cada request; rechaza usuario inactivo, múltiples perfiles o academia cambiada |
| Roles | Por nombre normalizado, sin `IdPerfil` fijo; Administrador y RRHH comparten permisos |
| Asignación por DNI | **No existe** lógica de perfil según último dígito del DNI; hay pruebas que lo prohíben |
| SQL injection | Consultas parametrizadas; no se interpola entrada de usuario. Solo hay una concatenación de fragmentos SQL fijos en `admin-ciclos.routes.js` |
| CORS | Whitelist explícita, sin `*`, con orígenes de producción, local y `CORS_ORIGINS` |
| Errores | Respuestas genéricas al cliente; los detalles SQL quedan en logs del servidor |
| Registro público | Solo crea perfil `Alumno`, en la academia configurada por `PUBLIC_REGISTRATION_ACADEMY_ID`; no acepta rol ni academia del body |
| Autoservicio | `PUT /usuarios/me` usa allowlist de campos y toma la identidad de la sesión |
| Notas | Los listados requieren perfil administrativo; el historial propio exige que el ID solicitado sea el del alumno autenticado |
| Pagos | Aislamiento por usuario y academia; no se confía en montos del cliente; auditoría transaccional |
| Webhook | HMAC con timestamp, ventana de 5 minutos, consulta a la API real y validación de vendedor/entorno/monto/moneda |
| Variables de entorno | `.env` está ignorado; solo se versionan `.example` sin secretos |
| Uploads de perfil/material | Validación de MIME, bytes mágicos, tamaño real y nombres seguros |

### 5.2 Hallazgos de seguridad

#### S-01 — `/uploads` público (Alto)

`index.js` sirve `app.use("/uploads", express.static(UPLOADS_DIR))` sin autenticación. Hoy solo hay `perfiles/` y `materiales/`, pero el contrato de comprobantes apunta a `/uploads/comprobantes/`. Cualquier archivo allí sería accesible con la URL, sin verificar que el solicitante sea el alumno o un administrador.

**Recomendación:** mover comprobantes a almacenamiento privado (bucket con URLs firmadas) o servirlos mediante un controlador autenticado que valide propiedad/academia. No usar `express.static` para documentos sensibles.

#### S-02 — No hay endpoint de subida de comprobantes (Alto, funcional)

El alumno no puede subir el archivo por la API. Solo puede declarar una ruta que debe existir previamente. Esto impide completar el flujo manual de forma segura y consistente.

**Recomendación (Morgan/frontend):** definir el contrato de carga, validar tipo/tamaño, guardar en almacenamiento privado y devolver un identificador, no una URL pública.

#### S-03 — Duplicados históricos de identidad (Alto)

Hay 20 cuentas adicionales con correo repetido y 4 con DNI repetido. La aplicación bloquea altas nuevas con `bloquearIdentidades` + `usuarioDuplicado`, pero no hay UNIQUE en BD. El login consulta `LIMIT 2`; si hay más de una coincidencia, solo compara la contraseña de la primera y luego responde 403 “Identidad ambigua”. Un usuario legítimo puede quedar fuera.

**Recomendación:** auditar y consolidar cuentas con respaldo y aprobación; después agregar columnas generadas y UNIQUE de correo/DNI. No ejecutar el UNIQUE antes de limpiar.

#### S-04 — Conexión a BD con usuario administrativo y sin TLS explícito (Medio-Alto)

La auditoría se conectó como `avnadmin@%`, un usuario con privilegios amplios, y `config/db.js` no configura `ssl`. Aunque la red de Aiven pueda cifrar el transporte, la aplicación debería usar TLS explícito y un usuario restringido a las operaciones necesarias.

**Recomendación:** crear un usuario de aplicación con permisos mínimos (`SELECT/INSERT/UPDATE/DELETE` y los `EXECUTE` necesarios), habilitar TLS con CA del proveedor y rotar credenciales.

#### S-05 — Login sin rate limiting (Medio)

`/api/auth/login` no limita intentos. El flujo de recuperación sí tiene un limitador en memoria (5 solicitudes/15 min por IP), pero el login no. Es vulnerable a fuerza bruta y credential stuffing.

**Recomendación:** limitar por IP + identificador, con almacenamiento compartido (Redis) si hay más de una instancia.

#### S-06 — Contraseñas legacy en texto plano (Medio)

Hay **17 usuarios con contraseña no bcrypt**, de los cuales **13 están activos**. El login las acepta y las migra a bcrypt en el primer acceso, pero hasta entonces están en texto plano en la base.

**Recomendación:** planificar una migración controlada (hash de los valores existentes con respaldo) o forzar restablecimiento a los 13 usuarios activos. No se modificaron credenciales en esta auditoría.

#### S-07 — Tablas de pagos sin claves foráneas (Medio)

`PagoTransaccion`, `PagoComprobante` y `PagoAuditoria` no tienen FK. La aplicación mantiene la coherencia, pero un script externo o un bug podría crear huérfanos. Además, `PagoComprobante`/`PagoAuditoria` usan `BIGINT UNSIGNED` para `IdPago`, incompatible con `PagosMensualidad.IdPago INT`.

**Recomendación:** alinear tipos y agregar FK después de verificar 0 huérfanos. Ver el SQL de diagnóstico adjunto.

#### S-08 — Sin cabeceras de seguridad HTTP (Medio-Bajo)

No se usa `helmet` ni se definen `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` o `Strict-Transport-Security` de forma global. CORS está bien, pero faltan defensas de navegador.

**Recomendación:** agregar `helmet` o cabeceras equivalentes, especialmente si se sirven documentos o HTML.

#### S-09 — Rate limiting de recuperación en memoria (Bajo)

El mapa `solicitudesPublicas` se reinicia con el proceso y no se comparte entre instancias. Un atacante puede evadirlo con reinicios o balanceo.

**Recomendación:** moverlo a Redis o a un middleware compartido.

#### S-10 — Registro público sin límite de altas (Bajo-Medio)

No hay rate limit en `/api/auth/register` ni en el checkout público. Aunque `bloquearIdentidades` serializa las altas, un atacante podría generar cuentas y correos masivamente.

**Recomendación:** limitar por IP, correo y ventana temporal; agregar captcha si el volumen lo justifica.

#### S-11 — Perfiles administrativos sin auditoría específica (Bajo)

Un administrador puede crear o promover perfiles administrativos. No hay un registro de auditoría dedicado a cambios de rol (solo logs de aplicación). Es una decisión de negocio, pero conviene trazabilidad.

**Recomendación:** auditar cambios de `Usuario_Perfiles` y altas de administradores.

#### S-12 — Configuración incompleta del entorno (Informativo)

El `.env` auditado solo contiene DB, PORT, JWT_SECRET y GEMINI_API_KEY. Faltan variables de correo (`GOOGLE_SCRIPT_URL`, `GOOGLE_SCRIPT_TOKEN`), datos bancarios (`PAYMENT_*`), Mercado Pago y URLs públicas. Por eso:

- Mercado Pago responde 503.
- Recuperación de contraseña responde 503 (`CORREO_NO_CONFIGURADO`).
- El frontend puede recibir instrucciones de transferencia no configuradas.

### 5.3 Acceso a información de otros alumnos

Se revisaron específicamente:

- `GET /api/alumno/pagos`: filtra por `p.IdUsuario = sesión` y `u.IdAcademia = sesión`. ✅
- `POST /api/alumno/pagos/:idPago/iniciar` y `/comprobante`: misma condición; no permiten IDs de otros. ✅
- `GET /api/notas/alumno/:id`: `autorizarHistorialAlumno` permite administrador o el propio alumno; la consulta además filtra por academia. ✅
- `GET /api/notas`: solo perfiles administrativos; docentes/tutores no tienen alcance verificable y se rechazan. ✅
- `GET /api/usuarios`: solo Administrador; devuelve datos de la academia de la sesión. ✅
- `GET /api/usuarios/directorio`: Administrador ve su academia; Docente/Tutor solo su propia entrada. ✅
- `GET /api/pagos/ciclo/:idCiclo`: Administrador, con `idAcademia` de sesión. ✅

No se encontró una ruta que permita a un alumno consultar notas, mensualidades o comprobantes de otro alumno.

---

## 6. Problemas encontrados

Prioridad: **P0** bloquea producción, **P1** debe resolverse antes de producción, **P2** mejora recomendada.

| ID | Prioridad | Problema | Evidencia / impacto | Responsable sugerido |
|---|---|---|---|---|
| P-01 | P0 | Duplicados históricos de correo/DNI | 20 cuentas con correo repetido; 4 con DNI repetido; login ambiguo y UNIQUE imposible | Yan |
| P-02 | P0 | Falta UNIQUE de `Usuario.CorreoElectronico` y `Usuario.DNI` | Solo validación de aplicación; concurrencia/scripts pueden duplicar | Yan |
| P-03 | P1 | 4 usuarios activos sin perfil | IDs 100, 114, 115, 116; no pueden iniciar sesión | Yan |
| P-04 | P1 | `/uploads` público | `express.static` sin auth; riesgo para comprobantes | Yan / Infra |
| P-05 | P1 | No hay subida de comprobantes | El contrato solo acepta una ruta; flujo manual incompleto | Morgan |
| P-06 | P1 | `PagoComprobante`/`PagoAuditoria` sin FK y con tipos incompatibles | `BIGINT UNSIGNED` vs `INT`; integridad dependiente de código | Yan |
| P-07 | P1 | Conexión con usuario administrativo y sin TLS explícito | `avnadmin@%`; `config/db.js` sin `ssl` | Yan |
| P-08 | P1 | 13 usuarios activos con contraseña en texto plano | 17 en total; migración solo al iniciar sesión | Yan |
| P-09 | P1 | Login sin rate limiting | Fuerza bruta/credential stuffing | Yan |
| P-10 | P1 | `Matricula.IdCurso` siempre NULL | 35/35; notas y cierres por curso no operan | Morgan / Yan |
| P-11 | P2 | Reservas `CREANDO` colgadas | Sin job de expiración; bloqueo `409 EN_PREPARACION` | Morgan |
| P-12 | P2 | 32 cuotas sin `FechaVencimiento` | Morosidad/recordatorios no automatizables | Morgan |
| P-13 | P2 | Ciclos 14 y 15 activos sin precios | Checkout online/generación de cuotas falla con 409 | Morgan / Admin |
| P-14 | P2 | Sin cabeceras de seguridad | Falta Helmet/CSP/HSTS | Yan |
| P-15 | P2 | Rate limit de recuperación en memoria | Se reinicia y no se comparte entre instancias | Yan |
| P-16 | P2 | `acadesys_db_init.sql` desactualizado | `Perfil` vs `perfil`; sin tablas de pagos | Yan |
| P-17 | P2 | Índices/FK duplicados | 3 UNIQUE de `CodigoUsuario`; 2 FK de `Matricula.IdCiclo` | Yan |
| P-18 | P2 | Sin UNIQUE de `PagoComprobante (IdPago, Referencia)` | Duplicados posibles fuera del flujo transaccional | Yan |
| P-19 | P2 | Sin UNIQUE de `PagosMensualidad (IdUsuario, IdCiclo, Mes)` | Idempotencia solo por bloqueo de aplicación | Yan |
| P-20 | P2 | Sin CI automatizado | `npm test` es manual; no hay pipeline versionado | Yan |

---

## 7. Correcciones realizadas

### 7.1 Corrección 1 — Fechas fijas caducadas en pruebas de ciclos

**Problema:** tres pruebas de `POST /api/admin/ciclos` usaban `fechaInicio: '2026-11-02'` y `fechaFin: '2027-03-01'`. Al ejecutar la auditoría el 2026-11-06, la fecha de inicio ya era pasada y la regla de negocio (correcta) rechazaba la creación con 400. No era un bug del producto, sino una prueba dependiente del calendario.

**Archivo:** `tests/admin-ciclos.universidad-cursos.test.js`

**Solución:** se agregó `fechaRelativa(dias)` y el helper `cuerpoCiclo` ahora usa `hoy + 30 días` y `hoy + 180 días` en UTC. Se conservan todas las expectativas (201 para universidad correcta, 400 para mezcla de universidades, etc.).

**Efecto:** solo en pruebas; no cambia el comportamiento de la API ni los datos.

### 7.2 Corrección 2 — Mock desactualizado tras el merge de conflictos docentes

**Problema:** el merge incorporó `utils/conflictos-docentes.js`. La prueba de horarios usaba un pool falso que no contemplaba la nueva consulta `SELECT h.IdHorario AS ConflictoDocente FROM Asignacion_Aula actual...` y lanzaba `Consulta no prevista`. No era un fallo del código de producción, sino del mock de la prueba.

**Archivo:** `tests/horarios.universidad-cursos.test.js`

**Solución:** se agregó una rama explícita que devuelve `[[]]` (sin conflicto) para esa consulta. El catálogo de prueba no define asignaciones, por lo que el resultado correcto es “no hay conflicto”.

**Efecto:** solo en pruebas; la validación real de conflictos sigue activa en producción.

### 7.3 Corrección 3 — Prueba intermitente de token manipulado

**Problema:** la prueba construía un token alterado con `${token.slice(0, -1)}A`. Si el token ya terminaba en `A` (probabilidad aproximada de 1/64), el token no cambiaba y la prueba fallaba de forma intermitente.

**Archivo:** `tests/token-verificacion-matricula.test.js`

**Solución:** se reemplaza el último carácter por uno **distinto**:

```js
const ultimo = token.slice(-1);
const alterado = `${token.slice(0, -1)}${ultimo === 'A' ? 'B' : 'A'}`;
```

**Efecto:** la prueba sigue verificando que un token manipulado se rechaza, pero de forma determinista.

### 7.4 Entregable adicional — SQL de diagnóstico de solo lectura

**Archivo:** `database/DIAGNOSTICO_INTEGRIDAD_YAN_2026-11-06.sql`

Contiene 23 consultas de solo lectura para reproducir:

- estructura de `PagoTransaccion`,
- tipos compatibles/incompatibles,
- huérfanos,
- duplicados de identidad y negocio,
- usuarios sin perfil,
- matrículas sin curso,
- cuotas sin vencimiento,
- ciclos sin precios,
- evaluaciones fuera de escala,
- eventos de auditoría.

Las propuestas de DDL están **comentadas**. El archivo se ejecutó en modo lectura para validar su sintaxis (23 result sets, sin errores). No se ejecutó ningún `ALTER`, `CREATE`, `DROP`, `INSERT`, `UPDATE` ni `DELETE`.

### 7.5 Lo que no se modificó

- No se cambió ningún contrato de API.
- No se tocó el adaptador de Mercado Pago ni el webhook (responsabilidad de Torito).
- No se modificaron datos de producción.
- No se agregaron FKs ni UNIQUE en la base viva.
- No se cambiaron credenciales.
- No se instalaron dependencias.
- No se hicieron commits, push ni cambios de rama.

---

## 8. Archivos modificados

| Archivo | Tipo de cambio | Motivo |
|---|---|---|
| `tests/admin-ciclos.universidad-cursos.test.js` | Corrección de prueba | Fechas relativas para evitar caducidad |
| `tests/horarios.universidad-cursos.test.js` | Corrección de prueba | Mock de la nueva consulta de conflictos docentes |
| `tests/token-verificacion-matricula.test.js` | Corrección de prueba | Mutación determinista del token |
| `database/DIAGNOSTICO_INTEGRIDAD_YAN_2026-11-06.sql` | Nuevo, solo lectura | Evidencia reproducible de integridad |
| `INFORME_BACKEND_YAN.md` | Nuevo | Este informe |

No se modificó ningún archivo de `routes/`, `services/`, `middlewares/`, `utils/`, `config/` ni `index.js`.

---

## 9. Pruebas ejecutadas y resultados

### 9.1 Suite principal

```bash
npm test
```

Resultado final:

```text
ℹ tests 301
ℹ pass 301
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 25559.1997
EXIT=0
```

Además, el runner ejecutó las tres suites locales:

| Suite | Resultado |
|---|---|
| `prueba-auth-local.js` | 4 comprobaciones OK |
| `prueba-cierre-local.js` | 5 comprobaciones OK |
| `prueba-notas-actas-local.js` | 21 comprobaciones OK |

Total verificable: **301 pruebas del runner + 30 comprobaciones locales = 331 comprobaciones aprobadas, 0 fallidas**.

> Nota de honestidad: la primera ejecución antes de las correcciones dio **295/301** (6 fallos). Los 6 fallos eran de mantenimiento de pruebas, no de producto: 3 por fechas fijas caducadas, 2 por el mock de conflictos docentes y 1 por la mutación aleatoria del token. Tras las correcciones, la suite quedó **301/301**.

### 9.2 Verificación de sintaxis

```bash
node scripts/check-sintaxis.js
```

Resultado:

```text
node --check correcto en 86 archivo(s) JS.
```

### 9.3 Verificación de configuración de Mercado Pago

```bash
node -e "try { require('./services/mercadopago.adapter').verificarConfiguracion(); console.log('MP_CONFIGURADA'); } catch (e) { console.log('MP_ERROR', e.status, e.code); }"
```

Resultado:

```text
MP_ERROR 503 PASARELA_NO_CONFIGURADA
```

Confirma que el 503 actual se debe a falta de credenciales, no a un fallo del código.

### 9.4 Auditoría de base de datos

Se ejecutaron consultas de **solo lectura** contra Aiven:

- `SHOW`/`information_schema` para tablas, columnas, índices y FK.
- Conteos y agrupaciones de estados.
- Búsqueda de duplicados y huérfanos.
- Comparación de evaluaciones con la escala de `utils/escalas.js`.
- Verificación de contraseñas bcrypt vs. texto plano.

No se ejecutó DDL ni DML. El SQL de diagnóstico del repositorio fue validado con 23 result sets.

---

## 10. Pendientes de Morgan

1. **Definir e implementar la subida de comprobantes** o acordar con frontend el almacenamiento privado. El endpoint actual solo acepta una ruta; no hay archivo.
2. **Resolver el modelo de curso en la matrícula**: las 35 matrículas tienen `IdCurso = NULL`. Decidir si la matrícula es por ciclo (como hoy) o por curso; si es por curso, ajustar notas, cierres y asistencia.
3. **Agregar recuperación de reservas `CREANDO` colgadas** (por ejemplo, marcar `ERROR` tras N minutos sin orden) o un job de conciliación.
4. **Revisar la unicidad de comprobantes** y el flujo de referencias repetidas entre estados.
5. **Configurar precios** en los ciclos 14 y 15 y fechas de vencimiento para nuevas cuotas.
6. **Actualizar la documentación** para reflejar que el adaptador y el webhook ya están implementados y que lo pendiente es configuración/E2E.
7. **Validar el contrato del frontend**: 201 al crear checkout, 200 al reutilizar, 409 en preparación/conflicto, 503 sin configuración, 502 ante fallo del proveedor; no mostrar “Pagado” hasta confirmación verificable.
8. **Definir política de reversos** (`refunded`/`charged_back`): hoy generan revisión manual y no revierten la cuota.

---

## 11. Pendientes de Torito

1. Configurar en el gestor de secretos (no en el repositorio):
   - `MERCADOPAGO_ENV=test` y luego `production`
   - `MERCADOPAGO_ACCESS_TOKEN`
   - `MERCADOPAGO_WEBHOOK_SECRET`
   - `MERCADOPAGO_SELLER_ID`
   - `MERCADOPAGO_WEBHOOK_URL=https://<backend>/api/webhooks/mercadopago`
   - `PAYMENT_RETURN_URL=https://<frontend>/alumno/pagos`
2. Usar una cuenta de vendedor de prueba de Perú, separada del comprador, y verificar `site_id = MPE`, `country_id = PE` y `test_user`.
3. Validar end-to-end en sandbox:
   - pago aprobado,
   - pago pendiente/en proceso,
   - pago rechazado,
   - pago cancelado,
   - reembolso,
   - contracargo,
   - notificación duplicada y fuera de orden.
4. Verificar la firma HMAC, la ventana de 5 minutos, el `x-request-id` único y el rechazo de eventos que no sean `payment`.
5. Confirmar que el webhook es público por HTTPS, sin JWT, con límite de 32 KiB y que responde 502/503 con `Retry-After: 60` cuando corresponde.
6. Mantener el reloj sincronizado y monitorear latencias/errores de la API de Mercado Pago.
7. Revisar el código ya presente antes de reimplementarlo: `services/mercadopago.adapter.js` y `routes/mercadopago-webhook.routes.js` ya cubren el contrato y tienen pruebas.
8. No activar `MERCADOPAGO_ENV=production` hasta completar la validación en QA.

---

## 12. Pendientes de Yan

1. **Respaldar** la base y coordinar ventana de mantenimiento antes de cualquier cambio de integridad.
2. **Limpiar duplicados históricos** de correo/DNI con aprobación; definir qué cuenta conserva cada persona y archivar el resto.
3. **Agregar UNIQUE** de correo/DNI con columnas generadas, solo después de la limpieza.
4. **Asignar perfil** a los 4 usuarios activos sin perfil o desactivarlos si son cuentas de prueba.
5. **Alinear tipos** de `PagoComprobante`/`PagoAuditoria` y agregar FKs de pagos después de verificar 0 huérfanos.
6. **Agregar UNIQUE** de `PagoComprobante (IdPago, Referencia)` y de `PagosMensualidad (IdUsuario, IdCiclo, Mes, EstadoRegistro)` tras auditar históricos.
7. **Eliminar duplicados** de índices/FK en `Usuario` y `Matricula` con `SHOW CREATE TABLE` y respaldo.
8. **Habilitar TLS** en `config/db.js` y crear un usuario de aplicación de mínimos privilegios.
9. **Migrar las contraseñas legacy**: 13 usuarios activos con texto plano. No se deben modificar credenciales sin aprobación; planificar hash o reset forzado.
10. **Agregar rate limiting** al login y al registro público; mover el limitador de recuperación a un almacén compartido si hay varias instancias.
11. **Agregar cabeceras de seguridad** (Helmet/CSP/HSTS).
12. **Proteger documentos**: comprobantes en almacenamiento privado; no servir `uploads/comprobantes` con `express.static`.
13. **Crear CI** que ejecute `npm test` y `node scripts/check-sintaxis.js` en cada push/PR.
14. **Actualizar `acadesys_db_init.sql`** o marcarlo como histórico; la fuente de verdad debe ser migraciones + esquema vivo.
15. **Monitorear** pagos: transacciones `CREANDO` antiguas, `PagoAuditoria` sin evento final, webhooks 5xx y diferencias entre `PagoTransaccion` y `PagosMensualidad`.
16. **Revisar datos de demo** (ciclos 14/15 sin precio, cuentas sin perfil) antes de producción.

---

## 13. Recomendaciones para producción

### 13.1 Seguridad

- Gestionar secretos en Render/gestor de secretos, nunca en `.env` versionado.
- Rotar credenciales de BD y de Mercado Pago si fueron compartidas por canales informales.
- Usar TLS en la conexión MySQL y un usuario de aplicación con permisos mínimos.
- Agregar `helmet`, límites de tasa y, si es posible, WAF/proxy con reglas.
- Revisar y reducir los orígenes CORS a los dominios reales.
- No exponer comprobantes ni documentos personales en `/uploads` público.

### 13.2 Base de datos

- Tomar respaldo completo y verificar restauración antes de cualquier migración.
- Aplicar cambios de integridad primero en staging con una copia restaurada y anonimizada.
- No ejecutar `POST_DEMO_UNIQUE_FK.sql` ni el SQL de diagnóstico con DDL en producción sin backup y ventana.
- Agregar FK/UNIQUE en orden: limpiar datos → validar 0 huérfanos → alinear tipos → crear restricciones.
- Mantener `PagoTransaccion` como tabla existente; no recrearla.
- Separar datos de demo de datos reales y desactivar cuentas/ciclos de prueba antes del lanzamiento.

### 13.3 Pagos

- Validar el flujo completo en sandbox con las cuentas oficiales de prueba.
- Monitorear `503 PASARELA_NO_CONFIGURADA`; si aparece en producción, revisar variables antes de reiniciar.
- Implementar conciliación periódica entre `PagoTransaccion`, `PagoComprobante`, `PagoAuditoria` y `PagosMensualidad`.
- Definir runbook para:
  - pago aprobado sin cuota actualizada,
  - pago duplicado,
  - reembolso/contracargo,
  - reserva `CREANDO` colgada,
  - webhook caído.
- No marcar una cuota como Pagado sin comprobante aprobado o confirmación verificable del proveedor.

### 13.4 Operación y calidad

- Configurar `GOOGLE_SCRIPT_URL`/`GOOGLE_SCRIPT_TOKEN` y probar recuperación de contraseña con un buzón real de QA.
- Configurar `PAYMENT_ACADEMY_ID` y datos bancarios por academia; no mostrar datos de una academia a otra.
- Ejecutar `npm test` y `node scripts/check-sintaxis.js` en CI antes de cada despliegue.
- Agregar pruebas de integración contra staging para pagos, matrículas y cierres.
- Documentar el contrato real (incluyendo que el adaptador/webhook ya existen) y el estado de las migraciones.
- Mantener un canal de alertas para errores 5xx, webhooks fallidos y transacciones atascadas.

---

## Resumen ejecutivo

- **Arquitectura:** API Express 5 con rutas, middlewares, servicios y utilidades; JWT revalidado contra BD; CORS por whitelist; SQL parametrizado; webhook con HMAC.
- **Base de datos:** 24 tablas, 54 usuarios, 45 cuotas, 1 transacción y 0 comprobantes. Existe `PagoTransaccion` con todos los campos necesarios y tres UNIQUE de idempotencia; **no se debe recrear**.
- **Pagos:** las 10 reglas de seguridad del módulo se cumplen. El 503 actual es por falta de variables de Mercado Pago. El adaptador y el webhook **ya están implementados y probados**; falta configuración real y E2E.
- **Problemas principales:** duplicados históricos de identidad, falta de UNIQUE/FK, 4 usuarios sin perfil, `/uploads` público, ausencia de subida de comprobantes, usuario de BD administrativo sin TLS explícito, 13 contraseñas activas en texto plano y login sin rate limiting.
- **Correcciones:** solo pruebas (fechas relativas, mock de conflictos, mutación determinista) y un SQL de diagnóstico de solo lectura. No se tocó producción ni contratos.
- **Pruebas:** **331 comprobaciones aprobadas, 0 fallidas** (301 del runner + 30 locales), sintaxis OK en 86 archivos, `npm test` con `EXIT=0`.
- **Prioridad inmediata:** limpiar identidades duplicadas, asignar perfiles, proteger comprobantes, configurar Mercado Pago/QA y agregar restricciones de integridad con respaldo.
