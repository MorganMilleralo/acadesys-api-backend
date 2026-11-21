'use strict';

// Cliente HTTP del servicio de facturación electrónica fact_api
// (https://github.com/angelitosystems/fact_api, Laravel + Greenter).
// Flujo de una boleta: crear -> enviar a SUNAT -> generar PDF -> descargar PDF y XML.

const { obtenerConfiguracionFacturacion } = require('../config/facturacion');

let tokenCache = null;

class ErrorFacturacion extends Error {
  constructor(message, { status = 502, reintentable = true } = {}) {
    super(message);
    this.name = 'ErrorFacturacion';
    this.status = status;
    this.reintentable = reintentable;
  }
}

async function solicitud(config, metodo, ruta, { cuerpo, token, binario = false } = {}) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), config.timeoutMs);
  let respuesta;
  try {
    respuesta = await fetch(`${config.baseUrl}${ruta}`, {
      method: metodo,
      headers: {
        Accept: binario ? '*/*' : 'application/json',
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: controlador.signal,
    });
  } catch (error) {
    throw new ErrorFacturacion(error?.name === 'AbortError'
      ? 'El servicio de facturación no respondió a tiempo.'
      : 'No se pudo conectar con el servicio de facturación.');
  } finally {
    clearTimeout(temporizador);
  }

  if (binario && respuesta.ok) {
    return { status: respuesta.status, contenido: Buffer.from(await respuesta.arrayBuffer()) };
  }
  const datos = await respuesta.json().catch(() => ({}));
  return { status: respuesta.status, ok: respuesta.ok, datos };
}

function mensajeDe(datos, porDefecto) {
  const errores = datos?.errors && typeof datos.errors === 'object'
    ? Object.values(datos.errors).flat().join(' ')
    : '';
  return String(datos?.message || errores || porDefecto).slice(0, 450);
}

async function iniciarSesion(config) {
  const r = await solicitud(config, 'POST', '/api/auth/login', {
    cuerpo: { email: config.email, password: config.password },
  });
  if (!r.ok || !r.datos?.access_token) {
    throw new ErrorFacturacion(`Inicio de sesión en facturación rechazado: ${mensajeDe(r.datos, `HTTP ${r.status}`)}`, { status: 503 });
  }
  tokenCache = { valor: r.datos.access_token, base: config.baseUrl, email: config.email };
  return tokenCache.valor;
}

// Repite la solicitud una vez con un token nuevo si el actual expiró.
async function autenticada(config, metodo, ruta, opciones = {}) {
  const vigente = tokenCache && tokenCache.base === config.baseUrl && tokenCache.email === config.email
    ? tokenCache.valor
    : await iniciarSesion(config);
  let r = await solicitud(config, metodo, ruta, { ...opciones, token: vigente });
  if (r.status === 401) {
    r = await solicitud(config, metodo, ruta, { ...opciones, token: await iniciarSesion(config) });
  }
  return r;
}

function redondear(valor, decimales) {
  const f = 10 ** decimales;
  return Math.round(valor * f) / f;
}

function nombreCompleto(alumno) {
  return [alumno.Nombres, alumno.ApellidoPaterno, alumno.ApellidoMaterno]
    .map((p) => String(p || '').trim()).filter(Boolean).join(' ').slice(0, 250) || 'CLIENTE VARIOS';
}

function descripcionCuota(datos) {
  const ciclo = String(datos.Ciclo || '').trim();
  const mes = String(datos.Mes || '').trim();
  const concepto = mes.toLowerCase() === 'inscripcion' ? 'Inscripción' : `Mensualidad ${mes}`;
  return `${concepto}${ciclo ? ` - ${ciclo}` : ''}`.slice(0, 250);
}

function fechaLima(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(fecha);
}

// Arma el cuerpo de la boleta (tipo 03) para el alumno que pagó la cuota.
function construirBoleta(config, datos) {
  const monto = Number(datos.Monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new ErrorFacturacion('La cuota no tiene un monto válido para la boleta.', { status: 409, reintentable: false });
  }
  const dni = String(datos.DNI || '').trim();
  const conDni = /^\d{8}$/.test(dni);
  const gravado = config.afectacion === '10';
  const email = String(datos.CorreoElectronico || '').trim();

  return {
    company_id: config.companyId,
    branch_id: config.branchId,
    serie: config.serie,
    fecha_emision: fechaLima(),
    moneda: datos.Moneda || 'PEN',
    tipo_operacion: '0101',
    metodo_envio: 'individual',
    forma_pago_tipo: 'Contado',
    client: {
      tipo_documento: conDni ? '1' : '0',
      numero_documento: conDni ? dni : '00000000',
      razon_social: nombreCompleto(datos),
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email } : {}),
    },
    detalles: [{
      codigo: `CUOTA-${datos.IdPago}`,
      descripcion: descripcionCuota(datos),
      unidad: 'ZZ',
      cantidad: 1,
      // El monto de la cuota incluye IGV: el valor unitario es el monto sin impuesto.
      mto_valor_unitario: gravado ? redondear(monto / 1.18, 6) : redondear(monto, 2),
      porcentaje_igv: gravado ? 18 : 0,
      tip_afe_igv: config.afectacion,
    }],
    usuario_creacion: 'acadesys',
  };
}

async function crearBoleta(datos) {
  const config = obtenerConfiguracionFacturacion();
  const r = await autenticada(config, 'POST', '/api/v1/boletas', { cuerpo: construirBoleta(config, datos) });
  if (!r.ok || !r.datos?.data?.id) {
    throw new ErrorFacturacion(`No se pudo crear la boleta: ${mensajeDe(r.datos, `HTTP ${r.status}`)}`, {
      reintentable: r.status >= 500 || r.status === 429,
    });
  }
  const b = r.datos.data;
  return {
    idExterno: String(b.id),
    serie: String(b.serie || config.serie).slice(0, 4),
    correlativo: String(b.correlativo || '').slice(0, 10),
    numeroCompleto: String(b.numero_completo || `${b.serie}-${b.correlativo}`).slice(0, 20),
  };
}

async function enviarSunat(idExterno) {
  const config = obtenerConfiguracionFacturacion();
  const r = await autenticada(config, 'POST', `/api/v1/boletas/${encodeURIComponent(idExterno)}/send-sunat`);
  if (r.ok) return String(r.datos?.data?.estado_sunat || 'ACEPTADO').slice(0, 40);
  if (/ya fue aceptada/i.test(String(r.datos?.message || ''))) return 'ACEPTADO';
  throw new ErrorFacturacion(`SUNAT no aceptó la boleta: ${mensajeDe(r.datos, `HTTP ${r.status}`)}`);
}

async function descargarArchivos(idExterno) {
  const config = obtenerConfiguracionFacturacion();
  const id = encodeURIComponent(idExterno);
  const generado = await autenticada(config, 'POST', `/api/v1/boletas/${id}/generate-pdf`, { cuerpo: { format: 'A4' } });
  if (!generado.ok) {
    throw new ErrorFacturacion(`No se pudo generar el PDF de la boleta: ${mensajeDe(generado.datos, `HTTP ${generado.status}`)}`);
  }
  const pdf = await autenticada(config, 'GET', `/api/v1/boletas/${id}/download-pdf?format=A4`, { binario: true });
  if (!pdf.contenido || pdf.contenido.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw new ErrorFacturacion('El servicio de facturación no devolvió un PDF válido.');
  }
  // El XML firmado es opcional: si no está disponible se guarda solo el PDF.
  const xml = await autenticada(config, 'GET', `/api/v1/boletas/${id}/download-xml`, { binario: true }).catch(() => null);
  const xmlValido = xml?.contenido && /^\s*<\?xml|^\s*</.test(xml.contenido.subarray(0, 64).toString('utf8'));
  return { pdf: pdf.contenido, xml: xmlValido ? xml.contenido : null };
}

function reiniciarSesion() {
  tokenCache = null;
}

module.exports = {
  ErrorFacturacion,
  construirBoleta,
  crearBoleta,
  enviarSunat,
  descargarArchivos,
  reiniciarSesion,
};
