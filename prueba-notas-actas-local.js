
const assert = require("node:assert/strict");
const express = require("express");

// Sustituir MySQL antes de cargar las rutas.
// Esta prueba NO se conecta a Aiven.
const rutaDB = require.resolve("./config/db");

const evaluaciones = [];
const cierres = [];
let siguienteId = 1;
let respaldo = null;
let falloInsercionEn = 0;
let falloAuditoria = false;
let pruebasRealizadas = 0;

const copia = (obj) => JSON.parse(JSON.stringify(obj));

const igualCurso = (a, b) =>
  a === b || (a == null && b == null);

const coincide = (e, ciclo, curso, periodo, tipo) =>
  e.idCiclo === Number(ciclo) &&
  igualCurso(e.IdCurso, curso) &&
  e.Periodo === periodo &&
  e.TipoEvaluacion === tipo;

async function query(sql, p = []) {
  const q = sql.replace(/\s+/g, " ").trim();
  assert.equal((q.match(/\?/g) || []).length, p.length, "Parametros SQL completos");

  if (/\bFROM Ciclo\b/i.test(q)) {
    return [
      [7, 8].includes(Number(p[0])) &&
      Number(p[1]) === 1
        ? [{
            IdCiclo: Number(p[0]),
            Nombre: "Ciclo de prueba",
            UniversidadObjetivo: "UNMSM",
          }]
        : [],
    ];
  }

  if (/\bFROM CicloCurso\b/i.test(q)) {
    return [
      [3, 4].includes(Number(p[1])) &&
      Number(p[0]) === 7
        ? [{ IdCurso: Number(p[1]) }]
        : [],
    ];
  }

  if (
    /\bFROM Matricula m\b/i.test(q) &&
    /SELECT m\.IdMatricula\b/i.test(q)
  ) {
    return [
      Number(p[0]) === 100 &&
      Number(p[1]) === 7 &&
      Number(p[2]) === 1
        ? [{ IdMatricula: 100 }]
        : [],
    ];
  }

  if (/\bFROM Auditoria_Cierres\b/i.test(q)) {
    assert.match(q, /IdCurso\s*<=>\s*\?/i);

    const existe = cierres.some(
      (c) =>
        c.idCiclo === Number(p[0]) &&
        igualCurso(c.idCurso, p[1]) &&
        c.periodo === p[2] &&
        c.tipo === p[3]
    );

    return [existe ? [{ IdCierre: 1 }] : []];
  }

  if (
    /\bFROM Evaluacion e\b/i.test(q) &&
    /EstadoRegistro\s+IN\s*\(1,\s*2\)/i.test(q)
  ) {
    assert.match(q, /e\.IdCurso/i);

    return [
      evaluaciones
        .filter((e) => [1, 2].includes(e.EstadoRegistro))
        .map((e) => ({
          ...e,
          Curso:
            e.IdCurso == null
              ? "Simulacro General"
              : "Curso de prueba",
        })),
    ];
  }

  if (
    /\bFROM Evaluacion e\b/i.test(q) &&
    /\bIdEvaluacion\s*=\s*\?/i.test(q)
  ) {
    const e = evaluaciones.find(
      (x) => x.IdEvaluacion === Number(p[0])
    );

    return [e ? [{ ...e, IdCiclo: e.idCiclo }] : []];
  }

  if (/^INSERT INTO Evaluacion\b/i.test(q)) {
    if (falloInsercionEn > 0 && --falloInsercionEn === 0) {
      throw new Error("Fallo de insercion simulado para comprobar rollback");
    }
    assert.match(q, /\bIdCurso\b/i);
    assert.match(q, /\bPeriodo\b/i);

    evaluaciones.push({
      IdEvaluacion: siguienteId++,
      IdMatricula: Number(p[0]),
      idCiclo: 7,
      IdCurso: p[1],
      Periodo: p[2],
      TipoEvaluacion: p[3],
      Calificacion: Number(p[4]),
      EstadoRegistro: 1,
    });

    return [{
      insertId: siguienteId - 1,
      affectedRows: 1,
    }];
  }

  if (
    /^UPDATE Evaluacion e\b/i.test(q) &&
    /SET\s+e\.EstadoRegistro\s*=\s*2/i.test(q)
  ) {
    assert.match(q, /e\.IdCurso\s*<=>\s*\?/i);

    let cantidad = 0;

    for (const e of evaluaciones) {
      if (
        e.EstadoRegistro === 1 &&
        coincide(e, p[1], p[2], p[3], p[4])
      ) {
        e.EstadoRegistro = 2;
        cantidad++;
      }
    }

    return [{ affectedRows: cantidad }];
  }

  if (
    /^UPDATE Evaluacion e\b/i.test(q) &&
    /SET\s+e\.Calificacion\s*=\s*\?/i.test(q)
  ) {
    const e = evaluaciones.find(
      (x) =>
        x.IdEvaluacion === Number(p[2]) &&
        x.EstadoRegistro === 1
    );

    if (e) {
      e.Calificacion = Number(p[0]);
    }

    return [{ affectedRows: e ? 1 : 0 }];
  }

  if (/^INSERT INTO Auditoria_Cierres\b/i.test(q)) {
    if (falloAuditoria) throw new Error("Fallo de auditoria simulado para comprobar rollback");
    cierres.push({
      idCiclo: Number(p[1]),
      idCurso: p[2],
      periodo: p[3],
      tipo: p[4],
    });

    return [{ affectedRows: 1 }];
  }

  throw new Error(
    "Consulta no simulada: " + q.slice(0, 120)
  );
}

const conexion = {
  query,

  async beginTransaction() {
    respaldo = {
      evaluaciones: copia(evaluaciones),
      cierres: copia(cierres),
      siguienteId,
    };
  },

  async commit() {
    respaldo = null;
  },

  async rollback() {
    if (!respaldo) return;

    evaluaciones.splice(
      0,
      evaluaciones.length,
      ...respaldo.evaluaciones
    );

    cierres.splice(
      0,
      cierres.length,
      ...respaldo.cierres
    );

    siguienteId = respaldo.siguienteId;
    respaldo = null;
  },

  release() {},
};

require.cache[rutaDB] = {
  id: rutaDB,
  filename: rutaDB,
  loaded: true,
  exports: {
    query,
    getConnection: async () => conexion,
  },
};

// Servidor exclusivo de pruebas locales.
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  req.usuario = {
    id: 10,
    idAcademia: 1,
    rol:
      req.headers["x-rol-prueba"] ||
      "Administrador",
  };
  next();
});

app.use(
  "/api/notas",
  require("./routes/notas.routes")
);

app.use(
  "/api",
  require("./routes/actas.routes")
);

const servidor = app.listen(
  0,
  "127.0.0.1",
  async () => {
    const base =
      `http://127.0.0.1:${servidor.address().port}`;

    async function probar(
      nombre,
      metodo,
      ruta,
      body,
      esperado,
      rol
    ) {
      const respuesta = await fetch(base + ruta, {
        method: metodo,
        headers: {
          "Content-Type": "application/json",
          "x-rol-prueba": rol || "Administrador",
        },
        body: JSON.stringify(body),
      });

      const detalle = await respuesta.text();

      assert.equal(
        respuesta.status,
        esperado,
        `${nombre}: esperado ${esperado}, ` +
          `recibido ${respuesta.status}. ${detalle}`
      );

      console.log("OK - " + nombre);
      pruebasRealizadas++;
      return JSON.parse(detalle);
    }

    const notaCurso = (
      IdCurso,
      periodo = "General"
    ) => ({
      idCiclo: 7,
      periodo,
      notas: [{
        IdMatricula: 100,
        IdCurso,
        TipoEvaluacion: "Practica",
        Calificacion: 16,
      }],
    });

    const simulacro = {
      idCiclo: 7,
      periodo: "General",
      notas: [{
        IdMatricula: 100,
        IdCurso: null,
        TipoEvaluacion: "Simulacro",
        Calificacion: 1450,
      }],
    };

    try {
      await probar(
        "Registrar nota del curso 3",
        "POST", "/api/notas",
        notaCurso(3), 201
      );

      await probar(
        "Registrar simulacro general",
        "POST", "/api/notas",
        simulacro, 201
      );

      assert.equal(evaluaciones.length, 2);

      const idNota =
        evaluaciones[0].IdEvaluacion;

      await probar(
        "Modificar nota abierta",
        "PUT", `/api/notas/${idNota}`,
        { Calificacion: 18 }, 200
      );

      assert.equal(
        evaluaciones[0].Calificacion, 18
      );

      await probar(
        "Cerrar Practica del curso 3",
        "PUT", "/api/actas/cierre",
        {
          idCiclo: 7,
          idCurso: 3,
          periodo: "General",
          tipoEvaluacion: "Practica",
        },
        200
      );

      assert.equal(
        evaluaciones[0].EstadoRegistro, 2
      );

      assert.equal(
        evaluaciones[1].EstadoRegistro, 1
      );

      assert.equal(cierres.length, 1);

      const listado = await probar(
        "Las notas cerradas siguen visibles",
        "GET", "/api/notas",
        undefined, 200
      );

      assert.ok(
        listado.some(
          (e) => e.EstadoRegistro === 2
        )
      );

      await probar(
        "RRHH puede consultar notas",
        "GET", "/api/notas",
        undefined, 200,
        "Recursos Humanos"
      );

      await probar(
        "Impedir modificar nota cerrada",
        "PUT", `/api/notas/${idNota}`,
        { Calificacion: 19 }, 409
      );

      await probar(
        "Impedir insertar en acta cerrada",
        "POST", "/api/notas",
        notaCurso(3), 409
      );

      await probar(
        "Permitir otro curso del mismo ciclo",
        "POST", "/api/notas",
        notaCurso(4), 201
      );

      await probar(
        "Permitir otro periodo del curso cerrado",
        "POST", "/api/notas",
        notaCurso(3, "Semana 2"), 201
      );

      await probar(
        "Permitir simulacro aun abierto",
        "POST", "/api/notas",
        simulacro, 201
      );

      await probar(
        "Impedir nota decimal",
        "POST", "/api/notas",
        {
          ...notaCurso(4),
          notas: [{
            IdMatricula: 100,
            IdCurso: 4,
            TipoEvaluacion: "Practica",
            Calificacion: 15.5,
          }],
        },
        400
      );

      await probar(
        "Docente sin permiso temporal",
        "POST", "/api/notas",
        notaCurso(4), 403,
        "Docente"
      );

      const antes = copia(evaluaciones);
      await probar("Lote invalido no guarda parcialmente", "POST", "/api/notas", {
        ...notaCurso(4), notas: [notaCurso(4).notas[0], { ...notaCurso(4).notas[0], Calificacion: 21 }],
      }, 400);
      assert.deepEqual(evaluaciones, antes);

      falloInsercionEn = 2;
      await probar("Fallo de segunda insercion restaura el lote", "POST", "/api/notas", {
        ...notaCurso(4), notas: [notaCurso(4).notas[0], notaCurso(4).notas[0]],
      }, 500);
      assert.deepEqual(evaluaciones, antes);

      const cierreGeneral = { idCiclo: 7, idCurso: null, periodo: "General", tipoEvaluacion: "Simulacro" };
      const cierresAntes = copia(cierres);
      falloAuditoria = true;
      await probar("Fallo de auditoria restaura estados de notas", "PUT", "/api/actas/cierre", cierreGeneral, 500);
      assert.deepEqual(evaluaciones, antes);
      assert.deepEqual(cierres, cierresAntes);
      falloAuditoria = false;

      await probar("RRHH cierra simulacros generales", "PUT", "/api/actas/cierre", cierreGeneral, 200, "Recursos Humanos");
      assert.ok(evaluaciones.filter(e => e.IdCurso === null).every(e => e.EstadoRegistro === 2));
      assert.ok(evaluaciones.filter(e => e.IdCurso === 4).every(e => e.EstadoRegistro === 1));
      await probar("Cierre general duplicado", "PUT", "/api/actas/cierre", cierreGeneral, 409);
      await probar("Simulacro cerrado no admite nuevas notas", "POST", "/api/notas", simulacro, 409);
      await probar("Simulacro cerrado no admite edicion", "PUT", `/api/notas/${evaluaciones[1].IdEvaluacion}`, { Calificacion: 1500 }, 409);
      await probar("Otro tipo del mismo curso permanece abierto", "POST", "/api/notas", {
        ...notaCurso(3), notas: [{ ...notaCurso(3).notas[0], TipoEvaluacion: "Examen" }],
      }, 201);

      console.log(`\n${pruebasRealizadas} pruebas locales correctas.`);
      console.log(
        "No se utilizo Aiven."
      );

    } catch (error) {
      console.error(
        "PRUEBA FALLIDA:",
        error.message
      );

      process.exitCode = 1;

    } finally {
      servidor.close();
    }
  }
);
