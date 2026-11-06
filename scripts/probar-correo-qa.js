'use strict';

// Envío controlado de UN correo de prueba a un buzón que administra el equipo.
// No imprime destinatario ni URL secreta. No procesa matrículas ni accede a MySQL.
require('dotenv').config({ quiet: true });

const { GOOGLE_SCRIPT_URL, QA_EMAIL_DESTINO, CONFIRMAR_ENVIO_CORREO_QA } = process.env;

function detener(mensaje) {
  console.error(mensaje);
  process.exitCode = 1;
}

async function main() {
  if (CONFIRMAR_ENVIO_CORREO_QA !== 'SI') {
    return detener('Envío cancelado. Para autorizarlo expresamente, configura CONFIRMAR_ENVIO_CORREO_QA=SI en el .env local.');
  }
  if (!GOOGLE_SCRIPT_URL || !QA_EMAIL_DESTINO) {
    return detener('Envío cancelado. Deben existir GOOGLE_SCRIPT_URL y QA_EMAIL_DESTINO en el entorno local.');
  }

  let endpoint;
  try {
    endpoint = new URL(GOOGLE_SCRIPT_URL);
    if (endpoint.protocol !== 'https:') throw new Error('scheme');
  } catch {
    return detener('Envío cancelado: GOOGLE_SCRIPT_URL debe ser una URL HTTPS válida.');
  }

  const destino = QA_EMAIL_DESTINO.trim();
  if (destino.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino)) {
    return detener('Envío cancelado: QA_EMAIL_DESTINO no parece un correo válido.');
  }

  const fecha = new Date().toISOString();
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2>Prueba técnica de correo - AcadeSys</h2>
      <p>Este mensaje confirma que el servicio de correo respondió a una prueba controlada.</p>
      <p>Marca QA: MORGAN-MAIL-CHECK</p>
      <p>Fecha UTC: ${fecha}</p>
      <p>Este mensaje no registra matrícula ni confirma un cobro.</p>
    </div>`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: destino,
        subject: '[QA] Verificación de correo AcadeSys',
        htmlBody,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.status !== 'success') {
      return detener(`El proveedor no confirmó éxito (HTTP ${response.status}). Revisa el servicio desde el hosting, sin compartir secretos.`);
    }
    console.log('OK: el proveedor confirmó el envío al buzón de QA configurado.');
    console.log('Comprueba recepción y spam manualmente. Este resultado no sustituye el flujo real de matrícula/recuperación.');
  } catch (error) {
    const tipo = error?.name || 'Error';
    return detener(`Falló la prueba de correo (${tipo}). No se muestran URL, destinatario ni contenido sensible.`);
  }
}

main().catch(() => detener('Falló la prueba de correo por un error no detallado.'));
