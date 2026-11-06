const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const requiereRol = require('../middlewares/roles.middleware');

const universidadDesdeNombre = (nombre = '') => {
  const n = String(nombre).toLowerCase();
  if (n.includes('san marcos') || n.includes('unmsm')) return 'UNMSM';
  if (/\buni\b/.test(n) || n.includes('ingenier')) return 'UNI';
  if (n.includes('católica') || n.includes('catolica') || n.includes('pucp')) return 'PUCP';
  if (n.includes('villarreal') || n.includes('unfv')) return 'UNFV';
  if (n.includes('unt') || n.includes('trujillo')) return 'UNT';
  if (n.includes('callao') || n.includes('unac')) return 'UNAC';
  return 'Preuniversitario';
};

router.use(requiereRol('Alumno', 'Estudiante'));


const { idPositivo, rollbackSeguro } = require('../utils/validaciones');
const {
  normalizarReferenciaPago,
  normalizarUrlComprobante,
  esEstadoPago,
} = require('../utils/pagos');

const idUsuarioSesion = (req) => idPositivo(req.usuario?.idUsuario ?? req.usuario?.id);
const idAcademiaSesion = (req) => idPositivo(req.usuario?.idAcademia);

async function auditarAccionPago(connection, datos) {
  await connection.query(
    `INSERT INTO PagoAuditoria
      (IdPago, IdComprobante, IdUsuarioActor, IdAcademia, Evento,
       EstadoAnterior, EstadoNuevo, MontoAnterior, MontoNuevo, Motivo, FechaCreacion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      datos.idPago,
      datos.idComprobante ?? null,
      datos.idUsuarioActor,
      datos.idAcademia,
      datos.evento,
      datos.estadoAnterior ?? null,
      datos.estadoNuevo ?? null,
      datos.montoAnterior ?? null,
      datos.montoNuevo ?? null,
      datos.motivo ?? null,
    ],
  );
}

// GET /api/alumno/pagos — solo cuotas del alumno autenticado.
router.get('/pagos', async (req, res) => {
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  if (!idUsuario || !idAcademia) {
    return res.status(401).json({ error: 'No fue posible identificar al alumno autenticado.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT p.IdPago, p.IdUsuario, p.IdCiclo, c.Nombre AS Ciclo,
              p.Mes, p.Monto, p.Estado, p.FechaPago, p.FechaVencimiento,
              pc.IdComprobante, pc.Referencia AS ReferenciaComprobante,
              pc.UrlComprobante, pc.EstadoRevision AS EstadoRevisionComprobante,
              pc.MotivoRevision, pc.FechaCreacion AS FechaSolicitudComprobante,
              pc.FechaRevision
       FROM PagosMensualidad p
       INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
       INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
       LEFT JOIN PagoComprobante pc ON pc.IdComprobante = (
         SELECT MAX(pc2.IdComprobante)
         FROM PagoComprobante pc2
         WHERE pc2.IdPago = p.IdPago AND pc2.IdUsuario = p.IdUsuario
           AND pc2.IdAcademia = u.IdAcademia AND pc2.EstadoRegistro = 1
       )
       WHERE p.IdUsuario = ? AND u.IdUsuario = ? AND u.IdAcademia = ?
         AND c.IdAcademia = ? AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
       ORDER BY p.IdCiclo DESC, p.Mes DESC, p.IdPago DESC`,
      [idUsuario, idUsuario, idAcademia, idAcademia],
    );

    const cuotas = rows.map((row) => ({
      idPago: Number(row.IdPago),
      idCiclo: Number(row.IdCiclo),
      ciclo: row.Ciclo,
      concepto: String(row.Mes || '').trim().toLowerCase() === 'inscripcion' ? 'Inscripción' : 'Mensualidad',
      periodo: row.Mes,
      monto: Number(row.Monto || 0),
      estado: row.Estado || 'Pendiente',
      fechaPago: row.FechaPago,
      fechaVencimiento: row.FechaVencimiento,
      comprobante: row.IdComprobante ? {
        idComprobante: Number(row.IdComprobante),
        referencia: row.ReferenciaComprobante,
        url: row.UrlComprobante,
        estado: row.EstadoRevisionComprobante,
        motivoRevision: row.MotivoRevision,
        fechaEnvio: row.FechaSolicitudComprobante,
        fechaRevision: row.FechaRevision,
      } : null,
    }));

    const totalPagado = cuotas.filter((c) => esEstadoPago(c.estado, 'Pagado')).reduce((sum, c) => sum + c.monto, 0);
    const pendientes = cuotas.filter((c) => !esEstadoPago(c.estado, 'Pagado'));
    res.json({
      cuotas,
      resumen: {
        cantidad: cuotas.length,
        pagadas: cuotas.filter((c) => esEstadoPago(c.estado, 'Pagado')).length,
        pendientes: pendientes.length,
        montoPagado: Number(totalPagado.toFixed(2)),
        montoPendiente: Number(pendientes.reduce((sum, c) => sum + c.monto, 0).toFixed(2)),
      },
    });
  } catch (error) {
    console.error('Error en GET /api/alumno/pagos:', error?.name || 'Error');
    res.status(500).json({ error: 'No se pudieron consultar tus pagos.' });
  }
});

// POST /api/alumno/pagos/:idPago/iniciar — devuelve instrucciones; no cobra ni marca Pagado.
router.post('/pagos/:idPago/iniciar', async (req, res) => {
  const idPago = idPositivo(req.params.idPago);
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  if (!idPago) return res.status(400).json({ error: 'El IdPago no es válido.' });
  if (!idUsuario || !idAcademia) return res.status(401).json({ error: 'La sesión del alumno no es válida.' });

  try {
    const [rows] = await pool.query(
      `SELECT p.IdPago, p.IdCiclo, p.Mes, p.Monto, p.Estado, p.FechaVencimiento,
              c.Nombre AS Ciclo
       FROM PagosMensualidad p
       INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
       INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
       WHERE p.IdPago = ? AND p.IdUsuario = ? AND u.IdAcademia = ?
         AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
       LIMIT 1`,
      [idPago, idUsuario, idAcademia],
    );
    if (!rows.length) return res.status(404).json({ error: 'La cuota no existe en tu cuenta.' });
    const pago = rows[0];
    if (esEstadoPago(pago.Estado, 'Pagado')) {
      return res.status(409).json({ error: 'Esta cuota ya está pagada.', estado: 'Pagado' });
    }
    const [comprobantes] = await pool.query(
      `SELECT IdComprobante, EstadoRevision
       FROM PagoComprobante
       WHERE IdPago = ? AND IdUsuario = ? AND IdAcademia = ?
         AND EstadoRegistro = 1 AND EstadoRevision = 'EN_REVISION'
       ORDER BY IdComprobante DESC LIMIT 1`,
      [idPago, idUsuario, idAcademia],
    );
    // Estos datos de entorno solo pueden usarse para la academia explícitamente configurada.
    // En una instalación multiacademia, cada academia debe tener su propia configuración; nunca
    // mostrar la cuenta de una academia a estudiantes de otra.
    const academiaConfiguradaParaPago = idPositivo(process.env.PAYMENT_ACADEMY_ID);
    const permiteMostrarDatosBancarios = academiaConfiguradaParaPago === idAcademia;
    const configuracionPago = {
      entidad: permiteMostrarDatosBancarios ? (process.env.PAYMENT_BANK_NAME || null) : null,
      titular: permiteMostrarDatosBancarios ? (process.env.PAYMENT_ACCOUNT_HOLDER || null) : null,
      cuenta: permiteMostrarDatosBancarios ? (process.env.PAYMENT_ACCOUNT_NUMBER || null) : null,
      cci: permiteMostrarDatosBancarios ? (process.env.PAYMENT_CCI || null) : null,
      instrucciones: permiteMostrarDatosBancarios
        ? (process.env.PAYMENT_INSTRUCTIONS || 'Realiza la transferencia solo a la cuenta oficial de la academia.')
        : 'Solicita a la administración los datos oficiales de transferencia de tu academia antes de enviar dinero.',
    };
    const instruccionesDisponibles = Boolean(permiteMostrarDatosBancarios && configuracionPago.entidad && configuracionPago.titular && (configuracionPago.cuenta || configuracionPago.cci));
    return res.json({
      idPago: Number(pago.IdPago),
      ciclo: pago.Ciclo,
      concepto: String(pago.Mes || '').trim().toLowerCase() === 'inscripcion' ? 'Inscripción' : 'Mensualidad',
      periodo: pago.Mes,
      monto: Number(pago.Monto || 0),
      estado: pago.Estado || 'Pendiente',
      fechaVencimiento: pago.FechaVencimiento,
      modo: 'transferencia_manual',
      cobroProcesado: false,
      comprobanteEnRevision: Boolean(comprobantes.length),
      instruccionesDisponibles,
      instrucciones: configuracionPago,
      mensaje: comprobantes.length
        ? 'Ya existe un comprobante en revisión para esta cuota.'
        : instruccionesDisponibles
          ? 'Realiza la transferencia fuera de AcadeSys y luego registra la referencia. La cuota seguirá pendiente hasta la aprobación administrativa.'
          : 'El sistema no tiene configurados los datos de transferencia. Contacta a la administración; no se realizó ningún cobro.',
    });
  } catch (error) {
    console.error('Error en POST /api/alumno/pagos/:idPago/iniciar:', error?.name || 'Error');
    res.status(500).json({ error: 'No se pudo iniciar la solicitud de pago.' });
  }
});

// POST /api/alumno/pagos/:idPago/comprobante — presenta la referencia para revisión.
router.post('/pagos/:idPago/comprobante', async (req, res) => {
  const idPago = idPositivo(req.params.idPago);
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  const referencia = normalizarReferenciaPago(req.body?.referencia ?? req.body?.Referencia);
  const urlResultado = normalizarUrlComprobante(req.body?.urlComprobante ?? req.body?.UrlComprobante);

  if (!idPago) return res.status(400).json({ error: 'El IdPago no es válido.' });
  if (!idUsuario || !idAcademia) return res.status(401).json({ error: 'La sesión del alumno no es válida.' });
  if (!referencia) return res.status(400).json({ error: 'La referencia debe tener entre 4 y 120 caracteres válidos.' });
  if (!urlResultado.valida) return res.status(400).json({ error: 'El comprobante debe ser una ruta local válida de /uploads/comprobantes/.' });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT p.IdPago, p.IdUsuario, p.IdCiclo, p.Estado, p.Monto, u.IdAcademia
       FROM PagosMensualidad p
       INNER JOIN Usuario u ON u.IdUsuario = p.IdUsuario
       INNER JOIN Ciclo c ON c.IdCiclo = p.IdCiclo AND c.IdAcademia = u.IdAcademia
       WHERE p.IdPago = ? AND p.IdUsuario = ? AND u.IdAcademia = ?
         AND p.EstadoRegistro = 1 AND u.EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [idPago, idUsuario, idAcademia],
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'La cuota no existe en tu cuenta.' });
    }
    const pago = rows[0];
    if (esEstadoPago(pago.Estado, 'Pagado')) {
      await connection.rollback();
      return res.status(409).json({ error: 'No puedes registrar un comprobante para una cuota ya pagada.' });
    }

    const [duplicados] = await connection.query(
      `SELECT IdComprobante FROM PagoComprobante
       WHERE IdPago = ? AND IdUsuario = ? AND IdAcademia = ? AND Referencia = ? AND EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [idPago, idUsuario, idAcademia, referencia],
    );
    if (duplicados.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'Esta referencia ya fue registrada para la cuota.' });
    }

    const [pendientes] = await connection.query(
      `SELECT IdComprobante FROM PagoComprobante
       WHERE IdPago = ? AND IdUsuario = ? AND IdAcademia = ?
         AND EstadoRevision = 'EN_REVISION' AND EstadoRegistro = 1
       LIMIT 1 FOR UPDATE`,
      [idPago, idUsuario, idAcademia],
    );
    if (pendientes.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'Ya existe un comprobante en revisión para esta cuota.' });
    }

    const [insertado] = await connection.query(
      `INSERT INTO PagoComprobante
        (IdPago, IdUsuario, IdAcademia, Referencia, UrlComprobante,
         EstadoRevision, MotivoRevision, FechaCreacion, EstadoRegistro)
       VALUES (?, ?, ?, ?, ?, 'EN_REVISION', NULL, NOW(), 1)`,
      [idPago, idUsuario, idAcademia, referencia, urlResultado.valor],
    );
    await auditarAccionPago(connection, {
      idPago,
      idComprobante: insertado.insertId,
      idUsuarioActor: idUsuario,
      idAcademia,
      evento: 'COMPROBANTE_ENVIADO',
      estadoAnterior: pago.Estado,
      estadoNuevo: pago.Estado,
      montoAnterior: Number(pago.Monto),
      montoNuevo: Number(pago.Monto),
      motivo: 'El alumno presentó una referencia para revisión administrativa.',
    });
    await connection.commit();
    return res.status(201).json({
      exito: true,
      idComprobante: insertado.insertId,
      idPago,
      estadoComprobante: 'EN_REVISION',
      estadoPago: pago.Estado || 'Pendiente',
      mensaje: 'Comprobante recibido. El pago sigue pendiente hasta que la administración lo revise.',
    });
  } catch (error) {
    await rollbackSeguro(connection);
    console.error('Error en POST /api/alumno/pagos/:idPago/comprobante:', error?.name || 'Error');
    return res.status(500).json({ error: 'No se pudo registrar el comprobante.' });
  } finally {
    if (connection) connection.release();
  }
});

router.get('/me', async (req, res) => {
  try {
    const idUsuario = req.usuario?.idUsuario || req.usuario?.id;
    const idAcademia = req.usuario?.idAcademia;

    if (!idUsuario || !idAcademia) {
      return res.status(401).json({ error: 'No fue posible identificar al alumno autenticado.' });
    }

    const [usuarios] = await pool.query(`
      SELECT
        u.IdUsuario,
        u.DNI,
        u.Nombres,
        u.ApellidoPaterno,
        u.ApellidoMaterno,
        CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno) AS NombreCompleto,
        u.CorreoElectronico,
        u.CodigoUsuario
      FROM Usuario u
      WHERE u.IdUsuario = ? AND u.IdAcademia = ? AND u.EstadoRegistro = 1
      LIMIT 1
    `, [idUsuario, idAcademia]);

    if (usuarios.length === 0) {
      return res.status(404).json({ error: 'Alumno no encontrado.' });
    }

    const usuario = usuarios[0];

    const [matriculas] = await pool.query(`
      SELECT
        m.IdMatricula,
        c.IdCiclo,
        c.Nombre AS Ciclo,
        c.Turno,
        COALESCE(NULLIF(TRIM(c.Horario), ''), CASE
          WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%mañana%' OR LOWER(COALESCE(c.Turno, '')) LIKE '%manana%' THEN '08:00 - 13:00'
          WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%tarde%' THEN '14:00 - 19:00'
          WHEN LOWER(COALESCE(c.Turno, '')) LIKE '%noche%' THEN '18:00 - 22:00'
          ELSE '08:00 - 13:00'
        END) AS Horario,
        COALESCE(NULLIF(TRIM(c.DiasClase), ''), 'Lunes a Sábado') AS DiasClase,
        COALESCE(NULLIF(TRIM(c.UniversidadObjetivo), ''), 'Preuniversitario') AS UniversidadObjetivo,
        c.FechaInicio,
        c.FechaFin,
        (
          SELECT COUNT(*)
          FROM Matricula m2
          WHERE m2.IdCiclo = c.IdCiclo AND m2.EstadoRegistro = 1
        ) AS TotalAlumnos
      FROM Matricula m
      INNER JOIN Ciclo c ON c.IdCiclo = m.IdCiclo
      WHERE m.IdUsuario = ?
        AND m.EstadoRegistro = 1
         AND c.EstadoRegistro = 1
         AND c.IdAcademia = ?
      ORDER BY m.IdMatricula DESC
      LIMIT 1
    `, [idUsuario, idAcademia]);

    let ciclo = null;
    let matriculaId = null;

    if (matriculas.length > 0) {
      const m = matriculas[0];
      matriculaId = m.IdMatricula;
      ciclo = {
        idCiclo: m.IdCiclo,
        nombre: m.Ciclo,
        turno: m.Turno || '',
        horario: m.Horario || '',
        diasClase: m.DiasClase || '',
        universidadObjetivo: (!m.UniversidadObjetivo || m.UniversidadObjetivo === 'Preuniversitario') ? universidadDesdeNombre(m.Ciclo) : m.UniversidadObjetivo,
        fechaInicio: m.FechaInicio,
        fechaFin: m.FechaFin,
        totalAlumnos: Number(m.TotalAlumnos || 0)
      };
    }

    if (!ciclo) {
      return res.json({
        usuario: {
          idUsuario: usuario.IdUsuario,
          dni: usuario.DNI,
          nombres: usuario.Nombres,
          apellidoPaterno: usuario.ApellidoPaterno,
          apellidoMaterno: usuario.ApellidoMaterno,
          nombreCompleto: usuario.NombreCompleto,
          correo: usuario.CorreoElectronico,
          codigoUsuario: usuario.CodigoUsuario
        },
        ciclo: null,
        cursos: [],
        horarioDetalle: [],
        notas: {
          promedioGeneral: 0,
          puestoRanking: null,
          totalEvaluaciones: 0,
          historial: []
        },
        materiales: []
      });
    }

    const [cursos] = await pool.query(`
      SELECT
        cu.IdCurso,
        cu.Nombre, cu.Codigo, cu.Descripcion, cu.UniversidadObjetivo,
        COALESCE((SELECT GROUP_CONCAT(DISTINCT TRIM(CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno)) SEPARATOR ', ')
          FROM Asignacion_Aula aa INNER JOIN Usuario u ON u.IdUsuario = aa.IdUsuario
          WHERE aa.IdCiclo = cc.IdCiclo AND aa.IdCurso = cc.IdCurso AND aa.IdAcademia = ?
            AND aa.EstadoRegistro = 1 AND u.EstadoRegistro = 1 AND u.IdAcademia = aa.IdAcademia), 'Por asignar') AS Docente
      FROM CicloCurso cc
      INNER JOIN Curso cu ON cu.IdCurso = cc.IdCurso
      WHERE cc.IdCiclo = ?
        AND cc.EstadoRegistro = 1
        AND cu.EstadoRegistro = 1
      ORDER BY cc.Orden ASC, cu.Nombre ASC
    `, [idAcademia, ciclo.idCiclo]);

    const [horarioDetalle] = await pool.query(`
      SELECT
        h.IdHorario,
        h.DiaSemana,
        TIME_FORMAT(h.HoraInicio, '%H:%i') AS HoraInicio,
        TIME_FORMAT(h.HoraFin, '%H:%i') AS HoraFin,
        cu.Nombre AS Curso,
        COALESCE((SELECT GROUP_CONCAT(DISTINCT TRIM(CONCAT_WS(' ', u.Nombres, u.ApellidoPaterno, u.ApellidoMaterno)) SEPARATOR ', ')
          FROM Asignacion_Aula aa INNER JOIN Usuario u ON u.IdUsuario = aa.IdUsuario
          WHERE aa.IdCiclo = h.IdCiclo AND aa.IdCurso = h.IdCurso AND aa.IdAcademia = ?
            AND aa.EstadoRegistro = 1 AND u.EstadoRegistro = 1 AND u.IdAcademia = aa.IdAcademia), 'Por asignar') AS Docente
      FROM HorarioCurso h
      INNER JOIN Curso cu ON cu.IdCurso = h.IdCurso
      WHERE h.IdCiclo = ?
        AND h.EstadoRegistro = 1
      ORDER BY h.Orden ASC, h.DiaNumero ASC, h.HoraInicio ASC
    `, [idAcademia, ciclo.idCiclo]);

    const [notas] = await pool.query(`
      SELECT
        e.IdEvaluacion,
        COALESCE(cu.Nombre, 'Simulacro general') AS Curso,
        e.TipoEvaluacion,
        e.Calificacion,
        e.EstadoRegistro AS EstadoRegistro,
        e.FechaCreacion
      FROM Evaluacion e
      INNER JOIN Matricula m ON m.IdMatricula = e.IdMatricula
      LEFT JOIN Curso cu ON cu.IdCurso = m.IdCurso
      WHERE m.IdUsuario = ?
        AND m.IdCiclo = ?
        AND m.EstadoRegistro = 1
        AND e.EstadoRegistro IN (1, 2)
      ORDER BY e.FechaCreacion DESC, e.IdEvaluacion DESC
    `, [idUsuario, ciclo.idCiclo]);

    const promedioBruto = notas.length ? notas.reduce((sum, n) => sum + Number(n.Calificacion), 0) / notas.length : 0;
    const promedio = Number(promedioBruto.toFixed(2));

    let puestoRanking = null;
    if (notas.length > 0) {
      const [rankingRows] = await pool.query(`
        SELECT COUNT(*) + 1 AS Puesto
        FROM (
          SELECT
            m2.IdUsuario,
            AVG(e2.Calificacion) AS Promedio
          FROM Matricula m2
          INNER JOIN Evaluacion e2 ON e2.IdMatricula = m2.IdMatricula
          INNER JOIN Usuario u2 ON u2.IdUsuario = m2.IdUsuario AND u2.EstadoRegistro = 1
          WHERE m2.IdCiclo = ?
            AND m2.EstadoRegistro = 1
            AND e2.EstadoRegistro IN (1, 2)
            AND u2.IdAcademia = ? AND m2.IdUsuario <> ?
          GROUP BY m2.IdUsuario
          HAVING AVG(e2.Calificacion) > ?
        ) r
      `, [ciclo.idCiclo, idAcademia, idUsuario, promedioBruto]);

      puestoRanking = Number(rankingRows[0]?.Puesto || 1);
    }

    const [materiales] = await pool.query(`
      SELECT
        ma.IdMaterial,
        ma.Titulo,
        ma.Descripcion,
        ma.NombreArchivo,
        ma.UrlArchivo,
        ma.TipoMime,
        ma.FechaPublicacion,
        cu.Nombre AS Curso
      FROM MaterialAcademico ma
      INNER JOIN CicloCurso cc ON cc.IdCiclo = ma.IdCiclo AND cc.IdCurso = ma.IdCurso AND cc.EstadoRegistro = 1
      INNER JOIN Curso cu ON cu.IdCurso = ma.IdCurso
      WHERE ma.IdCiclo = ?
        AND ma.EstadoRegistro = 1
        AND cu.EstadoRegistro = 1
      ORDER BY ma.FechaPublicacion DESC, ma.IdMaterial DESC
    `, [ciclo.idCiclo]);

    res.json({
      usuario: {
        idUsuario: usuario.IdUsuario,
        dni: usuario.DNI,
        nombres: usuario.Nombres,
        apellidoPaterno: usuario.ApellidoPaterno,
        apellidoMaterno: usuario.ApellidoMaterno,
        nombreCompleto: usuario.NombreCompleto,
        correo: usuario.CorreoElectronico,
        codigoUsuario: usuario.CodigoUsuario
      },
      matricula: { idMatricula: matriculaId },
      ciclo,
      cursos: cursos.map((c) => ({
        idCurso: c.IdCurso,
        nombre: c.Nombre,
        codigo: c.Codigo || '',
        descripcion: c.Descripcion || '',
        docente: c.Docente,
        universidadObjetivo: c.UniversidadObjetivo || ciclo.universidadObjetivo
      })),
      horarioDetalle: horarioDetalle.map((h) => ({
        idHorario: h.IdHorario,
        diaSemana: h.DiaSemana,
        horaInicio: h.HoraInicio,
        horaFin: h.HoraFin,
        curso: h.Curso,
        docente: h.Docente
      })),
      notas: {
        promedioGeneral: promedio,
        puestoRanking,
        totalEvaluaciones: notas.length,
        historial: notas.map((n) => ({
          idEvaluacion: n.IdEvaluacion,
          curso: n.Curso,
          tipoEvaluacion: n.TipoEvaluacion,
          calificacion: Number(n.Calificacion || 0),
          estadoRegistro: Number(n.EstadoRegistro),
          fechaCreacion: n.FechaCreacion
        }))
      },
      materiales: materiales.map((m) => ({
        idMaterial: m.IdMaterial,
        titulo: m.Titulo,
        descripcion: m.Descripcion,
        nombreArchivo: m.NombreArchivo,
        urlArchivo: m.UrlArchivo,
        tipoMime: m.TipoMime,
        fechaPublicacion: m.FechaPublicacion,
        curso: m.Curso
      }))
    });
  } catch (error) {
    console.error('Error en GET /api/alumno/me:', error.message);
    res.status(500).json({ error: 'No se pudo cargar el expediente del alumno.' });
  }
});

module.exports = router;
