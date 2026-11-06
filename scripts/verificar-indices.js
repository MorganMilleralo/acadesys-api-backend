// Comprobación de solo lectura de índices y claves foráneas.
// Ejecutar con: node scripts/verificar-indices.js
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

async function main() {
  const conexion = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 8000,
  });
  try {
    const tablas = ['Usuario', 'Evaluacion', 'HorarioCurso', 'Aula', 'Curso', 'Matricula', 'MaterialAcademico', 'OpcionesMenu', 'OpcionesMenu_Perfiles', 'perfil', 'Comunicado', 'Comunicado_Lectura', 'PagosMensualidad', 'Ciclo', 'CicloCurso', 'Asignacion_Aula', 'Asistencia', 'Auditoria_Cierres'];
    const [indices] = await conexion.query(
      `SELECT TABLE_NAME AS Tabla, INDEX_NAME AS Indice, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS Columnas, NON_UNIQUE AS NoUnico
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
        GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
        ORDER BY TABLE_NAME, INDEX_NAME`,
      [tablas],
    );
    for (const indice of indices) {
      console.log(`${indice.Tabla}.${indice.Indice} [${indice.NoUnico === 0 ? 'UNIQUE' : 'idx'}] (${indice.Columnas})`);
    }
    const [fk] = await conexion.query(
      `SELECT TABLE_NAME AS Tabla, CONSTRAINT_NAME AS Nombre, REFERENCED_TABLE_NAME AS RefTabla
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
    );
    console.log('--- claves foráneas ---');
    for (const fila of fk) console.log(`${fila.Tabla}.${fila.Nombre} -> ${fila.RefTabla}`);
    if (!fk.length) console.log('(ninguna clave foránea declarada)');
  } finally {
    await conexion.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});


