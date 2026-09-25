const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const bcrypt = require("bcrypt");
const requiereRol = require("../middlewares/roles.middleware");

function generarCodigo(prefijo) {
  const hash = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefijo}-${hash}`;
}

function generarClaveTemporal() {
  return Math.random().toString(36).substring(2, 10);
}

// POST /api/matriculas - Registro ágil de alumnos y emisión de credenciales
router.post(
  "/matriculas",
  requiereRol("Administrador", "Tutor de Aula"),
  async (req, res) => {
    const {
      Nombres,
      ApellidoPaterno,
      ApellidoMaterno,
      prefijoCiclo,
      IdPerfil,
      IdCiclo,
    } = req.body;

    if (!Nombres || !ApellidoPaterno || !prefijoCiclo) {
      return res
        .status(400)
        .json({
          error:
            "Nombres, ApellidoPaterno y prefijoCiclo son campos obligatorios.",
        });
    }

    const idAcademia = req.usuario.idAcademia;
    const perfilAsignado = IdPerfil ? Number(IdPerfil) : 4; // 4 = Alumno por defecto

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const claveTemporal = generarClaveTemporal();
      const claveHasheada = await bcrypt.hash(claveTemporal, 10);

      let codigoUsuario;
      let idGenerado;
      let intentos = 0;
      const maxIntentos = 5;

      // Reintentos automáticos en caso de colisión en el índice único UQ_Usuario_CodigoUsuario
      while (true) {
        codigoUsuario = generarCodigo(prefijoCiclo);
        try {
          const [result] = await connection.query(
            `INSERT INTO Usuario 
                        (CodigoUsuario, IdAcademia, Nombres, ApellidoPaterno, ApellidoMaterno, Clave, FechaCreacion, EstadoRegistro)
                     VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)`,
            [
              codigoUsuario,
              idAcademia,
              Nombres,
              ApellidoPaterno,
              ApellidoMaterno || "",
              claveHasheada,
            ],
          );
          idGenerado = result.insertId;
          break;
        } catch (err) {
          intentos++;
          if (err.code === "ER_DUP_ENTRY" && intentos < maxIntentos) {
            continue;
          }
          throw err;
        }
      }

      // Asignación de rol Alumno en tabla intermedia
      await connection.query(
        "INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, 1)",
        [idGenerado, perfilAsignado],
      );

      // Registro en el Ciclo Académico seleccionado
      if (IdCiclo) {
        await connection.query(
          "INSERT INTO Matricula (IdUsuario, IdCiclo, EstadoRegistro) VALUES (?, ?, 1)",
          [idGenerado, IdCiclo],
        );
      }

      await connection.commit();

      res.status(201).json({
        mensaje: "Matrícula SaaS exitosa",
        ticketAcceso: {
          idUsuario: idGenerado,
          codigoUsuario,
          claveTemporal,
        },
      });
    } catch (error) {
      await connection.rollback();
      console.error("Error en POST /matriculas:", error.message);
      res.status(500).json({ error: error.message });
    } finally {
      connection.release();
    }
  },
);

module.exports = router;
