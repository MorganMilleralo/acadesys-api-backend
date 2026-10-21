// Pruebas unitarias del validador de foto de perfil.
// No cargan MySQL ni tocan disco: solo validan buffers en memoria.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validarTipoArchivo,
  generarNombreSeguro,
  MAX_SIZE,
} = require('../utils/validar-foto');

const cabeceraJpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const cabeceraPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const jpeg = Buffer.concat([cabeceraJpeg, Buffer.alloc(16)]);
const png = Buffer.concat([cabeceraPng, Buffer.alloc(16)]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.alloc(8),
]);

test('acepta JPEG, PNG y WebP con bytes mágicos coherentes', () => {
  const jpg = validarTipoArchivo({ mimetype: 'image/jpeg', buffer: jpeg });
  assert.equal(jpg.valid, true);
  assert.equal(jpg.formato, 'jpeg');
  assert.equal(jpg.size, jpeg.length);

  const imagenPng = validarTipoArchivo({ mimetype: 'image/png', buffer: png });
  assert.equal(imagenPng.valid, true);
  assert.equal(imagenPng.formato, 'png');

  const imagenWebp = validarTipoArchivo({ mimetype: 'image/webp', buffer: webp });
  assert.equal(imagenWebp.valid, true);
  assert.equal(imagenWebp.formato, 'webp');
});

test('rechaza MIME no permitido', () => {
  const resultado = validarTipoArchivo({ mimetype: 'image/gif', buffer: jpeg });
  assert.match(resultado.error, /Formato de imagen no admitido/);
});

test('rechaza archivo vacío', () => {
  const resultado = validarTipoArchivo({ mimetype: 'image/jpeg', buffer: Buffer.alloc(0) });
  assert.match(resultado.error, /vacío/);
});

test('rechaza imágenes mayores a 2 MB usando el tamaño real del buffer', () => {
  const grande = Buffer.alloc(MAX_SIZE + 1);
  cabeceraJpeg.copy(grande);
  const resultado = validarTipoArchivo({ mimetype: 'image/jpeg', buffer: grande });
  assert.match(resultado.error, /2 MB/);
});

test('rechaza contenido que no coincide con el MIME declarado', () => {
  const resultado = validarTipoArchivo({ mimetype: 'image/jpeg', buffer: png });
  assert.match(resultado.error, /no coincide/);
});

test('rechaza archivos disfrazados sin firma de imagen válida', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const resultado = validarTipoArchivo({ mimetype: 'image/png', buffer: svg });
  assert.match(resultado.error, /no corresponde a una imagen válida/);
});

test('genera un nombre seguro, sin ruta ni nombre original', () => {
  const nombre = generarNombreSeguro(1134, 'jpeg');
  assert.match(nombre, /^foto-perfil-1134-[a-z0-9]+-[a-z0-9]+\.jpg$/);
  assert.equal(nombre.includes('/'), false);
  assert.equal(nombre.includes('..'), false);
  assert.match(generarNombreSeguro(1134, 'png'), /\.png$/);
  assert.match(generarNombreSeguro(1134, 'webp'), /\.webp$/);
});
