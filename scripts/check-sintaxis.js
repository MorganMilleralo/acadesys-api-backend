"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

const DIRECTORIOS_IGNORADOS = new Set([
  "node_modules",
  ".git",
  "coverage",
  "dist",
  "build",
]);

function obtenerArchivosJavaScript(directorio) {
  const entradas = fs.readdirSync(directorio, {
    withFileTypes: true,
  });

  const archivos = [];

  for (const entrada of entradas) {
    const ruta = path.join(directorio, entrada.name);

    if (entrada.isDirectory()) {
      if (!DIRECTORIOS_IGNORADOS.has(entrada.name)) {
        archivos.push(...obtenerArchivosJavaScript(ruta));
      }

      continue;
    }

    if (entrada.isFile() && entrada.name.endsWith(".js")) {
      archivos.push(ruta);
    }
  }

  return archivos;
}

const archivos = obtenerArchivosJavaScript(ROOT);

let fallos = 0;

for (const archivo of archivos) {
  const resultado = spawnSync(process.execPath, ["--check", archivo], {
    encoding: "utf8",
  });

  if (resultado.status !== 0) {
    console.error(`Error de sintaxis: ${path.relative(ROOT, archivo)}`);

    console.error(resultado.stderr || resultado.stdout);
    fallos++;
  }
}

console.log(
  fallos === 0
    ? `Sintaxis correcta en ${archivos.length} archivos JavaScript.`
    : `Se encontraron ${fallos} errores de sintaxis.`,
);

process.exitCode = fallos === 0 ? 0 : 1;
