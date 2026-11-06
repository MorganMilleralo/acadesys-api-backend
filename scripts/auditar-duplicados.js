// Auditoría de solo lectura de duplicados existentes (para el informe).
// Ejecutar con: node scripts/auditar-duplicados.js
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
    const consultas = [
      ['correos duplicados (todos los estados)', 'SELECT LOWER(TRIM(CorreoElectronico)) AS Clave, COUNT(*) AS n, SUM(EstadoRegistro = 1) AS Activos FROM Usuario WHERE CorreoElectronico IS NOT NULL AND TRIM(CorreoElectronico) <> \'\' GROUP BY LOWER(TRIM(CorreoElectronico)) HAVING COUNT(*) > 1'],
      ['DNI duplicados (todos los estados)', 'SELECT DNI AS Clave, COUNT(*) AS n, SUM(EstadoRegistro = 1) AS Activos FROM Usuario WHERE DNI IS NOT NULL AND TRIM(DNI) <> \'\' GROUP BY DNI HAVING COUNT(*) > 1'],
      ['códigos duplicados', 'SELECT CodigoUsuario AS Clave, COUNT(*) AS n FROM Usuario GROUP BY CodigoUsuario HAVING COUNT(*) > 1'],
      ['evaluaciones duplicadas', 'SELECT IdMatricula, COALESCE(Periodo, \'General\') AS Periodo, TipoEvaluacion, COUNT(*) AS n FROM Evaluacion WHERE EstadoRegistro IN (1, 2) GROUP BY IdMatricula, COALESCE(Periodo, \'General\'), TipoEvaluacion HAVING COUNT(*) > 1'],
      ['horarios solapados o duplicados', 'SELECT IdCiclo, IdCurso, DiaNumero, COUNT(*) AS n FROM HorarioCurso WHERE EstadoRegistro = 1 GROUP BY IdCiclo, IdCurso, DiaNumero HAVING COUNT(*) > 1'],
      ['aulas con nombre repetido', 'SELECT IdAcademia, Nombre, COUNT(*) AS n FROM Aula GROUP BY IdAcademia, Nombre HAVING COUNT(*) > 1'],
      ['cursos con código repetido', 'SELECT Codigo, COUNT(*) AS n FROM Curso GROUP BY Codigo HAVING COUNT(*) > 1'],
      ['perfiles con nombre repetido', 'SELECT LOWER(TRIM(Nombre)) AS Nombre, COUNT(*) AS n FROM perfil GROUP BY LOWER(TRIM(Nombre)) HAVING COUNT(*) > 1'],
    ];
    for (const [titulo, sql] of consultas) {
      const [filas] = await conexion.query(sql);
      console.log(`${titulo}: ${filas.length}`);
      for (const fila of filas.slice(0, 10)) console.log('   ', JSON.stringify(fila));
    }
  } finally {
    await conexion.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});


