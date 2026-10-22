// ============================================================================
// UNICA FUENTE DE VERDAD: escala de puntaje por UNIVERSIDAD OBJETIVO.
//
// Que es la escala: el maximo de puntos en el que AcadeSys califica un
// simulacro/evaluacion de un ciclo. Es una escala INTERNA de la academia:
// no es la escala oficial de la universidad (el sistema no verifica ofertas
// oficiales), asi que no se documenta como dato de la universidad.
//
// Reglas del sistema:
//   1. Las universidades que ya tienen escala configurada NO se tocan.
//   2. Una universidad sin escala propia usa la escala interna
//      preuniversitaria (vigesimal, 20 puntos), que es la misma del ciclo
//      "Preuniversitario" y la que ya usaba el dashboard por defecto.
//   3. TODOS los modulos (notas, dashboard, Tutor IA) consultan esta misma
//      tabla, de modo que la escala que se MUESTRA, la que se VALIDA y la que
//      se NORMALIZA son siempre la misma para una misma universidad.
//
// Nota: las claves se comparan sin distinguir mayusculas, porque el backend
// puede devolver tanto "UNMSM" como "Preuniversitario".
// ============================================================================

const ESCALAS_POR_UNIVERSIDAD = Object.freeze({
  // --- Escala ya configurada (no se modifica) ---
  UNMSM: 2000,
  UNI: 2000,
  PUCP: 1000,
  UNFV: 1000,
  UNAC: 100,
  UNT: 300,

  // --- Universidades del catalogo demo (2026-10) ---
  // Sin una decision de negocio propia: escala interna preuniversitaria.
  UNALM: 20,
  UPCH: 20,
  ULIMA: 20,
  UPC: 20,
  USMP: 20,
  UTP: 20,

  // --- Ciclo generico de la academia ---
  Preuniversitario: 20,
});

// Escala usada cuando la universidad no esta en la tabla.
const ESCALA_POR_DEFECTO = 20;

const INDICE_POR_CLAVE = new Map(
  Object.entries(ESCALAS_POR_UNIVERSIDAD).map(([clave, valor]) => [clave.toUpperCase(), valor])
);

/**
 * Maximo de la escala para una universidad objetivo.
 * Devuelve la escala interna preuniversitaria si la universidad no esta
 * registrada, de modo que ningun endpoint use un valor por defecto distinto.
 */
function escalaMaximaPorUniversidad(universidad = '') {
  const clave = String(universidad ?? '').trim();
  if (!clave) return ESCALA_POR_DEFECTO;
  return INDICE_POR_CLAVE.get(clave.toUpperCase()) ?? ESCALA_POR_DEFECTO;
}

module.exports = {
  ESCALAS_POR_UNIVERSIDAD,
  ESCALA_POR_DEFECTO,
  escalaMaximaPorUniversidad,
};


