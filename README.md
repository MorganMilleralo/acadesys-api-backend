# Avance de Morgan — autorización RBAC de notas

> Estado de la rama de consolidación: este avance ya está integrado. Consultar
> [CONSOLIDACION_BACKEND.md](CONSOLIDACION_BACKEND.md) para el contrato vigente,
> pruebas y bloqueos. Ejecutar `npm.cmd test`; no volver a ejecutar el instalador
> descrito abajo. Docente/tutor no reciben acceso a notas sin asignación verificable;
> Administrador y Recursos Humanos comparten permisos por nombre exacto normalizado.
>
> Alcance confirmado por Morgan: **solo simulacros semanales, sin calificaciones
> por curso**. El ajuste funcional está bloqueado hasta confirmar el DDL vigente y
> el identificador semanal. La suite actual todavía prueba el contrato anterior.
> **No apto para Auto-Deploy**: Render despliega main y Aiven es la única base.

El texto siguiente conserva la descripción del avance original de main.

## Objetivo
Cerrar las rutas de lectura de notas que no exigen autorización por rol y evitar que un alumno consulte el historial de otro estudiante.

## Contenido
- `middlewares/notas-acceso.middleware.js`: middleware completo e independiente para consultas generales de notas y consulta de historial individual.
- `scripts/aplicar-avance.js`: integra de forma quirúrgica el middleware en cuatro rutas de `routes/notas.routes.js`; no sustituye el archivo completo y crea un respaldo antes de escribir.
- `tests/notas-acceso.middleware.test.js`: pruebas con el módulo nativo de Node.js, sin librerías adicionales.
- `docs/AVANCE-MORGAN-RBAC-NOTAS.md`: pasos, criterios y limitaciones.

## Instalación
1. Copia únicamente `middlewares/notas-acceso.middleware.js` a la carpeta `middlewares/` del backend. No reemplaces `roles.middleware.js`; el archivo de notas existente seguirá usando su middleware actual para las rutas POST y PUT.
2. Copia el script de `scripts/` a una carpeta temporal o ejecuta este script desde esta carpeta, estando en la raíz del backend:
   `node /ruta/Avance_Morgan_RBAC_Notas/scripts/aplicar-avance.js`
3. Revisa el diff de `routes/notas.routes.js` y el respaldo `routes/notas.routes.js.bak-*` creado automáticamente.
4. Ejecuta las pruebas desde esta carpeta:
   `node --test tests/notas-acceso.middleware.test.js`
5. Prueba la integración contra la base de datos de desarrollo y revisa el frontend antes de hacer merge o desplegar.

## Endpoints protegidos
- `GET /api/notas`: personal académico autorizado.
- `GET /api/notas/contexto/:idCiclo`: personal académico autorizado.
- `GET /api/notas/matriculas/:idCiclo`: personal académico autorizado.
- `GET /api/notas/alumno/:id`: personal académico autenticado con academia válida, o el alumno autenticado consultando su propio ID.

Los `POST` y `PUT` existentes mantienen los controles de rol y el middleware de cierre que ya tenían.
