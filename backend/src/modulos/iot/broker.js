// ============================================================
//  Broker MQTT interno (Aedes)
//
//  Con MQTT_BROKER_INTERNO=true el servidor escucha MQTT en el puerto
//  MQTT_PUERTO_INTERNO (1883). No hay que instalar Mosquitto.
//
//  Seguridad:
//   * Usuario = identificador del ESP32, contraseña = su clave
//     (se compara con el hash de dispositivos_iot).
//   * Cada ESP32 solo publica en despensa/<su id>/... y solo se
//     suscribe a despensa/<su id>/comandos.
//   * El servidor entra con MQTT_USUARIO / MQTT_CLAVE.
// ============================================================
const net = require("net");
const crypto = require("crypto");
const { Aedes } = require("aedes");
const { config } = require("../../nucleo/config");
const temas = require("./temas");
const dispositivos = require("./dispositivos");

const igual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function errorAuth(codigo, texto) {
  const e = new Error(texto);
  e.returnCode = codigo; // 4 = usuario o contraseña incorrectos, 5 = no autorizado
  return e;
}

async function iniciar() {
  const broker = await Aedes.createBroker({ drainTimeout: 30000, connectTimeout: 15000 });

  broker.authenticate = (client, usuario, clave, cb) => {
    const textoClave = clave ? clave.toString() : "";
    if (usuario === config.mqtt.usuario) {
      if (igual(textoClave, config.mqtt.clave)) { client.qhdc = { servidor: true }; return cb(null, true); }
      return cb(errorAuth(4, "Credenciales del servidor incorrectas"), false);
    }
    dispositivos.autenticar(usuario, textoClave)
      .then((d) => {
        if (!d) return cb(errorAuth(4, "Dispositivo no reconocido"), false);
        client.qhdc = { identificador: d.identificador };
        cb(null, true);
      })
      .catch((e) => cb(errorAuth(3, `Servidor no disponible: ${e.message}`), false));
  };

  broker.authorizePublish = (client, packet, cb) => {
    if (packet.topic.startsWith("$SYS")) return cb(new Error("Topic reservado"));
    if (!client) return cb(null); // última voluntad de un cliente que ya se fue
    const q = client.qhdc || {};
    const t = temas.analizar(packet.topic);
    if (q.servidor) return cb(t ? null : new Error("Topic fuera del prefijo"));
    if (t && t.identificador === q.identificador && temas.puedePublicar(t.identificador, t.sufijo)) return cb(null);
    cb(new Error(`${q.identificador || "?"} no puede publicar en ${packet.topic}`));
  };

  broker.authorizeSubscribe = (client, sub, cb) => {
    const q = client.qhdc || {};
    if (q.servidor && sub.topic.startsWith(`${temas.PREFIJO}/`)) return cb(null, sub);
    if (q.identificador && sub.topic === temas.tema(q.identificador, "comandos")) return cb(null, sub);
    cb(null, null); // se niega sin desconectar (SUBACK 128)
  };

  broker.on("clientError", (client, err) => {
    const quien = client && client.qhdc ? client.qhdc.identificador || "servidor" : client && client.id;
    console.warn(`⚠ MQTT ${quien}: ${err.message}`);
  });

  const servidor = net.createServer(broker.handle);
  await new Promise((ok, mal) => {
    servidor.once("error", mal);
    servidor.listen(config.mqtt.puertoInterno, "0.0.0.0", ok);
  });

  return {
    async cerrar() {
      await new Promise((ok) => servidor.close(() => ok()));
      await new Promise((ok) => broker.close(() => ok()));
    },
  };
}

module.exports = { iniciar };
