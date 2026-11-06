const assert = require("node:assert/strict");
const express = require("express");

// Base de datos simulada: NO se utiliza Aiven.
const rutaDB = require.resolve("./config/db");
const cierres = new Set();

const clave = (ciclo, curso, periodo, tipo) =>
  `${ciclo}|${curso ?? 'general'}|${periodo}|${tipo}`;

const conexionFalsa = {
  async beginTransaction() {},

  async query(sql, params) {
    assert.equal((sql.match(/\?/g) || []).length, params.length);
    if (sql.includes("FROM Ciclo")) {
      return [[{ IdCiclo: params[0] }]];
    }

    if (sql.includes("FROM Auditoria_Cierres")) {
      const existe = cierres.has(
        clave(params[0], params[1], params[2], params[3])
      );

      return [existe ? [{ IdCierre: 1 }] : []];
    }

    if (sql.includes("UPDATE Evaluacion")) {
      // Verificamos que no sea un cierre global.
      assert.match(sql, /m\.IdCiclo\s*=\s*\?/i);
      assert.match(sql, /m\.IdCurso\s*<=>\s*\?/i);
      assert.match(sql, /e\.Periodo\s*=\s*\?/i);
      assert.match(sql, /e\.TipoEvaluacion\s*=\s*\?/i);
      assert.match(sql, /u\.IdAcademia\s*=\s*\?/i);

      return [{ affectedRows: 2 }];
    }

    if (sql.includes("INSERT INTO Auditoria_Cierres")) {
      assert.match(sql, /IdAdministrador/i);
      assert.match(sql, /IdCiclo/i);
      assert.match(sql, /IdCurso/i);
      assert.match(sql, /Periodo/i);
      assert.match(sql, /TipoEvaluacion/i);

      cierres.add(
        clave(params[1], params[2], params[3], params[4])
      );

      return [{ insertId: 1 }];
    }

    throw new Error("Consulta no simulada: " + sql);
  },

  async commit() {},
  async rollback() {},
  release() {},
};

require.cache[rutaDB] = {
  id: rutaDB,
  filename: rutaDB,
  loaded: true,
  exports: {
    getConnection: async () => conexionFalsa,
  },
};

const app = express();
app.use(express.json());

// Usuario ficticio, exclusivo de esta prueba.
app.use((req, res, next) => {
  req.usuario = {
    id: 10,
    idAcademia: 1,
    rol: req.headers["x-rol-prueba"] || "Administrador",
  };

  next();
});

// Cargamos las rutas reales con la BD simulada.
app.use("/api", require("./routes/actas.routes"));

const servidor = app.listen(0, "127.0.0.1", async () => {
  const puerto = servidor.address().port;
  const url = `http://127.0.0.1:${puerto}/api/actas/cierre`;

  async function probar(nombre, datos, esperado, rol) {
    const respuesta = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-rol-prueba": rol || "Administrador",
      },
      body: JSON.stringify(datos),
    });

    assert.equal(
      respuesta.status,
      esperado,
      `${nombre}: esperaba ${esperado}, recibi ${respuesta.status}`
    );

    console.log("OK - " + nombre);
  }

  const datos = {
    idCiclo: 7,
    idCurso: null,
    periodo: "General",
    tipoEvaluacion: "Simulacro",
  };

  try {
    await probar("Cierre general", datos, 200);

    await probar("Cierre duplicado", datos, 409);

    await probar(
      "Otro ciclo independiente",
      { ...datos, idCiclo: 8 },
      200
    );

    await probar(
      "Identificador de curso invalido se rechaza",
      { ...datos, idCurso: true },
      400
    );

    await probar(
      "Docente sin permiso de cierre",
      { ...datos, idCiclo: 9 },
      403,
      "Docente"
    );

    console.log("\n5 pruebas completadas correctamente.");

  } catch (error) {
    console.error("PRUEBA FALLIDA:", error.message);
    process.exitCode = 1;

  } finally {
    servidor.close();
  }
});


