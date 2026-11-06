// Comprobación de solo lectura: distribución de Periodo/TipoEvaluacion en Evaluacion.
// Ejecutar con: node scripts/verificar-notas.js
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
    const [periodos] = await conexion.query(
      `SELECT COALESCE(Periodo, '(NULL)') AS Periodo, TipoEvaluacion, EstadoRegistro, COUNT(*) AS n
         FROM Evaluacion
        GROUP BY COALESCE(Periodo, '(NULL)'), TipoEvaluacion, EstadoRegistro
        ORDER BY n DESC LIMIT 20`,
    );
    console.log('Periodo / Tipo / Estado / cantidad:');
    for (const fila of periodos) console.log('   ', JSON.stringify(fila));
    const [matriculas] = await conexion.query(
      `SELECT COUNT(*) AS n FROM Matricula WHERE IdCurso IS NULL AND EstadoRegistro = 1`,
    );
    console.log('matrículas activas sin curso:', matriculas[0].n);
    const [ciclos] = await conexion.query(
      `SELECT IdCiclo, Nombre, EstadoRegistro, Capacidad, Precio, UniversidadObjetivo
         FROM Ciclo WHERE IdAcademia = 1 ORDER BY IdCiclo`,
    );
    console.log('ciclos de la academia 1:');
    for (const ciclo of ciclos) console.log('   ', JSON.stringify(ciclo));
  } finally {
    await conexion.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});


