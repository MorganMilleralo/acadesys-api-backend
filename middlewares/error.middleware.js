module.exports = (err, req, res, next) => {
  console.error('Error no controlado:', err);
  if (res.headersSent) return next(err);
  const status = err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 : 500;
  const error = status === 413 ? 'El cuerpo JSON supera el límite permitido de 15 MB.'
    : status === 400 ? 'El cuerpo JSON no es válido.' : 'Error interno del servidor.';
  return res.status(status).json({ error });
};
