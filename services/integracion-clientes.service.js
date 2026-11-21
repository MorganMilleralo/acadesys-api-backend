'use strict';

// API de integración de clientes: claves de acceso, lectura de alumnos y
// confirmaciones de entrega para evitar duplicados en el aplicativo externo.

const crypto = require('node:crypto');
const pool = require('../config/db');
const { consultar, ejecutar } = require('../config/procedimientos');

const PREFIJO_CLAVE = 'acs_';
const FORMATO_CLAVE = /^acs_[A-Za-z0-9_-]{43}$/;
const FORMATO_ID_CLIENTE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/;
const FORMATO_VERSION = /^[a-f0-9]{64}$/;
const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 100;
const CONFIRMACIONES_MAXIMAS = 100;

class ErrorIntegracion extends Error {
  constructor(status, codigo, mensaje, detalles) {
    super(mensaje);
    this.name = 'ErrorIntegracion';
    this.status = status;
    this.codigo = codigo;
    if (detalles) this.detalles = detalles;
  }
}

function hashClave(clave) {
  return crypto.createHash('sha256').update(String(clave), 'utf8').digest('hex');
}

function generarClave() {
  const clave = `${PREFIJO_CLAVE}${crypto.randomBytes(32).toString('base64url')}`;
  return { clave, prefijo: clave.slice(0, 10), hash: hashClave(clave) };
}

function formatoClaveValido(clave) {
  return typeof clave === 'string' && FORMATO_CLAVE.test(clave);
}

async function autenticar(clave) {
  if (!formatoClaveValido(clave)) return null;
  const [filas] = await consultar(pool, 'sp_integracion_autenticar', [hashClave(clave)]);
  const fila = filas[0];
  if (!fila) return null;
  return {
    idConsumidor: Number(fila.IdConsumidor),
    idAcademia: Number(fila.IdAcademia),
    nombre: fila.Nombre,
    prefijo: fila.Prefijo,
    limitePorMinuto: Number(fila.LimitePorMinuto) || 60,
  };
}

function fechaIso(valor) {
  if (!valor) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function texto(valor) {
  const t = String(valor ?? '').trim();
  return t || null;
}

// Forma pública de un cliente: solo los datos necesarios, nunca la clave ni la foto.
function clientePublico(fila) {
  const dni = texto(fila.DNI);
  const nombres = texto(fila.Nombres);
  const paterno = texto(fila.ApellidoPaterno);
  const materno = texto(fila.ApellidoMaterno);
  return {
    idCliente: fila.CodigoUsuario,
    tipoDocumento: dni && /^\d{8}$/.test(dni) ? 'DNI' : null,
    numeroDocumento: dni && /^\d{8}$/.test(dni) ? dni : null,
    nombres,
    apellidoPaterno: paterno,
    apellidoMaterno: materno,
    nombreCompleto: [nombres, paterno, materno].filter(Boolean).join(' '),
    correo: texto(fila.CorreoElectronico)?.toLowerCase() || null,
    celular: texto(fila.Celular),
    ciclos: texto(fila.Ciclos) ? String(fila.Ciclos).split('||') : [],
    fechaRegistro: fechaIso(fila.FechaCreacion),
    version: fila.Version,
    confirmadoEn: fila.VersionConfirmada === fila.Version ? fechaIso(fila.FechaConfirmacion) : null,
  };
}

function leerLimite(valor) {
  if (valor === undefined) return LIMITE_POR_DEFECTO;
  if (typeof valor !== 'string' || !/^\d{1,3}$/.test(valor)) return null;
  const n = Number(valor);
  return n >= 1 && n <= LIMITE_MAXIMO ? n : null;
}

function leerCursor(valor) {
  if (valor === undefined) return 0;
  if (typeof valor !== 'string' || !/^\d{1,10}$/.test(valor)) return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) && n >= 0 && n <= 2147483647 ? n : null;
}

function validarConsulta(query, permitidos) {
  const desconocidos = Object.keys(query || {}).filter((k) => !permitidos.includes(k));
  if (desconocidos.length) {
    throw new ErrorIntegracion(400, 'PARAMETRO_NO_PERMITIDO', `Parámetros no permitidos: ${desconocidos.slice(0, 5).join(', ')}.`);
  }
  const limite = leerLimite(query.limite);
  if (limite === null) throw new ErrorIntegracion(400, 'LIMITE_INVALIDO', `limite debe ser un entero entre 1 y ${LIMITE_MAXIMO}.`);
  const cursor = leerCursor(query.cursor);
  if (cursor === null) throw new ErrorIntegracion(400, 'CURSOR_INVALIDO', 'cursor debe ser el valor siguienteCursor de la respuesta anterior.');
  return { limite, cursor };
}

async function listarClientes(consumidor, { limite, cursor, soloPendientes }) {
  // Se pide uno más para saber si hay otra página sin contar toda la tabla.
  const [filas] = await consultar(pool, 'sp_integracion_listar_clientes', [
    consumidor.idConsumidor, consumidor.idAcademia, cursor, limite + 1, soloPendientes ? 1 : 0, null,
  ]);
  const pagina = filas.slice(0, limite);
  const hayMas = filas.length > limite;
  return {
    datos: pagina.map(clientePublico),
    paginacion: {
      limite,
      cantidad: pagina.length,
      hayMas,
      siguienteCursor: hayMas ? String(pagina[pagina.length - 1].IdUsuario) : null,
    },
  };
}

async function obtenerCliente(consumidor, idCliente) {
  if (typeof idCliente !== 'string' || !FORMATO_ID_CLIENTE.test(idCliente)) {
    throw new ErrorIntegracion(400, 'ID_CLIENTE_INVALIDO', 'idCliente no tiene un formato válido.');
  }
  const [filas] = await consultar(pool, 'sp_integracion_listar_clientes', [
    consumidor.idConsumidor, consumidor.idAcademia, 0, 1, 0, idCliente,
  ]);
  if (!filas.length) throw new ErrorIntegracion(404, 'CLIENTE_NO_ENCONTRADO', 'No existe un cliente con ese idCliente.');
  return clientePublico(filas[0]);
}

function validarConfirmaciones(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo) || !Array.isArray(cuerpo.clientes)) {
    throw new ErrorIntegracion(400, 'CUERPO_INVALIDO', 'El cuerpo debe ser { "clientes": [ { "idCliente", "version" } ] }.');
  }
  const extras = Object.keys(cuerpo).filter((k) => k !== 'clientes');
  if (extras.length) throw new ErrorIntegracion(400, 'CAMPO_NO_PERMITIDO', `Campos no permitidos: ${extras.slice(0, 5).join(', ')}.`);
  if (cuerpo.clientes.length === 0) throw new ErrorIntegracion(400, 'SIN_CLIENTES', 'Envía al menos un cliente para confirmar.');
  if (cuerpo.clientes.length > CONFIRMACIONES_MAXIMAS) {
    throw new ErrorIntegracion(413, 'DEMASIADOS_CLIENTES', `Se aceptan como máximo ${CONFIRMACIONES_MAXIMAS} clientes por solicitud.`);
  }
  const errores = [];
  const unicos = new Map();
  cuerpo.clientes.forEach((item, indice) => {
    const valido = item && typeof item === 'object' && !Array.isArray(item)
      && typeof item.idCliente === 'string' && FORMATO_ID_CLIENTE.test(item.idCliente)
      && typeof item.version === 'string' && FORMATO_VERSION.test(item.version);
    if (!valido) errores.push({ indice, error: 'Cada elemento necesita idCliente y version (64 caracteres hexadecimales).' });
    else unicos.set(item.idCliente, item.version);
  });
  if (errores.length) throw new ErrorIntegracion(400, 'CLIENTES_INVALIDOS', 'Hay elementos con formato inválido.', errores.slice(0, 20));
  return [...unicos.entries()].map(([idCliente, version]) => ({ idCliente, version }));
}

async function confirmarClientes(consumidor, cuerpo) {
  const items = validarConfirmaciones(cuerpo);
  const resultados = [];
  for (const { idCliente, version } of items) {
    const [filas] = await consultar(pool, 'sp_integracion_confirmar_cliente', [
      consumidor.idConsumidor, consumidor.idAcademia, idCliente, version,
    ]);
    const fila = filas[0] || {};
    const resultado = fila.Resultado || 'NO_ENCONTRADO';
    resultados.push({
      idCliente,
      resultado,
      ...(resultado === 'VERSION_DESACTUALIZADA' ? { versionVigente: fila.VersionVigente } : {}),
    });
  }
  const resumen = { recibidos: cuerpo.clientes.length, procesados: resultados.length };
  for (const r of resultados) resumen[r.resultado] = (resumen[r.resultado] || 0) + 1;
  return { resultados, resumen };
}

async function registrarAuditoria(datos) {
  await ejecutar(pool, 'sp_integracion_registrar_auditoria', [
    datos.idConsumidor ?? null,
    datos.idSolicitud,
    String(datos.metodo).slice(0, 10),
    String(datos.ruta).slice(0, 200),
    datos.estadoHttp,
    datos.codigo ? String(datos.codigo).slice(0, 60) : null,
    datos.registros || 0,
    datos.ip ? String(datos.ip).slice(0, 45) : null,
    Math.min(Math.max(0, Math.round(datos.duracionMs || 0)), 2147483647),
  ]);
}

// --- Administración de consumidores ---

function validarNuevoConsumidor(cuerpo) {
  const nombre = typeof cuerpo?.nombre === 'string' ? cuerpo.nombre.trim() : '';
  if (nombre.length < 3 || nombre.length > 100) {
    throw new ErrorIntegracion(400, 'NOMBRE_INVALIDO', 'El nombre del aplicativo debe tener entre 3 y 100 caracteres.');
  }
  let limite = 60;
  if (cuerpo.limitePorMinuto !== undefined) {
    limite = Number(cuerpo.limitePorMinuto);
    if (!Number.isInteger(limite) || limite < 1 || limite > 600) {
      throw new ErrorIntegracion(400, 'LIMITE_INVALIDO', 'limitePorMinuto debe ser un entero entre 1 y 600.');
    }
  }
  return { nombre, limite };
}

async function crearConsumidor({ idAcademia, idUsuario }, cuerpo) {
  const { nombre, limite } = validarNuevoConsumidor(cuerpo);
  const { clave, prefijo, hash } = generarClave();
  const [r] = await ejecutar(pool, 'sp_integracion_crear_consumidor', [idAcademia, nombre, prefijo, hash, limite, idUsuario || null]);
  return { idConsumidor: Number(r.insertId), nombre, prefijo, limitePorMinuto: limite, clave };
}

async function listarConsumidores(idAcademia) {
  const [filas] = await consultar(pool, 'sp_integracion_listar_consumidores', [idAcademia]);
  return filas.map((f) => ({
    idConsumidor: Number(f.IdConsumidor),
    nombre: f.Nombre,
    prefijo: f.Prefijo,
    limitePorMinuto: Number(f.LimitePorMinuto),
    activo: Number(f.Activo) === 1,
    fechaCreacion: fechaIso(f.FechaCreacion),
    fechaRevocacion: fechaIso(f.FechaRevocacion),
    ultimoUso: fechaIso(f.UltimoUso),
    clientesConfirmados: Number(f.ClientesConfirmados) || 0,
  }));
}

async function revocarConsumidor(idAcademia, idConsumidor) {
  const [r] = await ejecutar(pool, 'sp_integracion_revocar_consumidor', [idConsumidor, idAcademia]);
  return r.affectedRows === 1;
}

module.exports = {
  ErrorIntegracion,
  LIMITE_MAXIMO,
  hashClave,
  generarClave,
  formatoClaveValido,
  autenticar,
  clientePublico,
  validarConsulta,
  validarConfirmaciones,
  listarClientes,
  obtenerCliente,
  confirmarClientes,
  registrarAuditoria,
  crearConsumidor,
  listarConsumidores,
  revocarConsumidor,
};
