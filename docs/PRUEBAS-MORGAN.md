# Pruebas manuales mínimas

> Morgan confirmó que solo hay simulacros semanales generales, sin notas por
> curso. Render despliega main automáticamente y no existe staging. La adaptación
> está bloqueada hasta confirmar el identificador semanal y el DDL de auditoría:
> ver [la revisión vigente](../database/REVISION_NOTAS_ACTAS.md). No ejecutar las
> migraciones sugeridas en la versión histórica de este documento.
> Los criterios siguientes son antecedentes de main, no la aceptación del nuevo
> contrato. No se ejecutaron migraciones ni pruebas sobre Aiven.

## RBAC de notas
- Sin JWT: `GET /api/notas` debe responder 401/403 desde el guard global.
- Con rol Alumno: `GET /api/notas`, `/api/notas/contexto/ID` y `/api/notas/matriculas/ID` deben responder 403.
- Alumno consultando su propio `/api/notas/alumno/ID_USUARIO`: respuesta únicamente con sus registros.
- Alumno consultando otro ID: 403.
- Docente/Tutor/Administrador: las consultas permitidas responden con filas limitadas a la academia.

## Cierre de actas
- Confirmar primero cómo se identifica un simulacro en el esquema y en React.
- Con datos ficticios, registrar dos simulacros semanales distintos del mismo ciclo.
- Cerrar uno con `PUT /api/actas/cierre`; debe bloquear edición e inserción solo
  en ese simulacro y permitir el segundo abierto. No usar `General` como semana.
- Verificar el código de respuesta acordado con React (403/409) y que las notas
  cerradas continúen visibles. Repetir el cierre no debe duplicar auditoría.
- La implementación de estos casos está pendiente del contrato real de tablas.

## Checkout
- Realizar checkout de prueba.
- La API debe responder con `pago.estado = Pendiente` y `confirmadoPorPasarela = false`.
- En `PagosMensualidad`, `Estado` debe ser `Pendiente` y `FechaPago` NULL.
- El correo y frontend deben indicar que es demostración y que no se ha realizado cobro.

## Esquema
- Revisar `SHOW CREATE TABLE` completo para `Matricula`, `Evaluacion`, `Auditoria_Cierres`, `PagosMensualidad`, `Usuario_Perfiles`.
- Verificar la relación entre simulacro semanal, ciclo, academia y matrículas.
- No requerir Evaluacion.IdCurso ni presuponer RegistrosAfectados.

## Otros casos heredados de main, pendientes de validar

- La versión anterior mencionaba tres migraciones que no están incluidas como
  archivos SQL. Esa instrucción queda retirada: no hay staging ni autorización
  para migrar. DBeaver consulta la misma base Aiven de producción.
- Confirmar que `POST /api/matriculas/checkout` crea `PagosMensualidad.Estado = Pendiente` y `FechaPago IS NULL`.
- Confirmar que `PUT /api/pagos/:id/estado` rechaza con 409 la modificación manual de un registro `Mes = 'Inscripcion'` y `Estado = 'Pendiente'`.
- El cierre por curso queda fuera de alcance. Confirmar con el DDL real el cierre
  de un simulacro semanal sin depender de Evaluacion.IdCurso o Matricula.IdCurso.
