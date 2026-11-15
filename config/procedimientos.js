'use strict';

// Acceso a datos mediante procedimientos almacenados.
// La API no arma consultas SQL: solo invoca procedimientos definidos en
// database/procedimientos/ y recibe sus resultados.

const NOMBRE_VALIDO = /^sp_[a-z0-9_]+$/;

function sentenciaCall(nombre, parametros) {
  if (!NOMBRE_VALIDO.test(nombre)) {
    throw new Error(`Nombre de procedimiento no válido: ${nombre}`);
  }
  if (!Array.isArray(parametros)) {
    throw new Error(`Los parámetros de ${nombre} deben ser un arreglo.`);
  }
  const marcadores = parametros.map(() => '?').join(', ');
  return `CALL ${nombre}(${marcadores})`;
}

function conjuntosDeResultados(resultado) {
  if (!Array.isArray(resultado)) return [];
  return resultado.filter(Array.isArray);
}

/**
 * Ejecuta un procedimiento que devuelve filas.
 * Devuelve [filas] para conservar la forma de pool.query().
 */
async function consultar(ejecutor, nombre, parametros = []) {
  const [resultado] = await ejecutor.query(sentenciaCall(nombre, parametros), parametros);
  return [conjuntosDeResultados(resultado)[0] || []];
}

/**
 * Ejecuta un procedimiento que devuelve varios conjuntos de filas.
 */
async function consultarVarios(ejecutor, nombre, parametros = []) {
  const [resultado] = await ejecutor.query(sentenciaCall(nombre, parametros), parametros);
  return conjuntosDeResultados(resultado);
}

/**
 * Ejecuta un procedimiento de escritura. Los procedimientos de escritura
 * terminan con SELECT ROW_COUNT() AS affectedRows, LAST_INSERT_ID() AS insertId.
 * Devuelve [{ affectedRows, insertId }] como pool.query().
 */
async function ejecutar(ejecutor, nombre, parametros = []) {
  const [resultado] = await ejecutor.query(sentenciaCall(nombre, parametros), parametros);
  const fila = conjuntosDeResultados(resultado)[0]?.[0] || {};
  return [{
    affectedRows: Number(fila.affectedRows ?? 0),
    insertId: Number(fila.insertId ?? 0),
  }];
}

module.exports = { consultar, consultarVarios, ejecutar, sentenciaCall };
