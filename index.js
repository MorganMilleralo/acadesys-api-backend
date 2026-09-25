<<<<<<< HEAD
const express = require('express');
const cors = require('cors'); 
require('./config/db'); 
=======
require("dotenv").config();
const express = require("express");
const cors = require("cors");
require("./config/db");
>>>>>>> 66a4a098baf469a33c726e91130c659bc7a5c56e

const app = express();
const port = process.env.PORT || 3000;

<<<<<<< HEAD
app.use(cors()); // Habilita peticiones desde cualquier origen (Vite en localhost:5173)
app.use(express.json());

// Importar rutas
const perfilRoutes = require('./routes/perfil.routes');
const menuRoutes = require('./routes/menu.routes');
const usuarioRoutes = require('./routes/usuario.routes');
const authRoutes = require('./routes/auth.routes');
const iaRoutes = require('./routes/ia.routes');
const apoderadosRoutes = require('./routes/apoderados.routes');
const actasRoutes = require('./routes/actas.routes');
const notasRoutes = require('./routes/notas.routes'); // <-- Agregado desde tu carpeta routes

// Usar rutas bajo el prefijo /api
app.use('/api', perfilRoutes);
app.use('/api', menuRoutes);
app.use('/api', usuarioRoutes);
app.use('/api', authRoutes);
app.use('/api', apoderadosRoutes);
app.use('/api', actasRoutes);
app.use('/api', notasRoutes);

// Tutor IA / Gemini: montado tanto en /api/tutor-ia como en /api para compatibilidad total
app.use('/api/tutor-ia', iaRoutes);
app.use('/api', iaRoutes);
=======
// Validación de arranque
const variablesRequeridas = [
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "JWT_SECRET",
];
const faltantes = variablesRequeridas.filter((v) => !process.env[v]);
if (faltantes.length > 0) {
  console.error(
    `❌ Faltan variables de entorno obligatorias: ${faltantes.join(", ")}`,
  );
  process.exit(1);
}

app.use(cors());
app.use(express.json());

const verificarToken = require("./middlewares/auth.middleware");

// Rutas Públicas
const authRoutes = require("./routes/auth.routes");
app.use("/api", authRoutes);
>>>>>>> 66a4a098baf469a33c726e91130c659bc7a5c56e

app.get("/ping", (req, res) => {
  res.send("AcadeSys API SaaS en línea.");
});

// Candado Global JWT
app.use("/api", verificarToken);

// Rutas Privadas
app.use("/api", require("./routes/matriculas.routes"));
app.use("/api", require("./routes/perfil.routes"));
app.use("/api", require("./routes/menu.routes"));
app.use("/api", require("./routes/usuario.routes"));
app.use("/api/notas", require("./routes/notas.routes"));
app.use("/api", require("./routes/actas.routes"));
app.use("/api", require("./routes/pagos.routes"));
app.use("/api", require("./routes/ia.routes"));

app.listen(port, () => {
  console.log(`🚀 AcadeSys SaaS corriendo en el puerto ${port}`);
});
