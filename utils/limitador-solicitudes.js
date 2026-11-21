'use strict';

// Límite de solicitudes en memoria por ventana fija de un minuto.
// Suficiente para una sola instancia (Render gratuito); se reinicia al desplegar.
class LimitadorSolicitudes {
  constructor({ ventanaMs = 60_000, maxClaves = 10_000 } = {}) {
    this.ventanaMs = ventanaMs;
    this.maxClaves = maxClaves;
    this.contadores = new Map();
  }

  // Registra un intento y dice si está permitido.
  consumir(clave, limite, ahora = Date.now()) {
    let entrada = this.contadores.get(clave);
    if (!entrada || ahora >= entrada.reinicio) {
      entrada = { usados: 0, reinicio: ahora + this.ventanaMs };
      this.contadores.delete(clave);
      this.contadores.set(clave, entrada);
      if (this.contadores.size > this.maxClaves) {
        this.contadores.delete(this.contadores.keys().next().value);
      }
    }
    entrada.usados += 1;
    return {
      permitido: entrada.usados <= limite,
      limite,
      restantes: Math.max(0, limite - entrada.usados),
      reinicioSegundos: Math.max(1, Math.ceil((entrada.reinicio - ahora) / 1000)),
    };
  }

  // Consulta sin consumir (para bloquear antes de validar la clave).
  agotado(clave, limite, ahora = Date.now()) {
    const entrada = this.contadores.get(clave);
    return Boolean(entrada && ahora < entrada.reinicio && entrada.usados >= limite);
  }

  reiniciar() {
    this.contadores.clear();
  }
}

module.exports = { LimitadorSolicitudes };
