// ============================================================
//  QHDC! — Simulador del ESP32 (celda de carga + HX711 + DHT22)
//
//  Hace exactamente lo que hace el firmware real (firmware/esp32-despensa):
//   * Con MQTT: se conecta al broker con su identificador y su clave,
//     publica peso, temperatura y humedad en los mismos topics, deja su
//     "última voluntad" (fuera_de_linea) y responde a los comandos de
//     tara y calibración.
//   * Sin MQTT: manda las lecturas por HTTP a /api/iot/lecturas.
//  Así, cuando se conecta el hardware, el resto del sistema no cambia.
//
//  Se puede usar de dos formas:
//   1) Dentro del servidor: SIMULADOR=true en .env
//   2) Aparte, en otra terminal:  npm run simulador
//      (con SIMULADOR=false en el servidor para que no haya dos)
//
//  IMPORTANTE: si el ESP32 real ya está conectado con el mismo
//  identificador, apaga el simulador (SIMULADOR=false).
// ============================================================
const crypto = require("crypto");
const { config } = require("../../nucleo/config");

// Un dispositivo vinculado en Dispositivos (SIMULADOR_IDENTIFICADOR y
// SIMULADOR_CLAVE en .env). En un ESP32 real esos datos van en
// firmware/esp32-despensa/config.h.
const DISPOSITIVOS = [
  { ...config.simuladorDispositivo, encendido: true },
];

const azar = (min, max) => min + Math.random() * (max - min);
const BOOT = crypto.randomBytes(2).toString("hex"); // como el ESP32: cambia en cada arranque

let base = null;
let temporizador = null;
let usarMqtt = false;
let urlMqtt = null;
let prefijo = "despensa";
let sensores = ["bascula", "dht22"]; // SIMULADOR_SENSORES: qué partes del ESP32 se simulan

async function post(ruta, cuerpo) {
  const r = await fetch(base + ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
  return json;
}

// ---------- Conexión MQTT de cada dispositivo simulado ----------
function conectarMqtt(disp) {
  if (disp.mqtt) return;
  const mqtt = require("mqtt");
  const t = (s) => `${prefijo}/${disp.identificador}/${s}`;
  disp.mqtt = mqtt.connect(urlMqtt, {
    username: disp.identificador,
    password: disp.clave,
    clientId: `${disp.identificador}-sim`,
    reconnectPeriod: 3000,
    // Si el "ESP32" se desconecta sin avisar, el broker publica esto
    will: { topic: t("estado"), payload: JSON.stringify({ estado: "fuera_de_linea" }), qos: 1, retain: true },
  });
  disp.mqtt.on("connect", () => {
    disp.mqtt.publish(t("estado"), JSON.stringify({ estado: "en_linea", ip: "127.0.0.1", rssi: -58, firmware: "simulador" }), { qos: 1, retain: true });
    disp.mqtt.subscribe(t("comandos"), { qos: 1 });
  });
  disp.mqtt.on("error", () => { /* credenciales incorrectas o broker apagado: reintenta solo */ });
  disp.mqtt.on("message", (topic, payload) => {
    let c = {};
    try { c = JSON.parse(payload.toString()); } catch (e) { return; }
    const responder = (r) => setTimeout(() => disp.mqtt.publish(t("respuestas"), JSON.stringify({ solicitudId: c.solicitudId, cmd: c.cmd, ...r }), { qos: 1 }), 900);
    const sinBascula = !sensores.includes("bascula") && (c.cmd === "tara" || c.cmd === "calibrar");
    if (sinBascula) responder({ ok: false, mensaje: "La báscula (HX711) todavía no está conectada." });
    else if (c.cmd === "tara") responder({ ok: true, offset: Math.round(azar(8_300_000, 8_500_000)), mensaje: "Tara lista (simulador)" });
    else if (c.cmd === "calibrar") {
      const ref = Number(c.pesoReferencia);
      if (!(ref > 0)) return responder({ ok: false, mensaje: "Falta el peso de referencia" });
      responder({ ok: true, factor: Math.round(azar(415, 425) * 1e4) / 1e4, pesoMedido: ref, mensaje: `Calibrada con ${ref} g (simulador)` });
    } else if (c.cmd === "reportar") {
      disp.mqtt.publish(t("estado"), JSON.stringify({ estado: "en_linea", ip: "127.0.0.1", rssi: -58, firmware: "simulador" }), { qos: 1, retain: true });
      responder({ ok: true });
    }
  });
}

// ---------- Lo que "mide" el dispositivo en esta vuelta ----------
async function medir(disp) {
  const cred = { identificador: disp.identificador, clave: disp.clave };
  // La configuración (qué alimento hay sobre la báscula) se pide por HTTP:
  // el simulador parte de lo que hay en la alacena para que los números cuadren.
  const cfg = await post("/api/iot/configuracion", cred);
  const lecturas = [];

  for (const c of sensores.includes("bascula") ? cfg.canales : []) {
    let cantidad = Number(c.cantidad);
    if (Math.random() < 0.02) cantidad -= c.capacidad * azar(0.005, 0.025); // de vez en cuando alguien toma un poco
    cantidad += azar(-0.8, 0.8);                                             // ruido de la celda de carga
    if (cantidad < c.capacidad * 0.05) cantidad = c.capacidad;              // compraron y rellenaron
    cantidad = Math.max(0, cantidad);
    // Cantidad del alimento -> gramos sobre la plataforma (inverso de factor y tara)
    const gramos = cantidad / Number(c.factor || 1) + Number(c.tara || 0);
    lecturas.push({ tipo: "peso", canal: c.canal, valor: Math.round(gramos * 10) / 10, unidad: "g", estable: true });
  }

  // DHT22: temperatura y humedad de la despensa (solo se puede leer cada 2 s)
  if (sensores.includes("dht22")) {
    disp.amb = disp.amb || { temp: cfg.ultimas.temperatura ?? 22.5, hum: cfg.ultimas.humedad ?? 50 };
    disp.amb.temp = Math.round(Math.min(26, Math.max(19, disp.amb.temp + azar(-0.15, 0.15))) * 10) / 10;
    disp.amb.hum = Math.round(Math.min(60, Math.max(40, disp.amb.hum + azar(-0.6, 0.6))) * 10) / 10;
    lecturas.push({ tipo: "temperatura", valor: disp.amb.temp, unidad: "°C" }, { tipo: "humedad", valor: disp.amb.hum, unidad: "%" });
  }

  disp.n = (disp.n || 0);
  const ts = Date.now();
  lecturas.forEach((l) => { l.msgId = `${BOOT}-${++disp.n}`; l.ts = ts; });

  if (usarMqtt) {
    conectarMqtt(disp);
    if (!disp.mqtt.connected) return 0;
    const SUFIJO = { peso: "bascula/peso", temperatura: "ambiente/temperatura", humedad: "ambiente/humedad" };
    for (const l of lecturas) {
      const { tipo, ...datos } = l;
      disp.mqtt.publish(`${prefijo}/${disp.identificador}/${SUFIJO[tipo]}`, JSON.stringify(datos), { qos: 1 });
    }
  } else {
    await post("/api/iot/lecturas", { ...cred, origen: "simulador", lecturas });
  }
  return lecturas.length;
}

async function ciclo({ silencioso }) {
  for (const d of DISPOSITIVOS.filter((x) => x.encendido)) {
    try {
      const n = await medir(d);
      if (!silencioso) console.log(`  ${d.identificador}: ${n} lecturas${usarMqtt ? " (MQTT)" : ""}`);
    } catch (e) {
      // 401 = ese dispositivo no existe en esta base; 423 = está en pausa
      if (!silencioso || !/no reconocido|pausa/.test(e.message)) console.warn(`  ${d.identificador}: ${e.message}`);
    }
  }
}

/** Arranca el simulador contra la URL del servidor */
function iniciar(url, { intervalo = 3000, silencioso = true, mqtt = false, simula = ["bascula", "dht22"] } = {}) {
  sensores = simula;
  base = url.replace(/\/$/, "");
  usarMqtt = mqtt;
  if (mqtt) {
    const { config } = require("../../nucleo/config");
    urlMqtt = config.mqtt.url;
    prefijo = config.mqtt.prefijo;
  }
  clearInterval(temporizador);
  temporizador = setInterval(() => ciclo({ silencioso }), intervalo);
  setTimeout(() => ciclo({ silencioso }), 500);
}

/** "Reintentar conexión" desde la app: el dispositivo vuelve a mandar datos */
function encender(identificador) {
  const d = DISPOSITIVOS.find((x) => x.identificador === identificador);
  if (d) d.encendido = true;
}

const activo = () => temporizador !== null;

module.exports = { iniciar, encender, activo };

// ---------- Uso independiente: npm run simulador ----------
if (require.main === module) {
  const { config } = require("../../nucleo/config");
  const url = process.env.SIMULADOR_URL || `http://localhost:${config.puerto}`;
  const conMqtt = config.mqtt.habilitado && !process.argv.includes("--http");
  console.log(`Simulador ESP32 → ${url} por ${conMqtt ? "MQTT " + config.mqtt.url : "HTTP"} (cada ${config.simuladorIntervalo / 1000} s). Ctrl + C para detener.`);
  iniciar(url, { intervalo: config.simuladorIntervalo, silencioso: false, mqtt: conMqtt, simula: config.simuladorSensores });
}
