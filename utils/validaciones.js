// Límites conservadores del esquema existente; no modifica la BD.
function idPositivo(valor) {
  if (!['string', 'number'].includes(typeof valor) || !/^\d+$/.test(String(valor).trim())) return null;
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function calificacionEntera(valor) {
  if (typeof valor !== 'number' && typeof valor !== 'string') return null;
  if (typeof valor === 'string' && !/^-?\d+$/.test(valor.trim())) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : null;
}

// Acepta el contrato PascalCase del backend y los alias camelCase que ya
// usan los clientes, sin cambiar nombres de columnas ni el payload público.
const ALIAS = {
  Nombres: ['Nombres', 'nombres', 'nombre'],
  ApellidoPaterno: ['ApellidoPaterno', 'apellidoPaterno', 'apellido'],
  ApellidoMaterno: ['ApellidoMaterno', 'apellidoMaterno'],
  CorreoElectronico: ['CorreoElectronico', 'correoElectronico', 'correo', 'email'],
  DNI: ['DNI', 'dni'],
  Celular: ['Celular', 'celular', 'telefono'],
  Clave: ['Clave', 'clave', 'contrasena', 'password'],
};

function leerCampo(datos, campo) {
  for (const alias of ALIAS[campo] || [campo]) {
    if (datos[alias] !== undefined) return datos[alias];
  }
  return undefined;
}

function validarDatosUsuario(datos, { crear = false, correoObligatorio = crear } = {}) {
  const limpio = {};
  for (const campo of ['Nombres', 'ApellidoPaterno', 'ApellidoMaterno']) {
    const valor = leerCampo(datos, campo);
    if (valor === undefined && !crear) continue;
    if (valor !== undefined && typeof valor !== 'string') return { error: `${campo} debe ser texto.` };
    const texto = String(valor ?? '').trim().replace(/\s+/g, ' ');
    if ((campo !== 'ApellidoMaterno' && texto.length < 2) || texto.length > 100 ||
        (texto && !/^[\p{L}\p{M} .'-]+$/u.test(texto))) {
      return { error: `${campo} debe contener un nombre válido de hasta 100 caracteres.` };
    }
    limpio[campo] = texto;
  }
  const correo = leerCampo(datos, 'CorreoElectronico');
  if (crear || correo !== undefined) {
    if (typeof correo !== 'string') return { error: 'El correo electrónico no es válido.' };
    const normalizado = correo.trim().toLowerCase();
    if ((correoObligatorio && !normalizado) || normalizado.length > 150 || (normalizado && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizado))) {
      return { error: 'El correo electrónico debe tener un formato válido y hasta 150 caracteres.' };
    }
    limpio.CorreoElectronico = normalizado || null;
  }
  const dni = leerCampo(datos, 'DNI');
  if (crear || dni !== undefined) {
    if (dni != null && !['number', 'string'].includes(typeof dni)) return { error: 'El DNI debe tener exactamente 8 dígitos.' };
    const normalizado = String(dni ?? '').trim();
    if (normalizado && !/^\d{8}$/.test(normalizado)) return { error: 'El DNI debe tener exactamente 8 dígitos.' };
    limpio.DNI = normalizado || null;
  }
  const celular = leerCampo(datos, 'Celular');
  if (crear || celular !== undefined) {
    if (celular !== undefined && typeof celular !== 'string') {
      return { error: 'El celular debe tener entre 7 y 15 caracteres válidos, o quedar vacío.' };
    }
    const telefono = String(celular ?? '');
    if (telefono.length > 15 || (telefono.trim() && !/^\+?[\d ()-]{7,15}$/.test(telefono.trim()))) {
      return { error: 'El celular debe tener entre 7 y 15 caracteres válidos, o quedar vacío.' };
    }
    limpio.Celular = telefono.trim();
  }
  const clave = leerCampo(datos, 'Clave');
  if (crear || clave !== undefined) {
    // Vacío al editar conserva la contraseña, como en el contrato existente.
    if (!(clave === '' && !crear)) {
      if (typeof clave !== 'string' || clave.length < 8 || Buffer.byteLength(clave, 'utf8') > 72 || !clave.trim()) {
        return { error: 'La contraseña nueva debe tener al menos 8 caracteres y hasta 72 bytes.' };
      }
      limpio.Clave = clave; // No recortar: los espacios forman parte de la clave.
    }
  }
  return { datos: limpio };
}

// La identidad es global: correo/DNI no se reutilizan entre academias.
// Solo se comparan los valores que REALMENTE cambian: si el valor enviado es
// igual al actual, no se bloquea la edición (la base puede contener
// duplicados históricos que no se deben "arreglar" ni bloquear aquí).
async function usuarioDuplicado(connection, datos, excluir = 0, actual = null) {
  const correo = datos.CorreoElectronico ? String(datos.CorreoElectronico).trim().toLowerCase() : null;
  const dni = datos.DNI ? String(datos.DNI).trim() : null;

  let correoEfectivo = correo;
  let dniEfectivo = dni;
  if (actual) {
    const correoActual = String(actual.CorreoElectronico || '').trim().toLowerCase();
    const dniActual = String(actual.DNI || '').trim();
    if (correoEfectivo && correoEfectivo === correoActual) correoEfectivo = null;
    if (dniEfectivo && dniEfectivo === dniActual) dniEfectivo = null;
  }

  if (!correoEfectivo && !dniEfectivo) return false;
  const [rows] = await connection.query(
    `SELECT IdUsuario FROM Usuario
     WHERE IdUsuario <> ? AND
       ((? IS NOT NULL AND LOWER(TRIM(CorreoElectronico)) = ?) OR (? IS NOT NULL AND TRIM(DNI) = ?))
     LIMIT 1 FOR UPDATE`,
    [excluir, correoEfectivo, correoEfectivo, dniEfectivo, dniEfectivo],
  );
  return rows.length > 0;
}

async function bloquearIdentidades(connection) {
  // Sin UNIQUE todavía: serializa altas/cambios de identidad de todos los flujos.
  // Siempre antes de Ciclo/Usuario, para mantener un orden de locks consistente.
  await connection.query('SELECT IdAcademia FROM Academia ORDER BY IdAcademia FOR UPDATE');
}

async function rollbackSeguro(connection) {
  if (!connection) return;
  try { await connection.rollback(); }
  catch (error) { console.error('No se pudo revertir la transacción:', error); }
}

module.exports = { idPositivo, calificacionEntera, validarDatosUsuario, usuarioDuplicado, bloquearIdentidades, rollbackSeguro };


