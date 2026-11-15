'use strict';

// Doble de config/procedimientos para las pruebas sin MySQL.
// Lee database/procedimientos/*.sql y, al invocar un procedimiento, envía al
// doble de la base de datos la sentencia que contiene ese procedimiento, con
// sus parámetros en orden. Así las pruebas siguen verificando el SQL real y los
// valores que la API entrega a cada procedimiento.
// Los procedimientos con varias sentencias se envían como CALL.

const fs = require('node:fs');
const path = require('node:path');

const carpeta = path.join(__dirname, '..', 'database', 'procedimientos');
const catalogo = new Map();

function quitarComentarios(texto) {
  return texto.replace(/^\s*--.*$/gm, '');
}

for (const archivo of fs.readdirSync(carpeta).filter((f) => f.endsWith('.sql'))) {
  const texto = fs.readFileSync(path.join(carpeta, archivo), 'utf8').replace(/\r\n/g, '\n');
  const bloques = texto.matchAll(/CREATE PROCEDURE (sp_\w+)\(([\s\S]*?)\)\s*BEGIN\n([\s\S]*?)\nEND\$\$/g);
  for (const [, nombre, firma, cuerpoCompleto] of bloques) {
    const parametros = [...firma.matchAll(/IN (p_\w+)/g)].map((m) => m[1]);
    const cuerpo = quitarComentarios(cuerpoCompleto)
      .replace(/\n\s*SELECT ROW_COUNT\(\) AS affectedRows, LAST_INSERT_ID\(\) AS insertId;\s*$/, '')
      .trim();
    const sentencias = cuerpo.split(/;\s*(?:\n|$)/).filter((s) => s.trim());
    catalogo.set(nombre, { parametros, cuerpo: cuerpo.replace(/;\s*$/, ''), simple: sentencias.length === 1 });
  }
}

function traducir(nombre, valores) {
  const sp = catalogo.get(nombre);
  if (!sp) throw new Error(`Procedimiento inexistente en database/procedimientos: ${nombre}`);
  if (valores.length !== sp.parametros.length) {
    throw new Error(`${nombre} espera ${sp.parametros.length} parámetros y recibió ${valores.length}`);
  }
  if (!sp.simple) {
    return { sql: `CALL ${nombre}(${valores.map(() => '?').join(', ')})`, params: valores };
  }
  const indice = new Map(sp.parametros.map((p, i) => [p, i]));
  const params = [];
  const patron = new RegExp(`\\b(${[...sp.parametros].sort((a, b) => b.length - a.length).join('|') || '(?!)'})\\b`, 'g');
  const sql = sp.cuerpo.replace(patron, (p) => { params.push(valores[indice.get(p)]); return '?'; });
  return { sql, params };
}

async function consultar(ejecutor, nombre, parametros = []) {
  const { sql, params } = traducir(nombre, parametros);
  const [filas] = await ejecutor.query(sql, params);
  return [filas ?? []];
}

async function consultarVarios(ejecutor, nombre, parametros = []) {
  const [filas] = await consultar(ejecutor, nombre, parametros);
  return [filas];
}

async function ejecutar(ejecutor, nombre, parametros = []) {
  const { sql, params } = traducir(nombre, parametros);
  const [resultado] = await ejecutor.query(sql, params);
  const base = resultado && !Array.isArray(resultado) ? resultado : {};
  return [{ affectedRows: 0, insertId: 0, ...base }];
}

module.exports = { consultar, consultarVarios, ejecutar, traducir, catalogo };
