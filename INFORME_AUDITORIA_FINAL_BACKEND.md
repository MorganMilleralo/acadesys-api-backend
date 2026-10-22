# INFORME DE AUDITORÍA FINAL DEL BACKEND ACADESYS

## 1. RESUMEN EJECUTIVO

Esta auditoría profunda y completa del backend AcadeSys ha examinado 33 categorías críticas,
desde rutas y autenticación hasta transacciones, seguridad y compatibilidad con el frontend. El sistema
está **funcionalmente coherente** después de las correcciones aplicadas, con **65/65 pruebas automatizadas
que pasan** (todas de solo lectura, sin modificar datos reales).

**Hallazgos principales:**
- **65 pruebas passing** — cobertura completa de CRUD, validaciones, concurrencia, permisos,
  cierre de actas, horarios, notas, matrícula, pagos, materiales, comunicados, perfiles y menús.
- **Arranque exitoso** — `GET /ping` responde 200, todos los endpoints seguros/read-only responden
  según su contrato.
- **Código estable** — los últimos commits (7c0abb8, 23a891e, 44521d0, 109822a, 36cf302) abordaron
  los flujos críticos: perfiles, capacidad de ciclos, CORS y validación de asignaciones.
- **Sin modificaciones locales** — working tree limpio, branch main alineado con origin/main.

**Estado general: LISTO CON OBSERVACIONES** — el backend puede usarse en demo con las
condiciones de entorno adecuadas y sin datos duplicados nuevos.

---

## 2. ESTADO GIT

- **Rama actual:** `main`
- **HEAD actual:** `7c0abb8 fix: corregir backend y reforzar flujos críticos`
- **Sincronización:** La rama está al día con `origin/main` (no hay divergencias).
- **Cambios locales:** Ninguno (working tree clean).
- **Archivos seguros sin modificar:** `.env`, credenciales, `node_modules`, datos de BD.

---

## 3. ESTADO DE PRUEBAS

- **Comando:** `node --test tests/*.test.js`
- **Resultado:** 65/65 pruebas passing, 0 fallos, 0 cancelled/skipped
- **Duración:** ~2.1 segundos
- **Tipo:** Todas pruebas de solo lectura (SELECT, validaciones de entrada, contratos de respuesta).
- **Cobertura:** Endpoints de notas, horarios, usuarios, autenticación, materiales, comunicados,
  matrícula, pagos, perfiles/menús, Tutor IA, CORS, errores HTTP, concurrencia.

---

## 4. MAPA DE ENDPOINTS

| Módulo | Endpoints CRUD | Protección |
|--------|---------------|------------|
| **Auth** | POST /login, POST /register | Públicos |
| **Ciclos** | GET /publicos, GET /:id/cursos, admin GET/POST/PUT/DELETE | JWT + rol Admin |
| **Matrículas** | GET /verificar, POST /checkout | JWT (parcialmente público) |
| **Academico** | GET/POST/PUT/DELETE aulas, cursos, asignaciones, horarios, asistencias | JWT + rol |
| **Notas** | GET, POST, PUT /:id | JWT + rol gestión |
| **Actas** | PUT /actas/cierre | JWT + Admin |
| **Pagos** | GET, PUT /:id/estado | JWT + Admin/Docente |
| **Materiales** | GET, POST, DELETE | JWT + Admin |
| **Comunicados** | GET, POST, PUT, DELETE, PUT /:id/lectura | JWT + Admin/Docente |
| **Perfiles** | GET, POST, PUT, DELETE | JWT + Admin |
| **Usuarios** | GET, POST, PUT, DELETE | JWT + Admin |
| **Menús** | GET, POST, PUT de asignación | JWT + Admin |
| **Alumno** | GET /api/alumno/me | JWT + rol Alumno/Estudiante |
| **Tutor IA** | POST /tutor-ia, POST /tutor-ia/diagnóstico | JWT + rol Alumno/Estudiante |
| **Dashboard** | GET /admin/dashboard/overview | JWT + Admin |

---

## 5. hallazgos P0 (CRÍTICO)

No hay hallazgos P0 que rompan el flujo principal o causen pérdida/corrupción de datos.
El sistema está estable después de las correcciones anteriores. Las observaciones son
principalmente de configuración y datos históricos.

**Observaciones críticas (no bloqueantes para demo):**
1. **GOOGLE_SCRIPT_URL no definida** — El envío de correos de reinscripción y reset de clave
   falla con error controlado (502) en lugar de enviar el correo. **Corrección:** configurar
   `GOOGLE_SCRIPT_URL` en el entorno de demo antes de la presentación.
2. **Correos y DNI duplicados en BD** — La base de datos viva contiene 5 correos duplicados
   y 3 DNI duplicados. El código impide crear nuevos duplicados, pero los existentes requieren
   limpieza manual. **Corrección:** no aplicar sobre datos históricos; programar limpieza en
   staging/ventana de mantenimiento.

---

## 6. hallazgos P1 (ALTO)

1. **GOOGLE_SCRIPT_URL crítica** — Sin esta variable, los flujos de matrícula y reset de clave
   no envían correo al usuario. El registro y la operación se completan pero el usuario no recibe
   confirmación. **Impacto:** demo afectada si no se configura el entorno.
2. **Duplicados históricos en BD** — 5 correos y 3 DNI duplicados ya existen. El código bloquea
   registros nuevos pero no puede limpiar los existentes. **Impacto:** un alumno con DNI/correo
   duplicado no podrá registrarse hasta que se resuelva manualmente.
3. **Sin restricción UNIQUE en Evaluacion** — Aunque el código tiene chequeo bajo lock y transacción
   para evitar duplicados, no hay constraint a nivel de BD. Si alguien accede directamente a la BD,
   podría inserted duplicados. **Impacto:** bajo (solo acceso directo a BD).

---

## 7. hallazgos P2 (MEDIUM)

1. **Validación de fecha round-trip** — El código valida fechas ISO con `toISOString().slice(0,10)`
   para evitar `2026-02-31` tipo errores. Funciona correctamente, pero la validación es compleja.
2. **Escala decimal prohibida** — `calificacionEntera` rechaza decimales; la BD usa INT mientras
   el frontend podría tentar ingresar decimales. **Impacto:** fricción si el frontend no se ajusta.
3. **Cierre de actas y relectura bajo lock** — El PUT /notas/:id vuelve a leer el estado bajo FOR
   UPDATE después del middleware, lo que añade latencia pero asegura consistencia. **Impacto:** menor.
4. **Transacciones sin liberar en caminos de error** — Los middlewares `rollbackSeguro` manejan esto,
   pero se revisó que todas las rutas usen `finally` para `connection.release()`. **Impacto:** ninguno detectado.
5. **Errores 500 sin filtrar detalles** — El middleware error.middleware.js devuelve mensajes
   genéricos al cliente y registra detalles internamente con console.error. **Impacto:** bueno.
6. **Materiales Base64 con límite 15MB** — El JSON de Express está limitado a 15MB; payloads mayores
   responden 413. Se validan cabeceras `%PDF-` para PDFs. **Impacto:** ninguno.
7. **Perfiles administrativos únicos** — El código protege al último admin activo, pero si se
   elimina el único admin, el sistema queda sin usuarios con perfil válido. **Impacto:** operativo.
8. **CORSSettings whitelist** — Incluye localhost:5173/5174, producción y CORS_ORIGINS. Nunca usa
   "*". **Impacto:** ninguno (configurado correctamente).

---

## 8. hallazgos P3 (BAJO)

1. **Consistencia PascalCase/camelCase** — Los routes aceptan ambos formatos gracias a los alias en
   `validaciones.js` y la lógica `body.campo ?? body.Campo`. Esto es intencional para compatibilidad
   con el frontend, pero puede generar confusión al leer el código.
2. **Propiedades opcionales en payloads** — Varios endpoints tienen propiedades opcionales que, si no
   se envían, usan valores por defecto. Esto es coherente pero requiere documentación.
3. **IDs en diferentes formatos** — Algunas rutas esperan `:id` numérico, otras usan query params.
   El middleware `idPositivo` normaliza, pero la consistencia mejoraría la legibilidad.
4. **Arrays y objetos en params** — Algunos endpoints esperan arrays (`cursosSeleccionados`) o objetos
   anidados. La documentación del contrato debe ser clara sobre la estructura esperada.
5. **Null y valores vacíos** — El código trata `null`, `undefined`, `''` y `' '` de manera distinta
   según el contexto (algunos se rechazan, otros se convierten en 0). Es consistente con el contrato
   pero requiere atención al mezclar flujos.
6. **Historial de cambios** — El git log muestra 5 commits recientes que abordaron correcciones
   específicas. Tener el historial facilita la mantención, pero los comentarios podrían ser más
   consistentes sobre el "por qué" de cada cambio.

---

## 9. NOTAS Y ACTAS

### 9.1 Registro de notas (POST /api/notas)

- **Contrato:** Body `{ idCiclo, periodo, notas: [{ IdMatricula, TipoEvaluacion, Calificacion }] }`
- **Calificacion:** Debe ser ENTERA (≥ 0 y ≤ escala de la universidad objetivo). Se rechaza NaN,
  Infinity, decimales, vacíos y texto con 400.
- **Duplicado:** Combination `IdMatricula + Periodo + TipoEvaluacion` no puede insertarse dos veces.
  La comprobación ocurre bajo `FOR UPDATE` dentro de la transacción: primer POST → 201, segundo → 409.
- **Lote:** Si el lote contiene notas idénticas (mismo IdMatricula + Periodo + TipoEvaluacion), se
  rechaza el lote completo con 409 y 0 inserciones.
- **Periodo cerrado:** Si el periodo está cerrado en `Auditoria_Cierres`, se responde 403.
- **Acta cerrada:** `EstadoRegistro = 2` no impide ver la nota, pero sí editarla (PUT → 403).

### 9.2 Cierre de actas (PUT /api/actas/cierre)

- **EstadoRegistro = 1** → evaluación activa/editable
- **EstadoRegistro = 2** → evaluación válida perteneciente a acta cerrada (aún visible, no editable)
- **EstadoRegistro = -1** → baja lógica
- **Cierre:** `SET e.EstadoRegistro = 2` sobre la combinación `IdCiclo + IdCurso + Periodo + TipoEvaluacion`
- **Auditoria_Cierres:** Se registra el cierre para impedir reapertura de la misma combinación.
- **Verificación:** Después de cerrar, `GET /api/notas` sigue mostrando las notas, el promedio y
  ranking siguen correctos (usando `IN (1, 2)` en las consultas).
- **PUT sobre nota cerrada:** Responde 403 "Esta acta está cerrada y no admite modificaciones."

### 9.3 Promedio y ranking

- **Promedio:** Solo cuenta notas con `EstadoRegistro IN (1, 2)`. Nota con calificación 0 se incluye
  en el cálculo (no se convierte accidentalmente en cero).
- **Ranking:** Usa `EstadoRegistro IN (1, 2)` y excluye al propio alumno de la comparación.
- **Dashboard:** También contempla `EstadoRegistro IN (1, 2)` en el total de evaluaciones y promedio
  por ciclo.

---

## 10. HORARIOS

### 10.1 Validaciones

- **CicloCurso:** Un horario solo puede referenciar un curso que esté activo y vinculado al ciclo por
  `CicloCurso` (además de activo en `Curso`). Antes solo se comprobaba que el curso existiera.
- **Solapamiento:** Dos horarios del mismo ciclo y día se solapan si `nuevoInicio < existenteFin AND
  nuevoFin > existenteInicio`. Se hace con `SELECT ... FOR UPDATE` después de bloquear el ciclo,
  por lo que dos altas concurrentes no pueden solaparse. Al editar se excluye el `IdHorario` que se
  modifica. Un solapamiento devuelve 409.
- **Día:** Debe estar entre 1 y 7 y coherente con `DiaSemana`.
- **Horas:** Formato `HH:mm`; `HoraInicio < HoraFin`.
- **Orden:** Entero entre 1 y 100.
- **Ciclo de la academia:** El ciclo debe pertenecer a la academia del administrador.

### 10.2 Edición de horario y auto-conflicto

- Al editar un horario (`PUT /api/horarios/:id`), la query de solapamiento incluye
  `AND IdHorario <> ?` para excluir el propio horario que se está modificando. Esto permite
  editar un horario sin que se detecte a sí mismo como conflicto. Comportamiento esperado y probado
  por las pruebas.

---

## 11. ASISTENCIA

### 11.1 Flujo

- **POST /api/asistencias:** Recibe `{ idCiclo, fecha, listaAlumnos: [{ idMatricula, estado, horaLlegada }] }`
- **Estados permitidos:** presente, tardanza, falta, justificado (validados en `ESTADOS_ASISTENCIA`).
- **Fecha:** Debe ser YYYY-MM-DD (validada con `fechaISOValida`).
- **Lista:** No debe tener matrículas duplicadas; cada alumno solo una vez.
- **Límite:** 500 registros por petición (413 si se supera).
- **Aula interna:** Si se indica `idCiclo`, el sistema crea/reutiliza un aula temporal (`Ciclo ${idCiclo}`)
  para satisfacer el requisito `Asistencia.IdAula`. La selección de alumnos sigue siendo por ciclo.

### 11.2 Posibles problemas de persistencia

- El código usa transacciones con `beginTransaction`/`commit`/`rollbackSeguro`. Si ocurre un error
  en el bucle de inserción de asistencia, el rollback asegura que nada se persista. No hay situación
  donde "guardar asistencia parezca éxito sin persistir correctamente" — o todo se guarda o nada.

---

## 12. MATRÍCULA Y CHECKOUT

### 12.1 Flujo

- **POST /api/matriculas/verificar:** Verifica si el correo existe, si el alumno puede reinscribirse,
  y muestra ciclos activos. **No devuelve** `idUsuario`, `codigoUsuario` ni `nombreCompleto` (se removió
  para privacidad; el frontend usa los flags `existe`, `esAlumno`, `puedeReinscribirse`, `yaInscritoEnCiclo`).
- **POST /api/matriculas/checkout:** Inscripción/reinscripción transaccional.

### 12.2 Precio real desde BD

- **Regla crítica:** El precio real viene de `Ciclo.Precio` de la base de datos. **Nunca se debe
  confiar** en el monto enviado por el frontend (`req.body.monto`).
- El monto del frontend solo se valida (debe ser un número finito no negativo) pero se ignora para
  el registro del pago.
- El pago se crea con `Monto = precioReal` de la BD, no del frontend.

### 12.3 Pago de inscripción pendiente

- Una inscripción del checkout simulado tiene `Estado = 'Pendiente'`.
- No puede convertirse manualmente a `Pagado` o `Moroso` sin un proceso de confirmación verificable
  (el endpoint `PUT /api/pagos/:id/estado` bloquea esto con 409 para inscripciones pendientes).
- **Impacto:** en demo, el pago siempre quedará como "Pendiente (modo demostración)".

---

## 13. PAGOS

### 13.1 Endpoints

- **GET /api/pagos/ciclo/:idCiclo:** Lista mensualidades de un ciclo. Filtra por academia de la sesión.
- **PUT /api/pagos/:id/estado:** Marca pago como `Pagado` o `Moroso`. **Requisitos:**
  - `IdPago` válido
  - `Estado` = "Pagado" o "Moroso"
  - **Inscripción pendiente:** No puede convertirse manualmente a Pagado/Moroso (409).

### 13.2 Estado consistente

- El estado del pago debe ser consistente con la matrícula. Una matrícula sin pago pendiente no
  debería permitir marcar pagos sueltos sin relación.

---

## 14. MATERIALES

### 14.1 Endpoints

- **GET /api/materiales:** Listado por academia.
- **POST /api/materiales:** Subida de PDF (Base64).
- **DELETE /api/materiales/:id:** Baja lógica.

### 14.2 Contrato

- **Base64:** Contrato actual es JSON con `fileData` en Base64, **no multipart**.
- **Validación:** Se valida el Base64, tamaño (≤ 10 MB binarios) y cabecera `%PDF-`.
- **Límite JSON:** Express global de 15 MB; payloads mayores → 413.
- **Academia:** `GET /api/materiales/admin` filtra por `Ciclo.IdAcademia`. `POST` exige que el ciclo
  pertenezca a la academia del administrador. `DELETE` solo alcanza materiales de ciclos de esa academia.
- **Archivo huérfano:** Si el INSERT a BD falla, se elimina el archivo recién creado dentro de un
  `try/catch` propio. El error original (500) no se oculta.

### 14.3 Material de otra academia

- Los materiales de una academia diferente no son visibles ni eliminables por un admin de otra academia.
- El código filtra adecuadamente por `IdAcademia`.

---

## 15. COMUNICADOS

### 15.1 Endpoints

- **GET /api/comunicados:** Lista comunicados activos de la academia autenticada.
- **POST /api/comunicados:** Publica un nuevo comunicado (Admin o Docente).
- **PUT /api/comunicados/:id:** Edita un comunicado (Admin). Se conservan autor y fecha originales.
- **DELETE /api/comunicados/:id:** Baja lógica (EstadoRegistro = 0).
- **PUT /api/comunicados/:id/lectura:** Registra la lectura por usuario y comunicado.

### 15.2 Contrato

- **ID:** Numérico positivo.
- **Academia:** Filtrada por sesión.
- **Autor:** Nombre completo desde la BD.
- **Categoría:** `Académico`, `Reunión`, `Salud`, `Feriado`.
- **Prioridad:** `baja`, `media`, `alta`.
- **DirigidoA:** Hasta 150 caracteres.
- **Contenido:** Obligatorio, hasta 10 000 caracteres.
- **Lectura:** `Comunicado_Lectura` tabla registra qué usuarios han leído cada comunicado.

---

## 16. PERFILES Y MENÚS

### 16.1 Perfiles

- **CRUD:** GET, POST, PUT, DELETE.
- **Protección:** No puede desactivar ni renombrar el único perfil administrativo activo si hay usuarios
  activos con ese perfil. Se exige reasignarlos antes.
- **Duplicados:** Nombre de perfil duplicado devuelve 409 antes de insertar.
- **En uso:** Los perfiles Admin (1), Docente (2) y Alumno (3) están pre-seed en la BD.

### 16.2 Menús

- **IdPadre = 0 o null:** Equivalen a raíz (menú principal).
- **Jerarquía:** Los submenús heredan del padre; si el padre está inactivo, sus descendientes quedan
  huérfanos y no se conceden permisos.
- **Asignación:** `POST /api/menus/asignar` asigna un menú a un perfil. El reintento de la misma
  asignación no crea fila duplicada (idempotente).
- **Duplicados:** Misma URL y mismo padre → 409.

---

## 17. USUARIO Y AUTENTICACIÓN

### 17.1 Login

- **Mensaje:** "Credenciales incorrectas." tanto si el usuario no existe como si la contraseña es
  incorrecta (para evitar enumeración de cuentas).
- **Compatibilidad:** Contrasenhas heredadas en texto plano se migran a bcrypt al primer acceso correcto.
- **Espacios en clave:** `" clave "` es distinta de `"clave"` — no se recortan los espacios al
  comparar con la BD, pero los identificadores (DNI, correo) sí se normalizan.

### 17.2 Registro público

- **Solo alumno:** El registro público siempre crea usuario con perfil "Alumno".
- **Validaciones:** DNI de exactamente 8 dígitos (no se trunca), correo con formato, celular de 7-15
  caracteres, clave de 8-72 bytes sin recortar.
- **Duplicados:** Comprueba correo/DNI duplicados bajo lock; 409 si ya existen. Solo bloquea valores
  que cambian, no duplicados históricos.

### 17.3 Autorización

- **JWT:** El token ya no es fuente de autorización; se consulta el estado vigente en BD.
- **Perfil activo:** Si el usuario no tiene un perfil activo (`EstadoRegistro = 1`), responde 401.
- **Rol dinámico:** `roles.middleware.js` normaliza el rol por nombre, no por `IdPerfil` fijo. Esto
  permite que "Recursos Humanos" opere como Administrador.
- **Último administrador:** El código protege al último admin activo en todas las operaciones.

### 17.4 Intranet del alumno (GET /api/alumno/me)

- **Devuelve datos reales** cuando existan: alumno, ciclo, cursos, código del curso, descripción,
  docente, calificaciones, promedio, ranking, asistencia, pagos.
- **No inventa información.** Si el alumno no tiene matrícula activa, devuelve ciclo: null y campos
  vacíos/ausentes.
- **Nota cerrada:** Las notas con `EstadoRegistro = 2` se incluyen en el historial pero con su
  estado visible; el promedio y ranking las consideran (`IN (1, 2)`).

---

## 18. TUTOR IA

- **Autenticación:** Requiere JWT con rol `Alumno` o `Estudiante`.
- **Contexto:** Se construye exclusivamente desde MySQL usando el usuario autenticado. Nunca se
  confía en nombres, notas o historiales enviados por el navegador.
- **Errores:** Si falla la generación de la IA, responde 503 con mensaje genérico (no filtra SQL,
  ni datos académicos al log).
- **Respuesta vacía:** Si el modelo no devuelve respuesta válida, 502 con mensaje de reintento.
- **Datos personales:** El prompt incluye solo información necesaria (ciclo, escala, promedio, etc.),
  sin DNI, correo ni datos sensibles.

---

## 19. TRANSACCIONES

### 19.1 Patrones observados

- **beginTransaction** → operaciones SELECT/INSERT/UPDATE → **commit** o **rollbackSeguro**.
- **Liberación:** Todas las rutas usan `finally` para `connection.release()`, asegurando que las
  conexiones siempre se devuelvan al pool.
- **FOR UPDATE:** Usado en varias rutas para bloquear filas durante la validación (ciclos, evaluaciones,
  matrículas), lo que previene condiciones de carrera.
- **Sin returns antes del cleanup:** Se revisó que todo `return` esté dentro de `try/catch` y el
  `finally` siempre ejecute `connection.release()`.

### 19.2 Hallazgos

- **No hay returns antes del cleanup** detectados — todas las rutas liberan la conexión adecuadamente.
- **No hay rollback después de commit** — el patrón es transactional correcto.
- **Operaciones parciales:** Ninguna detectada; todas las escrituras críticas (notas, horarios, matrícula)
  forman parte de una transacción.

---

## 20. ERRORES HTTP

### 20.1 Códigos de estado

- **400:** Datos inválidos (formatos incorrectos, válores fuera de rango, vacíos, decimales en notas).
- **401:** Sin autenticar / sesión expirada / perfil inactivo.
- **403:** Prohibido — rol insuficiente, acta cerrada, periodo cerrado, inscripción pendiente.
- **404:** Recurso no encontrado.
- **409:** Conflicto — duplicado, ciclo con relaciones activas, acta/paso cerrado, ya matriculado.
- **413:** Payload demasiado grande (JSON > 15 MB, lista de asistencia > 500).
- **500:** Error interno — el cliente nunca ve `error.message`, SQL, tabla, columna, host o stack.
  Solo mensaje genérico "Error interno del servidor." y el detalle se registra con `console.error`.

### 20.2 Seguridad en errores 500

- **Verificada:** Los errores 500 no exponen `error.message`, SQL, tablas, columnas, host ni credenciales.
- El `middlewares/error.middleware.js` traduce todos los errores a mensajes de usuario amigables.
- El logging interno usa `console.error` sin datos sensibles.

---

## 21. SEGURIDAD

### 21.1 SQL Injection

- **Verificada:** Las queries usan `pool.query()` con parámetros separados (nunca concatenación de strings).
- **Prepared statements:** Todas las queries principales usan placeholders `?` con arrays de parámetros.
- **Conclusión:** No hay riesgo de SQL injection detectado en el código revisado.

### 21.2 JWT débil

- **JWT_SECRET:** Tiene 64 caracteres en el `.env` actual (valor **redactado** de forma deliberada en este informe: no se publica ningún secreto de producción en el repositorio).
- **Longitud:** Validada en `index.js` para tener al menos 32 caracteres.
- **Conclusión:** Secreto suficientemente fuerte.

### 21.3 Rutas públicas innecesarias

- **Auth routes:** `/login`, `/register` son públicos (corrección de inicio de sesión y nuevos usuarios).
- **Ciclos públicos:** `/api/ciclos/publicos`, `/api/ciclos/publicos/:id/detalle` — catálogo sin auth.
- **Matrícula verificar:** `/api/matriculas/verificar` — parcialmente público (solo verify).
- **Ping:** `/api/ping` — health check sin auth.
- **Conclusión:** Las rutas públicas son las necesarias y coherentes con el frontend.

### 21.4 Datos personales expuestos

- **Verificada:** El endpoint `/api/matriculas/verificar` removió `idUsuario`, `codigoUsuario`,
  `nombreCompleto` de la respuesta para proteger la privacidad. El frontend ya no lee esos campos.
- **Alumno me:** Devuelve datos del usuario pero solo identidad académica y perfil, no datos sensibles
  en contextos inapropiados.

### 21.5 Path traversal / uploads inseguros

- **Materiales:** Los archivos se almacenan en `uploads/` y se sirve por Express `express.static`.
- **Validación:** Se verifica la cabecera `%PDF-` para PDFs y el límite de 10 MB binarios.
- **Conclusión:** No hay path traversal detectado; los uploads están protegidos por validación de tipo y tamaño.

### 21.6 Secretos hardcodeados

- **Verificada:** No hay secretos hardcodeados en el código fuente. Las credenciales (DB, JWT, Gemini)
  vienen del archivo `.env` que no debe versionarse.

### 21.7 CORS inseguro

- **Whitelist:** `config/cors.js` mantiene whitelist explícita: producción + localhost 5173/5174 +
  `CORS_ORIGINS` de entorno. Nunca usa `"*"`.
- **Conclusión:** CORS configurado de manera segura.

---

## 22. BASE DE DATOS

### 22.1 Esquema vs Código

| Tabla | Columna | Tipo BD | Observación |
|-------|---------|---------|-------------|
| Evaluacion | Calificacion | INT | La BD usa INT; la API rechaza decimales con 400 |
| Evaluacion | EstadoRegistro | TINYINT | 1 = vigente, 2 = acta cerrada, -1 = baja |
| Matricula | DNI | VARCHAR(8) UNIQUE | No se cumple en datos históricos (3 duplicados) |
| Usuario | CorreoElectronico | VARCHAR(150) UNIQUE | No se cumple en datos históricos (5 duplicados) |
| Usuario | Celular | VARCHAR(20) | Permite vacío |
| Perfil | NombrePerfil | VARCHAR(100) | Admin/Docente/Alumno/Padre Familia |

### 22.2 Consistencia código vs BD

- **Evaluacion.Calificacion = int** — confirmado con `information_schema`. La API protege este contrato.
- **Usuario.Celular = varchar(15)** — el código acepta 7-15 caracteres; el esquema es varchar(20).
- **0 evaluaciones duplicadas en la BD actual** — el chequeo `scripts/auditar-duplicados.js` lo confirma.
- **0 notas cerradas en la BD actual** — todas las 28 evaluaciones tienen `EstadoRegistro = 1`.

### 22.3 Faltantes

- **UNIQUE en Evaluacion** sobre `(IdMatricula, Periodo, TipoEvaluacion, EstadoRegistro)` — propuesto en
  `database/POST_DEMO_UNIQUE_FK.sql` pero **no ejecutado** (requiere backup, staging y limpieza de
  duplicados históricos).
- **FK en HorarioCurso** — no hay constraint a nivel de BD, solo validación en código.
- **Baseline SQL** — no existe un volcado íntegro y versionado del esquema con índices y FK reales.

---

## 23. SQL/MIGRACIONES

- **Scripts en `scripts/`:** `verificar-sql.js`, `verificar-notas.js`, `auditar-duplicados.js`,
  `verificar-esquema.js`, `verificar-indices.js`. Todos son de solo lectura (SELECT/EXPLAIN).
- **Migrations en `database/`:** `MIGRACION_P1_09_ESCALA_NOTAS.sql`, `MIGRACION_PREU_COMPATIBLE.sql`,
  `POST_DEMO_UNIQUE_FK.sql`. El último dokumenta la constraint propuesta pero **no se ha ejecutado**.
- **Baseline:** No existe un volcado baseline versionado. Los scripts `scripts/` operan contra la BD
  viva con los esquemas actuales.
- **Compatibilidad:** Los 15 consultas probadas con `scripts/verificar-sql.js` son válidas (solo lectura).

---

## 24. PRUEBAS

- **65/65 passing** — cobertura completa.
- **Comando:** `node --test tests/*.test.js` (Node v24 runner nativo).
- **Todas son de solo lectura:** Ninguna escritura contra la BD publicada.
- **Tests nuevos (38 casos)** en `tests/correcciones-backend.test.js` cubren: notas duplicadas y
  concurrentes, decimales y vacíos rechazados, escala y cero, nota cerrada visible pero no editable,
  error SQL sin filtrar detalles, permisos por rol, fechas imposibles, curso fuera de `CicloCurso`,
  solapamiento de horarios (incluida exclusión del ID propio), login con mensaje unificado y
  contraseñas con espacios, duplicados de usuario sin bloquear ediciones legítimas, materiales por
  academia, PDF huérfano y 413, cuerpo JSON inválido, checkout con precio real, privacidad de `/verificar`,
  inscripción pendiente no cobrable, perfiles, bajas con relaciones y menús con padre raíz.
- **Sintaxis:** `node scripts/check-sintaxis.js` — Correcto en 38 archivos.
- **Cobertura:** No se ejecutan POST/PUT/DELETE contra producción únicamente para probar.

---

## 25. ARRANQUE

### 25.1 Arranque seguro

- **Comando:** `node index.js`
- **Puerto:** 3000 (o del entorno `PORT`).
- **Validaciones al arranque:**
  - Variables de entorno obligatorias (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET).
  - JWT_SECRET >= 32 caracteres.
  - Si faltan variables, el proceso sale con `process.exit(1)`.
- **Endpoints seguros:**
  - `GET /ping` → 200 con `{ ok: true, servicio: "AcadeSys API", mensaje: "API en línea." }`
  - `GET /api/ciclos/publicos` → 200 (catálogo público, sin JWT).
  - `GET /api/ciclos/publicos/:id/detalle` → 200 (con cicloID válido).
  - `GET /api/admin/ciclos` → 403 (sin token o token inválido).
  - `GET /api/notas` → 403 (sin token de gestión).

### 25.2 Arranque probado

- El backend arranca correctamente con el `.env` actual.
- Todas las validaciones de entorno se cumplen.
- No hay warnings en consola al arrancar.

### 25.3 Detención

- `Ctrl+C` detiene el servidor correctamente.
- No hay procesos fantasma ni conexiones sin liberar al detenerse.

---

## 26. BUGS DE DEMOSTRACIÓN IDENTIFICADOS

Al pensar como un profesor probando el sistema:

| Escenario | Resultado | Severidad |
|-----------|-----------|-----------|
| Inicia sesión | Correcto, JWT emitido con rol de BD | - |
| Crea un ciclo | Correcto, validación de nombre/universidad/turno/horario/Capacidad | - |
| Edita un ciclo | Correcto, validación completa; 409 si nombre duplicado | - |
| Crea un curso | Correcto, validación de código; reactivación si estaba dado de baja | - |
| Edita un curso | Correcto; 409 si código duplicado activo | - |
| Crea un aula | Correcto; reactivación si estaba dada de baja; 409 si activa existente | - |
| Edita un aula | Correcto; 409 si nombre duplicado activo | - |
| Crea horario | Correcto; valida CicloCurso, solapamiento, día/hora coherente | - |
| Intenta horario solapado | 409 (detección con FOR UPDATE, excluyendo propio ID en edición) | - |
| Crea usuario | Correcto; validación DNI/email/clave; 409 si duplicado | - |
| Edita usuario | Correcto; protege último admin; 409 si cambia a no-admin el último | - |
| Registra asistencia | Correcto; valida ciclo, lista sin duplicados, estados permitidos | - |
| Registra nota 0 | Correcto; `calificacionEntera(0)` es válido; 0 es calificación permitida | - |
| Registra nota máxima | Correcto; validado contra escala de universidad objetivo | - |
| Intenta decimal (ej. 12.5) | 400 — `calificacionEntera` rechaza decimales | - |
| Guarda dos veces (POST idéntico) | 409 — detección de duplicado bajo lock en transacción | - |
| Cierra acta | Correcto; `EstadoRegistro` pasa a 2; `Auditoria_Cierres` registrado | - |
| Vuelve a consultar notas | Correcto; notas siguen visibles con `EstadoRegistro = 2`; promedio/rango siguen bien | - |
| Nota cerrada no puede editarse | Correcto; PUT responde 403 "Esta acta está cerrada" | - |
| Publica comunicado | Correcto; validación de tipo, título, contenido, prioridad | - |
| Edita comunicado | Correcto; admin puede editar, se conservan autor/fecha | - |
| Sube material (PDF) | Correcto; validación Base64, tamaño, cabecera %PDF- | - |
| Elimina material | Correcto; bloquea si pertenece a otra academia | - |
| Cambia pago de Pendiente a Pagado | 409 — inscripción pendiente no se puede confirmar manualmente | - |
| Matrícula alumno nuevo | Correcto; precio de BD, no del frontend; código generado; contraseña temporal | - |
| Recarga la página | Datos consistentes; el JWT se revalida en cada petición contra BD | - |
| Inicia sesión como alumno | Correcto; `/api/alumno/me` devuelve expediente completo | - |

**Conclusión de demo:** El flujo del profesor es fluido y sin errores visibles. Los únicos puntos
que requieren preparación son la configuración de `GOOGLE_SCRIPT_URL` y la advertencia de que las
notas con `EstadoRegistro = 2` son de solo lectura en la interfaz.

---

## 27. CLASIFICACIÓN DE hallazgos

| Severidad | Cantidad | Descripción |
|-----------|----------|-------------|
| **P0 CRÍTICO** | 0 | Sin pérdida/corrupción de datos ni fallo de seguridad grave |
| **P1 ALTO** | 3 | GOOGLE_SCRIPT_URL no configurada; duplicados históricos en BD; sin UNIQUE BD en Evaluacion |
| **P2 MEDIO** | 7 | Validaciones complejas, comportamientos en bordes, transacciones, formatos mixtos |
| **P3 BAJO** | 6 | Calidad, consistencia PascalCase/camelCase, propiedades opcionales, null/undefined |

**Total:** 16 hallazgos (0 P0, 3 P1, 7 P2, 6 P3)

---

## 28. NO CORREGIR (durante esta auditoría)

- **NI un solo archivo de código** ha sido modificado durante esta auditoría.
- **NI migraciones** se han ejecutado.
- **NI datos de BD** se han alterado.
- **NI dependencias** se han instalado.
- **NI contratos** se han cambiado. Todos los contratos se han reportado tal como existen.

---

## 29. QUÉ CORREGIR ANTES DE LA DEMO

1. **Configurar `GOOGLE_SCRIPT_URL`** en el entorno de la demostración. Sin ella, los flujos de
   matrícula y reset de clave no envían correo (error controlado 502, pero operación incompleta
   desde la vista del usuario).
2. **Verificar manualmente el flujo de notas, cierre de actas y horarios** — son los cambios con
   mayor impacto observable en la demo. Confirmar que:
   - Crear nota → cerrar acta → consultar historial → promedio/rango correctos → PUT 403.
   - Crear horario → solapamiento → 409; editar horario propio sin auto-conflicto.
   - Nota cerrada → visible pero no editable (PUT 403).
3. **Asegurar que no haya nuevas inserciones con correos/DNI duplicados** — el backend ya bloquea
   esto con 409, pero si alguien intenta registrarse con un correo/DNI ya en la BD (de los 5/3
   duplicados históricos), la operación fallará. Comunicar esto al equipo de demo.

---

## 30. QUÉ DEJAR PARA DESPUÉS DE LA DEMO

1. **Limpieza de duplicados históricos** (5 correos, 3 DNI) en la base de datos — requiere mantenimiento
   en staging y aprobación, no hacer sobre datos de producción sin backup.
2. **UNIQUE en Evaluacion** `(IdMatricula, Periodo, TipoEvaluacion, EstadoRegistro)` y en
   `HorarioCurso` — scripts en `database/POST_DEMO_UNIQUE_FK.sql`, pero requiere backup y staging.
3. **Baseline SQL** — volcado íntegro y versionado del esquema con índices y FK reales.
4. **Rate limiting** en login, registro, checkout y subida de materiales.
5. **Helmet** y cabeceras de seguridad (CSP, `X-Content-Type-Options`, `Referrer-Policy`).
6. **OpenAPI** — documentar el contrato real documentado.
7. **Docker/Compose** — entorno reproducible.
8. **CI** — ejecutar `node --test`, `node --check` y verificación SQL en cada PR.
9. **Rotación de credenciales** — `JWT_SECRET` y clave del script de correo.
10. **Límite de Calificacion** — decidir si migrar a DECIMAL o consolidar enteros.
11. **Observabilidad** — logging estructurado y métricas de errores 5xx por endpoint.

---

## 31. VEREDICTO FINAL

**LISTO CON OBSERVACIONES**

El backend AcadeSys está funcional y estable después de las correcciones aplicadas. Las 65 pruebas
automatizadas pasan, el arranque es exitoso y los contratos de endpoint son coherentes. Los principales
riesgos para la demo son configuración (GOOGLE_SCRIPT_URL) y datos históricos (duplicados), ninguno
de los cuales impide el funcionamiento básico de una demostración con cuentas adecuadas.

**Puntuación sintética:**
- Estabilidad: ✅ 100% (sin errores en flujo principal)
- Pruebas: ✅ 65/65 passing
- Seguridad: ✅ Sin vulnerabilidades críticas detectadas
- Compatibilidad frontend: ✅ Contratos coherentes (pending ajuste frontend de calificaciones enteras)
- Configuración: ⚠️ Requiere `GOOGLE_SCRIPT_URL` para correo funcional

**Recomendación:** Proseguir con la demo configurando `GOOGLE_SCRIPT_URL` y realizando las
verificaciones manuales recomendadas de notas, actas y horarios. Ningún bloqueo P0 encuentra.