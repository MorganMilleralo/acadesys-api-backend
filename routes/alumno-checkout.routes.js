"use strict";

const express = require('express');
const router = express.Router();
const requiereRol = require('../middlewares/roles.middleware');
const { idPositivo } = require('../utils/validaciones');
const { ErrorPago } = require('../utils/pagos-proveedor');
const mercadopago = require('../services/mercadopago.adapter');
const transacciones = require('../services/transacciones-pago.service');
const conciliacion = require('../services/conciliacion-pagos.service');
const { obtenerConfiguracionPagos } = require('../config/pagos');

const idUsuarioSesion = (req) => idPositivo(req.usuario?.idUsuario ?? req.usuario?.id);
const idAcademiaSesion = (req) => idPositivo(req.usuario?.idAcademia);
router.use(requiereRol('Alumno', 'Estudiante'));

function responderError(res, error, contexto) {
  const conocido = error instanceof ErrorPago;
  const status = conocido ? error.status : 500;
  if (status >= 500) {
    console.error(`${contexto}:`, conocido ? conocido.code : (error?.name || 'ERROR'));
  }
  return res.status(status).json({
    code: conocido ? error.code : 'MERCADOPAGO_CHECKOUT_NO_DISPONIBLE',
    error: conocido ? error.message : 'No se pudo completar la operación de pago. Inténtalo nuevamente.',
  });
}

function respuestaCheckout(res, reserva, statusCode = 201) {
  return res.status(statusCode).json({
    exito: true,
    proveedor: obtenerConfiguracionPagos().provider,
    idPago: Number(reserva.idPago),
    idTransaccion: Number(reserva.idTransaccion),
    orderId: reserva.idOrdenProveedor,
    checkoutUrl: reserva.checkoutUrl,
    amount: Number(reserva.monto),
    currency: reserva.moneda,
    estado: reserva.estado || 'PENDIENTE',
    reutilizada: Boolean(reserva.reutilizada),
    mensaje: 'Checkout creado. La cuota seguirá pendiente hasta verificar la acreditación de la orden.',
  });
}

async function crearCheckoutAlumno({ idPago, idUsuario, idAcademia, res }) {
  let reserva;
  try {
    mercadopago.verificarConfiguracion();
    reserva = await transacciones.reservarCheckoutAlumno({ idPago, idUsuario, idAcademia });

    if (reserva.enPreparacion) {
      return res.status(409).json({
        code: 'CHECKOUT_EN_PREPARACION',
        idTransaccion: reserva.idTransaccion,
        error: 'Ya existe una operación que se está preparando para esta cuota. Actualiza en unos segundos.',
      });
    }

    // Si ya hay una order persistida, se consulta primero al proveedor. Nunca
    // reutilizamos un checkout marcado como pagado, fallido o cancelado.
    if (reserva.idOrdenProveedor) {
      const verificada = await mercadopago.consultarOrdenVerificada({
        orderId: reserva.idOrdenProveedor,
        referenciaInterna: reserva.referenciaInterna,
        monto: reserva.monto,
      });
      if (verificada.estado === 'APROBADA') {
        await transacciones.confirmarPagoProveedor(verificada);
        return res.status(409).json({
          code: 'CUOTA_YA_PAGADA',
          error: 'Mercado Pago confirmó la orden. Actualiza tus cuotas para ver el nuevo estado.',
        });
      }
      if (['RECHAZADA', 'CANCELADA', 'REEMBOLSADA'].includes(verificada.estado)) {
        await transacciones.actualizarEstadoNoAprobado(verificada);
        return res.status(409).json({
          code: 'ORDEN_NO_VIGENTE',
          error: 'La orden anterior ya no está disponible. Actualiza el estado antes de iniciar otro intento.',
        });
      }

      if (reserva.checkoutUrl) {
        return respuestaCheckout(res, { ...reserva, estado: verificada.estado }, 200);
      }

      // Recuperación idempotente: si el ID se guardó pero la URL no, se toma
      // la URL vigente desde la respuesta del proveedor y se persiste.
      const ordenCompleta = await mercadopago.obtenerOrden(reserva.idOrdenProveedor, {
        referenciaInterna: reserva.referenciaInterna,
        monto: reserva.monto,
      });
      const guardada = await transacciones.guardarOrdenCreada({
        idTransaccion: reserva.idTransaccion,
        idOrdenProveedor: ordenCompleta.id,
        checkoutUrl: ordenCompleta.checkout_url,
        estadoProveedor: ordenCompleta.status,
      });
      return respuestaCheckout(res, {
        ...reserva,
        idOrdenProveedor: guardada.IdOrdenProveedor,
        checkoutUrl: guardada.UrlCheckout,
        estado: guardada.Estado,
      }, 200);
    }

    const orden = await mercadopago.crearOrdenPago(reserva);
    const guardada = await transacciones.guardarOrdenCreada({
      idTransaccion: reserva.idTransaccion,
      idOrdenProveedor: orden.idOrdenProveedor,
      checkoutUrl: orden.checkoutUrl,
      estadoProveedor: orden.estadoProveedor,
    });

    if (guardada.Estado === 'APROBADA') {
      return res.status(409).json({
        code: 'CUOTA_YA_PAGADA',
        error: 'La orden fue confirmada antes de terminar el checkout. Actualiza tus cuotas.',
      });
    }

    return respuestaCheckout(res, {
      ...reserva,
      idOrdenProveedor: guardada.IdOrdenProveedor,
      checkoutUrl: guardada.UrlCheckout,
      estado: guardada.Estado,
    }, 201);
  } catch (error) {
    // Solo se libera la reserva cuando el proveedor rechazó definitivamente la
    // creación. Los timeouts y errores de red mantienen la idempotencia para reintentar.
    if (reserva?.idTransaccion && error?.safeToMarkError === true) {
      try {
        await transacciones.marcarErrorCreacion(reserva.idTransaccion);
      } catch {
        // Se conserva el error original y la operación permanece auditada.
      }
    }
    return responderError(res, error, 'Error al crear checkout de Mercado Pago');
  }
}

router.post('/pagos/:idPago/checkout', async (req, res) => {
  const idPago = idPositivo(req.params.idPago);
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  if (!idPago) return res.status(400).json({ error: 'El IdPago no es válido.' });
  if (!idUsuario || !idAcademia) return res.status(401).json({ error: 'La sesión del alumno no es válida.' });
  return crearCheckoutAlumno({ idPago, idUsuario, idAcademia, res });
});

router.get('/pagos/:idPago/estado', async (req, res) => {
  const consulta = {
    idPago: req.params.idPago,
    idUsuario: idUsuarioSesion(req),
    idAcademia: idAcademiaSesion(req),
  };
  try {
    let data = await transacciones.obtenerEstadoPagoAlumno(consulta);
    const tx = data?.transaccion;
    if (tx?.proveedor === obtenerConfiguracionPagos().provider
        && tx.orderId
        && ['CREANDO', 'PENDIENTE'].includes(String(tx.estado || '').toUpperCase())
        && conciliacion.puedeConciliar(tx.referenciaInterna)) {
      try {
        await conciliacion.conciliarReferencia({
          referenciaInterna: tx.referenciaInterna,
          idOrdenProveedor: tx.orderId,
        });
        data = await transacciones.obtenerEstadoPagoAlumno(consulta);
      } catch (syncError) {
        if (syncError instanceof ErrorPago && syncError.status < 500) {
          console.warn('Conciliación Mercado Pago requiere revisión:', syncError.code);
        } else {
          console.warn('Conciliación Mercado Pago temporalmente no disponible.');
        }
      }
    }
    return res.json(data);
  } catch (error) {
    return responderError(res, error, 'Error al consultar el estado de la cuota');
  }
});

router.post('/pagos/:idPago/conciliar', async (req, res) => {
  const idPago = idPositivo(req.params.idPago);
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  if (!idPago) return res.status(400).json({ error: 'El IdPago no es válido.' });
  if (!idUsuario || !idAcademia) return res.status(401).json({ error: 'La sesión del alumno no es válida.' });

  try {
    mercadopago.verificarConfiguracion();
    const referencia = await transacciones.obtenerReferenciaConciliable({ idPago, idUsuario, idAcademia });
    let resumen = { consultado: false, motivo: 'SIN_CHECKOUT' };
    if (referencia && ['CREANDO', 'PENDIENTE', 'RECHAZADA', 'CANCELADA', 'EXPIRADA'].includes(referencia.estado)) {
      if (conciliacion.puedeConciliar(referencia.referenciaInterna)) {
        const resultado = await conciliacion.conciliarReferencia(referencia);
        resumen = {
          consultado: true,
          pagosEncontrados: resultado.pagosEncontrados,
          confirmada: resultado.confirmada,
          requiereRevision: resultado.requiereRevision,
        };
      } else {
        resumen = { consultado: false, motivo: 'CONSULTA_RECIENTE' };
      }
    } else if (referencia) {
      resumen = { consultado: false, motivo: 'ESTADO_FINAL' };
    }
    const estado = await transacciones.obtenerEstadoPagoAlumno({ idPago, idUsuario, idAcademia });
    return res.json({ ...estado, conciliacion: resumen });
  } catch (error) {
    return responderError(res, error, 'Error al conciliar el pago del alumno');
  }
});

module.exports = router;
