Migraciones controladas de AcadeSys

Nunca ejecutes una migración de escritura en Aiven/producción solo por copiarla del ZIP.
1. Backup comprobado.
2. Ejecutar primero contra una BD de QA/staging restaurada.
3. Ejecutar el precheck por separado.
4. Ejecutar el ALTER solo si se confirma que la columna no existe.
5. Verificar SHOW CREATE TABLE y probar subida, lectura, reemplazo y eliminación de foto.
6. Tener plan de rollback: restauración/backup y versión anterior del backend.
