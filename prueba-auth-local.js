
process.env.JWT_SECRET = "clave-exclusiva-prueba-local-123456789";

const jwt = require("jsonwebtoken");

// Simulamos MySQL para NO conectarnos a Aiven.
let usuariosSimulados = [];

const rutaDB = require.resolve("./config/db");

require.cache[rutaDB] = {
  id: rutaDB,
  filename: rutaDB,
  loaded: true,
  exports: {
    query: async () => [usuariosSimulados],
  },
};

const verificarToken = require("./middlewares/auth.middleware");

const token = jwt.sign(
  {
    id: 7,
    idAcademia: 1,
    rol: "Administrador",
  },
  process.env.JWT_SECRET,
  { expiresIn: "5m" }
);

async function probar(nombre, usuarios, resultadoEsperado, rolEsperado) {
  usuariosSimulados = usuarios;

  const req = {
    headers: {
      authorization: `Bearer ${token}`,
    },
  };

  let codigo = null;

  const res = {
    status(valor) {
      codigo = valor;
      return this;
    },
    json() {
      return this;
    },
  };

  await verificarToken(req, res, () => {
    codigo = 200;
  });

  const correcto =
    codigo === resultadoEsperado &&
    (!rolEsperado || req.usuario?.rol === rolEsperado);

  console.log(
    `${correcto ? "OK" : "ERROR"} - ${nombre}`
  );

  if (!correcto) {
    process.exitCode = 1;
  }
}

async function ejecutar() {
  const usuario = {
    IdUsuario: 7,
    IdAcademia: 1,
    IdPerfil: 2,
    Rol: "Docente",
  };

  await probar(
    "Actualizacion de Administrador a Docente",
    [usuario],
    200,
    "Docente"
  );

  await probar(
    "Usuario desactivado",
    [],
    401
  );

  await probar(
    "Usuario con multiples perfiles",
    [usuario, { ...usuario, IdPerfil: 4, Rol: "Alumno" }],
    403
  );

  await probar(
    "Usuario de otra academia",
    [{ ...usuario, IdAcademia: 2 }],
    401
  );
}

ejecutar().catch((error) => { console.error(error); process.exitCode = 1; });
