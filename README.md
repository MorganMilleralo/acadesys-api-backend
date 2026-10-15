# Avance de Morgan — autorización RBAC de notas

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
