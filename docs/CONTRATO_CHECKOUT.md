# Contrato candidato de matrícula y reinscripción

## `POST /api/matriculas/verificar`

Entrada: `{ correo, idCiclo }`. La API comprueba solamente la disponibilidad pública del ciclo. No consulta ni retorna si un correo pertenece a una cuenta. Éxito: `200 { disponible: true, idCiclo, mensaje }`. Ciclo no publicado/cerrado/sin capacidad: `404` o `409` con mensaje de negocio. Configuración de academia pública ausente/incorrecta: `503`.

## `POST /api/matriculas/checkout`

Entrada normalizada con nombre, apellidos, correo e ID del ciclo. Si el request es anónimo y no lleva una verificación previa válida, la API solo envía el enlace de verificación y responde `202` con `verificacionRequerida: true`, `matriculaRegistrada: false`; no crea usuario/matrícula/pago. El token se vence en 15 minutos. Un `GET` al enlace no escribe nada; requiere pulsar un botón que hace el `POST` de confirmación.

Si hay un alumno existente, un visitante no puede reinscribirlo a partir del correo aunque haya abierto el enlace: debe iniciar sesión y hacer la operación desde su panel. La API valida que la sesión corresponda al mismo alumno y academia.

Si el checkout se completa, las respuestas deben indicar claramente que el pago es `Pendiente`/simulado, no un cobro real. El estado de correo se comunica por separado. Si la BD ya confirmó la matrícula y luego el correo de instrucciones falla, la UI no debe invitar a reenviar el formulario; debe pedir contacto con la academia.

## Reglas que no debe romper el frontend

- No tratar `202 verificacionRequerida` como matrícula creada.
- No mandar el precio del navegador como autoridad del cobro; como máximo, es un dato visual.
- No reintentar automáticamente POST de escritura tras un timeout cuyo resultado sea desconocido.
- Mostrar mensajes coherentes con el estado recibido, permitir al usuario cancelar antes de confirmar y bloquear doble clic.
- Para reinscripción: mandar el JWT vigente y los datos asociados a la sesión; el backend vuelve a comprobarlo todo.
- Nunca mostrar contraseñas temporales, tokens ni secretos en logs del navegador.
