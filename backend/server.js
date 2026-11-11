// ============================================================
//  QHDC! — ¿Qué Hay de Comer?  ·  Arranque del servidor
//
//  1. Lee y valida backend/.env (src/nucleo/config.js)
//  2. Comprueba MySQL, enciende MQTT y abre la app (src/app.js)
//  3. Tareas de cada hora: resumir lecturas y borrar fotos vencidas
//
//  Arranque:  npm install   →   npm start   →   http://localhost:3000
// ============================================================
const { config, advertencias } = require("./src/nucleo/config"); // primero: carga y valida .env

const { probarConexion, consulta } = require("./src/nucleo/db");
const imagenes = require("./src/nucleo/imagenes");
const { crearApp } = require("./src/app");
const iot = require("./src/modulos/iot");
const simulador = require("./src/modulos/iot/simulador");

const app = crearApp();
const PUERTO = config.puerto;

// ---------- Arranque ----------
async function arrancar() {
  try {
    const db = await probarConexion();
    console.log(`✔ MySQL ${db.version} · base "${db.base}" · ${db.ahora}`);
  } catch (e) {
    console.error("✖ No se pudo conectar a MySQL:", e.message);
    console.error("  Revisa que MySQL esté encendido, que ejecutaste database/qhdc_base_de_datos.sql");
    console.error("  y los datos DB_... de backend/.env");
    process.exit(1);
  }

  advertencias().forEach((a) => console.warn(`⚠ ${a}`));

  // MQTT: broker interno (si está activado) + cliente del servidor
  let mqttActivo = false;
  try {
    const r = await iot.iniciar();
    mqttActivo = r.activo;
    if (r.activo) {
      console.log(r.interno
        ? `✔ Broker MQTT interno escuchando en el puerto ${config.mqtt.puertoInterno} (los ESP32 se conectan a la IP de esta computadora)`
        : `✔ Conectado al broker MQTT ${config.mqtt.url.replace(/\/\/[^@]*@/, "//")}`);
    }
  } catch (e) {
    console.error("✖ MQTT no arrancó:", e.message);
    console.error("  La app sigue funcionando; los ESP32 pueden usar POST /api/iot/lecturas mientras tanto.");
  }

  app.listen(PUERTO, () => {
    console.log(`✔ QHDC! listo en http://localhost:${PUERTO} (${config.produccion ? "producción" : "desarrollo"})`);
    if (config.simulador && config.simuladorDispositivo.identificador && config.simuladorDispositivo.clave) {
      simulador.iniciar(`http://localhost:${PUERTO}`, { intervalo: config.simuladorIntervalo, mqtt: mqttActivo, simula: config.simuladorSensores });
      console.log(`✔ Simulador de ESP32 por ${mqttActivo ? "MQTT" : "HTTP"}: simula ${config.simuladorSensores.join(" + ")} (SIMULADOR=false para apagarlo)`);
    }
  });

  // Cada hora: se resume el historial por hora (lecturas_resumen_hora) y se
  // borran las lecturas individuales de más de 7 días.
  const limpiar = async () => {
    try {
      await consulta("CALL sp_resumir_lecturas()");
      await consulta("DELETE FROM lecturas_sensor WHERE recibido_en < NOW() - INTERVAL 7 DAY");
    } catch (e) {
      console.warn("⚠ No se pudo resumir/limpiar el historial de lecturas:", e.message);
    }
    // Fotos: se borran los archivos que pasaron su tiempo de retención
    try {
      const n = await imagenes.limpiarVencidas();
      if (n) console.log(`✔ ${n} foto(s) vencida(s) borrada(s)`);
    } catch (e) {
      console.warn("⚠ No se pudieron borrar las fotos vencidas:", e.message);
    }
  };
  limpiar();
  setInterval(limpiar, 60 * 60 * 1000);
}

arrancar();
