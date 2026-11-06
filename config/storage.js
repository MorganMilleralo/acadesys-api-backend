'use strict';

const path = require('node:path');

// En local se usa backend/uploads. En hosting, definir UPLOADS_DIR apuntando
// a un volumen persistente (por ejemplo /var/data/uploads) antes de habilitar
// fotografías/materiales en producción. Una carpeta efímera se pierde al redeploy.
const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
);
const PROFILE_UPLOADS_DIR = path.join(UPLOADS_DIR, 'perfiles');
const MATERIAL_UPLOADS_DIR = path.join(UPLOADS_DIR, 'materiales');

module.exports = {
  UPLOADS_DIR,
  PROFILE_UPLOADS_DIR,
  MATERIAL_UPLOADS_DIR,
};
