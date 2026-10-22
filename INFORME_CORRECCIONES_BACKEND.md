# Informe de correcciones del backend AcadeSys

## Resultado general

**LISTO CON OBSERVACIONES**

El backend queda funcionalmente coherente con el frontend corregido, con las notas, actas, horarios,
materiales y usuarios validados contra el esquema real. Las **65 pruebas automatizadas pasan**, el
arranque responde y las consultas modificadas se han validado contra la BD real (solo lectura).

Observaciones que impiden marcarlo como "LISTO":

1. `GOOGLE_SCRIPT_URL` no está definida en el entorno: sin ella el envío de accesos de reinscripción y el
   reset de clave devuelven un error controlado en vez de enviar correo. Hay que configurar esa variable
   antes de la demostración (se retiró el fallback a un script de Google hardcodeado).
2. La BD viva ya contiene **correos y DNI duplicados** (5 correos y 3 DNI). El código impide crear nuevos
   duplicados, pero los existentes requieren una limpieza manual en staging/ventana de mantenimiento.
3. No se ejecutó ninguna prueba autenticada de extremo a extremo contra la BD publicada: no se realizaron
   escrituras reales para no alterar datos de producción.
4. `Evaluacion.Calificacion` sigue siendo `INT`: el frontend debe aceptar **solo enteros** (ver
   "Integración con frontend").

## Estado Git

- Rama: `main` (no se cambió de rama).
- Commit inicial: `44521d0` (`fix(ciclos): capacidad real hasta 500 y docente desde Asignacion_Aula`).
- Estado inicial: working tree limpio.
- **Los cambios están commitados y publicados en `origin/main`.** El commit de entrega es
  `fix: corregir backend y reforzar flujos críticos` (hash `3396d5a` tras reaplicar sobre el remoto).
  Durante el push, `origin/main` había avanzado con `23a891e` ("Arreglado lo de perfiles y elimine un
  database que no se usa"), que solo borra `database/MIGRACION_PREU.sql`. Se integró con `git rebase`
  (sin merge, sin conflictos y sin perder la eliminación remota de ese archivo); no se hizo `push --force`.
- Archivos del commit: 18 modificados + 13 nuevos (detalle en "Archivos tocados").
- No se modificaron `.env`, credenciales, `node_modules`, archivos generados ni datos de la BD.

### Archivos tocados

Modificados: `index.js`, `middlewares/cierre.middleware.js`, `routes/academico.routes.js`,
`routes/actas.routes.js`, `routes/admin-ciclos.routes.js`, `routes/alumno.routes.js`,
`routes/auth.routes.js`, `routes/ciclos.routes.js`, `routes/comunicados.routes.js`,
`routes/dashboard.routes.js`, `routes/ia.routes.js`, `routes/materiales.routes.js`,
`routes/matriculas.routes.js`, `routes/menu.routes.js`, `routes/notas.routes.js`,
`routes/pagos.routes.js`, `routes/perfil.routes.js`, `routes/usuario.routes.js`.

Nuevos: `.env.example`, `INFORME_CORRECCIONES_BACKEND.md`, `database/POST_DEMO_UNIQUE_FK.sql`
(documentado, **no ejecutado**), `middlewares/error.middleware.js`, `utils/validaciones.js`,
`tests/correcciones-backend.test.js`, `tests/smoke-readonly.js` y los seis scripts de verificación de
`scripts/`.

## Bugs corregidos

| # | Problema | Solución | Archivo | Endpoint | Cómo comprobarlo |
| --- | --- | --- | --- | --- | --- |
| 1 | Las notas cerradas (`EstadoRegistro = 2`) desaparecían del historial, listado, promedio, ranking, dashboard y contadores | Todas las lecturas válidas usan `EstadoRegistro IN (1, 2)`; la escritura exige `= 1` | `routes/notas.routes.js`, `routes/alumno.routes.js`, `routes/dashboard.routes.js`, `routes/ia.routes.js` | `GET /api/notas`, `GET /api/notas/alumno/:id`, `GET /api/alumno/me`, `GET /api/admin/dashboard/overview`, `POST /api/tutor-ia` | Cerrar un acta y volver a consultar: la nota sigue visible, el promedio no cambia y el PUT responde 403. Cubierto por prueba "crear, consultar, cerrar acta, consultar historial" |
| 2 | Doble clic o reintento duplicaba evaluaciones | Comprobación bajo lock de `IdMatricula + Periodo + TipoEvaluacion` dentro de la transacción y 409 sin insertar | `routes/notas.routes.js` | `POST /api/notas` | POST #1 → 201, POST equivalente → 409 y una sola fila. Cubierto por 3 pruebas, incluida la de concurrencia |
| 3 | Un lote podía contener la misma nota dos veces | Detección de claves repetidas en el propio lote: se rechaza el lote completo con 409 | `routes/notas.routes.js` | `POST /api/notas` | Lote con dos notas idénticas → 409 y 0 inserciones |
| 4 | Nota vacía o no numérica podía llegar a la BD | `calificacionEntera` rechaza `null`, `undefined`, `''`, `' '`, `NaN`, `Infinity`, texto y decimales; 400 explícito | `utils/validaciones.js`, `routes/notas.routes.js` | `POST /api/notas`, `PUT /api/notas/:id` | Enviar `12.5` o `''` → 400. Cubierto por prueba de 12 valores |
| 5 | El frontend podía intentar editar una nota de acta cerrada | Re-lectura del estado bajo `FOR UPDATE` después de bloquear el ciclo; 403 si ya no es 1 | `routes/notas.routes.js` | `PUT /api/notas/:id` | Cerrar el acta y hacer PUT → 403 |
| 6 | Un cierre concurrente podía colarse entre la validación y el UPDATE | El UPDATE exige `e.EstadoRegistro = 1` y el estado se relee con lock | `routes/notas.routes.js` | `PUT /api/notas/:id` | Cerrar el acta mientras se guarda → el PUT no escribe |
| 7 | La escala dependía de una comprobación frágil | Escala por universidad centralizada, sin decimales y con límites del contrato | `utils/validaciones.js` | `POST/PUT /api/notas` | 0 y máximo válidos; un punto por encima → 400 |
| 8 | Horarios sin curso, con curso ajeno al ciclo, con hora inválida o con día incoherente | Validación completa: ciclo de la academia, curso activo y vinculado por `CicloCurso`, día coherente con `DiaNumero`, `HH:mm` y `inicio < fin` | `routes/academico.routes.js` | `POST /api/horarios`, `PUT /api/horarios/:id` | Curso fuera de `CicloCurso` → 400. Cubierto por pruebas |
| 9 | Dos horarios del mismo ciclo y día podían solaparse | Detección de solapamiento con `inicio < finExistente AND fin > inicioExistente`, excluyendo el propio `IdHorario` en edición; 409 | `routes/academico.routes.js` | `POST/PUT /api/horarios` | Solapado → 409. Cubierto por prueba que comprueba la exclusión del ID propio |
| 10 | `2026-02-31` se aceptaba como fecha válida | Validación round-trip con comparación del `toISOString()` | `routes/ciclos.routes.js` | `POST/PUT /api/admin/ciclos` | `2026-02-29` y `2026-02-31` → 400; `2028-02-29` → válido. Cubierto por prueba |
| 11 | `GET /api/materiales/admin` no filtraba por academia | Filtro por `c.IdAcademia` y validación de `idCiclo` | `routes/materiales.routes.js` | `GET /api/materiales/admin` | Con admin de otra academia no aparecen materiales. Cubierto por prueba |
| 12 | `POST /api/materiales` no comprobaba la academia del ciclo | `CicloCurso` + `Ciclo.IdAcademia` + validación de Base64 y título | `routes/materiales.routes.js` | `POST /api/materiales` | Ciclo de otra academia → 400. Cubierto por prueba |
| 13 | `DELETE /api/materiales/:id` ignoraba la academia | `UPDATE ... JOIN Ciclo` acotado a la academia | `routes/materiales.routes.js` | `DELETE /api/materiales/:id` | Material ajeno → 404 |
| 14 | Archivo PDF huérfano si fallaba el INSERT | Se elimina el archivo recién creado cuando el INSERT falla, sin ocultar el error original | `routes/materiales.routes.js` | `POST /api/materiales` | INSERT simulado en fallo → 500 y archivo eliminado. Cubierto por prueba |
| 15 | Login distinguía "usuario inexistente" de "contraseña incorrecta" | Mensaje único "Credenciales incorrectas." en ambos casos | `routes/auth.routes.js` | `POST /api/auth/login` | Respuesta idéntica. Cubierto por prueba |
| 16 | `password.trim()` alteraba la contraseña real | La contraseña se compara sin recortar; los identificadores sí se normalizan | `routes/auth.routes.js` | `POST /api/auth/login` | `" clave "` funciona; `"clave"` falla. Cubierto por prueba |
| 17 | El registro público truncaba el DNI a 8 caracteres en silencio y no validaba correo/celular/clave | Validación centralizada: DNI de exactamente 8 dígitos, correo con formato, celular de 7–15, clave de 8–72 bytes sin recortar | `utils/validaciones.js`, `routes/auth.routes.js` | `POST /api/auth/register` | DNI de 9 dígitos → 400 (no se trunca) |
| 18 | Se podían crear usuarios duplicados de correo/DNI | Comprobación bajo lock y 409; solo compara valores que **cambian**, para no bloquear por duplicados históricos | `utils/validaciones.js`, `routes/usuario.routes.js`, `routes/auth.routes.js` | `POST /api/usuarios`, `PUT /api/usuarios/:id`, `PUT /api/usuarios/me`, `POST /api/auth/register` | Correo ya usado → 409; editar sin cambiar el correo → 200. Cubierto por 3 pruebas |
| 19 | `PUT /api/usuarios/:id` recortaba la contraseña | Se envía la clave exacta, hasheada | `routes/usuario.routes.js` | `PUT /api/usuarios/:id` | Clave con espacios conserva los espacios |
| 20 | `PUT /api/usuarios/me` no comprobaba duplicados ni pertenencia a la academia | Transacción con lock, filtro por `IdAcademia` y 409 | `routes/usuario.routes.js` | `PUT /api/usuarios/me` | Correo de otra cuenta → 409 |
| 21 | Errores internos exponían `error.message` (SQL, tablas, host) | Mensajes genéricos en 500 y registro interno con `console.error`; los 4xx de dominio conservan su mensaje | `routes/notas.routes.js`, `routes/pagos.routes.js`, `routes/academico.routes.js`, `routes/auth.routes.js`, `routes/ia.routes.js`, `routes/comunicados.routes.js`, `routes/admin-ciclos.routes.js`, `index.js`, `middlewares/error.middleware.js` | todos | Un fallo SQL no aparece en la respuesta. Cubierto por pruebas que buscan "SELECT", "tabla_privada" y "host=" |
| 22 | `POST /api/matriculas/checkout` aceptaba el monto del frontend | El precio se toma siempre de `Ciclo.Precio`; el monto enviado solo se valida y se ignora | `routes/matriculas.routes.js` | `POST /api/matriculas/checkout` | Enviar `monto: 1` con precio 250 en BD → el pago se registra con 250. Cubierto por prueba |
| 23 | `POST /api/matriculas/verificar` devolvía nombre completo, código, IDs de usuario y de matrícula | Se elimina esa información; se conservan los flags que usa el frontend (`existe`, `esAlumno`, `puedeReinscribirse`, `yaInscritoEnCiclo`, `ciclos[].nombre`) y se añade el alias `message` | `routes/matriculas.routes.js` | `POST /api/matriculas/verificar` | La respuesta no contiene `idUsuario`, `codigoUsuario` ni `nombreCompleto`. Cubierto por 2 pruebas |
| 24 | Una reinscripción podía cambiar el nombre del titular sin autorización | El checkout ya no sobrescribe `Nombres`/`ApellidoPaterno` de una cuenta existente | `routes/matriculas.routes.js` | `POST /api/matriculas/checkout` | Reinscribir un nombre propio por otro no modifica el usuario |
| 25 | `GOOGLE_SCRIPT_URL` tenía un fallback a un script de Google real hardcodeado | Se eliminó el fallback: sin la variable no hay envío y se informa con un error controlado | `routes/matriculas.routes.js` | `POST /api/matriculas/checkout`, `POST /api/matriculas/restablecer-clave` | Sin `GOOGLE_SCRIPT_URL` la matrícula se registra y el envío de correo se omite/falla de forma explícita |
| 26 | No existía `.env.example` | Se crea con nombres reales del proyecto y **valores ficticios** | `.env.example` | — | `diff` no contiene secretos |
| 27 | La intranet devolvía `docente = "Por asignar"` y cursos sin código/descripción | Docente real desde `Asignacion_Aula` + `Usuario`; código y descripción reales del curso; `"Por asignar"` solo si no hay asignación | `routes/alumno.routes.js`, `routes/ia.routes.js` | `GET /api/alumno/me`, `POST /api/tutor-ia` | Con docente asignado aparece su nombre. Cubierto por prueba |
| 28 | Promedios del alumno ignoraban notas nulas y el ranking no incluía notas cerradas | Promedios recalculados sobre notas válidas y ranking con `IN (1, 2)` | `routes/alumno.routes.js`, `routes/ia.routes.js` | `GET /api/alumno/me` | Nota 0 y nota cerrada: promedio y puesto correctos. Cubierto por prueba |
| 29 | El dashboard no contabilizaba evaluaciones cerradas | `IN (1, 2)` en total de evaluaciones y en rendimiento por ciclo | `routes/dashboard.routes.js` | `GET /api/admin/dashboard/overview` | Cubierto por prueba |
| 30 | Menús: `IdPadre` 0 no se trataba como raíz y la asignación duplicada devolvía 400 | `0`/`null` equivalen a raíz; jerarquía normalizada; duplicado de asignación → 409 | `routes/menu.routes.js` | `POST /api/menus`, `POST /api/menus/asignar` | `IdPadre: 0` crea un menú raíz. Cubierto por prueba |
| 31 | Perfiles: se podían crear nombres duplicados | Comprobación bajo lock y 409 antes de insertar | `routes/perfil.routes.js` | `POST /api/perfiles`, `PUT /api/perfiles/:id` | Nombre repetido → 409. Cubierto por prueba |
| 32 | Bajas de aula/curso dejaban relaciones activas colgando | Se comprueban `Asignacion_Aula`, `Asistencia`, `CicloCurso`, `HorarioCurso`, `MaterialAcademico` y `Matricula`; 409 si hay relaciones | `routes/academico.routes.js` | `DELETE /api/aulas/:id`, `DELETE /api/cursos/:id` | Con relaciones → 409 y ninguna escritura. Cubierto por prueba |
| 33 | Retirar un curso de un ciclo podía dejar horarios y matrículas huérfanos | Se verifican las dependencias activas antes de reemplazar `CicloCurso`; 409 con mensaje explicativo | `routes/admin-ciclos.routes.js` | `PUT /api/admin/ciclos/:id` | Curso con horario o matrícula → 409 |
| 34 | Communications: campos sin validación de tipo ni de longitud | Tipo verificado, título 3–180, `dirigidoA` ≤150, contenido 1–10 000; contrato de endpoints intacto | `routes/comunicados.routes.js` | `POST/PUT /api/comunicados` | Título de 181 caracteres → 400. Cubierto por prueba |
| 35 | Pagos: `IdPago`/`IdCiclo` sin validar y error interno expuesto | IDs validados, filtro por academia y ciclo, mensaje genérico en 500 | `routes/pagos.routes.js` | `GET /api/pagos/ciclo/:idCiclo`, `PUT /api/pagos/:id/estado` | `idCiclo=abc` → 400. Cubierto por prueba |
| 36 | El middleware de cierre consultaba evaluaciones de otras academias | Filtra por `u.IdAcademia` de la sesión y exige academia válida | `middlewares/cierre.middleware.js` | `PUT /api/notas/:id` | Un token de otra academia no evalúa ajenos |
| 37 | El cuerpo JSON inválido o demasiado grande devolvía 500 con detalle interno | Middleware de error dedicado: 400 para JSON inválido, 413 para exceder 15 MB, 500 genérico | `middlewares/error.middleware.js`, `index.js` | todos | Cubierto por prueba (413) |
| 38 | CORS sin control de entradas ajenas | Se mantiene la whitelist existente: producción + localhost 5173/5174 + `CORS_ORIGINS`. Nunca `"*"` | `config/cors.js` (sin cambios) | todos | 12 pruebas de CORS preexistentes pasan |

## Notas y actas

- **Duplicados.** `POST /api/notas` ya no inserta una segunda evaluación para la misma combinación
  `IdMatricula + Periodo + TipoEvaluacion`. La comprobación ocurre dentro de la misma transacción que
  bloquea la fila del ciclo, con `SELECT ... FOR UPDATE`, de modo que dos peticiones simultáneas se
  serializan: la primera devuelve 201 y la segunda 409. También se rechaza un lote que repita la misma nota.
  El mensaje es "Ya existe una evaluación registrada para este alumno, periodo y tipo.".
  Las notas antiguas con `Periodo` nulo se consideran del periodo `General` (usa `COALESCE`).
  No se añadió ninguna restricción `UNIQUE` a la BD viva: la propuesta está en
  `database/POST_DEMO_UNIQUE_FK.sql` y **no se ha ejecutado**.
- **EstadoRegistro.** Significado vigente: `1` = vigente y editable, `2` = válida pero perteneciente a un
  acta cerrada, `-1` = baja lógica. `2` ya no desaparece de ninguna lectura.
- **Cierre de actas.** `PUT /api/actas/cierre` sigue sellando con `EstadoRegistro = 2` y registrando en
  `Auditoria_Cierres`. No se implementó reapertura de actas: no existe una regla de negocio clara y no se
  inventa.
- **PUT.** `PUT /api/notas/:id` exige un ID válido y una calificación **entera** no negativa dentro de la
  escala del ciclo. Rechaza vacíos, `null`, `NaN`, `Infinity`, textos y decimales con 400. Si el periodo
  está cerrado en `Auditoria_Cierres` o la evaluación está en estado 2, responde 403. La comprobación del
  estado se repite bajo lock porque el middleware se ejecuta antes de la transacción.
- **Nota vacía.** No existe `DELETE /api/notas/:id` y no se ha inventado. Dejar una nota persistida en
  blanco no se puede persistir: el PUT devuelve 400 y el frontend bloquea el guardado. Para "borrar" una
  nota hay que escribir otro valor.
- **Decimales.** `Evaluacion.Calificacion` es `int` en la BD viva (verificado con `information_schema`).
  Mientras siga así, la API rechaza decimales con 400. No hay truncamiento ni redondeo silencioso.
- **Escala.** La escala depende de `Ciclo.UniversidadObjetivo`: UNMSM/UNI 2000, PUCP/UNFV 1000, UNAC 100,
  UNT 300, Preuniversitario 20; valor por defecto 2000. `GET /api/notas/contexto/:idCiclo` la expone.
- **Promedio y ranking.** El promedio del alumno se recalcula sobre las notas no nulas; el ranking usa
  `EstadoRegistro IN (1, 2)` y excluye al propio alumno. El dashboard agrega también las notas cerradas.

## Horarios

- **CicloCurso.** Un horario solo puede referenciar un curso que esté **activo y vinculado al ciclo** por
  `CicloCurso` (además de activo en `Curso`). Antes se comprobaba únicamente que el curso existiera.
- **Solapamientos.** Dos horarios del mismo ciclo y del mismo día se solapan si
  `nuevoInicio < existenteFin AND nuevoFin > existenteInicio`. La comprobación se hace con
  `SELECT ... FOR UPDATE` dentro de la transacción, después de bloquear la fila del ciclo, por lo que dos
  altas concurrentes no pueden solaparse. Al editar se excluye el `IdHorario` que se modifica. Un
  solapamiento devuelve **409**.
- **Otras validaciones.** Día entre 1 y 7 y coherente con `DiaSemana`; horas en `HH:mm`; `HoraInicio <
  HoraFin`; orden entero entre 1 y 100; el ciclo debe pertenecer a la academia del administrador.
- **Conflicto de docente/aula.** No se implementó. El modelo actual (`HorarioCurso` no tiene `IdAula`,
  `IdUsuario` ni franja de aula) no permite decidir de forma inequívoca si dos horarios del mismo docente
  o aula se pisan. Se documenta como pendiente en lugar de inventar una regla.

## Usuarios/autenticación

- **Correo.** Formato `usuario@dominio.tld`, hasta 150 caracteres (el esquema de `Usuario.CorreoElectronico`
  es `varchar(150)`). Ya no se restringe a Gmail ni a dominios de la academia.
- **DNI.** Exactamente 8 dígitos. Ya no se trunca con `.slice(0, 8)`: un DNI de 9 dígitos es un 400.
  En edición se puede dejar vacío para borrarlo, como antes.
- **Celular.** 7–15 caracteres, dígitos y los signos `+`, espacios, paréntesis y guiones (el esquema es
  `varchar(15)`).
- **Contraseña.** Mínimo 8 caracteres, máximo 72 bytes (límite de bcrypt) y no puede ser solo espacios.
  **No se recortan los espacios**: `" clave "` es distinta de `"clave"`. Las cuentas existentes siguen
  admitting la comparación heredada en texto plano, que se migra a bcrypt al primer acceso correcto.
- **Duplicados.** `POST /api/usuarios`, `PUT /api/usuarios/:id`, `PUT /api/usuarios/me` y
  `POST /api/auth/register` devuelven **409** si el correo o el DNI ya pertenecen a otra cuenta. La
  comprobación solo tiene en cuenta los valores que **cambian**: si el usuario conserva su correo (aunque
  ese correo esté duplicado por datos históricos) la edición no se bloquea. No se eliminó ni se modificó
  ningún duplicado existente.
- **Login.** Mensaje único "Credenciales incorrectas." tanto si el usuario no existe como si la contraseña
  no coincide, para no permitir enumeración de cuentas. Se mantiene la compatibilidad con contraseñas
  heredadas en texto plano, que se convierten a bcrypt tras validarse.
- **Resto de la validación.** Nombres y apellidos obligatorios (2–100 caracteres, con tildes, apóstrofos y
  guiones), apellido materno opcional, perfil existente y activo, academia de sesión válida, protección del
  último administrador activo y perfil administrativo único.

## Materiales

- **Academia.** `GET /api/materiales/admin` filtra por `Ciclo.IdAcademia`; `POST` exige que el ciclo
  pertenezca a la academia del administrador; `DELETE` solo alcanza materiales de ciclos de esa academia.
- **PDF.** Se mantiene el contrato actual: **JSON con `fileData` en Base64**, no multipart. Se validan
  el Base64, el tamaño (≤ 10 MB binarios) y la cabecera `%PDF-`. El límite JSON global de Express se
  mantiene en 15 MB y un payload mayor responde **413** con un mensaje explicativo.
- **Archivo huérfano.** El archivo se escribe en disco antes del INSERT. Si el INSERT falla, se elimina el
  archivo recién creado dentro de un `try/catch` propio: un fallo del cleanup no oculta ni cambia el
  error original, que sigue devolviendo 500.
- **Contrato de respuesta.** Se mantiene `idMaterial`, `idCiclo`, `idCurso`, `titulo`, `descripcion`,
  `nombreArchivo`, `urlArchivo`, `tipoMime`, `fechaPublicacion` y `curso`.

## Integración con frontend

### Confirmación sobre las calificaciones

**El frontend debe aceptar únicamente calificaciones enteras mientras la BD siga usando `INT`.**

La columna viva `Evaluacion.Calificacion` es `int`. La API ahora rechaza con 400 cualquier valor decimal
(`12.5`, `"12.5"`). El `RegistroNotasPage.jsx` del frontend acepta hoy hasta dos decimales y debe
cambiarse a enteros: es un ajuste pequeño y localizado en ese componente (validación de la entrada y
`maxLength`). Hasta que se aplique, la API protege los datos pero el usuario ve un 400 al guardar un
decimal.

### Contratos finales

| Endpoint | Contrato |
| --- | --- |
| `POST /api/notas` | Body `{ idCiclo, periodo, notas: [{ IdMatricula, TipoEvaluacion, Calificacion }] }`. `Calificacion` entero ≥ 0 y ≤ escala. Respuestas: **201** alta, **400** datos inválidos (vacío, decimal, tipo desconocido, lote > 500), **403** matrícula ajena o periodo cerrado, **404** ciclo inexistente, **409** ya existe esa evaluación para alumno/periodo/tipo, **413** lote > 500, **500** error interno genérico |
| `PUT /api/notas/:id` | Body `{ Calificacion }` entero ≥ 0 y ≤ escala. **200** actualizada, **400** vacía/decimal/no numérica/ID inválido, **403** acta cerrada o periodo cerrado, **404** no existe o no es de tu academia |
| `POST /api/matriculas/checkout` | Body `{ idCiclo, nombres, apellidos, correo, monto? }`. El `monto` se **ignora**: el precio sale de `Ciclo.Precio`. Respuestas: **201** creada, **409** ciclo cerrado/lleno/ya matriculado/correo ya en otra academia, **400** datos inválidos, **404** ciclo inexistente |
| `POST /api/matriculas/verificar` | Body `{ correo, idCiclo }`. Respuesta: `existe`, `esAlumno`, `puedeReinscribirse`, `yaInscritoEnCiclo`, `mensaje` **y** `message` (alias), `cicloSeleccionado`, `ciclos[{ nombre }]`. Ya **no** devuelve `idUsuario`, `codigoUsuario`, `nombreCompleto` ni IDs de matrícula. El frontend debe dejar de leer esos campos (el flujo actual no los usa) |
| `GET /api/admin/ciclos` | Sin cambios de contrato. Añadido: 409 con mensaje claro si el nombre ya existe en la academia, y 409 si se intenta retirar un curso con relaciones activas |
| `GET /api/materiales/admin?idCiclo=` | Sin cambios de contrato. Ahora acotado a la academia de la sesión; `idCiclo` no numérico → 400 |
| `GET /api/notas` | Cada fila incluye ahora `EstadoRegistro` (1 vigente, 2 acta cerrada) para que la interfaz pueda marcar las notas cerradas como solo lectura |
| `GET /api/alumno/me` | `notas.historial[].estadoRegistro` y `cursos[].codigo/descripcion/docente` reales; `horarioDetalle[].docente` real |
| `POST /api/auth/login` | Mensaje de error unificado "Credenciales incorrectas." (antes diferenciaba usuario inexistente de contraseña incorrecta) |
| `POST /api/matriculas/checkout` y `POST /api/matriculas/restablecer-clave` | Requieren `GOOGLE_SCRIPT_URL` en el entorno para enviar correo. Sin ella no se envía y se avisa con un error controlado (502) |

### Otros puntos que debe conocer el frontend

- `GET /api/notas` devuelve notas cerradas: la interfaz de registro de notas debe ignorar visualmente las
  filas con `EstadoRegistro = 2` al preparar nuevas altas, porque el backend responde 409 si intenta
  crear una nota que ya existe (aunque esté cerrada) y 403 si intenta modificarla.
- `POST /api/matriculas/verificar` ya no entrega `idUsuario`: el flujo de inscripción no debe necesitarlo.

## Pruebas

| Comprobación | Comando | Resultado |
| --- | --- | --- |
| Sintaxis de todos los JS versionados | `node scripts/check-sintaxis.js` (interno `node --check`) | **Correcto en 38 archivos** |
| Suite completa | `node --test tests/*.test.js` | **65/65 pasan**, 0 fallos |
| `npm test` | `npm test` | Falla en este entorno por el shim de Windows: `/usr/bin/env: 'bash': No such file or directory`. Se ejecutó el runner nativo equivalente: `node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" test` → **65/65** |
| Arranque y smoke | `node tests/smoke-readonly.js` | Arranca una instancia local y ejecuta solo GET/OPTIONS. `GET /ping` → **200**; `/api/ciclos/publicos` → 200 (9 ciclos); `/api/ciclos/publicos/:id/detalle` → 200; `/api/ciclos/:id/cursos` → 200; `/api/admin/ciclos`, `/api/materiales/admin`, `/api/notas` sin token → **403**; preflight CORS `http://localhost:5173` → **204** |
| SQL modificado contra el esquema real | `node scripts/verificar-sql.js` | **15/15 consultas válidas** (solo lectura) |
| Esquema y columnas | `node scripts/verificar-esquema.js` | Confirma `Evaluacion.Calificacion = int`, `Usuario.Celular = varchar(15)`, 0 evaluaciones duplicadas y 0 notas cerradas en la BD actual |
| Duplicados existentes | `node scripts/auditar-duplicados.js` | 5 correos duplicados (el mayor con 13 cuentas) y 3 DNI duplicados; 0 duplicados en evaluaciones, horarios, aulas, cursos y perfiles |
| Índices y claves foráneas | `node scripts/verificar-indices.js` | Inventario de índices: ya existen `UQ_Aula_Academia_Nombre`, `UQ_Alumno_Ciclo`, `UQ_Asistencia_Matricula_Aula_Fecha`, `UQ_Asignacion_Aula_Detalle`, `UQ_Comunicado_Lectura_Usuario` y FK en la mayoría de tablas. **Faltan** `UNIQUE` en `Evaluacion` y `HorarioCurso` |
| Distribución de notas | `node scripts/verificar-notas.js` | 28 evaluaciones: periodo "General" (15) y "Segundo Examen" (13), todas `EstadoRegistro = 1` |

Cobertura de las pruebas nuevas (`tests/correcciones-backend.test.js`, 38 casos) sobre los routers reales con
pool, sistema de archivos y `bcrypt` simulados: notas duplicadas y concurrentes, decimales y vacíos
rechazados, escala y cero, nota cerrada visible pero no editable, error SQL sin filtrar detalles,
permisos por rol, fechas imposibles, curso fuera de `CicloCurso`, solapamiento de horarios (incluida la
exclusión del ID propio), login con mensaje unificado y contraseñas con espacios, duplicados de usuario
sin bloquear ediciones legítimas, materiales por academia, PDF huérfano y 413, cuerpo JSON inválido,
checkout con precio real, privacidad de `/verificar`, inscripción pendiente no cobrable, perfiles,
bajas con relaciones y menús con padre raíz.

**Ninguna prueba escribe en la base de datos publicada ni borra datos reales.** Los routers se montan
con un pool simulado inyectado en `require.cache`; los únicos contactos con la BD real son los scripts de
verificación, que ejecutan `SELECT` e `EXPLAIN`.

## Pendientes post-demo

1. **UNIQUE en `Evaluacion`** sobre `(IdMatricula, Periodo, TipoEvaluacion, EstadoRegistro)` y en
   `HorarioCurso` sobre `(IdCiclo, IdCurso, DiaNumero, HoraInicio, HoraFin)`. Preparado en
   `database/POST_DEMO_UNIQUE_FK.sql`; **no ejecutar** sin backup, staging y limpieza de duplicados.
2. **Claves foráneas** en las tablas que aún no las tienen (principalmente `Evaluacion` en su FK directa y
   `MaterialAcademico`). Hay que auditar huérfanos antes de aplicarlas.
3. **Limpieza de cuentas duplicadas** (5 correos, 3 DNI) de forma manual y con aprobación, en staging o
   ventana de mantenimiento. No se hizo ningún `UPDATE` masivo.
4. **Baseline SQL**: un volcado íntegro y versionado del esquema con sus índices y claves foráneas reales.
5. **Migraciones**: `database/` tiene scripts solapados y `Evaluacion.Periodo` no está en todos ellos;
   conviene una única línea base más migraciones incrementales verificables.
6. **Rate limiting** en login, registro, checkout y subida de materiales.
7. **Helmet** y cabeceras de seguridad (CSP, `X-Content-Type-Options`, `Referrer-Policy`). Requiere revisar
   el hosting de `uploads` y los enlaces del correo antes de activarlo.
8. **OpenAPI**: documentar el contrato real (hoy está repartido entre rutas, frontend y pruebas).
9. **Docker/Compose** para un entorno reproducible.
10. **CI**: ejecutar `node --test`, `node --check` y la verificación de SQL en cada pull request.
11. **Rotación de credenciales**: `JWT_SECRET` y la clave del script de correo deben rotarse; la antigua URL
   hardcodeada de Google Script debe considerarse filtrada.
12. **Límite de `Calificacion`**: decidir si se migra a `DECIMAL` (con su UNIQUE y validación coherente) o
   se consolida el rango de escalas enteras. Hoy el contrato es entero.
13. **Observabilidad**: logging estructurado y métricas de errores 5xx por endpoint.

## Pruebas manuales recomendadas

En entorno de staging, con cuentas autorizadas y datos de prueba.

- **Notas y actas:** crear notas → cerrar el acta → verificar que siguen en el listado, el historial del
  alumno, el promedio, el ranking y el dashboard; confirmar que el PUT responde 403 y que el POST
  equivalente responde 409; probar escala 20, 100, 300, 1000 y 2000; intentar un decimal (400) y un
  vacío (400).
- **Horarios:** alta de un curso no vinculado al ciclo (400); alta de un horario solapado (409); edición
  de un horario que sí se solapa consigo mismo (debe permitirse); edición que solapa con otro (409);
  cambio de día con nombre incoherente (400).
- **Usuarios y acceso:** alta con correo ya usado (409), con DNI de 9 dígitos (400) y con contraseña de 7
  caracteres (400); edición que conserva el correo duplicado histórico (debe permitirse); login con
  usuario inexistente y con contraseña incorrecta (mensajes idénticos); login con clave con espacios.
- **Materiales:** PDF válido, PDF renombrado sin cabecera `%PDF-` (400), archivo de 11 MB (413), cuerpo
  mayor de 15 MB (413); comprobar en disco que no quedan archivos huérfanos; material de otra academia no
  visible ni eliminable.
- **Multiacademia:** verificar que aulas, cursos, horarios, notas, pagos, comunicados, usuarios y materiales
  de una segunda academia no se mezclan con los de la principal.
- **Matrícula:** inscription nueva, reinscripción del mismo correo, ciclo lleno (409), ciclo cerrado
  (409) y confirmación de que el importe guardado es el de la BD y no el enviado por el cliente.
- **Pagos:** marcar Pagado/Moroso y comprobar que se persiste; confirmar que una inscripción pendiente
  no se puede confirmar (409).
- **Intranet y Tutor IA:** login de alumno, verificar docente y curso reales en el horario, notas cerradas
  visibles, ranking correcto y diagnóstico del Tutor IA sin inventar datos.
- **Comunicados:** publicar, editar, listar, confirmar lectura y comprobar que la campana del frontend
  refleja las lecturas reales.

## Estado final para demo

El backend está **listo para integrarse con el frontend corregido**, con estas condiciones:

1. Configurar `GOOGLE_SCRIPT_URL` (y revisar `API_PUBLIC_URL`) en el entorno de la demostración.
2. Aplicar en el frontend el ajuste de **calificaciones enteras** en `RegistroNotasPage.jsx` y el
   reconocimiento de `EstadoRegistro = 2` para no ofrecer edición de notas cerradas.
3. No crear usuarios nuevos con correos/DNI ya existentes: el backend los rechazará con 409 hasta que se
   limpien los duplicados históricos.
4. Verificar manualmente el flujo de notas, cierre de actas y horarios, que son los cambios con
   mayor impacto observable.


