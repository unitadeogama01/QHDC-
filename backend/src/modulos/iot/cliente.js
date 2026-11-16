// ============================================================
//  Cliente MQTT del servidor
//
//  Se suscribe a lo que publican los ESP32, valida y guarda las
//  lecturas (procesar.js), registra si un dispositivo se conecta o
//  desconecta, y envía comandos (tara, calibrar) esperando la respuesta.
// ============================================================
const crypto = require("crypto");
const mqtt = require("mqtt");
const { config } = require("../../nucleo/config");
const temas = require("./temas");
const dispositivos = require("./dispositivos");
const { registrarLecturas } = require("./procesar");

let cliente = null;
let conectado = false;
const pendientes = new Map();   // solicitudId → { resolver, rechazar, temporizador, identificador }
const colas = new Map();        // identificador → promesa (procesa en orden lo de cada ESP32)

function leerJson(payload) {
  const texto = payload.toString("utf8").trim();
  if (!texto) return {};
  try { return JSON.parse(texto); } catch (e) { return { valor: texto }; } // "23.5" o "fuera_de_linea" a secas
}

/** Procesa los mensajes de cada ESP32 uno por uno y en orden. */
function enCola(identificador, trabajo) {
  const anterior = colas.get(identificador) || Promise.resolve();
  const siguiente = anterior.then(trabajo).catch((e) => console.warn(`⚠ MQTT ${identificador}: ${e.message}`));
  colas.set(identificador, siguiente);
  siguiente.finally(() => { if (colas.get(identificador) === siguiente) colas.delete(identificador); });
}

async function alRecibir(topic, payload) {
  const t = temas.analizar(topic);
  if (!t) return;
  const datos = leerJson(payload);

  // Respuesta a un comando: no necesita la base
  if (t.sufijo === "respuestas") {
    const p = pendientes.get(String(datos.solicitudId || ""));
    if (p && p.identificador === t.identificador) {
      clearTimeout(p.temporizador);
      pendientes.delete(String(datos.solicitudId));
      p.resolver(datos);
    }
    return;
  }

  enCola(t.identificador, async () => {
    const d = await dispositivos.porIdentificador(t.identificador);
    if (!d) return; // dispositivo desconocido o dado de baja: se ignora

    if (t.sufijo === "estado") {
      const valor = String(datos.estado || datos.valor || "").toLowerCase();
      // El broker guarda solo el ÚLTIMO mensaje retenido de este topic (la
      // última voluntad lo reemplaza), así que siempre es el estado vigente.
      const enLinea = ["en_linea", "online", "conectado"].includes(valor);
      await dispositivos.marcarConexion(d, enLinea ? "en_linea" : "fuera_de_linea", {
        ip: datos.ip ? String(datos.ip).slice(0, 45) : null,
        rssi: Number(datos.rssi),
        firmware: datos.firmware ? String(datos.firmware).slice(0, 40) : null,
      });
      return;
    }

    const tipo = temas.LECTURAS[t.sufijo];
    if (!tipo) return;
    await registrarLecturas(d, [{ ...datos, tipo }], { origen: "mqtt" });
  });
}

async function conectar() {
  cliente = await mqtt.connectAsync(config.mqtt.url, {
    username: config.mqtt.usuario,
    password: config.mqtt.clave,
    clientId: `qhdc-servidor-${crypto.randomBytes(4).toString("hex")}`,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    clean: true,
  });
  conectado = true;
  cliente.on("connect", () => {
    conectado = true;
    cliente.subscribe(temas.SUSCRIPCIONES, { qos: 1 });
  });
  cliente.on("close", () => { conectado = false; });
  cliente.on("error", (e) => console.warn("⚠ MQTT (servidor):", e.message));
  cliente.on("message", (topic, payload) => {
    alRecibir(topic, payload).catch((e) => console.warn("⚠ MQTT:", e.message));
  });
  await cliente.subscribeAsync(temas.SUSCRIPCIONES, { qos: 1 });
}

/**
 * Manda un comando a un ESP32 y espera su respuesta.
 * @returns la respuesta del dispositivo: { ok, mensaje, offset, factor, ... }
 */
function enviarComando(identificador, cmd, datos = {}, { espera = 15000 } = {}) {
  if (!cliente || !conectado) {
    const e = new Error("El servidor no está conectado al broker MQTT.");
    e.estado = 503;
    return Promise.reject(e);
  }
  const solicitudId = crypto.randomBytes(8).toString("hex");
  return new Promise((resolver, rechazar) => {
    const temporizador = setTimeout(() => {
      pendientes.delete(solicitudId);
      const e = new Error("El dispositivo no respondió. Revisa que esté encendido y conectado al WiFi.");
      e.estado = 504;
      rechazar(e);
    }, espera);
    pendientes.set(solicitudId, { resolver, rechazar, temporizador, identificador });
    cliente.publish(temas.tema(identificador, "comandos"), JSON.stringify({ solicitudId, cmd, ...datos }), { qos: 1 }, (err) => {
      if (!err) return;
      clearTimeout(temporizador);
      pendientes.delete(solicitudId);
      rechazar(err);
    });
  });
}

async function cerrar() {
  if (cliente) await cliente.endAsync().catch(() => {});
  cliente = null;
  conectado = false;
}

module.exports = { conectar, enviarComando, cerrar, estaConectado: () => conectado };
