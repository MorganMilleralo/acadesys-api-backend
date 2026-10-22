// Validacion compartida de identificadores de identidad y perfiles.
// Las notas y cierres conservan el contrato de main; no hay modelo de notas por curso.
const enteroPositivo = (valor) =>
  (typeof valor === 'number' || (typeof valor === 'string' && /^\d+$/.test(valor.trim()))) &&
  Number.isSafeInteger(Number(valor)) && Number(valor) > 0;
module.exports = { enteroPositivo };


