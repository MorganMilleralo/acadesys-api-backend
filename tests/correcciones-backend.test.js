// Routers reales, pool y filesystem simulados: ninguna escritura sobre MySQL/disco.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const bcrypt = require("bcrypt");
const {
  calificacionEntera,
  validarDatosUsuario,
} = require("../utils/validaciones");

let ejecutar;
let consultas;
let tx;
const dbPath = require.resolve("../config/db");
const pool = {
  query(sql, params = []) {
    consultas.push({ sql, params });
    assert.equal(
      (sql.match(/\?/g) || []).length,
      params.length,
      `Placeholders: ${sql}`,
    );
    return ejecutar(sql, params, this);
  },
  async getConnection() {
    const connection = {
      query: pool.query,
      async beginTransaction() {
        tx.begin++;
      },
      async commit() {
        tx.commit++;
        connection.desbloquear?.();
        connection.desbloquear = null;
      },
      async rollback() {
        tx.rollback++;
        connection.restaurar?.();
        connection.desbloquear?.();
        connection.desbloquear = null;
      },
      release() {
        tx.release++;
        connection.desbloquear?.();
      },
    };
    return connection;
  },
};
// Evitar cualquier salida al proveedor de correo, incluso si el entorno lo configuró.
process.env.GOOGLE_SCRIPT_URL = "https://correo-qa.invalid/endpoint";
process.env.PUBLIC_REGISTRATION_ACADEMY_ID = "1";
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: pool,
};
// El Tutor IA lee la clave al cargar el módulo; en las pruebas nunca se llama
// al proveedor externo: el fallo se provoca antes, en la consulta simulada.
process.env.GEMINI_API_KEY = "clave-ficticia-exclusiva-de-pruebas";
const routers = [
  ["/api/notas", require("../routes/notas.routes")],
  ["/api", require("../routes/actas.routes")],
  ["/api", require("../routes/academico.routes")],
  ["/api/materiales", require("../routes/materiales.routes")],
  ["/api/alumno", require("../routes/alumno.routes")],
  ["/api/admin", require("../routes/dashboard.routes")],
  ["/api", require("../routes/auth.routes")],
  ["/api", require("../routes/usuario.routes")],
  ["/api", require("../routes/perfil.routes")],
  ["/api", require("../routes/menu.routes")],
  ["/api", require("../routes/pagos.routes")],
  ["/api/matriculas", require("../routes/matriculas.routes")],
  ["/api", require("../routes/comunicados.routes")],
  ["/api", require("../routes/ia.routes")],
];

beforeEach(() => {
  consultas = [];
  tx = { begin: 0, commit: 0, rollback: 0, release: 0 };
  ejecutar = async (sql) => {
    throw new Error(`SQL inesperado en fixture: ${sql}`);
  };
});

async function conServidor(fn, rol = "Administrador") {
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use((req, res, next) => {
    // rol=null simula una petición pública sin una sesión autenticada.
    if (rol !== null)
      req.usuario = { id: 10, idUsuario: 10, idAcademia: 1, rol };
    next();
  });
  for (const [ruta, router] of routers) app.use(ruta, router);
  app.use(require("../middlewares/error.middleware"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const pedir = async (ruta, method = "GET", datos) => {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}${ruta}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: datos === undefined ? undefined : JSON.stringify(datos),
      },
    );
    return { status: res.status, body: await res.json() };
  };
  pedir.base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(pedir);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function fixtureNotas() {
  const estado = { notas: [], cerrado: false };
  let cola = Promise.resolve();
  ejecutar = async (sql, p, c) => {
    if (/FROM Ciclo\s+WHERE/i.test(sql) && /FOR UPDATE/.test(sql)) {
      const anterior = cola;
      cola = new Promise((resolve) => {
        c.desbloquear = resolve;
      });
      await anterior;
      const copia = structuredClone(estado);
      c.restaurar = () => Object.assign(estado, copia);
      return [
        [
          {
            IdCiclo: 1,
            Nombre: "Ciclo de prueba",
            UniversidadObjetivo: "Preuniversitario",
          },
        ],
      ];
    }
    if (/SELECT m.IdMatricula, m.IdCurso/.test(sql))
      return [[{ IdMatricula: p[0], IdCurso: null }]];
    if (/FROM Evaluacion\s+WHERE IdMatricula/.test(sql)) {
      assert.match(sql, /EstadoRegistro IN \(1, 2\)/);
      return [
        estado.notas.filter(
          (n) =>
            n.IdMatricula === p[0] &&
            n.Periodo === p[1] &&
            n.TipoEvaluacion === p[2],
        ),
      ];
    }
    if (/FROM Auditoria_Cierres/.test(sql))
      return [estado.cerrado ? [{ IdCierre: 1 }] : []];
    if (/INSERT INTO Evaluacion/.test(sql)) {
      estado.notas.push({
        IdEvaluacion: estado.notas.length + 1,
        IdMatricula: p[0],
        Calificacion: p[1],
        TipoEvaluacion: p[2],
        Periodo: p[3],
        EstadoRegistro: 1,
      });
      return [{ affectedRows: 1 }];
    }
    if (
      /UPDATE Evaluacion e/.test(sql) &&
      /SET e.EstadoRegistro = 2/.test(sql)
    ) {
      estado.notas.forEach((n) => {
        n.EstadoRegistro = 2;
      });
      return [{ affectedRows: estado.notas.length }];
    }
    if (/INSERT INTO Auditoria_Cierres/.test(sql)) {
      estado.cerrado = true;
      return [{ affectedRows: 1 }];
    }
    if (/FROM Evaluacion e/.test(sql)) {
      if (/SELECT e.IdEvaluacion, e.EstadoRegistro/.test(sql)) {
        return [
          [
            {
              ...estado.notas[0],
              IdCiclo: 1,
              IdCurso: null,
              IdAcademia: 1,
              UniversidadObjetivo: "Preuniversitario",
            },
          ],
        ];
      }
      assert.match(
        sql,
        /e.EstadoRegistro IN \(1, 2\)/,
        "Una evaluación cerrada debe permanecer visible",
      );
      return [estado.notas];
    }
    if (/SELECT EstadoRegistro FROM Evaluacion/.test(sql))
      return [[{ EstadoRegistro: estado.notas[0]?.EstadoRegistro }]];
    if (/UPDATE Evaluacion e/.test(sql)) {
      estado.notas[0].Calificacion = p[0];
      return [{ affectedRows: 1 }];
    }
    throw new Error(`SQL de notas no contemplado: ${sql}`);
  };
  return estado;
}
const lote = {
  idCiclo: 1,
  periodo: "General",
  notas: [{ IdMatricula: 7, TipoEvaluacion: "Simulacro", Calificacion: 12 }],
};

test("POST notas: primera alta 201, equivalente 409 sin segunda inserción", async () => {
  const estado = fixtureNotas();
  await conServidor(async (pedir) => {
    assert.equal((await pedir("/api/notas", "POST", lote)).status, 201);
    assert.equal((await pedir("/api/notas", "POST", lote)).status, 409);
  });
  assert.equal(estado.notas.length, 1);
  assert.deepEqual(tx, { begin: 2, commit: 1, rollback: 1, release: 2 });
});

test("POST concurrentes serializados por el lock de Ciclo: 201 y 409", async () => {
  const estado = fixtureNotas();
  await conServidor(async (pedir) => {
    const respuestas = await Promise.all([
      pedir("/api/notas", "POST", lote),
      pedir("/api/notas", "POST", lote),
    ]);
    assert.deepEqual(respuestas.map((r) => r.status).sort(), [201, 409]);
  });
  assert.equal(estado.notas.length, 1);
  assert.equal(tx.release, 2);
});

test("un lote repetido internamente se rechaza completo, sin inserciones", async () => {
  const estado = fixtureNotas();
  await conServidor(async (pedir) =>
    assert.equal(
      (
        await pedir("/api/notas", "POST", {
          ...lote,
          notas: [lote.notas[0], lote.notas[0]],
        })
      ).status,
      409,
    ),
  );
  assert.equal(estado.notas.length, 0);
  assert.equal(tx.rollback, 1);
});

test("crear, consultar, cerrar acta, consultar historial: notas/promedio permanecen; PUT 403", async () => {
  fixtureNotas();
  await conServidor(async (pedir) => {
    assert.equal((await pedir("/api/notas", "POST", lote)).status, 201);
    assert.equal((await pedir("/api/notas")).body.length, 1);
    assert.equal(
      (
        await pedir("/api/actas/cierre", "PUT", {
          idCiclo: 1,
          idCurso: null,
          periodo: "General",
          tipoEvaluacion: "Simulacro",
        })
      ).status,
      200,
    );
    const listado = await pedir("/api/notas");
    assert.equal(listado.body[0].Calificacion, 12);
    const historial = await pedir("/api/notas/alumno/10");
    assert.equal(historial.body.promedioGeneral, 12);
    assert.equal(historial.body.totalCursosEvaluados, 1);
    assert.equal(
      (await pedir("/api/notas/1", "PUT", { Calificacion: 18 })).status,
      403,
    );
  });
});

test("POST y PUT rechazan vacío, null, espacios, no numéricos y decimales", async () => {
  fixtureNotas();
  await conServidor(async (pedir) => {
    for (const valor of [
      null,
      "",
      " ",
      "NaN",
      "Infinity",
      "-Infinity",
      "abc",
      12.5,
      "12.5",
      -1,
      true,
      {},
      [],
    ]) {
      const datos = {
        ...lote,
        notas: [{ ...lote.notas[0], Calificacion: valor }],
      };
      assert.equal(
        (await pedir("/api/notas", "POST", datos)).status,
        400,
        `POST ${JSON.stringify(valor)}`,
      );
      // Sin fila en fixture, el middleware deja validar el payload al controlador.
      ejecutar = async (sql) =>
        /FROM Evaluacion e/.test(sql)
          ? [[]]
          : [
              [
                {
                  IdCiclo: 1,
                  Nombre: "Ciclo",
                  UniversidadObjetivo: "Preuniversitario",
                },
              ],
            ];
      assert.equal(
        (await pedir("/api/notas/1", "PUT", { Calificacion: valor })).status,
        400,
      );
      fixtureNotas();
    }
    assert.equal((await pedir("/api/notas/1", "PUT", {})).status, 400);
  });
});

test("escala INT: cero y máximo son válidos; exceso es 400", async () => {
  fixtureNotas();
  await conServidor(async (pedir) => {
    for (const [valor, status, id] of [
      [0, 201, 7],
      [20, 201, 8],
      [21, 400, 9],
    ]) {
      assert.equal(
        (
          await pedir("/api/notas", "POST", {
            ...lote,
            notas: [{ ...lote.notas[0], IdMatricula: id, Calificacion: valor }],
          })
        ).status,
        status,
      );
    }
  });
});

test("matrícula ajena/ciclo inválido/tipo inválido no permiten insertar", async () => {
  fixtureNotas();
  const base = ejecutar;
  ejecutar = (sql, p, c) =>
    /SELECT m.IdMatricula, m.IdCurso/.test(sql)
      ? Promise.resolve([[]])
      : base(sql, p, c);
  await conServidor(async (pedir) => {
    assert.equal((await pedir("/api/notas", "POST", lote)).status, 403);
    assert.equal(
      (await pedir("/api/notas", "POST", { ...lote, idCiclo: "x" })).status,
      400,
    );
    assert.equal(
      (
        await pedir("/api/notas", "POST", {
          ...lote,
          notas: [{ ...lote.notas[0], TipoEvaluacion: "inventado" }],
        })
      ).status,
      400,
    );
  });
});

test("fallo SQL en notas: rollback/release y 500 genérico", async (t) => {
  t.mock.method(console, "error", () => {});
  ejecutar = async () => {
    throw new Error("SELECT secreto FROM tabla_privada host=privado");
  };
  await conServidor(async (pedir) => {
    const respuesta = await pedir("/api/notas", "POST", lote);
    assert.equal(respuesta.status, 500);
    assert.doesNotMatch(
      JSON.stringify(respuesta.body),
      /SELECT|tabla_privada|host=/,
    );
  });
  assert.equal(tx.rollback, 1);
  assert.equal(tx.release, 1);
});

test("alumno no puede gestionar notas ni horarios ni materiales", async () => {
  await conServidor(async (pedir) => {
    assert.equal((await pedir("/api/notas")).status, 403);
    assert.equal((await pedir("/api/horarios", "POST", {})).status, 403);
    assert.equal((await pedir("/api/materiales/admin")).status, 403);
  }, "Alumno");
  assert.equal(consultas.length, 0);
});

test("fechas round-trip: años bisiestos e imposibles", () => {
  const { validarFechaISO } = require("../routes/ciclos.routes");
  for (const fecha of ["2026-02-28", "2028-02-29"])
    assert.equal(validarFechaISO(fecha, "Fecha"), null);
  for (const fecha of ["2026-02-29", "2026-02-31", "texto"])
    assert.ok(validarFechaISO(fecha, "Fecha"));
});

const horario = {
  idCiclo: 1,
  idCurso: 7,
  diaNumero: 1,
  diaSemana: "Lunes",
  horaInicio: "08:00",
  horaFin: "10:00",
  orden: 1,
};
function fixtureHorario({ vinculado = true, solapado = false } = {}) {
  ejecutar = async (sql, p) => {
    if (/FROM Academia/.test(sql)) return [[{ IdAcademia: 1 }]];
    if (/FROM Ciclo WHERE/.test(sql)) return [[{ IdCiclo: 1 }]];
    if (/FROM Curso cu INNER JOIN CicloCurso/.test(sql))
      return [vinculado ? [{ IdCurso: 7 }] : []];
    if (/SELECT h.IdHorario/.test(sql)) return [[{ IdHorario: 9 }]];
    if (/HoraInicio < \? AND HoraFin > \?/.test(sql)) {
      assert.deepEqual(p.slice(3), ["10:00:00", "08:00:00"]);
      return [solapado ? [{ IdHorario: 2 }] : []];
    }
    if (/INSERT INTO HorarioCurso|UPDATE HorarioCurso SET/.test(sql))
      return [{ insertId: 9, affectedRows: 1 }];
    throw new Error(`SQL horario inesperado: ${sql}`);
  };
}

test("horario: curso fuera de CicloCurso es 400 y revierte", async () => {
  fixtureHorario({ vinculado: false });
  await conServidor(async (pedir) =>
    assert.equal((await pedir("/api/horarios", "POST", horario)).status, 400),
  );
  assert.equal(tx.rollback, 1);
  assert.equal(tx.release, 1);
});

test("horario solapado: POST y PUT son 409; PUT excluye su propio ID", async () => {
  fixtureHorario({ solapado: true });
  await conServidor(async (pedir) => {
    assert.equal((await pedir("/api/horarios", "POST", horario)).status, 409);
    assert.equal((await pedir("/api/horarios/9", "PUT", horario)).status, 409);
  });
  assert.equal(
    consultas.filter((q) => /HoraInicio < \?/.test(q.sql))[1].params[2],
    9,
  );
  assert.equal(tx.commit, 0);
});

test("horario válido se crea/edita; día inconsistente u hora inválida es 400", async () => {
  fixtureHorario();
  await conServidor(async (pedir) => {
    assert.equal((await pedir("/api/horarios", "POST", horario)).status, 201);
    assert.equal((await pedir("/api/horarios/9", "PUT", horario)).status, 200);
    for (const datos of [
      { diaSemana: "Martes" },
      { horaInicio: "24:00" },
      { horaFin: "07:00" },
      { orden: 0 },
      { diaNumero: 8 },
    ]) {
      assert.equal(
        (await pedir("/api/horarios", "POST", { ...horario, ...datos })).status,
        400,
      );
    }
  });
});

test("validación de usuarios: no truncar DNI/celular, validar correo, preservar clave exacta", () => {
  const datos = {
    Nombres: "Ana",
    ApellidoPaterno: "D'Angelo",
    CorreoElectronico: "ana@example.test",
    DNI: "12345678",
    Clave: " clave 123 ",
  };
  assert.equal(
    validarDatosUsuario(datos, { crear: true }).datos.Clave,
    " clave 123 ",
  );
  for (const cambio of [
    { DNI: "123456789" },
    { CorreoElectronico: "sin-arroba" },
    { Celular: "1".repeat(16) },
    { Clave: "corta" },
    { Nombres: " " },
    { ApellidoPaterno: "" },
  ]) {
    assert.ok(
      validarDatosUsuario({ ...datos, ...cambio }, { crear: true }).error,
    );
  }
  for (const valor of [
    NaN,
    Infinity,
    -Infinity,
    null,
    undefined,
    "",
    " ",
    1.5,
    "1.5",
    true,
  ])
    assert.equal(calificacionEntera(valor), null);
  assert.equal(calificacionEntera("12"), 12);
});

test("login inexistente y contraseña incorrecta tienen la misma respuesta pública", async () => {
  const hash = await bcrypt.hash("clave correcta", 4);
  let existe = false;
  ejecutar = async () => [
    existe
      ? [{ IdUsuario: 1, Clave: hash, IdPerfil: 1, Rol: "Administrador" }]
      : [],
  ];
  await conServidor(async (pedir) => {
    const ausente = await pedir("/api/auth/login", "POST", {
      usuario: "ejemplo",
      password: "incorrecta",
    });
    existe = true;
    const incorrecta = await pedir("/api/auth/login", "POST", {
      usuario: "ejemplo",
      password: "incorrecta",
    });
    assert.equal(ausente.status, 401);
    assert.deepEqual(ausente, incorrecta);
  });
});

test("login conserva espacios de contraseña existente", async () => {
  const anterior = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "clave_ficticia_exclusiva_de_pruebas_1234567890";
  const hash = await bcrypt.hash(" clave ", 4);
  ejecutar = async () => [
    [
      {
        IdUsuario: 1,
        IdAcademia: 1,
        IdPerfil: 1,
        Rol: "Administrador",
        Clave: hash,
      },
    ],
  ];
  try {
    await conServidor(async (pedir) => {
      assert.equal(
        (
          await pedir("/api/auth/login", "POST", {
            usuario: "ejemplo",
            password: " clave ",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await pedir("/api/auth/login", "POST", {
            usuario: "ejemplo",
            password: "clave",
          })
        ).status,
        401,
      );
    });
  } finally {
    if (anterior === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = anterior;
  }
});

test("PUT vuelve a leer estado bajo lock si el acta se cierra después del middleware", async () => {
  fixtureNotas();
  const base = ejecutar;
  ejecutar = async (sql, p, c) => {
    if (/SELECT e.IdEvaluacion, e.EstadoRegistro/.test(sql))
      return [
        [
          {
            IdEvaluacion: 1,
            IdCiclo: 1,
            IdCurso: null,
            Periodo: "General",
            TipoEvaluacion: "Simulacro",
            EstadoRegistro: 1,
            IdAcademia: 1,
          },
        ],
      ];
    if (/SELECT EstadoRegistro FROM Evaluacion/.test(sql))
      return [[{ EstadoRegistro: 2 }]];
    return base(sql, p, c);
  };
  await conServidor(async (pedir) =>
    assert.equal(
      (await pedir("/api/notas/1", "PUT", { Calificacion: 12 })).status,
      403,
    ),
  );
  assert.equal(
    consultas.some((q) => /UPDATE Evaluacion/.test(q.sql)),
    false,
  );
  assert.equal(tx.rollback, 1);
});

test("intranet conserva nota cerrada/cero, ranking y datos reales del curso/docente", async () => {
  ejecutar = async (sql) => {
    if (/FROM Usuario u/.test(sql) && /WHERE u.IdUsuario/.test(sql))
      return [[{ IdUsuario: 10, Nombres: "Ana" }]];
    if (/FROM Matricula m\s/.test(sql) && /LIMIT 1/.test(sql))
      return [
        [
          {
            IdMatricula: 7,
            IdCiclo: 1,
            Ciclo: "Ciclo demo",
            UniversidadObjetivo: "Preuniversitario",
          },
        ],
      ];
    if (/FROM CicloCurso cc/.test(sql)) {
      assert.match(sql, /Asignacion_Aula/);
      return [
        [
          {
            IdCurso: 7,
            Nombre: "Álgebra",
            Codigo: "ALG",
            Descripcion: "Curso de álgebra",
            Docente: "Docente real",
          },
        ],
      ];
    }
    if (/FROM HorarioCurso h/.test(sql)) {
      assert.match(sql, /Asignacion_Aula/);
      return [[{ Docente: "Docente real" }]];
    }
    if (/FROM Evaluacion e\s/.test(sql)) {
      assert.match(sql, /e.EstadoRegistro IN \(1, 2\)/);
      return [[{ IdEvaluacion: 1, Calificacion: 0, EstadoRegistro: 2 }]];
    }
    if (/SELECT COUNT\(\*\) \+ 1 AS Puesto/.test(sql)) {
      assert.match(sql, /e2.EstadoRegistro IN \(1, 2\)/);
      return [[{ Puesto: 1 }]];
    }
    if (/FROM MaterialAcademico/.test(sql)) return [[]];
    throw new Error(`Fixture intranet: ${sql}`);
  };
  await conServidor(async (pedir) => {
    const r = await pedir("/api/alumno/me");
    assert.equal(r.status, 200);
    assert.equal(r.body.notas.totalEvaluaciones, 1);
    assert.equal(r.body.notas.promedioGeneral, 0);
    assert.equal(r.body.notas.puestoRanking, 1);
    assert.equal(r.body.cursos[0].codigo, "ALG");
    assert.equal(r.body.horarioDetalle[0].docente, "Docente real");
  }, "Alumno");
});

test("overview contabiliza evaluaciones cerradas y su promedio", async () => {
  ejecutar = async (sql) => {
    if (/AS TotalEstudiantes/.test(sql)) return [[{ TotalEstudiantes: 1 }]];
    if (/AS MatriculasActivas/.test(sql)) return [[{ MatriculasActivas: 1 }]];
    if (/AS TotalEvaluaciones/.test(sql)) {
      assert.match(sql, /e.EstadoRegistro IN \(1, 2\)/);
      return [
        [
          {
            IdCiclo: 1,
            Nombre: "Ciclo demo",
            EstadoRegistro: 1,
            Capacidad: 20,
            TotalAlumnos: 1,
            TotalEvaluaciones: 1,
          },
        ],
      ];
    }
    if (/AS TotalMorosos/.test(sql)) return [[{ TotalMorosos: 0 }]];
    if (/AS TotalPagos/.test(sql))
      return [[{ TotalPagos: 1, Pagados: 1, Pendientes: 0 }]];
    if (/AS PromedioBruto/.test(sql)) {
      assert.match(sql, /e.EstadoRegistro IN \(1, 2\)/);
      return [
        [
          {
            IdCiclo: 1,
            Nombre: "Ciclo demo",
            UniversidadObjetivo: "Preuniversitario",
            PromedioBruto: 12,
            Evaluaciones: 1,
          },
        ],
      ];
    }
    throw new Error(`Fixture dashboard: ${sql}`);
  };
  await conServidor(async (pedir) => {
    const r = await pedir("/api/admin/dashboard/overview");
    assert.equal(r.status, 200);
    assert.equal(r.body.ciclos[0].totalEvaluaciones, 1);
    assert.equal(r.body.resumen.promedioInstitucional, 12);
  });
});

function fixtureEdicionUsuario(correoActual) {
  ejecutar = async (sql) => {
    if (/FROM Academia/.test(sql)) return [[{ IdAcademia: 1 }]];
    if (
      /SELECT IdUsuario, EstadoRegistro, DNI, CorreoElectronico FROM Usuario/.test(
        sql,
      )
    ) {
      return [
        [
          {
            IdUsuario: 9,
            EstadoRegistro: 1,
            DNI: "12345678",
            CorreoElectronico: correoActual,
          },
        ],
      ];
    }
    if (/FROM Usuario_Perfiles up/.test(sql))
      return [[{ NombrePerfil: "Docente" }]];
    if (/SELECT IdUsuario FROM Usuario/.test(sql)) return [[{ IdUsuario: 55 }]];
    if (/UPDATE Usuario SET/.test(sql)) return [{ affectedRows: 1 }];
    if (/SELECT IdUsuario FROM Usuario_Perfiles/.test(sql))
      return [[{ IdUsuario: 9 }]];
    throw new Error(`Fixture de edición: ${sql}`);
  };
}

test("editar sin cambiar correo/DNI no bloquea por duplicados preexistentes", async () => {
  fixtureEdicionUsuario("compartido@example.test");
  await conServidor(async (pedir) => {
    const r = await pedir("/api/usuarios/9", "PUT", {
      correo: "compartido@example.test",
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
});

test("cambiar a un correo ya usado por otra cuenta responde 409", async () => {
  fixtureEdicionUsuario("propio@example.test");
  await conServidor(async (pedir) => {
    assert.equal(
      (await pedir("/api/usuarios/9", "PUT", { correo: "otro@example.test" }))
        .status,
      409,
    );
  });
});

test("usuarios y registro público impiden nuevos duplicados sin insertar", async () => {
  ejecutar = async (sql) => {
    if (/FROM Academia/.test(sql)) return [[{ IdAcademia: 1 }]];
    if (/SELECT IdUsuario FROM Usuario/.test(sql)) return [[{ IdUsuario: 99 }]];
    throw new Error(`No debe escribir un duplicado: ${sql}`);
  };
  await conServidor(async (pedir) => {
    const datos = {
      Nombres: "Ana",
      ApellidoPaterno: "Pérez",
      CorreoElectronico: "ana@example.test",
      Clave: "Clave demo 123",
      IdPerfil: 2,
    };
    assert.equal((await pedir("/api/usuarios", "POST", datos)).status, 409);
    assert.equal(
      (await pedir("/api/auth/register", "POST", datos)).status,
      409,
    );
    assert.equal(
      (await pedir("/api/usuarios", "POST", { ...datos, DNI: "123456789" }))
        .status,
      400,
    );
  });
  assert.equal(
    consultas.some((q) => /INSERT INTO Usuario/.test(q.sql)),
    false,
  );
  assert.equal(tx.release, 2);
});

test("fallo adquiriendo conexión no filtra detalles ni deja cleanup inválido", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(pool, "getConnection", async () => {
    throw new Error("host interno simulado");
  });
  await conServidor(async (pedir) => {
    const r = await pedir("/api/notas", "POST", lote);
    assert.equal(r.status, 500);
    assert.doesNotMatch(JSON.stringify(r.body), /host interno/);
  });
  assert.equal(tx.release, 0);
});

test("materiales admin limita academia y rechaza ID no válido", async () => {
  ejecutar = async (sql, p) => {
    assert.match(sql, /c.IdAcademia = \?/);
    assert.equal(p[0], 1);
    return [[]];
  };
  await conServidor(async (pedir) => {
    assert.equal((await pedir("/api/materiales/admin?idCiclo=2")).status, 200);
    assert.equal(
      (await pedir("/api/materiales/admin?idCiclo=abc")).status,
      400,
    );
  });
});

const pdf = {
  idCiclo: 1,
  idCurso: 7,
  titulo: "Material de prueba",
  nombreArchivo: "../ejemplo.pdf",
  fileData: Buffer.from("%PDF-1.4\nContenido simulado").toString("base64"),
};
test("material de otra academia no se publica ni elimina", async () => {
  ejecutar = async (sql, p) => {
    assert.ok(p.includes(1));
    assert.match(sql, /c.IdAcademia = \?/);
    return [[]];
  };
  await conServidor(async (pedir) => {
    assert.equal((await pedir("/api/materiales", "POST", pdf)).status, 400);
    assert.equal((await pedir("/api/materiales/8", "DELETE")).status, 404);
  });
});

test("PDF huérfano se limpia si falla INSERT; cleanup no oculta el error original", async (t) => {
  const escritos = [],
    borrados = [];
  t.mock.method(console, "error", () => {});
  t.mock.method(fs, "mkdirSync", () => {});
  t.mock.method(fs, "writeFileSync", (destino) => escritos.push(destino));
  t.mock.method(fs, "unlinkSync", (destino) => {
    borrados.push(destino);
    throw new Error("fallo cleanup simulado");
  });
  ejecutar = async (sql) => {
    if (/FROM CicloCurso/.test(sql)) return [[{ Curso: "Álgebra" }]];
    if (/INSERT INTO MaterialAcademico/.test(sql))
      throw new Error("fallo insert simulado");
    throw new Error("SQL inesperado");
  };
  await conServidor(async (pedir) =>
    assert.equal((await pedir("/api/materiales", "POST", pdf)).status, 500),
  );
  assert.equal(escritos.length, 1);
  assert.deepEqual(borrados, escritos);
});

test("PDF inválido y mayor de 10 MB se rechazan sin escribir archivos", async (t) => {
  ejecutar = async () => [[{ Curso: "Álgebra" }]];
  t.mock.method(fs, "writeFileSync", () =>
    assert.fail("No debe escribir un PDF inválido"),
  );
  await conServidor(async (pedir) => {
    assert.equal(
      (
        await pedir("/api/materiales", "POST", {
          ...pdf,
          fileData: Buffer.from("No es un PDF en absoluto").toString("base64"),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await pedir("/api/materiales", "POST", {
          ...pdf,
          fileData: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
        })
      ).status,
      413,
    );
  });
});

test("errores JSON: 400 inválido y 413 para cuerpo mayor de 15 MB", async (t) => {
  t.mock.method(console, "error", () => {});
  await conServidor(async (pedir) => {
    const invalido = await fetch(`${pedir.base}/api/notas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(invalido.status, 400);
    assert.equal(
      (
        await pedir("/api/notas", "POST", {
          contenido: "x".repeat(15 * 1024 * 1024),
        })
      ).status,
      413,
    );
  });
});

test("checkout público verifica el correo antes de crear cuenta, matrícula o pago", async (t) => {
  const fetchOriginal = globalThis.fetch;
  const correos = [];
  let montoPersistido;
  t.mock.method(globalThis, "fetch", async (url, ...args) => {
    if (String(url) === "https://correo-qa.invalid/endpoint") {
      correos.push(JSON.parse(args[0]?.body || "{}"));
      return new Response(JSON.stringify({ status: "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return fetchOriginal(url, ...args);
  });

  ejecutar = async (sql, p) => {
    if (/FROM Ciclo c/.test(sql))
      return [
        [
          {
            IdCiclo: 1,
            IdAcademia: 1,
            Nombre: "Ciclo demo",
            EstadoRegistro: 1,
            FechaFin: "2099-12-31",
            Capacidad: 20,
            TotalAlumnos: 0,
            Precio: 250,
          },
        ],
      ];
    throw new Error(
      `Preverificación pública no debe leer usuarios ni escribir: ${sql}`,
    );
  };

  await conServidor(async (pedir) => {
    const primera = await pedir("/api/matriculas/checkout", "POST", {
      idCiclo: 1,
      nombres: "Ana",
      apellidos: "Pérez",
      correo: "ana@example.test",
      monto: 1,
    });
    assert.equal(primera.status, 202);
    assert.equal(primera.body.verificacionRequerida, true);
    assert.equal(primera.body.matriculaRegistrada, false);
    assert.equal(primera.body.pago, undefined);
    assert.equal(
      tx.begin,
      0,
      "El primer paso no abre transacción ni crea registros",
    );
    assert.equal(correos.length, 1);
    assert.match(correos[0].subject, /Confirma tu correo/);
    assert.match(
      correos[0].htmlBody,
      /no se ha creado una cuenta, matrícula ni pago/i,
    );

    const enlace = correos[0].htmlBody.match(
      /href="[^"]*\/api\/matriculas\/confirmar-correo-matricula\?token=([^"]+)"/,
    );
    assert.ok(
      enlace,
      "El correo debe contener el enlace de confirmación de API_PUBLIC_URL",
    );
    const token = decodeURIComponent(enlace[1]);

    // Tras confirmar el enlace se usa la fixture de transacción: recién aquí se
    // permite crear el alumno y registrar el pago pendiente al precio de la BD.
    ejecutar = async (sql, p) => {
      if (/FROM Academia/.test(sql)) return [[{ IdAcademia: 1 }]];
      if (/FROM Ciclo c/.test(sql))
        return [
          [
            {
              IdCiclo: 1,
              IdAcademia: 1,
              Nombre: "Ciclo demo",
              EstadoRegistro: 1,
              FechaFin: "2099-12-31",
              Capacidad: 20,
              Precio: 250,
            },
          ],
        ];
      if (/FROM Matricula m/.test(sql) && /FOR UPDATE/.test(sql)) return [[]];
      if (/FROM Usuario u/.test(sql)) return [[]];
      if (/FROM Usuario\s+WHERE/.test(sql)) return [[]];
      if (/FROM perfil/.test(sql)) return [[{ IdPerfil: 4 }]];
      if (/INSERT INTO Usuario_Perfiles/.test(sql))
        return [{ affectedRows: 1 }];
      if (/INSERT INTO Usuario/.test(sql)) return [{ insertId: 10 }];
      if (/INSERT INTO Matricula/.test(sql)) return [{ insertId: 7 }];
      if (/INSERT INTO PagosMensualidad/.test(sql)) {
        montoPersistido = p[2];
        return [{ insertId: 4 }];
      }
      if (/COUNT\(\*\) AS TotalAlumnos/.test(sql))
        return [[{ TotalAlumnos: 1 }]];
      throw new Error(`Fixture checkout confirmación: ${sql}`);
    };

    const confirmada = await pedir(
      "/api/matriculas/confirmar-correo-matricula",
      "POST",
      { token },
    );
    assert.equal(confirmada.status, 201);
    assert.equal(confirmada.body.pago.monto, 250);
    assert.equal(confirmada.body.pago.estado, "Pendiente");
    assert.equal(confirmada.body.pago.confirmadoPorPasarela, false);
    assert.equal(confirmada.body.correo.estado, "enviado");
    assert.equal(tx.commit, 1);
  }, null);
  assert.equal(montoPersistido, 250);
});

test(
  "verificar no revela si el correo existe; solo confirma disponibilidad de ciclo",
  async () => {
    ejecutar = async (sql) => {
      if (/FROM Ciclo c/.test(sql))
        return [
          [
            {
              IdCiclo: 1,
              IdAcademia: 1,
              Nombre: "Ciclo demo",
              EstadoRegistro: 1,
              FechaFin: "2099-12-31",
              Capacidad: 20,
              TotalAlumnos: 3,
            },
          ],
        ];
      throw new Error(`El preflight no debe consultar cuentas: ${sql}`);
    };
    await conServidor(async (pedir) => {
      const r = await pedir("/api/matriculas/verificar", "POST", {
        correo: "ana@example.test",
        idCiclo: 1,
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.disponible, true);
      assert.equal(r.body.idCiclo, 1);
      assert.match(r.body.mensaje, /disponible/i);
      for (const clave of [
        "idUsuario",
        "codigoUsuario",
        "nombreCompleto",
        "existe",
        "esAlumno",
        "ciclos",
      ]) {
        assert.equal(Object.hasOwn(r.body, clave), false);
      }
      assert.equal(
        consultas.some((q) => /CorreoElectronico|FROM Usuario/i.test(q.sql)),
        false,
      );
    });
  },
  null,
);

test("pago de inscripción pendiente no se confirma como cobro real", async () => {
  ejecutar = async (sql) => {
    assert.match(sql, /p.EstadoRegistro = 1/);
    assert.match(sql, /c.IdAcademia = u.IdAcademia/);
    return [[{ IdPago: 2, Mes: "Inscripcion", Estado: "Pendiente" }]];
  };
  await conServidor(async (pedir) => {
    assert.equal(
      (await pedir("/api/pagos/2/estado", "PUT", { Estado: "Pagado" })).status,
      409,
    );
    assert.equal(
      (await pedir("/api/pagos/2/estado", "PUT", { Estado: "Inventado" }))
        .status,
      400,
    );
    assert.equal((await pedir("/api/pagos/ciclo/abc")).status, 400);
  });
  assert.equal(tx.rollback, 1);
});

test("perfiles duplicados devuelven 409 antes de insertar", async () => {
  ejecutar = async (sql) =>
    /FROM Academia/.test(sql) ? [[{ IdAcademia: 1 }]] : [[{ IdPerfil: 2 }]];
  await conServidor(async (pedir) =>
    assert.equal(
      (await pedir("/api/perfiles", "POST", { NombrePerfil: "Docente" }))
        .status,
      409,
    ),
  );
  assert.equal(
    consultas.some((q) => /INSERT INTO perfil/.test(q.sql)),
    false,
  );
});

test("aula o curso con relaciones activas no admiten baja lógica", async () => {
  ejecutar = async () => [[{ IdCurso: 7, IdAula: 4 }]];
  await conServidor(async (pedir) => {
    assert.equal((await pedir("/api/cursos/7", "DELETE")).status, 409);
    assert.equal((await pedir("/api/aulas/4", "DELETE")).status, 409);
  });
  assert.equal(
    consultas.some((q) => /UPDATE /.test(q.sql)),
    false,
  );
});

test("menús aceptan padre cero como raíz y mantienen contrato id", async () => {
  ejecutar = async (sql, p) => {
    if (/FROM Academia/.test(sql)) return [[{ IdAcademia: 1 }]];
    if (/SELECT IdOpcionMenu/.test(sql)) return [[]];
    if (/INSERT INTO OpcionesMenu /.test(sql)) {
      assert.equal(p[3], null);
      return [{ affectedRows: 1, insertId: 9 }];
    }
    throw new Error("SQL menú inesperado");
  };
  await conServidor(async (pedir) => {
    const r = await pedir("/api/menus", "POST", {
      Nombre: "Inicio",
      UrlMenu: "/dashboard",
      IdPadre: 0,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.id, 9);
  });
});

test("Tutor IA: un fallo interno responde 500 genérico y no filtra SQL", async (t) => {
  t.mock.method(console, "error", () => {});
  ejecutar = async () => {
    throw new Error('SELECT secreto FROM Evaluacion WHERE Clave = "abc"');
  };
  await conServidor(async (pedir) => {
    const r = await pedir("/api/tutor-ia", "POST", {
      pregunta: "¿Cómo estudio?",
    });
    assert.equal(r.status, 500);
    assert.doesNotMatch(JSON.stringify(r.body), /SELECT|Clave|abc/);
  }, "Alumno");
});

test("Tutor IA exige rol de alumno", async () => {
  await conServidor(async (pedir) => {
    assert.equal(
      (await pedir("/api/tutor-ia", "POST", { pregunta: "x" })).status,
      403,
    );
  }, "Docente");
});

test("comunicado demasiado largo o de tipo inválido se rechaza antes de SQL", async () => {
  await conServidor(async (pedir) => {
    assert.equal(
      (
        await pedir("/api/comunicados", "POST", {
          titulo: "x".repeat(181),
          contenido: "Prueba",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await pedir("/api/comunicados", "POST", {
          titulo: {},
          contenido: "Prueba",
        })
      ).status,
      400,
    );
  });
  assert.equal(consultas.length, 0);
});
