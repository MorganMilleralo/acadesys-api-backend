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
const { consultar, ejecutar } = require('../config/procedimientos');
const { enviarArchivoBoleta, formatoSolicitado, boletaPublica } = require('../utils/boleta-archivo');
const {
  normalizarReferenciaPago,
  normalizarUrlComprobante,
  esEstadoPago,
} = require('../utils/pagos');

const idUsuarioSesion = (req) => idPositivo(req.usuario?.idUsuario ?? req.usuario?.id);
const idAcademiaSesion = (req) => idPositivo(req.usuario?.idAcademia);

async function auditarAccionPago(connection, datos) {
  await ejecutar(connection, 'sp_alumno_registrar_auditoria_pago', [
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
    ]);
}

// GET /api/alumno/pagos — solo cuotas del alumno autenticado.
router.get('/pagos', async (req, res) => {
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  if (!idUsuario || !idAcademia) {
    return res.status(401).json({ error: 'No fue posible identificar al alumno autenticado.' });
  }

  try {
    const [rows] = await consultar(pool, 'sp_alumno_listar_cuota', [idUsuario, idAcademia]);

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
    const [rows] = await consultar(pool, 'sp_alumno_obtener_cuota', [idPago, idUsuario, idAcademia]);
    if (!rows.length) return res.status(404).json({ error: 'La cuota no existe en tu cuenta.' });
    const pago = rows[0];
    if (esEstadoPago(pago.Estado, 'Pagado')) {
      return res.status(409).json({ error: 'Esta cuota ya está pagada.', estado: 'Pagado' });
    }
    const [comprobantes] = await consultar(pool, 'sp_alumno_obtener_comprobante', [idPago, idUsuario, idAcademia]);
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
    const [rows] = await consultar(connection, 'sp_alumno_bloquear_cuota', [idPago, idUsuario, idAcademia]);
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'La cuota no existe en tu cuenta.' });
    }
    const pago = rows[0];
    if (esEstadoPago(pago.Estado, 'Pagado')) {
      await connection.rollback();
      return res.status(409).json({ error: 'No puedes registrar un comprobante para una cuota ya pagada.' });
    }

    const [duplicados] = await consultar(connection, 'sp_alumno_bloquear_comprobante_por_id_pago', [idPago, idUsuario, idAcademia, referencia]);
    if (duplicados.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'Esta referencia ya fue registrada para la cuota.' });
    }

    const [pendientes] = await consultar(connection, 'sp_alumno_bloquear_comprobante_por_id_pago_y_id_usuario', [idPago, idUsuario, idAcademia]);
    if (pendientes.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'Ya existe un comprobante en revisión para esta cuota.' });
    }

    // No se registra una transferencia mientras la misma cuota tiene un pago
    // online en proceso: así se evita el doble pago.
    const [enProceso] = await consultar(connection, 'sp_alumno_bloquear_transaccion', [idPago, idUsuario, idAcademia]);
    if (enProceso.length) {
      await connection.rollback();
      return res.status(409).json({
        code: 'PAGO_ONLINE_EN_PROCESO',
        error: 'Tienes un pago online en proceso para esta cuota. Espera su confirmación antes de registrar una transferencia.',
      });
    }

    const [insertado] = await ejecutar(connection, 'sp_alumno_registrar_comprobante', [idPago, idUsuario, idAcademia, referencia, urlResultado.valor]);
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

// GET /api/alumno/boletas — boletas electrónicas de las cuotas del alumno.
router.get('/boletas', async (req, res) => {
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  if (!idUsuario || !idAcademia) return res.status(401).json({ error: 'La sesión del alumno no es válida.' });
  try {
    const [rows] = await consultar(pool, 'sp_boletas_listar_alumno', [idUsuario, idAcademia]);
    res.json({ boletas: rows.map(boletaPublica) });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_SP_DOES_NOT_EXIST') return res.json({ boletas: [] });
    console.error('Error en GET /api/alumno/boletas:', error?.code || error?.name || 'Error');
    res.status(500).json({ error: 'No se pudieron cargar las boletas.' });
  }
});

// GET /api/alumno/pagos/:idPago/boleta?formato=pdf|xml — descarga la boleta propia.
router.get('/pagos/:idPago/boleta', async (req, res) => {
  const idPago = idPositivo(req.params.idPago);
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  if (!idPago) return res.status(400).json({ error: 'El IdPago no es válido.' });
  if (!idUsuario || !idAcademia) return res.status(401).json({ error: 'La sesión del alumno no es válida.' });
  try {
    const [rows] = await consultar(pool, 'sp_boletas_obtener_archivo_alumno', [idPago, idUsuario, idAcademia]);
    return enviarArchivoBoleta(res, rows[0], formatoSolicitado(req));
  } catch (error) {
    console.error('Error en GET /api/alumno/pagos/:idPago/boleta:', error?.code || error?.name || 'Error');
    res.status(500).json({ error: 'No se pudo descargar la boleta.' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const idUsuario = req.usuario?.idUsuario || req.usuario?.id;
    const idAcademia = req.usuario?.idAcademia;

    if (!idUsuario || !idAcademia) {
      return res.status(401).json({ error: 'No fue posible identificar al alumno autenticado.' });
    }

    const [usuarios] = await consultar(pool, 'sp_alumno_obtener_usuario', [idUsuario, idAcademia]);

    if (usuarios.length === 0) {
      return res.status(404).json({ error: 'Alumno no encontrado.' });
    }

    const usuario = usuarios[0];

    const [matriculas] = await consultar(pool, 'sp_alumno_obtener_matricula', [idUsuario, idAcademia]);

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

    const [cursos] = await consultar(pool, 'sp_alumno_listar_ciclo_curso', [idAcademia, ciclo.idCiclo]);

    const [horarioDetalle] = await consultar(pool, 'sp_alumno_listar_horario', [idAcademia, ciclo.idCiclo]);

    const [notas] = await consultar(pool, 'sp_alumno_listar_evaluacion', [idUsuario, ciclo.idCiclo]);

    const promedioBruto = notas.length ? notas.reduce((sum, n) => sum + Number(n.Calificacion), 0) / notas.length : 0;
    const promedio = Number(promedioBruto.toFixed(2));

    let puestoRanking = null;
    if (notas.length > 0) {
      const [rankingRows] = await consultar(pool, 'sp_alumno_listar_matricula', [ciclo.idCiclo, idAcademia, idUsuario, promedioBruto]);

      puestoRanking = Number(rankingRows[0]?.Puesto || 1);
    }

    const [materiales] = await consultar(pool, 'sp_alumno_listar_material', [ciclo.idCiclo]);

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
