# Pendientes y bloqueos — Morgan / AcadeSys

## Antes de una demostración (P0)

- [ ] Revisar rama, commit y cambios reales de frontend/backend en los repositorios.
- [ ] Confirmar `PUBLIC_REGISTRATION_ACADEMY_ID` con consulta autorizada del ID real; no adivinarlo.
- [ ] Configurar `GOOGLE_SCRIPT_URL` como secreto en entorno de QA y enviar correo real a buzón de QA.
- [ ] Probar el flujo de verificación de matrícula con: correo nuevo, correo ya registrado, token vencido/manipulado, ciclo sin vacantes, fallo de envío, doble clic y cierre de pestaña.
- [ ] Probar panel de reinscripción con el propio alumno, sesión expirada, token de otro usuario y cuenta de otra academia.
- [ ] Confirmar que el checkout deja pago `Pendiente` y no afirma que haya cobro.
- [ ] Ejecutar pruebas en navegador después de instalar dependencias y compilar frontend.

## Antes de producción (P1)

- [ ] Verificar DDL, FK e índices reales por `SHOW CREATE TABLE` y `SHOW INDEX` autorizado.
- [ ] Auditar duplicados históricos de correo/DNI de solo lectura; planear corrección con respaldo.
- [ ] Probar restricciones de unicidad y concurrencia en staging; incluir rollback.
- [ ] Revisar Helmet/rate limiting y política de CORS/proxy con el responsable backend.
- [ ] Confirmar almacenamiento persistente para FotoUrl y flujo subir/cambiar/eliminar foto.
- [ ] Definir la relación real de asistencia (alumno/ciclo/aula/sesión).
- [ ] Definir el identificador de simulacro semanal y contrato de cierre antes de modificar tablas.
- [ ] Validar logs y errores sin datos personales, contraseñas, tokens o URLs-secretas.

## Avisos sobre el paquete

- Los binarios originales `hero.png` y `acadesys-mark-teal.png` no venían en el export de texto. Se incluyen gráficos provisionales únicamente para que los imports existan; reemplazarlos por los originales antes de integrar la parte visual.
- `node_modules` no se incluye: instalar dependencias con `npm ci` dentro de backend y frontend.
- No se ejecutó checkout autenticado contra Aiven, ni envío real de correo, ni pruebas de navegador/despliegue.
- No publicar mientras Render tenga Auto-Deploy bloqueado por el plan de equipo.
