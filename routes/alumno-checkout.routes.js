
"use strict";

const express = require("express");
const router = express.Router();
const requiereRol = require("../middlewares/roles.middleware");
const { idPositivo } = require("../utils/validaciones");
const { ErrorPago, aCentimos } = require("../utils/pagos-proveedor");
const culqi = require("../services/culqi.adapter");
const transacciones = require("../services/transacciones-pago.service");
const {
  reservarCheckoutAlumno,
  guardarOrdenCreada,
  marcarErrorCreacion,
  obtenerEstadoPagoAlumno,
  obtenerReferenciaConciliable,
} = require("../services/transacciones-pago.service");
const conciliacion = require("../services/conciliacion-pagos.service");

const idUsuarioSesion = (req) =>
  idPositivo(req.usuario?.idUsuario ?? req.usuario?.id);
const idAcademiaSesion = (req) => idPositivo(req.usuario?.idAcademia);
router.use(requiereRol("Alumno", "Estudiante"));

function datosCliente(reserva) {
  return {
    email: reserva.emailAlumno,
    firstName: reserva.nombreAlumno,
    lastName: [reserva.apellidoPaterno, reserva.apellidoMaterno]
      .filter(Boolean)
      .join(" "),
  };
}

function respuestaCulqi({
  reserva,
  orderId,
  estado,
  reutilizada,
  statusCode,
  res,
}) {
  return res.status(statusCode).json({
    exito: true,
    proveedor: "CULQI",
    reutilizada: Boolean(reutilizada),
    idPago: Number(reserva.idPago),
    idTransaccion: Number(reserva.idTransaccion),
    orderId,
    publicKey: String(process.env.CULQI_PUBLIC_KEY || "").trim(),
    amountCentimos: aCentimos(reserva.monto),
    amount: Number(reserva.monto),
    currency: "PEN",
    estado: estado || "PENDIENTE",
    client: datosCliente(reserva),
    mensaje:
      "Orden preparada. El pago seguirá pendiente hasta recibir y verificar la notificación de Culqi.",
  });
}

async function checkoutCulqi({ idPago, idUsuario, idAcademia, res }) {
  let reserva;
  try {
    // La ausencia de credenciales devuelve 503 antes de abrir una transacción SQL.
    culqi.verificarConfiguracion();
    reserva = await reservarCheckoutAlumno({
      idPago,
      idUsuario,
      idAcademia,
      proveedor: "CULQI",
    });

    if (reserva.enPreparacion) {
      return res.status(409).json({
        code: "CHECKOUT_EN_PREPARACION",
        idTransaccion: reserva.idTransaccion,
        error:
          "Ya se está preparando una orden para esta cuota. Actualiza la pantalla en unos segundos.",
      });
    }

    let orderId = reserva.idOrdenProveedor || null;
    if (!orderId) {
      const orden = await culqi.crearOrdenPago({ ...reserva, idPago });
      orderId = orden.idOrdenProveedor;

      // Persistimos la orden en CREANDO antes de confirmarla. Si la respuesta
      // de confirmación se pierde, el siguiente intento consulta el mismo ID.
      await guardarOrdenCreada({
        idTransaccion: reserva.idTransaccion,
        idOrdenProveedor: orderId,
        checkoutUrl: null,
        estadoProveedor: "created",
        proveedor: "CULQI",
      });
    }

    const ordenActual = await culqi.confirmarOrdenPago(orderId, {
      ...reserva,
      idPago,
    });
    if (["expired", "deleted"].includes(ordenActual.state)) {
      const estadoVerificado = await culqi.consultarOrdenVerificada({
        orderId,
      });
      await transacciones.actualizarEstadoNoAprobado(estadoVerificado);
      throw new ErrorPago(
        409,
        "ORDEN_CULQI_EXPIRADA",
        "El QR de esta orden venció o fue cancelado. Vuelve a pulsar pagar para generar uno nuevo.",
      );
    }
    if (ordenActual.state === "paid") {
      const pagoVerificado = await culqi.consultarOrdenVerificada({ orderId });
      await transacciones.confirmarPagoProveedor(pagoVerificado);
      throw new ErrorPago(
        409,
        "CUOTA_YA_PAGADA",
        "Culqi ya reporta esta orden como pagada. Se actualizó el estado de tu cuota.",
      );
    }

    const guardada = await guardarOrdenCreada({
      idTransaccion: reserva.idTransaccion,
      idOrdenProveedor: orderId,
      checkoutUrl: null,
      estadoProveedor: "pending",
      proveedor: "CULQI",
    });
    reserva.estado = guardada.Estado;

    // El webhook puede llegar mientras respondemos al checkout. Si ya cerró
    // la transacción, no abrimos otra vez una orden pagada o vencida.
    if (String(guardada.Estado).toUpperCase() === "APROBADA") {
      return res.status(409).json({
        code: "CUOTA_YA_PAGADA",
        error:
          "El pago ya fue confirmado por Culqi. Actualiza tus cuotas para ver el estado.",
      });
    }
    if (
      ["EXPIRADA", "CANCELADA", "RECHAZADA"].includes(
        String(guardada.Estado).toUpperCase(),
      )
    ) {
      return res.status(409).json({
        code: "ORDEN_CULQI_NO_VIGENTE",
        error:
          "La orden ya no está vigente. Vuelve a iniciar el pago para generar otra orden.",
      });
    }

    return respuestaCulqi({
      reserva: { ...reserva, idPago },
      orderId,
      estado: reserva.estado || "PENDIENTE",
      reutilizada: Boolean(reserva.reutilizada || reserva.requiereConfirmacion),
      statusCode:
        reserva.reutilizada || reserva.requiereConfirmacion ? 200 : 201,
      res,
    });
  } catch (error) {
    // Solo se libera una reserva cuando se sabe que no existe una orden en Culqi.
    // marcarErrorCreacion exige además que IdOrdenProveedor siga NULL.
    if (reserva?.idTransaccion && error?.safeToMarkError === true) {
      try {
        await marcarErrorCreacion(reserva.idTransaccion, "CULQI");
      } catch {
        /* conservar error original */
      }
    }
    const conocido = error instanceof ErrorPago;
    const status = conocido ? error.status : 500;
    if (status >= 500)
      console.error(
        "Error al crear checkout Culqi:",
        conocido ? error.code : "CULQI_CHECKOUT_NO_DISPONIBLE",
      );
    return res.status(status).json({
      code: conocido ? error.code : "CULQI_CHECKOUT_NO_DISPONIBLE",
      error: conocido
        ? error.message
        : "No se pudo iniciar el pago. La transacción quedó protegida para evitar un cobro duplicado.",
    });
  }
}

// POST /api/alumno/pagos/:idPago/checkout
// El navegador envía solo el ID de la cuota. El servidor calcula monto/titular.
router.post("/pagos/:idPago/checkout", async (req, res) => {
  const idPago = idPositivo(req.params.idPago);
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  if (!idPago)
    return res.status(400).json({ error: "El IdPago no es válido." });
  if (!idUsuario || !idAcademia)
    return res
      .status(401)
      .json({ error: "La sesión del alumno no es válida." });

  // AcadeSys opera exclusivamente con Culqi para nuevos pagos online.
  // Los registros históricos de otros proveedores permanecen intactos en MySQL.
  return checkoutCulqi({ idPago, idUsuario, idAcademia, res });
});

// GET /api/alumno/pagos/:idPago/estado. Solo consulta MySQL; nunca confirma por query.
router.get("/pagos/:idPago/estado", async (req, res) => {
  try {
    const consulta = {
      idPago: req.params.idPago,
      idUsuario: idUsuarioSesion(req),
      idAcademia: idAcademiaSesion(req),
    };
    let data = await obtenerEstadoPagoAlumno(consulta);

    // La consulta manual también reconcilia Culqi por API. Así el alumno puede
    // recuperar el estado incluso si el webhook se retrasó, sin confiar en
    // parámetros del navegador ni declarar el pago por el retorno del checkout.
    if (
      data?.transaccion?.proveedor === "CULQI" &&
      data?.transaccion?.orderId &&
      ["CREANDO", "PENDIENTE"].includes(
        String(data.transaccion.estado || "").toUpperCase(),
      )
    ) {
      try {
        const pagoVerificado = await culqi.consultarOrdenVerificada({
          orderId: data.transaccion.orderId,
        });
        if (pagoVerificado.estadoProveedor === "paid") {
          await transacciones.confirmarPagoProveedor(pagoVerificado);
        } else {
          await transacciones.actualizarEstadoNoAprobado(pagoVerificado);
        }
        data = await obtenerEstadoPagoAlumno(consulta);
      } catch (errorSincronizacion) {
        // El estado previamente registrado sigue siendo válido; no exponemos
        // fallos internos ni convertimos un GET en error si Culqi está lento.
        if (
          errorSincronizacion instanceof ErrorPago &&
          errorSincronizacion.status < 500
        ) {
          console.error(
            "Reconciliación Culqi requiere revisión:",
            errorSincronizacion.code,
          );
        } else if (errorSincronizacion?.status >= 500) {
          console.error("Reconciliación Culqi temporalmente no disponible.");
        }
      }
    }
    return res.json(data);
  } catch (error) {
    const conocido = error instanceof ErrorPago;
    const status = conocido ? error.status : 500;
    if (status >= 500)
      console.error(
        "Error al consultar estado de checkout:",
        conocido ? error.code : "ESTADO_PAGO_NO_DISPONIBLE",
      );
    return res
      .status(status)
      .json({
        code: conocido ? error.code : "ESTADO_PAGO_NO_DISPONIBLE",
        error: conocido
          ? error.message
          : "No se pudo consultar el estado del pago.",
      });
  }
});

// POST /api/alumno/pagos/:idPago/conciliar
// «Consultar estado del pago»: si el webhook no llegó, busca la operación en
// Culqi y la aplica con la misma verificación que el webhook. Nunca usa
// datos enviados por React ni los parámetros de la URL de retorno.
router.post('/pagos/:idPago/conciliar', async (req, res) => {
  const idPago = idPositivo(req.params.idPago);
  const idUsuario = idUsuarioSesion(req);
  const idAcademia = idAcademiaSesion(req);
  if (!idPago) return res.status(400).json({ error: 'El IdPago no es válido.' });
  if (!idUsuario || !idAcademia) return res.status(401).json({ error: 'La sesión del alumno no es válida.' });
  try {
    culqi.verificarConfiguracion();
    const referencia = await obtenerReferenciaConciliable({ idPago, idUsuario, idAcademia });
    let resumen = { consultado: false, motivo: 'SIN_CHECKOUT' };
    if (referencia && ['PENDIENTE', 'RECHAZADA', 'CANCELADA', 'EXPIRADA', 'CREANDO'].includes(referencia.estado)) {
      if (conciliacion.puedeConciliar(referencia.referenciaInterna)) {
        const r = await conciliacion.conciliarReferencia(referencia);
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
      error: status >= 500 ? 'No se pudo consultar Culqi en este momento. Inténtalo en unos minutos.'
        : (conocido ? error.message : 'No se pudo consultar el estado del pago.') });
  }
});

module.exports = router;
