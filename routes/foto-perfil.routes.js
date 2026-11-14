"use strict";

// Fotos de perfil guardadas en MySQL (tabla FotoPerfil). Son públicas porque
// se usan en etiquetas <img>; el nombre lleva 16 caracteres aleatorios.
// Si la foto no está en la base (fotos antiguas o tabla aún no creada), se
// pasa al siguiente middleware: el estático de uploads/perfiles.
const express = require("express");
const pool = require("../config/db");

const router = express.Router();
const NOMBRE_FOTO = /^foto-perfil-(?:\d{1,10}|anon)-[a-z0-9]{1,16}-[a-z0-9]{1,32}\.(?:jpg|png|webp)$/;
const TIPOS = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

router.get("/:nombre", async (req, res, next) => {
  const nombre = String(req.params.nombre || "");
  if (!NOMBRE_FOTO.test(nombre)) return next();
  try {
    const [rows] = await pool.query(
      "SELECT Contenido, TipoMime FROM FotoPerfil WHERE NombreArchivo = ? LIMIT 1",
      [nombre],
    );
    if (!rows.length) return next();
    const extension = nombre.split(".").pop();
    res.set("Content-Type", TIPOS[extension] || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("X-Content-Type-Options", "nosniff");
    const contenido = rows[0].Contenido;
    return res.send(Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido));
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return next();
    console.error("Error al servir foto de perfil:", error.message);
    return res.status(500).json({ error: "No se pudo cargar la foto." });
  }
});

module.exports = router;
