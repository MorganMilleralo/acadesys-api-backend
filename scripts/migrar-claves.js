require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../config/db');

(async () => {
  let migradas = 0;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [usuarios] = await connection.query(
      'SELECT IdUsuario, Clave FROM Usuario WHERE Clave IS NOT NULL',
    );

    for (const usuario of usuarios) {
      const clave = String(usuario.Clave || '');
      if (!clave || /^\$2[aby]\$/.test(clave)) continue;
      const hash = await bcrypt.hash(clave, 10);
      await connection.query(
        'UPDATE Usuario SET Clave = ? WHERE IdUsuario = ?',
        [hash, usuario.IdUsuario],
      );
      migradas += 1;
    }

    await connection.commit();
    console.log(`Migración de contraseñas terminada. Filas actualizadas: ${migradas}.`);
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); } catch (_) {}
    }
    console.error('Falló la migración de contraseñas:', error.message);
    process.exitCode = 1;
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
})();
