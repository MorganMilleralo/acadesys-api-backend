require("dotenv").config();
const express = require("express");
const cors = require("cors");
require("./config/db");

const app = express();
const port = process.env.PORT || 3000;

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
