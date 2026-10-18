# Pruebas manuales mínimas

> Este documento conserva los criterios originales de main. Para la integración
> vigente consultar [CONSOLIDACION_BACKEND.md](../CONSOLIDACION_BACKEND.md): docente/tutor
> sin alcance verificable reciben 403; curso/cierre usan Evaluacion.IdCurso y un
> cierre con curso null solo corresponde a Simulacro. Las tres migraciones
> mencionadas al final no están incluidas como archivos SQL en este repositorio.
> No se ejecutaron migraciones ni pruebas sobre Aiven.

## RBAC de notas
- Sin JWT: `GET /api/notas` debe responder 401/403 desde el guard global.
- Con rol Alumno: `GET /api/notas`, `/api/notas/contexto/ID` y `/api/notas/matriculas/ID` deben responder 403.
- Alumno consultando su propio `/api/notas/alumno/ID_USUARIO`: respuesta únicamente con sus registros.
- Alumno consultando otro ID: 403.
- Docente/Tutor/Administrador: las consultas permitidas responden con filas limitadas a la academia.

## Cierre de actas
- Registrar calificaciones para ciclo X, curso Y, periodo P, tipo T.
- Cerrar esa combinación con `PUT /api/actas/cierre`.
- Un nuevo POST de notas para esa combinación debe responder 403.
- Cambiar a otro periodo, tipo, curso o ciclo abierto debe continuar permitido.
- Repetir el cierre debe responder 409 y no duplicar auditoría.

## Checkout
- Realizar checkout de prueba.
- La API debe responder con `pago.estado = Pendiente` y `confirmadoPorPasarela = false`.
- En `PagosMensualidad`, `Estado` debe ser `Pendiente` y `FechaPago` NULL.
- El correo y frontend deben indicar que es demostración y que no se ha realizado cobro.

## Esquema
- Revisar `SHOW CREATE TABLE` completo para `Matricula`, `Evaluacion`, `Auditoria_Cierres`, `PagosMensualidad`, `Usuario_Perfiles`.
- Verificar la relación entre IdCurso, IdCiclo y matrículas antes de producción.

## Casos añadidos por revisión del esquema en DBeaver

- Ejecutar primero, en staging y una sola vez, las tres migraciones incluidas: `Evaluacion.Periodo`, `PagosMensualidad.Estado = Pendiente` y `Auditoria_Cierres.IdCurso` nullable.
- Confirmar que `POST /api/matriculas/checkout` crea `PagosMensualidad.Estado = Pendiente` y `FechaPago IS NULL`.
- Confirmar que `PUT /api/pagos/:id/estado` rechaza con 409 la modificación manual de un registro `Mes = 'Inscripcion'` y `Estado = 'Pendiente'`.
- Confirmar que el cierre con `idCurso: null` sella solo evaluaciones cuyas matrículas tienen `IdCurso IS NULL`; un cierre por curso sella solo el curso solicitado.
