const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const bcrypt = require("bcrypt");
const requiereRol = require("../middlewares/roles.middleware");

// 1. CREAR USUARIO STAFF (Docente / Tutor de Aula)
router.post("/usuarios", requiereRol("Administrador"), async (req, res) => {
  const {
    DNI,
    Nombres,
    ApellidoPaterno,
    ApellidoMaterno,
    Celular,
    CorreoElectronico,
    Clave,
    IdPerfil,
  } = req.body;

  if (!Nombres || !ApellidoPaterno || !Clave || !IdPerfil) {
    return res.status(400).json({
      error:
        "Nombres, ApellidoPaterno, Clave e IdPerfil son campos obligatorios.",
    });
  }

  const idAcademia = req.usuario.idAcademia;
  const claveHasheada = await bcrypt.hash(Clave, 10);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [resultUsuario] = await connection.query(
      `INSERT INTO Usuario
                (DNI, Nombres, ApellidoPaterno, ApellidoMaterno, Celular, CorreoElectronico, Clave, IdAcademia, FechaCreacion, EstadoRegistro)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 1)`,
      [
        DNI || null,
        Nombres,
        ApellidoPaterno,
        ApellidoMaterno || "",
        Celular || "",
        CorreoElectronico || null,
        claveHasheada,
        idAcademia,
      ],
    );

    const idGenerado = resultUsuario.insertId;

    await connection.query(
      "INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, 1)",
      [idGenerado, Number(IdPerfil)],
    );

    await connection.commit();
    res.status(201).json({
      message: "Usuario creado y perfil asignado con éxito",
      id: idGenerado,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error en POST /usuarios:", error.message);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// 2. LISTAR USUARIOS (Filtrado por academia, sin exponer hashes de contraseña)
router.get("/usuarios", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
                u.IdUsuario, u.DNI, u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno,
                CONCAT(u.Nombres, ' ', COALESCE(u.ApellidoPaterno, ''), ' ', COALESCE(u.ApellidoMaterno, '')) AS NombreCompleto,
                u.CorreoElectronico, u.CorreoElectronico AS Correo, u.Celular, u.CodigoUsuario, u.EstadoRegistro,
                up.IdPerfil, p.Nombre AS NombrePerfil, p.Nombre AS Perfil
             FROM Usuario u
             LEFT JOIN Usuario_Perfiles up ON u.IdUsuario = up.IdUsuario AND up.EstadoRegistro = 1
             LEFT JOIN perfil p ON up.IdPerfil = p.IdPerfil
             WHERE u.EstadoRegistro IN (0, 1) AND u.IdAcademia = ?
             ORDER BY u.IdUsuario DESC`,
      [req.usuario.idAcademia],
    );
    res.json(rows);
  } catch (error) {
    console.error("Error en GET /usuarios:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 3. MODIFICAR USUARIO
router.put("/usuarios/:id", requiereRol("Administrador"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params;
    const {
      DNI,
      Nombres,
      ApellidoPaterno,
      ApellidoMaterno,
      Celular,
      CorreoElectronico,
      Clave,
      EstadoRegistro,
      IdPerfil,
    } = req.body;

    let queryUpdate =
      "UPDATE Usuario SET DNI=?, Nombres=?, ApellidoPaterno=?, ApellidoMaterno=?, Celular=?, CorreoElectronico=?";
    const paramsUpdate = [
      DNI || null,
      Nombres,
      ApellidoPaterno,
      ApellidoMaterno || "",
      Celular || "",
      CorreoElectronico || null,
    ];

    if (Clave && String(Clave).trim() !== "") {
      const claveHasheada = await bcrypt.hash(String(Clave).trim(), 10);
      queryUpdate += ", Clave=?";
      paramsUpdate.push(claveHasheada);
    }

    if (EstadoRegistro !== undefined && EstadoRegistro !== null) {
      queryUpdate += ", EstadoRegistro=?";
      paramsUpdate.push(Number(EstadoRegistro));
    }

    queryUpdate += " WHERE IdUsuario=? AND IdAcademia=?";
    paramsUpdate.push(id, req.usuario.idAcademia);

    const [result] = await connection.query(queryUpdate, paramsUpdate);

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: "Usuario no encontrado en tu academia." });
    }

    if (IdPerfil) {
      const [existePerfil] = await connection.query(
        "SELECT * FROM Usuario_Perfiles WHERE IdUsuario = ?",
        [id],
      );
      if (existePerfil.length > 0) {
        await connection.query(
          "UPDATE Usuario_Perfiles SET IdPerfil = ?, EstadoRegistro = 1 WHERE IdUsuario = ?",
          [Number(IdPerfil), id],
        );
      } else {
        await connection.query(
          "INSERT INTO Usuario_Perfiles (IdUsuario, IdPerfil, EstadoRegistro) VALUES (?, ?, 1)",
          [id, Number(IdPerfil)],
        );
      }
    }

    await connection.commit();
    res.json({ message: "Usuario y perfil actualizados con éxito" });
  } catch (error) {
    await connection.rollback();
    console.error("Error en PUT /usuarios/:id:", error.message);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// 4. ELIMINACIÓN LÓGICA
router.delete(
  "/usuarios/:id",
  requiereRol("Administrador"),
  async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { id } = req.params;
      await connection.beginTransaction();

      const [result] = await connection.query(
        "UPDATE Usuario SET EstadoRegistro = -1 WHERE IdUsuario = ? AND IdAcademia = ?",
        [id, req.usuario.idAcademia],
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ error: "Usuario no encontrado en tu academia." });
      }

      await connection.query(
        "UPDATE Usuario_Perfiles SET EstadoRegistro = -1 WHERE IdUsuario = ?",
        [id],
      );

      await connection.commit();
      res.json({ message: "Usuario eliminado lógicamente con éxito (-1)" });
    } catch (error) {
      await connection.rollback();
      console.error("Error en DELETE /usuarios/:id:", error.message);
      res.status(500).json({ error: error.message });
    } finally {
      connection.release();
    }
  },
);

module.exports = router;
