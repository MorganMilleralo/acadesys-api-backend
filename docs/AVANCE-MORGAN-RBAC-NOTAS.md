# Avance técnico de Morgan: control de acceso a notas

## Hallazgo
La revisión estática de `BACKEND.md` mostró cuatro rutas GET en `routes/notas.routes.js` sin validación de rol en su declaración: listado general, contexto de ciclo, matrículas de ciclo e historial por ID. El historial filtra por academia, pero ese filtro por sí solo no demuestra que quien consulta tenga permiso de ver los datos.

## Corrección incluida
Se agregó `middlewares/notas-acceso.middleware.js` con dos controles:
- `requiereGestionNotas`: exige JWT procesado por la aplicación, academia válida y uno de los roles `Docente`, `Tutor de Aula` o `Administrador`.
- `autorizarHistorialAlumno`: permite personal académico dentro de una sesión vinculada a una academia, o un usuario cuyo rol es `Alumno`/`Estudiante` consultando su propio ID. Bloquea otros casos por defecto.

El script de integración añade estos controles a las cuatro declaraciones GET, preserva los controladores actuales y crea una copia de respaldo. No reemplaza el archivo de rutas entero para no borrar cambios recientes que no forman parte de este avance.

## Pruebas incluidas
Las pruebas unitarias verifican acceso del docente, bloqueo al alumno en el listado general, acceso al propio historial, bloqueo al ID de otro alumno, ID inválido y ausencia de academia.

## Criterios de aceptación para integración
1. La suite `node --test tests/notas-acceso.middleware.test.js` termina sin fallos.
2. Un alumno recibe 403 al llamar `GET /api/notas`, `GET /api/notas/contexto/:idCiclo` y `GET /api/notas/matriculas/:idCiclo`.
3. Un alumno recibe acceso solo a su propio historial en `GET /api/notas/alumno/:id`.
4. Docente, Tutor de Aula y Administrador pueden mantener las consultas que necesitan para la gestión académica.
5. El acceso continúa limitado a la academia del token por las condiciones SQL que ya existen en las rutas.
6. El frontend de registro de notas y el expediente del alumno pasan pruebas manuales.

## Límites conocidos
- El cambio es una corrección de autorización por endpoint, no sustituye la revisión de permisos de todas las rutas ni la corrección del cierre académico por ciclo/periodo.
- No se ha probado con la base de datos real de Aiven ni en despliegue de producción.
- Se debe confirmar que los perfiles de alumno están representados como `Alumno` o `Estudiante` en la tabla de perfiles. Si la base usa otro nombre, debe ajustarse la lista permitida de forma explícita; no debe habilitarse acceso por defecto a cualquier rol.
- Para revisar datos ajenos a la academia, el middleware autoriza el rol académico, pero cada consulta SQL debe seguir llevando el filtro `IdAcademia` autenticado, como ya hace la ruta de historial compartida.
