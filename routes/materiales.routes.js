const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');
const { idPositivo } = require('../utils/validaciones');
const { MATERIAL_UPLOADS_DIR } = require('../config/storage');

const UPLOAD_DIR = MATERIAL_UPLOADS_DIR;

function asegurarDirectorio() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function apiBase(req) {
  return String(process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function limpiarNombreArchivo(nombre = 'material.pdf') {
  const base = path.basename(String(nombre)).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

// GET /api/materiales/admin?idCiclo=...
router.get('/admin', requiereRol('Administrador'), async (req, res) => {
  try {
    const { idCiclo } = req.query;
    const idAcademia = idPositivo(req.usuario?.idAcademia);
    if (!idAcademia) return res.status(401).json({ error: 'Academia de sesión inválida.' });
    if (idCiclo !== undefined && !idPositivo(idCiclo)) return res.status(400).json({ error: 'IdCiclo no válido.' });
    const params = [idAcademia];
    let where = 'ma.EstadoRegistro = 1 AND c.IdAcademia = ?';

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

  const idAcademia = idPositivo(req.usuario?.idAcademia);
  if (!idAcademia) return res.status(401).json({ error: 'Academia de sesión inválida.' });
  if (!idPositivo(idCiclo) || !idPositivo(idCurso) || typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 180 || (descripcion != null && (typeof descripcion !== 'string' || descripcion.length > 10000)) || !fileData) {
    return res.status(400).json({
      error: 'Ciclo, curso, título y archivo PDF son obligatorios.'
    });
  }
  if (titulo.trim().length < 3) {
    return res.status(400).json({ error: 'El título debe tener al menos 3 caracteres.' });
  }

  if (typeof fileData !== 'string' || fileData.length < 20 || !/^[A-Za-z0-9+/]*={0,2}$/.test(fileData) || fileData.length % 4 !== 0) {
    return res.status(400).json({ error: 'El archivo PDF recibido no es válido.' });
  }

  let destino;
  let insertado = false;
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
        AND c.IdAcademia = ?
      LIMIT 1
    `, [Number(idCiclo), Number(idCurso), idAcademia]);

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
    // Defensa extra: el buffer no debe contener bytes nulos de relleno.
    if (buffer.length < 20) {
      return res.status(400).json({ error: 'El archivo PDF recibido está vacío o incompleto.' });
    }

    asegurarDirectorio();

    const nombreSeguro = limpiarNombreArchivo(nombreArchivo || 'material.pdf').slice(-180);
    const nombreFinal = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${nombreSeguro}`;
    destino = path.join(UPLOAD_DIR, nombreFinal);

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
    insertado = true;

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
    if (destino && !insertado) {
      try { fs.unlinkSync(destino); }
      catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('Cleanup PDF no completado:', cleanupError); }
    }
    console.error('Error en POST /api/materiales:', error.message);
    res.status(500).json({ error: 'No se pudo guardar el material PDF.' });
  }
});

const ROLES_ADMIN = new Set(['administrador', 'recursos humanos']);
const rolNormalizado = (rol) => String(rol ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().toLowerCase().replace(/\s+/g, ' ');

// Ruta física del PDF a partir de UrlArchivo, siempre dentro de UPLOAD_DIR.
function archivoDelMaterial(urlArchivo) {
  const url = String(urlArchivo || '');
  let nombre = '';
  try { nombre = path.basename(decodeURIComponent(url.split('?')[0].split('/').pop() || '')); } catch { return null; }
  if (!nombre || nombre === '.' || nombre === '..') return null;
  const archivo = path.join(UPLOAD_DIR, nombre);
  return path.dirname(archivo) === UPLOAD_DIR ? archivo : null;
}

// GET /api/materiales/:id/descargar (HU-19)
// Administración: materiales de su academia. Alumno: solo con matrícula
// activa en el ciclo del material. Docente: solo si está asignado a ese
// ciclo y curso. Cualquier otro caso responde 404 para no revelar si existe.
router.get('/:id/descargar', async (req, res) => {
  const idMaterial = idPositivo(req.params.id);
  const idAcademia = idPositivo(req.usuario?.idAcademia);
  const idUsuario = idPositivo(req.usuario?.idUsuario ?? req.usuario?.id);
  if (!idMaterial) return res.status(400).json({ error: 'IdMaterial no válido.' });
  if (!idAcademia || !idUsuario) return res.status(401).json({ error: 'Sesión inválida.' });
  const rol = rolNormalizado(req.usuario?.rol);
  try {
    const [rows] = await pool.query(`
      SELECT ma.IdMaterial, ma.IdCiclo, ma.IdCurso, ma.NombreArchivo, ma.UrlArchivo
      FROM MaterialAcademico ma
      INNER JOIN Ciclo c ON c.IdCiclo = ma.IdCiclo
      WHERE ma.IdMaterial = ? AND ma.EstadoRegistro = 1 AND c.IdAcademia = ?
      LIMIT 1
    `, [idMaterial, idAcademia]);
    const material = rows[0];
    if (!material) return res.status(404).json({ error: 'Material no encontrado.' });

    let autorizado = ROLES_ADMIN.has(rol);
    if (!autorizado && rol === 'alumno') {
      const [matriculas] = await pool.query(`
        SELECT m.IdMatricula FROM Matricula m
        INNER JOIN Usuario u ON u.IdUsuario = m.IdUsuario
        WHERE m.IdUsuario = ? AND m.IdCiclo = ? AND m.EstadoRegistro = 1
          AND u.IdAcademia = ? AND u.EstadoRegistro = 1
        LIMIT 1
      `, [idUsuario, material.IdCiclo, idAcademia]);
      autorizado = matriculas.length > 0;
    } else if (!autorizado && rol === 'docente') {
      const [asignaciones] = await pool.query(`
        SELECT aa.IdAsignacion FROM Asignacion_Aula aa
        WHERE aa.IdUsuario = ? AND aa.IdCiclo = ? AND aa.IdCurso = ?
          AND aa.IdAcademia = ? AND aa.EstadoRegistro = 1
        LIMIT 1
      `, [idUsuario, material.IdCiclo, material.IdCurso, idAcademia]);
      autorizado = asignaciones.length > 0;
    }
    if (!autorizado) return res.status(404).json({ error: 'Material no encontrado.' });

    const archivo = archivoDelMaterial(material.UrlArchivo);
    if (!archivo || !fs.existsSync(archivo)) {
      return res.status(404).json({ code: 'ARCHIVO_NO_DISPONIBLE', error: 'El archivo del material no está disponible en el servidor.' });
    }
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.download(archivo, limpiarNombreArchivo(material.NombreArchivo || 'material.pdf'), {
      headers: { 'Content-Type': 'application/pdf' },
    }, (error) => {
      if (error && !res.headersSent) res.status(500).json({ error: 'No se pudo descargar el material.' });
    });
  } catch (error) {
    console.error('Error en GET /api/materiales/:id/descargar:', error.message);
    return res.status(500).json({ error: 'No se pudo descargar el material.' });
  }
});

router.delete('/:id', requiereRol('Administrador'), async (req, res) => {
  try {
    const { id } = req.params;
    const idAcademia = idPositivo(req.usuario?.idAcademia);
    if (!idAcademia) return res.status(401).json({ error: 'Academia de sesión inválida.' });
    if (!idPositivo(id)) return res.status(400).json({ error: 'IdMaterial no válido.' });

    const [rows] = await pool.query(`
      SELECT ma.IdMaterial, ma.UrlArchivo
      FROM MaterialAcademico ma INNER JOIN Ciclo c ON c.IdCiclo = ma.IdCiclo
      WHERE ma.IdMaterial = ? AND ma.EstadoRegistro = 1 AND c.IdAcademia = ?
      LIMIT 1
    `, [Number(id), idAcademia]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Material no encontrado.' });
    }

    await pool.query(
      `UPDATE MaterialAcademico ma INNER JOIN Ciclo c ON c.IdCiclo = ma.IdCiclo
       SET ma.EstadoRegistro = -1 WHERE ma.IdMaterial = ? AND c.IdAcademia = ? AND ma.EstadoRegistro = 1`,
      [Number(id), idAcademia]
    );

    try {
      const archivo = archivoDelMaterial(rows[0].UrlArchivo);
      if (archivo && fs.existsSync(archivo)) {
        fs.unlinkSync(archivo);
      }
    } catch (unlinkError) {
      console.warn('No se pudo eliminar el archivo físico:', unlinkError.message);
    }

    res.json({ message: 'Material eliminado correctamente.' });
  } catch (error) {
    console.error('Error en DELETE /api/materiales/:id:', error.message);
    res.status(500).json({ error: 'No se pudo eliminar el material.' });
  }
});

module.exports = router;


