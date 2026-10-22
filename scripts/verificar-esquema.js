// Comprobación de solo lectura del esquema usado por las nuevas validaciones.
// Ejecutar con: node scripts/verificar-esquema.js
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

const CONSULTAS = [
  ['columnas de Evaluacion', 'SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?, ?, ?)', ['Evaluacion', 'Calificacion', 'EstadoRegistro', 'Periodo', 'TipoEvaluacion']],
  ['columnas de Usuario', 'SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?, ?, ?)', ['Usuario', 'DNI', 'CorreoElectronico', 'Celular', 'Clave']],
  ['columnas de Matricula', 'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?, ?)', ['Matricula', 'IdCiclo', 'IdCurso', 'EstadoRegistro']],
  ['columnas de HorarioCurso', 'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?, ?, ?, ?)', ['HorarioCurso', 'IdCiclo', 'IdCurso', 'DiaNumero', 'HoraInicio', 'HoraFin']],
  ['columnas de MaterialAcademico', 'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?, ?)', ['MaterialAcademico', 'IdCiclo', 'IdCurso', 'EstadoRegistro']],
  ['columnas de Asignacion_Aula', 'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?, ?)', ['Asignacion_Aula', 'IdCiclo', 'IdCurso', 'IdAula']],
  ['columnas de Ciclo', 'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?, ?)', ['Ciclo', 'IdAcademia', 'EstadoRegistro', 'Nombre']],
];

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
    for (const [titulo, sql, params] of CONSULTAS) {
      const [filas] = await conexion.query(sql, params);
      console.log(`${titulo}: ${filas.map((f) => f.COLUMN_NAME || f).join(', ')}`);
    }
    const [duplicados] = await conexion.query(
      `SELECT IdMatricula, COALESCE(Periodo, 'General') AS Periodo, TipoEvaluacion, COUNT(*) AS n
         FROM Evaluacion WHERE EstadoRegistro IN (1, 2)
        GROUP BY IdMatricula, COALESCE(Periodo, 'General'), TipoEvaluacion
       HAVING COUNT(*) > 1 LIMIT 10`,
    );
    console.log(`evaluaciones duplicadas existentes: ${duplicados.length}`);
    for (const fila of duplicados) console.log(`  ${fila.IdMatricula} | ${fila.Periodo} | ${fila.TipoEvaluacion} | ${fila.n}`);
    const [cerradas] = await conexion.query('SELECT COUNT(*) AS n FROM Evaluacion WHERE EstadoRegistro = 2');
    console.log(`evaluaciones cerradas (EstadoRegistro = 2): ${cerradas[0].n}`);
  } finally {
    await conexion.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});


