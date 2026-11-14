'use strict';

const express = require('express');
const router = express.Router();
const requiereRol = require('../middlewares/roles.middleware');
const { idPositivo } = require('../utils/validaciones');
const { ErrorPago } = require('../utils/pagos-proveedor');
const pasarela = require('../services/mercadopago.adapter');
const {
  reservarCheckoutAlumno,
  guardarOrdenCreada,
  marcarErrorCreacion,
  obtenerEstadoPagoAlumno,
  obtenerReferenciaConciliable,
} = require('../services/transacciones-pago.service');
const conciliacion = require('../services/conciliacion-pagos.service');

const idUsuarioSesion = (req) => idPositivo(req.usuario?.idUsuario ?? req.usuario?.id);
const idAcademiaSesion = (req) => idPositivo(req.usuario?.idAcademia);

router.use(requiereRol('Alumno', 'Estudiante'));

// POST /api/alumno/pagos/:idPago/checkout
// Solo crea/reutiliza el checkout. Jamás marca una cuota como Pagado.
router.post('/pagos/:idPago/checkout', async (req, res) => {
  const idPago = idPositivo(req.params.idPago);
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  if (!idPago) return res.status(400).json({ error: 'El IdPago no es válido.' });
  if (!idUsuario || !idAcademia) return res.status(401).json({ error: 'La sesión del alumno no es válida.' });

  let reserva;
  try {
    pasarela.verificarConfiguracion();
    reserva = await reservarCheckoutAlumno({ idPago, idUsuario, idAcademia });
    if (reserva.reutilizada && reserva.checkoutUrl) {
      return res.status(200).json({
        exito: true,
        reutilizada: true,
        idPago,
        idTransaccion: reserva.idTransaccion,
        estado: reserva.estado,
        monto: reserva.monto,
        moneda: reserva.moneda,
        checkoutUrl: reserva.checkoutUrl,
        mensaje: 'Se reutilizó el checkout pendiente de esta cuota.',
      });
    }
    if (reserva.enPreparacion) {
      return res.status(409).json({
        code: 'CHECKOUT_EN_PREPARACION',
        idTransaccion: reserva.idTransaccion,
        error: 'Ya se está preparando un checkout para esta cuota. Actualiza la pantalla en unos segundos.',
      });
    }

    const orden = await pasarela.crearOrdenPago({
      idTransaccion: reserva.idTransaccion,
      referenciaInterna: reserva.referenciaInterna,
      idempotencyKey: reserva.idempotencyKey,
      monto: reserva.monto,
      moneda: reserva.moneda,
      concepto: reserva.concepto,
      ciclo: reserva.ciclo,
      alumno: reserva.alumno,
      payerEmail: reserva.emailAlumno,
      notificationUrl: process.env.MERCADOPAGO_WEBHOOK_URL || null,
      returnUrl: process.env.PAYMENT_RETURN_URL || null,
    });

    const guardada = await guardarOrdenCreada({
      idTransaccion: reserva.idTransaccion,
      idOrdenProveedor: orden?.idOrdenProveedor,
      checkoutUrl: orden?.checkoutUrl,
      estadoProveedor: orden?.estado || 'pending',
    });

    return res.status(201).json({
      exito: true,
      reutilizada: false,
      idPago,
      idTransaccion: reserva.idTransaccion,
      estado: guardada.Estado,
      monto: reserva.monto,
      moneda: reserva.moneda,
      checkoutUrl: guardada.UrlCheckout,
      mensaje: 'Checkout creado. La cuota seguirá pendiente hasta recibir una confirmación verificada.',
    });
  } catch (error) {
    // Solo liberar la reserva cuando el adaptador garantiza que NO creó una
    // orden. Ante timeout/red ambigua se conserva CREANDO para evitar cobrar
    // dos veces al reintentar con una nueva clave idempotente.
    if (reserva?.idTransaccion && error?.safeToMarkError === true) {
      try { await marcarErrorCreacion(reserva.idTransaccion); } catch { /* conservar error original */ }
    }
    const conocido = error instanceof ErrorPago;
    const status = conocido ? error.status : 500;
    if (status >= 500) console.error('Error al crear checkout de alumno:', conocido ? error.code : 'CHECKOUT_NO_DISPONIBLE');
    return res.status(status).json({
      code: conocido ? error.code : 'CHECKOUT_NO_DISPONIBLE',
      error: status === 503
        ? 'El pago online todavía no está disponible. Puedes usar el medio manual habilitado por la academia.'
        : (conocido ? error.message : 'No se pudo iniciar el checkout.'),
    });
  }
});

// GET /api/alumno/pagos/:idPago/estado
// Devuelve el estado interno. Nunca consulta ni modifica un estado enviado por React.
router.get('/pagos/:idPago/estado', async (req, res) => {
  try {
    const data = await obtenerEstadoPagoAlumno({
      idPago: req.params.idPago,
      idUsuario: idUsuarioSesion(req),
      idAcademia: idAcademiaSesion(req),
    });
    return res.json(data);
  } catch (error) {
    const conocido = error instanceof ErrorPago;
    const status = conocido ? error.status : 500;
    if (status >= 500) console.error('Error al consultar estado de checkout:', conocido ? error.code : 'ESTADO_PAGO_NO_DISPONIBLE');
    return res.status(status).json({ code: conocido ? error.code : 'ESTADO_PAGO_NO_DISPONIBLE',
      error: conocido ? error.message : 'No se pudo consultar el estado del pago.' });
  }
});

// POST /api/alumno/pagos/:idPago/conciliar
// «Consultar estado del pago»: si el webhook no llegó, busca la operación en
// Mercado Pago y la aplica con la misma verificación que el webhook. Nunca usa
// datos enviados por React ni los parámetros de la URL de retorno.
router.post('/pagos/:idPago/conciliar', async (req, res) => {
  const idPago = idPositivo(req.params.idPago);
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  if (!idPago) return res.status(400).json({ error: 'El IdPago no es válido.' });
  if (!idUsuario || !idAcademia) return res.status(401).json({ error: 'La sesión del alumno no es válida.' });
  try {
    pasarela.verificarConfiguracion();
    const referencia = await obtenerReferenciaConciliable({ idPago, idUsuario, idAcademia });
    let resumen = { consultado: false, motivo: 'SIN_CHECKOUT' };
    if (referencia && ['PENDIENTE', 'RECHAZADA', 'CANCELADA', 'EXPIRADA', 'CREANDO'].includes(referencia.estado)) {
      if (conciliacion.puedeConciliar(referencia.referenciaInterna)) {
        const r = await conciliacion.conciliarReferencia(referencia.referenciaInterna);
        resumen = { consultado: true, pagosEncontrados: r.pagosEncontrados, confirmada: r.confirmada };
      } else {
        resumen = { consultado: false, motivo: 'CONSULTA_RECIENTE' };
      }
    } else if (referencia) {
      resumen = { consultado: false, motivo: 'ESTADO_FINAL' };
    }
    const estado = await obtenerEstadoPagoAlumno({ idPago, idUsuario, idAcademia });
    return res.json({ ...estado, conciliacion: resumen });
  } catch (error) {
    const conocido = error instanceof ErrorPago;
    const status = conocido ? error.status : 500;
    if (status >= 500) console.error('Error al conciliar pago de alumno:', conocido ? error.code : 'CONCILIACION_NO_DISPONIBLE');
    return res.status(status).json({ code: conocido ? error.code : 'CONCILIACION_NO_DISPONIBLE',
      error: status >= 500 ? 'No se pudo consultar Mercado Pago en este momento. Inténtalo en unos minutos.'
        : (conocido ? error.message : 'No se pudo consultar el estado del pago.') });
  }
});

module.exports = router;
