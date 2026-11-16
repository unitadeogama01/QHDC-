// ============================================================
//  Procesamiento de lecturas de los ESP32 (MQTT y HTTP)
//
//  Reglas para que un sensor nunca cambie mal el inventario:
//   1. Mensaje repetido (mismo msgId del mismo ESP32) → se ignora.
//   2. Valor fuera de rango, báscula sin alimento asignado o lectura
//      marcada como inestable por el ESP32 → se GUARDA como inválida
//      (con su motivo) pero no toca el inventario.
//   3. Peso válido → solo se aplica al inventario cuando llegan
//      `lecturas_estables` lecturas seguidas parecidas (diferencia menor
//      a `umbral_cambio_g`). Así, levantar un frasco un momento no
//      registra un consumo falso.
//   4. Temperatura y humedad solo se registran: nunca deciden por sí
//      solas si un alimento está en buen o mal estado.
//   5. La hora del ESP32 se usa si es razonable (±10 min); si no, la del
//      servidor.
// ============================================================
const { pool } = require("../../nucleo/db");
const { canales } = require("./dispositivos");

const UNIDAD = { peso: "g", gas: "ppm", temperatura: "°C", humedad: "%", bateria: "%", otro: "" };
// Rangos físicos de los sensores del proyecto
const RANGO = {
  temperatura: [-40, 80], // DHT22
  humedad: [0, 100],      // DHT22
  bateria: [0, 100],
  gas: [0, 10000],
};
const DESFASE_MAX_MS = 10 * 60 * 1000;
const RUIDO_NEGATIVO_G = 20; // una celda en cero puede marcar -2 g; -20 g o menos indica mala tara

// Últimos pesos válidos por dispositivo y canal (para la regla de estabilidad)
const ventanas = new Map();

function estable(d, canal, valor) {
  const clave = `${d.id}:${canal}`;
  const n = Math.max(1, Number(d.lecturas_estables) || 1);
  const v = (ventanas.get(clave) || []).concat(valor).slice(-n);
  ventanas.set(clave, v);
  if (v.length < n) return false;
  return Math.max(...v) - Math.min(...v) <= Math.max(1, Number(d.umbral_cambio_g) || 0);
}

/** Olvida la ventana de estabilidad (después de calibrar o cambiar el alimento). */
function reiniciarEstabilidad(dispositivoId) {
  for (const k of ventanas.keys()) if (k.startsWith(`${dispositivoId}:`)) ventanas.delete(k);
}

/** Revisa una lectura y devuelve { valido, motivo, valor } */
function validar(d, l, canal) {
  const valor = Number(l.valor);
  if (l.tipo === "peso") {
    if (!canal) return { valido: false, motivo: "La báscula no tiene un alimento asignado", valor };
    if (l.estable === false) return { valido: false, motivo: "Lectura inestable: la báscula se estaba moviendo", valor };
    if (valor <= -RUIDO_NEGATIVO_G) return { valido: false, motivo: "Peso negativo: hay que volver a poner la báscula en cero (tara)", valor };
    const cap = Number(d.capacidad_g);
    if (cap && valor > cap * 1.05) return { valido: false, motivo: `Supera la capacidad de la celda (${cap} g)`, valor };
    return { valido: true, motivo: null, valor: Math.max(0, valor) }; // -2 g de ruido cuenta como 0
  }
  const rango = RANGO[l.tipo];
  if (rango && (valor < rango[0] || valor > rango[1])) {
    return { valido: false, motivo: `Fuera del rango del sensor (${rango[0]} a ${rango[1]} ${UNIDAD[l.tipo]})`, valor };
  }
  return { valido: true, motivo: null, valor };
}

/** Marca de tiempo del ESP32 en milisegundos, o null si no viene o no es razonable. */
function horaDispositivo(ts) {
  if (ts === undefined || ts === null || ts === "") return null;
  const ms = typeof ts === "number" ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(ts); // acepta segundos, ms o ISO
  return Number.isFinite(ms) && ms > 1.6e12 ? ms : null;
}

/**
 * Guarda un grupo de lecturas de un dispositivo.
 * @param d        dispositivo (de dispositivos.autenticar / porIdentificador)
 * @param lecturas [{ tipo, valor, unidad?, canal?, msgId?, ts?, estable?, crudo? }]
 * @param origen   'mqtt' | 'http' | 'simulador'
 */
async function registrarLecturas(d, lecturas, { origen = "http" } = {}) {
  const r = { guardadas: 0, invalidas: 0, duplicadas: 0, aplicadas: 0, ignoradas: 0 };
  if (d.estado !== "activo") { r.ignoradas = lecturas.length; return r; } // pausado o en mantenimiento

  const asignados = lecturas.some((l) => l.tipo === "peso") ? await canales(d.id) : [];

  for (const l of lecturas.slice(0, 20)) {
    if (!Object.prototype.hasOwnProperty.call(UNIDAD, l.tipo) || !Number.isFinite(Number(l.valor))) { r.ignoradas++; continue; }
    const numCanal = Number(l.canal) || 1;
    const canal = l.tipo === "peso" ? asignados.find((c) => c.canal === numCanal) : null;
    const v = validar(d, l, canal);

    const ms = horaDispositivo(l.ts);
    const confiable = ms !== null && Math.abs(ms - Date.now()) <= DESFASE_MAX_MS;
    const msgId = l.msgId ? String(l.msgId).slice(0, 64) : null;

    let id;
    try {
      const [ins] = await pool.query(
        `INSERT INTO lecturas_sensor (hogar_id, dispositivo_id, alimento_id, tipo_lectura, valor, valor_crudo, unidad,
                                      msg_id, origen, leido_dispositivo_en, leido_en, valido, motivo_invalidez)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, FROM_UNIXTIME(? / 1000)),
                 IF(?, FROM_UNIXTIME(? / 1000), NOW(3)), ?, ?)`,
        [d.hogar_id, d.id, canal ? canal.alimento_id : null, l.tipo, v.valor,
         Number.isFinite(Number(l.crudo)) ? Number(l.crudo) : null,
         l.unidad ? String(l.unidad).slice(0, 20) : UNIDAD[l.tipo],
         msgId, origen, ms, ms, confiable, ms, v.valido, v.motivo]
      );
      id = ins.insertId;
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") { r.duplicadas++; continue; } // el ESP32 reenvió el mismo mensaje
      throw e;
    }
    r.guardadas++;
    if (!v.valido) { r.invalidas++; continue; }

    // El peso se convierte en consumo o entrada dentro de la base, solo si es estable
    if (l.tipo === "peso" && estable(d, numCanal, v.valor)) {
      await pool.query("CALL sp_aplicar_lectura_peso(?)", [id]);
      r.aplicadas++;
    }
  }
  return r;
}

module.exports = { registrarLecturas, reiniciarEstabilidad, UNIDAD, RANGO, reglas: { validar, estable, horaDispositivo } };
