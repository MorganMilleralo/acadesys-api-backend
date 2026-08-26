const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Prueba de conexión
pool.getConnection()
    .then(connection => {
        console.log('¡Conexión a MySQL (Aiven) exitosa, Arquitecto!');
        connection.release();
    })
    .catch(err => {
        console.error('Error conectando a la base de datos:', err);
    });

module.exports = pool;