// ============================================================
// VALIDACIÓN DE ARCHIVOS PARA FOTO DE PERFIL
// ------------------------------------------------------------
// API síncrona: devuelve { valid:true, formato, mimetype, size }
// o { error: "..." }. El tamaño real se toma del buffer, nunca
// del valor declarado por el cliente.
// ============================================================

const allowedMimes = {
  'image/jpeg': true,
  'image/jpg': true,
  'image/png': true,
  'image/webp': true,
};

// Tamaño máximo en bytes (2 MB)
const MAX_SIZE = 2 * 1024 * 1024;

const PNG_FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function detectarFormato(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 8).equals(PNG_FIRMA)) return 'png';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function validarTipoArchivo(file = {}) {
  const mimetype = String(file?.mimetype || '').toLowerCase();
  const buffer = file?.buffer;

  if (!allowedMimes[mimetype]) {
    return { error: 'Formato de imagen no admitido. Solo JPEG, JPG, PNG y WebP.' };
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { error: 'El archivo está vacío.' };
  }
  if (buffer.length > MAX_SIZE) {
    return { error: 'La imagen supera el límite de 2 MB.' };
  }

  const formato = detectarFormato(buffer);
  if (!formato) {
    return { error: 'El contenido del archivo no corresponde a una imagen válida.' };
  }

  const esperado = mimetype === 'image/jpg' ? 'jpeg' : mimetype.replace('image/', '');
  if (formato !== esperado) {
    return { error: 'El contenido de la imagen no coincide con el formato declarado.' };
  }

  return { valid: true, formato, mimetype, size: buffer.length };
}

// Nombre seguro: nunca usa el nombre original del usuario.
function generarNombreSeguro(idUsuario, formato = 'webp') {
  const id = Number(idUsuario);
  const base = Number.isSafeInteger(id) && id > 0 ? String(id) : 'anon';
  const extensiones = { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp' };
  const extension = extensiones[String(formato).toLowerCase()] || 'webp';
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `foto-perfil-${base}-${timestamp}-${random}.${extension}`;
}

module.exports = {
  validarTipoArchivo,
  generarNombreSeguro,
  MAX_SIZE,
  allowedMimes,
};


