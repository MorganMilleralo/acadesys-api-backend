const express = require('express');
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');

const router = express.Router();
const CATEGORIAS_VALIDAS = new Set(['Académico', 'Reunión', 'Salud', 'Feriado']);
const PRIORIDADES_VALIDAS = new Set(['baja', 'media', 'alta']);

function idPositivo(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function texto(value, maxLength) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function obtenerIdentidad(req) {
  const idUsuario = idPositivo(req.usuario?.idUsuario ?? req.usuario?.id);
  const idAcademia = idPositivo(req.usuario?.idAcademia);
  return { idUsuario, idAcademia };
}

function prepararDatos(body = {}) {
  const titulo = texto(body.titulo ?? body.Titulo, 180);
  const categoria = texto(body.categoria ?? body.Categoria ?? 'Académico', 50);
  const prioridad = texto(body.prioridad ?? body.Prioridad ?? 'media', 10).toLowerCase();
  const dirigidoA = texto(body.dirigidoA ?? body.DirigidoA ?? 'Todos los Niveles', 150) || 'Todos los Niveles';
  const contenido = String(body.contenido ?? body.Contenido ?? '').trim();

  if (titulo.length < 3) return { error: 'El título debe tener entre 3 y 180 caracteres.' };
  if (!CATEGORIAS_VALIDAS.has(categoria)) return { error: 'La categoría debe ser Académico, Reunión, Salud o Feriado.' };
  if (!PRIORIDADES_VALIDAS.has(prioridad)) return { error: 'La prioridad debe ser baja, media o alta.' };
  if (!contenido || contenido.length > 10000) return { error: 'El contenido es obligatorio y no puede superar 10 000 caracteres.' };

  return { datos: { titulo, categoria, prioridad, dirigidoA, contenido } };
}

async function obtenerAutor(idUsuario, idAcademia, connection = pool) {
  const [rows] = await connection.query(
    `SELECT CONCAT_WS(' ', Nombres, ApellidoPaterno, NULLIF(ApellidoMaterno, '')) AS nombreCompleto
       FROM Usuario
      WHERE IdUsuario = ? AND IdAcademia = ? AND EstadoRegistro = 1
      LIMIT 1`,
    [idUsuario, idAcademia],
  );
  return rows[0]?.nombreCompleto || null;
}

const SELECT_COMUNICADO = `
  SELECT
    c.IdComunicado AS id,
    c.Titulo AS titulo,
    c.Categoria AS categoria,
    c.Prioridad AS prioridad,
    c.DirigidoA AS dirigidoA,
    c.Contenido AS contenido,
    c.AutorNombre AS autor,
    DATE_FORMAT(c.FechaCreacion, '%d/%m/%Y') AS fecha,
    DATE_FORMAT(c.FechaCreacion, '%h:%i %p') AS hora,
    CASE WHEN cl.IdComunicadoLectura IS NULL THEN 0 ELSE 1 END AS confirmado,
    CASE WHEN cl.IdComunicadoLectura IS NULL THEN 0 ELSE 1 END AS leido,
    c.EstadoRegistro AS estadoRegistro,
    c.FechaCreacion AS fechaCreacion
  FROM Comunicado c
  LEFT JOIN Comunicado_Lectura cl
    ON cl.IdComunicado = c.IdComunicado
   AND cl.IdUsuario = ?
   AND cl.EstadoRegistro = 1
`;

async function consultarComunicado(idComunicado, idAcademia, idUsuario, connection = pool) {
  const [rows] = await connection.query(
    `${SELECT_COMUNICADO}
     WHERE c.IdComunicado = ? AND c.IdAcademia = ? AND c.EstadoRegistro = 1
     LIMIT 1`,
    [idUsuario || 0, idComunicado, idAcademia],
  );
  return rows[0] || null;
}

// GET /api/comunicados — lista los comunicados activos de la academia autenticada.
router.get('/comunicados', async (req, res) => {
  const { idUsuario, idAcademia } = obtenerIdentidad(req);
  if (!idAcademia) return res.status(401).json({ error: 'El usuario autenticado no tiene una academia válida.' });

  try {
    const [rows] = await pool.query(
      `${SELECT_COMUNICADO}
       WHERE c.IdAcademia = ? AND c.EstadoRegistro = 1
       ORDER BY c.FechaCreacion DESC, c.IdComunicado DESC`,
      [idUsuario || 0, idAcademia],
    );
    res.json(rows);
  } catch (error) {
    console.error('GET /api/comunicados:', error);
    res.status(500).json({ error: 'No se pudieron consultar los comunicados. Verifica que la migración de comunicados esté aplicada.' });
  }
});

// POST /api/comunicados — administradores y docentes pueden publicar.
router.post('/comunicados', requiereRol('Administrador', 'Docente'), async (req, res) => {
  const { idUsuario, idAcademia } = obtenerIdentidad(req);
  if (!idUsuario || !idAcademia) return res.status(401).json({ error: 'No se pudo identificar al usuario o su academia.' });

  const preparado = prepararDatos(req.body);
  if (preparado.error) return res.status(400).json({ error: preparado.error });

  try {
    const autorNombre = await obtenerAutor(idUsuario, idAcademia);
    if (!autorNombre) return res.status(401).json({ error: 'El usuario autenticado no está activo en esta academia.' });

    const { titulo, categoria, prioridad, dirigidoA, contenido } = preparado.datos;
    const [result] = await pool.query(
      `INSERT INTO Comunicado
        (IdAcademia, Titulo, Categoria, Prioridad, DirigidoA, Contenido, IdAutor, AutorNombre, EstadoRegistro)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [idAcademia, titulo, categoria, prioridad, dirigidoA, contenido, idUsuario, autorNombre],
    );

    const comunicado = await consultarComunicado(result.insertId, idAcademia, idUsuario);
    res.status(201).json(comunicado || { id: result.insertId, message: 'Comunicado publicado correctamente.' });
  } catch (error) {
    console.error('POST /api/comunicados:', error);
    res.status(500).json({ error: 'No se pudo publicar el comunicado.' });
  }
});

// PUT /api/comunicados/:id — edición administrativa; autor y fecha originales se conservan.
router.put('/comunicados/:id', requiereRol('Administrador'), async (req, res) => {
  const { idUsuario, idAcademia } = obtenerIdentidad(req);
  const idComunicado = idPositivo(req.params.id);
  if (!idAcademia || !idComunicado) return res.status(400).json({ error: 'La academia o el identificador del comunicado no son válidos.' });

  const preparado = prepararDatos(req.body);
  if (preparado.error) return res.status(400).json({ error: preparado.error });

  try {
    const { titulo, categoria, prioridad, dirigidoA, contenido } = preparado.datos;
    const [result] = await pool.query(
      `UPDATE Comunicado
          SET Titulo = ?, Categoria = ?, Prioridad = ?, DirigidoA = ?, Contenido = ?, FechaModificacion = CURRENT_TIMESTAMP
        WHERE IdComunicado = ? AND IdAcademia = ? AND EstadoRegistro = 1`,
      [titulo, categoria, prioridad, dirigidoA, contenido, idComunicado, idAcademia],
    );
    if (!result.affectedRows) {
      const actual = await consultarComunicado(idComunicado, idAcademia, idUsuario);
      if (!actual) return res.status(404).json({ error: 'Comunicado no encontrado o ya desactivado.' });
    }

    const comunicado = await consultarComunicado(idComunicado, idAcademia, idUsuario);
    res.json(comunicado || { id: idComunicado, message: 'Comunicado actualizado correctamente.' });
  } catch (error) {
    console.error('PUT /api/comunicados/:id:', error);
    res.status(500).json({ error: 'No se pudo actualizar el comunicado.' });
  }
});

// DELETE /api/comunicados/:id — baja lógica para conservar histórico y lecturas.
router.delete('/comunicados/:id', requiereRol('Administrador'), async (req, res) => {
  const { idAcademia } = obtenerIdentidad(req);
  const idComunicado = idPositivo(req.params.id);
  if (!idAcademia || !idComunicado) return res.status(400).json({ error: 'La academia o el identificador del comunicado no son válidos.' });

  try {
    const [result] = await pool.query(
      `UPDATE Comunicado
          SET EstadoRegistro = 0, FechaModificacion = CURRENT_TIMESTAMP
        WHERE IdComunicado = ? AND IdAcademia = ? AND EstadoRegistro = 1`,
      [idComunicado, idAcademia],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Comunicado no encontrado o ya desactivado.' });
    res.json({ message: 'Comunicado desactivado correctamente.', id: idComunicado });
  } catch (error) {
    console.error('DELETE /api/comunicados/:id:', error);
    res.status(500).json({ error: 'No se pudo desactivar el comunicado.' });
  }
});

// PUT /api/comunicados/:id/lectura — registra una lectura por usuario y comunicado.
router.put('/comunicados/:id/lectura', async (req, res) => {
  const { idUsuario, idAcademia } = obtenerIdentidad(req);
  const idComunicado = idPositivo(req.params.id);
  if (!idUsuario || !idAcademia || !idComunicado) return res.status(400).json({ error: 'No se pudo identificar el usuario, la academia o el comunicado.' });

  try {
    const comunicado = await consultarComunicado(idComunicado, idAcademia, idUsuario);
    if (!comunicado) return res.status(404).json({ error: 'Comunicado no encontrado o no disponible en esta academia.' });

    await pool.query(
      `INSERT INTO Comunicado_Lectura (IdComunicado, IdUsuario, FechaLectura, EstadoRegistro)
       VALUES (?, ?, CURRENT_TIMESTAMP, 1)
       ON DUPLICATE KEY UPDATE FechaLectura = CURRENT_TIMESTAMP, EstadoRegistro = 1`,
      [idComunicado, idUsuario],
    );
    res.json({ message: 'Lectura confirmada correctamente.', id: idComunicado, confirmado: true });
  } catch (error) {
    console.error('PUT /api/comunicados/:id/lectura:', error);
    res.status(500).json({ error: 'No se pudo confirmar la lectura del comunicado.' });
  }
});

module.exports = router;
