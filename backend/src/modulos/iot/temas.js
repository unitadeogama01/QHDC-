// ============================================================
//  Topics MQTT (documentados en docs/mqtt.md)
//
//  Deben ser IGUALES en el firmware del ESP32 y aquí. <id> es el
//  identificador del dispositivo (p. ej. esp32-despensa-001).
//
//  ESP32 → servidor
//    despensa/<id>/bascula/peso          {msgId, ts, valor, unidad:"g", estable, crudo}
//    despensa/<id>/ambiente/temperatura  {msgId, ts, valor, unidad:"°C"}
//    despensa/<id>/ambiente/humedad      {msgId, ts, valor, unidad:"%"}
//    despensa/<id>/estado                {estado:"en_linea"|"fuera_de_linea", ip, rssi, firmware}  (retenido + última voluntad)
//    despensa/<id>/respuestas            {solicitudId, cmd, ok, offset, factor, mensaje}
//  Servidor → ESP32
//    despensa/<id>/comandos              {solicitudId, cmd:"tara"|"calibrar"|"reportar", pesoReferencia}
// ============================================================
const { config } = require("../../nucleo/config");

const P = config.mqtt.prefijo;

// Lo que publica un ESP32 y qué tipo de lectura representa
const LECTURAS = {
  "bascula/peso": "peso",
  "ambiente/temperatura": "temperatura",
  "ambiente/humedad": "humedad",
};

const tema = (identificador, sufijo) => `${P}/${identificador}/${sufijo}`;

/** Separa "despensa/<id>/bascula/peso" en { identificador, sufijo } o null. */
function analizar(topic) {
  const partes = String(topic).split("/");
  if (partes.length < 3 || partes[0] !== P) return null;
  return { identificador: partes[1], sufijo: partes.slice(2).join("/") };
}

/** Topics en los que un ESP32 puede publicar (todo bajo su propio identificador). */
const puedePublicar = (identificador, sufijo) =>
  Object.prototype.hasOwnProperty.call(LECTURAS, sufijo) || sufijo === "estado" || sufijo === "respuestas";

module.exports = {
  PREFIJO: P,
  LECTURAS,
  tema,
  analizar,
  puedePublicar,
  // Suscripciones del servidor
  SUSCRIPCIONES: [`${P}/+/bascula/peso`, `${P}/+/ambiente/+`, `${P}/+/estado`, `${P}/+/respuestas`],
};
