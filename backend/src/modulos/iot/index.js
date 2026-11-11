// ============================================================
//  Módulo IoT: arranque de MQTT (broker interno opcional + cliente)
// ============================================================
const { config } = require("../../nucleo/config");
const cliente = require("./cliente");

let broker = null;

async function iniciar() {
  if (!config.mqtt.habilitado) return { activo: false };
  if (config.mqtt.brokerInterno) {
    try {
      broker = await require("./broker").iniciar();
    } catch (e) {
      if (e.code === "EADDRINUSE") {
        throw new Error(`El puerto MQTT ${config.mqtt.puertoInterno} ya está ocupado (¿otro servidor o Mosquitto?). ` +
          "Cámbialo con MQTT_PUERTO_INTERNO o usa MQTT_BROKER_INTERNO=false.");
      }
      throw e;
    }
  }
  await cliente.conectar();
  return { activo: true, interno: Boolean(broker) };
}

async function detener() {
  await cliente.cerrar();
  if (broker) await broker.cerrar();
  broker = null;
}

module.exports = {
  iniciar,
  detener,
  enviarComando: cliente.enviarComando,
  estaConectado: cliente.estaConectado,
  procesar: require("./procesar"),
  dispositivos: require("./dispositivos"),
  temas: require("./temas"),
};
