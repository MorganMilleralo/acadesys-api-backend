const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');
const { idPositivo, rollbackSeguro } = require('../utils/validaciones');
const { MATERIAL_UPLOADS_DIR } = require('../config/storage');
const { consultar, ejecutar } = require('../config/procedimientos');

const UPLOAD_DIR = MATERIAL_UPLOADS_DIR;

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
    const [rows] = await consultar(pool, 'sp_materiales_listar_admin', [idAcademia, idCiclo ? Number(idCiclo) : null]);

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

  let conexion;
  try {
    const [relacion] = await consultar(pool, 'sp_materiales_obtener_ciclo_curso', [Number(idCiclo), Number(idCurso), idAcademia]);

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

    // El PDF se guarda en MySQL (MaterialArchivo): el disco de Render se borra
    // en cada despliegue, la base de datos no.
    const nombreSeguro = limpiarNombreArchivo(nombreArchivo || 'material.pdf').slice(-180);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const [insert] = await ejecutar(conexion, 'sp_materiales_registrar_material', [
        Number(idCiclo),
        Number(idCurso),
        String(titulo).trim(),
        String(descripcion || '').trim(),
        nombreSeguro,
        req.usuario.idUsuario || req.usuario.id,
      ]);
    const urlArchivo = `${apiBase(req)}/api/materiales/${insert.insertId}/descargar`;
    await ejecutar(conexion, 'sp_materiales_registrar_archivo_material', [insert.insertId, buffer, buffer.length, sha256]);
    await ejecutar(conexion, 'sp_materiales_actualizar_material', [urlArchivo, insert.insertId]);
    await conexion.commit();

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
    await rollbackSeguro(conexion);
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      console.error('Falta la tabla MaterialArchivo (database/migraciones/06_material_archivo.sql).');
      return res.status(503).json({ code: 'ALMACEN_NO_CONFIGURADO', error: 'El almacenamiento de materiales no está configurado. Avisa al administrador del sistema.' });
    }
    if (error?.code === 'ER_NET_PACKET_TOO_LARGE') {
      return res.status(413).json({ error: 'El PDF supera el tamaño que acepta la base de datos.' });
    }
    console.error('Error en POST /api/materiales:', error.message);
    res.status(500).json({ error: 'No se pudo guardar el material PDF.' });
  } finally {
    if (conexion) conexion.release();
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

// GET /api/materiales/:id/descargar
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
    const [rows] = await consultar(pool, 'sp_materiales_obtener_material_descarga', [idMaterial, idAcademia]);
    const material = rows[0];
    if (!material) return res.status(404).json({ error: 'Material no encontrado.' });

    let autorizado = ROLES_ADMIN.has(rol);
    if (!autorizado && rol === 'alumno') {
      const [matriculas] = await consultar(pool, 'sp_materiales_obtener_matricula', [idUsuario, material.IdCiclo, idAcademia]);
      autorizado = matriculas.length > 0;
    } else if (!autorizado && rol === 'docente') {
      const [asignaciones] = await consultar(pool, 'sp_materiales_obtener_asignacion', [idUsuario, material.IdCiclo, material.IdCurso, idAcademia]);
      autorizado = asignaciones.length > 0;
    }
    if (!autorizado) return res.status(404).json({ error: 'Material no encontrado.' });

    const nombreDescarga = limpiarNombreArchivo(material.NombreArchivo || 'material.pdf');
    let guardado = null;
    try {
      const [archivos] = await consultar(pool, 'sp_materiales_obtener_archivo_material', [idMaterial]);
      guardado = archivos[0]?.Contenido || null;
    } catch (error) {
      // Sin la tabla todavía se intenta el archivo antiguo en disco.
      if (error?.code !== 'ER_NO_SUCH_TABLE') throw error;
    }
    if (guardado) {
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Type', 'application/pdf');
      res.attachment(nombreDescarga);
      return res.send(Buffer.isBuffer(guardado) ? guardado : Buffer.from(guardado));
    }

    // Materiales anteriores a MaterialArchivo: archivo en disco, si todavía existe.
    const archivo = archivoDelMaterial(material.UrlArchivo);
    if (!archivo || !fs.existsSync(archivo)) {
      return res.status(404).json({ code: 'ARCHIVO_NO_DISPONIBLE', error: 'El archivo del material no está disponible en el servidor.' });
    }
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.download(archivo, nombreDescarga, {
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

    const [rows] = await consultar(pool, 'sp_materiales_obtener_material', [Number(id), idAcademia]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Material no encontrado.' });
    }

    await ejecutar(pool, 'sp_materiales_cambiar_estado_material', [Number(id), idAcademia]);

    try {
      await ejecutar(pool, 'sp_materiales_eliminar_archivo_material', [Number(id)]);
    } catch (blobError) {
      if (blobError?.code !== 'ER_NO_SUCH_TABLE') console.warn('No se pudo liberar el PDF guardado:', blobError.message);
    }

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


