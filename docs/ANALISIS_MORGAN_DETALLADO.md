# AcadeSys — Implementación completa de Morgan (base de trabajo)

## Alcance

Morgan es fullstack con responsabilidad principal de backend. Este paquete reúne el árbol completo de frontend y backend reconstruido desde los volcados más recientes, más una propuesta de cambios para endurecer la matrícula y reinscripción. El código no se ha publicado ni se ha probado contra Aiven/Render.

## Cambios incluidos en este árbol

### Backend
- `routes/matriculas.routes.js`: checkout revisado para no fiarse del precio enviado por el navegador, validar estado/capacidad, gestionar la matrícula en una transacción y distinguir el estado del correo de la matrícula. Para visitantes anónimos, inicia el flujo de verificación de correo antes de escribir cuenta/matrícula/pago.
- `routes/matriculas.routes.js` + `utils/token-verificacion-matricula.js`: token cifrado AES-GCM con vencimiento corto, propósito específico y validación estricta; `GET /confirmar-correo-matricula` muestra una página que exige una acción explícita, para evitar que un escáner de enlaces confirme automáticamente.
- `utils/autorizacion-reinscripcion.js` y `middlewares/autenticacion-opcional.middleware.js`: impiden que un visitante use solo el correo conocido para reinscribir una cuenta ajena; cuando la cuenta ya existe, exige autenticar a ese mismo alumno desde el panel.
- `routes/ciclos.routes.js` y `utils/reglas-matricula.js`: validan el ciclo público desde configuración, sin asumir silenciosamente una academia si falta el ID configurado.
- `tests/autorizacion-reinscripcion.test.js`, `tests/reglas-matricula.test.js` y `tests/token-verificacion-matricula.test.js`: cubren la función de autorización, disponibilidad/fechas/precio/capacidad y token.
- `scripts/verificar-entorno-morgan.js`, `scripts/probar-correo-qa.js` y `database/QA_SOLO_LECTURA_MORGAN.sql`: ayudan a verificar el entorno/correo e inspeccionar el esquema sin escrituras.

### Frontend
- `src/pages/LandingPage.jsx` + `src/services/api.js`: integran el nuevo contrato de checkout. El preflight comprueba la disponibilidad del ciclo sin revelar si existe una cuenta; la UI informa que la matrícula todavía no se creó cuando se está esperando el clic de verificación por correo.
- `src/components/PanelReinscripcionAlumno.jsx` integrado en `StudentIntranetPage.jsx`: ofrece reinscripción autenticada desde el panel; muestra precio/estado como viene del servidor y avisa que el pago está pendiente y es simulado.
- `tests/contrato-api.test.js` incluye verificación de que el preflight no enumera cuentas y conserva los contratos principales de la API.

## Flujo de matrícula propuesto

1. El visitante selecciona un ciclo publicado y envía nombre/apellidos/correo.
2. `POST /api/matriculas/verificar` comprueba solamente que el ciclo permita continuar; no revela si el correo existe.
3. `POST /api/matriculas/checkout` para un visitante anónimo emite un enlace cifrado que vence en 15 minutos. Si el correo no se pudo enviar, no se crea matrícula.
4. El usuario abre el enlace y pulsa expresamente “Confirmar y continuar”.
5. El backend vuelve a validar ciclo, precio, capacidad y duplicados; si el correo ya corresponde a un alumno, le pide iniciar sesión y hacer la reinscripción desde el panel.
6. La cuenta nueva, matrícula y pago se registran en la transacción. El pago queda pendiente; no hay cobro real.
7. El envío de instrucciones de acceso se muestra separado del resultado de BD. Si falla después del commit, el alumno recibe un aviso para no repetir el checkout.

## Reglas de seguridad y de negocio que deben mantenerse

- Nunca usar el precio ni la capacidad aportados por React como autoridad. Releerlos desde la BD bajo la transacción.
- El backend verifica identidad, rol, academia, estado y existencia de matrícula duplicada.
- Un `403` no debe cerrar la sesión ni convertirse en permisos de administrador.
- Mantener `Calificacion` como entero mientras el contrato real de BD y API siga siendo `INT`.
- El estado de pago de demostración es `Pendiente`; no decir que se cobró.
- No inventar datos de ciclos/cursos/aulas ni llenar paneles con datos sintéticos de producción.
- Validaciones de formato no certifican que una identidad sea real; para eso haría falta verificación oficial externa, no provista en los archivos.
- No agregar `UNIQUE`, FK ni columnas a Aiven hasta revisar `SHOW CREATE TABLE`, índices, duplicados y probar migración/rollback en una BD aislada.

## Bloqueos externos a Morgan

- La configuración real `PUBLIC_REGISTRATION_ACADEMY_ID` debe confirmarse con el ID de academia autorizado; no dar por hecho que es `1`.
- `GOOGLE_SCRIPT_URL` debe configurarse como secreto en el entorno de QA y debe probarse envío real a una dirección de QA.
- La columna `Usuario.FotoUrl`, el almacenamiento persistente de imágenes en el hosting y los índices/constraints vigentes requieren inspección real.
- La integración de asistencia depende de definir la relación alumno/aula/sesión. No saltarse un `409` ni añadir aulas ficticias.
- El contrato semanal de simulacros y cierres debe confirmarse con el DDL real; `Periodo = General` no identifica semanas diferentes. No crear `Evaluacion.IdCurso` o `RegistrosAfectados` por suposición.
- No publicar mientras el plan de equipo mantenga el bloqueo de Auto-Deploy de Render.

## Qué falta antes de declarar “completo”

1. Instalar dependencias con `npm ci` en cada proyecto.
2. Ejecutar todas las suites actuales; investigar y resolver sus fallos.
3. Probar el checkout completo con una BD aislada y datos sintéticos, incluido doble clic/concurrencia.
4. Probar el correo con el proveedor real de QA; nunca imprimir URL/token/credenciales.
5. Probar navegación, sesión, matrícula, panel alumno, notas, actas, asistencia y foto en navegador.
6. Confirmar el DDL e índices reales con acceso autorizado de solo lectura.
7. Coordinar con Yan la UI de todos los estados; con Torito las reglas de negocio, integridad y seguridad; con Luis/Dante los cambios de pantallas respectivas.
8. Guardar evidencia reproducible por cada defecto y obtener aprobación para el despliegue.

Este documento describe una base de trabajo candidata; no certifica producción.
