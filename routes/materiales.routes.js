const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'materiales');

function asegurarDirectorio() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function apiBase(req) {
  return String(process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function limpiarNombreArchivo(nombre = 'material.pdf') {
  const base = path.basename(String(nombre)).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

// GET /api/materiales/admin?idCiclo=...
router.get('/admin', requiereRol('Administrador'), async (req, res) => {
  try {
    const { idCiclo } = req.query;
    const params = [];
    let where = 'ma.EstadoRegistro = 1';

    if (idCiclo) {
      where += ' AND ma.IdCiclo = ?';
      params.push(Number(idCiclo));
    }

    const [rows] = await pool.query(`
      SELECT
        ma.IdMaterial,
        ma.IdCiclo,
        ma.IdCurso,
        ma.Titulo,
        ma.Descripcion,
        ma.NombreArchivo,
        ma.UrlArchivo,
        ma.TipoMime,
        ma.FechaPublicacion,
        c.Nombre AS Ciclo,
        cu.Nombre AS Curso
      FROM MaterialAcademico ma
      INNER JOIN Ciclo c ON c.IdCiclo = ma.IdCiclo
      INNER JOIN Curso cu ON cu.IdCurso = ma.IdCurso
      WHERE ${where}
      ORDER BY ma.FechaPublicacion DESC, ma.IdMaterial DESC
    `, params);

    res.json(rows);
  } catch (error) {
    console.error('Error en GET /api/materiales/admin:', error.message);
    res.status(500).json({ error: 'No se pudieron cargar los materiales.' });
  }
});

// POST /api/materiales
// Recibe el PDF como base64 para no agregar otra dependencia al backend.
router.post('/', requiereRol('Administrador'), async (req, res) => {
  const {
    idCiclo,
    idCurso,
    titulo,
    descripcion,
    nombreArchivo,
    fileData
  } = req.body || {};

  if (!idCiclo || !idCurso || !titulo || !fileData) {
    return res.status(400).json({
      error: 'Ciclo, curso, título y archivo PDF son obligatorios.'
    });
  }

  if (typeof fileData !== 'string' || fileData.length < 20) {
    return res.status(400).json({ error: 'El archivo PDF recibido no es válido.' });
  }

  try {
    const [relacion] = await pool.query(`
      SELECT
        c.IdCiclo,
        cu.IdCurso,
        cu.Nombre AS Curso
      FROM CicloCurso cc
      INNER JOIN Ciclo c ON c.IdCiclo = cc.IdCiclo
      INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
      WHERE cc.IdCiclo = ?
        AND cc.IdCurso = ?
        AND cc.EstadoRegistro = 1
        AND c.EstadoRegistro = 1
        AND cu.EstadoRegistro = 1
      LIMIT 1
    `, [Number(idCiclo), Number(idCurso)]);

    if (relacion.length === 0) {
      return res.status(400).json({
        error: 'El curso seleccionado no está vinculado al ciclo seleccionado.'
      });
    }

    // 10 MB aprox. de binario => 13.4 MB de base64.
    if (Buffer.byteLength(fileData, 'base64') > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'El PDF no puede superar los 10 MB.' });
    }

    const buffer = Buffer.from(fileData, 'base64');

    // PDF válido comienza con %PDF-
    if (buffer.subarray(0, 5).toString() !== '%PDF-') {
      return res.status(400).json({ error: 'El archivo no parece ser un PDF válido.' });
    }

    asegurarDirectorio();

    const nombreSeguro = limpiarNombreArchivo(nombreArchivo || 'material.pdf');
    const nombreFinal = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${nombreSeguro}`;
    const destino = path.join(UPLOAD_DIR, nombreFinal);

    fs.writeFileSync(destino, buffer);

    const urlArchivo = `${apiBase(req)}/uploads/materiales/${encodeURIComponent(nombreFinal)}`;

    const [insert] = await pool.query(`
      INSERT INTO MaterialAcademico
        (IdCiclo, IdCurso, Titulo, Descripcion, NombreArchivo, UrlArchivo, TipoMime, IdUsuarioCreacion, FechaPublicacion, EstadoRegistro)
      VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, NOW(), 1)
    `, [
      Number(idCiclo),
      Number(idCurso),
      String(titulo).trim(),
      String(descripcion || '').trim(),
      nombreSeguro,
      urlArchivo,
      req.usuario.idUsuario || req.usuario.id
    ]);

    res.status(201).json({
      idMaterial: insert.insertId,
      idCiclo: Number(idCiclo),
      idCurso: Number(idCurso),
      titulo: String(titulo).trim(),
      descripcion: String(descripcion || '').trim(),
      nombreArchivo: nombreSeguro,
      urlArchivo,
      tipoMime: 'application/pdf',
      fechaPublicacion: new Date().toISOString(),
      curso: relacion[0].Curso
    });
  } catch (error) {
    console.error('Error en POST /api/materiales:', error.message);
    res.status(500).json({ error: 'No se pudo guardar el material PDF.' });
  }
});

router.delete('/:id', requiereRol('Administrador'), async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(`
      SELECT IdMaterial, UrlArchivo
      FROM MaterialAcademico
      WHERE IdMaterial = ? AND EstadoRegistro = 1
      LIMIT 1
    `, [Number(id)]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Material no encontrado.' });
    }

    await pool.query(
      'UPDATE MaterialAcademico SET EstadoRegistro = -1 WHERE IdMaterial = ?',
      [Number(id)]
    );

    const url = String(rows[0].UrlArchivo || '');
    const nombre = decodeURIComponent(url.split('/').pop() || '');
    const archivo = path.join(UPLOAD_DIR, path.basename(nombre));

    if (archivo.startsWith(UPLOAD_DIR) && fs.existsSync(archivo)) {
      try {
        fs.unlinkSync(archivo);
      } catch (unlinkError) {
        console.warn('No se pudo eliminar el archivo físico:', unlinkError.message);
      }
    }

    res.json({ message: 'Material eliminado correctamente.' });
  } catch (error) {
    console.error('Error en DELETE /api/materiales/:id:', error.message);
    res.status(500).json({ error: 'No se pudo eliminar el material.' });
  }
});

module.exports = router;
