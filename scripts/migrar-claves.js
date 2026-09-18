// scripts/migrar-claves.js
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../config/db');

(async () => {
  const [usuarios] = await pool.query('SELECT id, Clave FROM usuarios');
  for (const u of usuarios) {
    if (u.Clave.startsWith('$2')) continue; // ya está hasheada, sáltala
    const hash = await bcrypt.hash(u.Clave, 10);
    await pool.query('UPDATE usuarios SET Clave = ? WHERE id = ?', [hash, u.id]);
  }
  console.log('Migración lista ✅');
  process.exit();
})();