'use strict';

// Respuesta de descarga de una boleta electrónica guardada en la base de datos.
function enviarArchivoBoleta(res, fila, formato) {
  const esXml = formato === 'xml';
  const contenido = esXml ? fila?.XmlArchivo : fila?.PdfArchivo;
  if (!fila || fila.Estado !== 'EMITIDA' || !contenido) {
    return res.status(404).json({
      code: 'BOLETA_NO_DISPONIBLE',
      error: fila?.Estado === 'ERROR' || fila?.Estado === 'EMITIENDO' || fila?.Estado === 'PENDIENTE'
        ? 'La boleta electrónica de esta cuota todavía se está emitiendo.'
        : 'Esta cuota no tiene boleta electrónica.',
    });
  }
  const numero = String(fila.NumeroCompleto || `boleta-${fila.IdPago}`).replace(/[^A-Za-z0-9-]/g, '');
  const buffer = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido);
  res.setHeader('Content-Type', esXml ? 'application/xml' : 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${numero}.${esXml ? 'xml' : 'pdf'}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(buffer);
}

function formatoSolicitado(req) {
  return String(req.query?.formato || 'pdf').toLowerCase() === 'xml' ? 'xml' : 'pdf';
}

function boletaPublica(fila) {
  if (!fila) return null;
  return {
    idPago: Number(fila.IdPago),
    estado: fila.Estado,
    numero: fila.NumeroCompleto || null,
    estadoSunat: fila.EstadoSunat || null,
    fechaEmision: fila.FechaEmision ? new Date(fila.FechaEmision).toISOString() : null,
    disponible: fila.Estado === 'EMITIDA' && Boolean(Number(fila.TienePdf)),
  };
}

module.exports = { enviarArchivoBoleta, formatoSolicitado, boletaPublica };
