const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('UPLOADS_DIR controla el almacén compartido de perfiles y materiales', (t) => {
  const key = require.resolve('../config/storage');
  const original = process.env.UPLOADS_DIR;
  const custom = path.join(path.sep, 'tmp', 'acadesys-uploads-test');
  process.env.UPLOADS_DIR = custom;
  delete require.cache[key];
  const storage = require('../config/storage');
  assert.equal(storage.UPLOADS_DIR, path.resolve(custom));
  assert.equal(storage.PROFILE_UPLOADS_DIR, path.join(path.resolve(custom), 'perfiles'));
  assert.equal(storage.MATERIAL_UPLOADS_DIR, path.join(path.resolve(custom), 'materiales'));
  delete require.cache[key];
  if (original === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = original;
  require('../config/storage');
});
