// ============================================================
//  Configuración central
//
//  Lee las variables de backend/.env una sola vez y las valida.
//  Así el mismo código corre en local y en Hostinger: solo
//  cambian los valores del .env (ver .env.example).
// ============================================================
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env"), quiet: true }); // backend/.env

const env = process.env;

const entero = (nombre, porDefecto) => {
  if (env[nombre] === undefined || env[nombre] === "") return porDefecto;
  const n = Number(env[nombre]);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${nombre} debe ser un número entero positivo (recibido: "${env[nombre]}").`);
  return n;
};
const booleano = (nombre, porDefecto) => {
  const v = String(env[nombre] ?? "").trim().toLowerCase();
  if (v === "") return porDefecto;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`${nombre} debe ser "true" o "false" (recibido: "${env[nombre]}").`);
};

const produccion = env.NODE_ENV === "produccion" || env.NODE_ENV === "production";

// TRUST_PROXY acepta un número de saltos (0, 1, 2…) o nombres de Express
// como "loopback" o "loopback, 10.0.0.0/8". "true" no se permite: dejaría
// que cualquiera falsee su IP y se salte los límites de peticiones.
function confianzaProxy(valor, porDefecto) {
  const v = String(valor ?? "").trim();
  if (v === "") return porDefecto;
  if (/^\d+$/.test(v)) return Number(v);
  if (v.toLowerCase() === "true") throw new Error('TRUST_PROXY=true no es seguro: usa un número (1) o "loopback".');
  if (v.toLowerCase() === "false") return 0;
  return v;
}

const config = {
  produccion,
  puerto: entero("PUERTO", 3000),
  zonaHoraria: env.ZONA_HORARIA || "-06:00",
  db: {
    host: env.DB_HOST || "localhost",
    puerto: entero("DB_PUERTO", 3306),
    usuario: env.DB_USUARIO || "root",
    contrasena: env.DB_CONTRASENA || "",
    nombre: env.DB_NOMBRE || "qhdc",
    conexiones: entero("DB_CONEXIONES", 10), // conexiones simultáneas a MySQL
  },
  // El simulador solo arranca si se pide de forma explícita
  simulador: booleano("SIMULADOR", false),
  simuladorIntervalo: entero("SIMULADOR_INTERVALO", 3000),
  // Qué sensores simula: "bascula", "dht22" o ambos separados por coma.
  // Así se simula solo lo que todavía no está conectado de verdad.
  simuladorSensores: (env.SIMULADOR_SENSORES || "bascula,dht22").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  // Con qué dispositivo se conecta el simulador: uno vinculado en Dispositivos.
  // No hay clave predeterminada: una clave escrita en el código sería pública.
  simuladorDispositivo: {
    identificador: (env.SIMULADOR_IDENTIFICADOR || "").trim(),
    clave: (env.SIMULADOR_CLAVE || "").trim(),
  },
  cookieSegura: booleano("COOKIE_SEGURA", produccion),
  // Límites de peticiones por IP (frenan abusos). Se pueden subir SOLO para
  // pruebas de carga, donde todo sale de una misma computadora.
  limites: {
    apiPorMinuto: entero("LIMITE_API_POR_MINUTO", 300),
    accesoCada15Min: entero("LIMITE_ACCESO_15MIN", 40),
    registroPorHora: entero("LIMITE_REGISTRO_HORA", 10),
    fotosCada10Min: entero("LIMITE_FOTOS_10MIN", 40),
    iaCada10Min: entero("LIMITE_IA_10MIN", 60),
    iotPorMinuto: entero("LIMITE_IOT_POR_MINUTO", 120),
    intentosEntrarPorMinuto: entero("LIMITE_INTENTOS_ENTRAR", 8),
  },
  // En quién se confía para conocer la IP real del visitante (X-Forwarded-For):
  //   "loopback" (local) = solo programas de esta misma PC, como el túnel de
  //   Cloudflare; 1 = el proxy de Hostinger/Nginx; 0 = nadie.
  trustProxy: confianzaProxy(env.TRUST_PROXY, produccion ? 1 : "loopback"),
  // Comunicación con los ESP32 por MQTT
  mqtt: {
    habilitado: booleano("MQTT_HABILITADO", true),
    // true = el servidor trae su propio broker (Aedes): no hay que instalar nada.
    // false = se usa un broker externo (Mosquitto, HiveMQ Cloud, EMQX Cloud) en MQTT_URL.
    brokerInterno: booleano("MQTT_BROKER_INTERNO", true),
    puertoInterno: entero("MQTT_PUERTO_INTERNO", 1883),
    url: env.MQTT_URL || "",
    // Usuario con el que el servidor se conecta al broker (no es un ESP32)
    usuario: env.MQTT_USUARIO || "qhdc-servidor",
    clave: env.MQTT_CLAVE || "",
    prefijo: (env.MQTT_PREFIJO || "despensa").replace(/\/+$/, ""),
  },
};

// Fotos de alimentos e inteligencia artificial
config.imagenes = {
  // Carpeta PRIVADA (fuera de frontend/): las fotos solo se sirven por la API
  carpeta: path.resolve(__dirname, "..", "..", env.IMAGENES_CARPETA || "almacen/imagenes"), // relativa a backend/
  maxMB: entero("IMAGEN_MAX_MB", 10),
  retencionDias: entero("IMAGENES_RETENCION_DIAS", 30),
};
config.ia = {
  // Sin clave, el reconocimiento usa el modo de demostración (simulado)
  clave: env.ANTHROPIC_API_KEY || "",
  modelo: env.IA_MODELO || "claude-opus-5-5",
  confianzaMinima: Number(env.IA_CONFIANZA_MINIMA) || 0.6, // debajo de esto no se marca para guardar
};

// Inicio de sesión con Google (opcional): sin GOOGLE_CLIENT_ID no aparece el botón
config.google = { clientId: (env.GOOGLE_CLIENT_ID || "").trim() };

// Con broker interno, si no se definió una clave para el servidor se genera
// una al azar en cada arranque (el servidor y el broker están en el mismo proceso).
if (config.mqtt.habilitado && config.mqtt.brokerInterno) {
  if (!config.mqtt.clave) config.mqtt.clave = require("crypto").randomBytes(24).toString("hex");
  if (!config.mqtt.url) config.mqtt.url = `mqtt://127.0.0.1:${config.mqtt.puertoInterno}`;
}
if (config.mqtt.habilitado && !config.mqtt.brokerInterno && !config.mqtt.url) {
  throw new Error("MQTT_URL es obligatoria cuando MQTT_BROKER_INTERNO=false (p. ej. mqtts://tu-broker:8883).");
}
if (!/^[a-z0-9_-]+$/i.test(config.mqtt.prefijo)) {
  throw new Error(`MQTT_PREFIJO solo admite letras, números, - y _ (recibido: "${config.mqtt.prefijo}").`);
}

if (!/^[+-]\d{2}:\d{2}$/.test(config.zonaHoraria)) {
  throw new Error(`ZONA_HORARIA debe tener la forma -06:00 (recibido: "${config.zonaHoraria}").`);
}

/** Advertencias que no impiden arrancar, pero conviene ver. */
function advertencias() {
  const a = [];
  if (config.produccion && config.simulador) a.push("SIMULADOR=true en producción: se mezclarán datos simulados con los reales.");
  if (config.simulador && !(config.simuladorDispositivo.identificador && config.simuladorDispositivo.clave)) {
    a.push("SIMULADOR=true pero faltan SIMULADOR_IDENTIFICADOR y SIMULADOR_CLAVE: vincula un dispositivo en Dispositivos y copia sus datos en .env. El simulador no arrancará.");
  }
  const L = config.limites;
  if (config.produccion && (L.apiPorMinuto > 300 || L.accesoCada15Min > 40 || L.registroPorHora > 10 || L.intentosEntrarPorMinuto > 8)) {
    a.push("Límites de peticiones (LIMITE_*) más altos que los recomendados en producción: úsalos solo para pruebas de carga.");
  }
  if (config.produccion && !config.cookieSegura) a.push("COOKIE_SEGURA=false en producción: usa HTTPS y pon COOKIE_SEGURA=true.");
  if (config.produccion && !config.db.contrasena) a.push("DB_CONTRASENA está vacía en producción.");
  if (!config.ia.clave) a.push("Sin ANTHROPIC_API_KEY: el reconocimiento de fotos funciona en modo de demostración (simulado).");
  if (config.produccion && config.mqtt.habilitado && /^mqtt:\/\//.test(config.mqtt.url) && !config.mqtt.brokerInterno) {
    a.push("MQTT_URL usa mqtt:// sin cifrar en producción: usa mqtts:// (TLS).");
  }
  return a;
}

module.exports = { config, advertencias };
