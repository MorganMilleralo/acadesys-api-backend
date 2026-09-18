require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../config/db');

(async () => {
  const [usuarios] = await pool.query('SELECT IdUsuario, Clave FROM Usuario');
  for (const u of usuarios) {
    if (u.Clave.startsWith('$2')) continue; // ya está hasheada, sáltala
    const hash = await bcrypt.hash(u.Clave, 10);
    await pool.query('UPDATE Usuario SET Clave = ? WHERE IdUsuario = ?', [hash, u.IdUsuario]);
  }
  console.log('Migración lista ✅');
  process.exit();
})();