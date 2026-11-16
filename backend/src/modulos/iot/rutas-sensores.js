// ============================================================
//  /api/sensores — Acciones de la pantalla Dispositivos (con sesión)
//
//    GET  /api/sensores/vivo                 Lo que cambia en vivo (la app lo pide cada 3 s)
//    POST /api/sensores                      Vincular un ESP32 nuevo (administrador)
//    POST /api/sensores/:id/conectar         Reactivar un dispositivo pausado
//    PUT  /api/sensores/:id/alimento         Qué alimento está sobre la báscula
//    POST /api/sensores/:id/calibrar         Tara o calibración con peso conocido
//
//  La calibración es real: el servidor manda el comando al ESP32 por
//  MQTT, el ESP32 lo ejecuta con el HX711, guarda el resultado en su
//  memoria y responde; aquí queda el registro en calibraciones_bascula.
// ============================================================
const crypto = require("crypto");
const express = require("express");
const { una, transaccion } = require("../../nucleo/db");
const { ErrorApp, async_, texto, numero, id } = require("../../nucleo/errores");
const { soloAdministrador, hash } = require("../auth/sesiones");
const { config } = require("../../nucleo/config");
const hogar = require("../hogar/estado");
const iot = require("./index");
const simulador = require("./simulador");

const router = express.Router();

// ---------- En vivo: dispositivos, últimas lecturas y lo que pesa cada báscula ----------
router.get("/vivo", async_(async (req, res) => {
  const h = req.usuario.hogarId;
  const [sensores, lecturas, productos] = await Promise.all([
    hogar.sensores(h),
    hogar.lecturas(h, { desde: req.query.desde, limite: 40 }),
    hogar.productos(h),
  ]);
  res.json({
    sensores,
    lecturas,
    // Solo los alimentos que pesa una báscula (son los que cambian solos)
    productos: productos.filter((p) => p.sensorId).map((p) => ({ id: p.id, cantidad: p.cantidad, capacidad: p.capacidad, caducidad: p.caducidad, historial: p.historial, consumoDiario: p.consumoDiario })),
  });
}));

async function dispositivoDelHogar(req) {
  const d = await una(
    `SELECT d.*, (v.en_linea = 1) AS en_linea FROM dispositivos_iot d
       JOIN vista_dispositivos v ON v.dispositivo_id = d.id
      WHERE d.hogar_id = ? AND d.id = ? AND d.estado <> 'baja'`,
    [req.usuario.hogarId, id(req.params.id)]
  );
  if (!d) throw new ErrorApp(404, "Ese dispositivo no existe.");
  return d;
}

// ---------- Vincular un ESP32 nuevo ----------
// Devuelve su identificador y su clave UNA sola vez: se escriben en el firmware.
router.post("/", soloAdministrador, async_(async (req, res) => {
  const u = req.usuario;
  const nombre = texto(req.body.nombre || "Báscula de la despensa", "El nombre", { max: 100 });
  const ubicacion = await una(
    "SELECT id FROM ubicaciones_almacenamiento WHERE hogar_id = ? AND (nombre = ? OR ? IS NULL) ORDER BY tipo = 'despensa' DESC, orden LIMIT 1",
    [u.hogarId, req.body.ubicacion || null, req.body.ubicacion || null]
  );
  const identificador = `esp32-${crypto.randomBytes(3).toString("hex")}`;
  const clave = crypto.randomBytes(12).toString("base64url"); // 16 caracteres
  const nuevo = await transaccion(async (c) => {
    const [r] = await c.query(
      `INSERT INTO dispositivos_iot (hogar_id, identificador, nombre, tipo, modelo, ubicacion_id, clave_hash, capacidad_g)
       VALUES (?, ?, ?, 'bascula', 'ESP32 + HX711 + DHT22', ?, ?, 5000)`,
      [u.hogarId, identificador, nombre, ubicacion ? ubicacion.id : null, hash(clave)]
    );
    await c.query("INSERT INTO eventos_dispositivo (hogar_id, dispositivo_id, tipo, usuario_id, detalle) VALUES (?, ?, 'vinculado', ?, 'Desde la app')",
      [u.hogarId, r.insertId, u.id]);
    return r.insertId;
  });
  res.status(201).json({ id: nuevo, identificador, clave, mqtt: { prefijo: iot.temas.PREFIJO, puerto: config.mqtt.puertoInterno } });
}));

// ---------- Reactivar ----------
router.post("/:id/conectar", async_(async (req, res) => {
  const u = req.usuario;
  const d = await dispositivoDelHogar(req);
  await transaccion(async (c) => {
    await c.query("UPDATE dispositivos_iot SET estado = 'activo' WHERE id = ?", [d.id]);
    await c.query("INSERT INTO eventos_dispositivo (hogar_id, dispositivo_id, tipo, usuario_id, detalle) VALUES (?, ?, 'reanudado', ?, 'Desde la app')", [u.hogarId, d.id, u.id]);
  });
  simulador.encender(d.identificador); // solo tiene efecto si el simulador está activo
  // Se le pide al ESP32 que reporte su estado (si está conectado responde enseguida)
  let respondio = false;
  if (iot.estaConectado()) {
    respondio = await iot.enviarComando(d.identificador, "reportar", {}, { espera: 4000 }).then(() => true, () => false);
  }
  const v = await una("SELECT en_linea FROM vista_dispositivos WHERE dispositivo_id = ?", [d.id]);
  res.json({ ok: true, enLinea: respondio || Boolean(v && v.en_linea) });
}));

// ---------- Alimento sobre la báscula ----------
// La celda mide gramos. Se convierte a la unidad del alimento SOLO cuando
// la conversión es exacta: g, kg, o piezas con un peso por pieza conocido.
router.put("/:id/alimento", async_(async (req, res) => {
  const u = req.usuario;
  const d = await dispositivoDelHogar(req);
  if (d.tipo !== "bascula") throw new ErrorApp(400, "Este dispositivo no es una báscula.");
  const alimentoId = id(req.body.alimentoId, "El alimento");
  const canal = 1; // una sola celda de carga
  const a = await una(
    `SELECT a.id, a.nombre, um.codigo AS unidad, a.peso_unitario_g FROM alimentos a JOIN unidades_medida um ON um.id = a.unidad_id
      WHERE a.hogar_id = ? AND a.id = ? AND a.activo`, [u.hogarId, alimentoId]
  );
  if (!a) throw new ErrorApp(404, "Ese alimento no existe.");

  let pesoUnitario = a.peso_unitario_g ? Number(a.peso_unitario_g) : null;
  if (a.unidad === "pz") pesoUnitario = numero(req.body.pesoUnitarioG ?? pesoUnitario, "El peso de una pieza", { min: 0.1, max: 5000 });
  const FACTOR = { g: 1, kg: 0.001, pz: pesoUnitario ? 1 / pesoUnitario : null };
  const factor = FACTOR[a.unidad];
  if (!factor) {
    throw new ErrorApp(400, `${a.nombre} se mide en ${a.unidad}. La báscula solo puede llevar alimentos en g, kg o piezas (indicando cuánto pesa una pieza).`);
  }

  await transaccion(async (c) => {
    if (a.unidad === "pz") await c.query("UPDATE alimentos SET peso_unitario_g = ? WHERE id = ?", [pesoUnitario, a.id]);
    await c.query("DELETE FROM dispositivo_alimentos WHERE dispositivo_id = ? AND (canal = ? OR alimento_id = ?)", [d.id, canal, a.id]);
    await c.query(
      "INSERT INTO dispositivo_alimentos (hogar_id, dispositivo_id, canal, alimento_id, factor_conversion, tara) VALUES (?, ?, ?, ?, ?, 0)",
      [u.hogarId, d.id, canal, a.id, Math.round(factor * 1e6) / 1e6]
    );
    await c.query("INSERT INTO eventos_dispositivo (hogar_id, dispositivo_id, tipo, usuario_id, detalle) VALUES (?, ?, 'vinculado', ?, ?)",
      [u.hogarId, d.id, u.id, a.nombre]);
  });
  iot.procesar.reiniciarEstabilidad(d.id);
  res.json({ ok: true });
}));

// ---------- Calibrar ----------
//  paso "tara":   plataforma (con el frasco vacío) → el ESP32 pone el cero
//  paso "factor": se coloca un peso conocido → el ESP32 calcula su factor
router.post("/:id/calibrar", async_(async (req, res) => {
  const u = req.usuario;
  const d = await dispositivoDelHogar(req);
  if (d.tipo !== "bascula") throw new ErrorApp(400, "Este dispositivo no es una báscula.");
  if (!config.mqtt.habilitado) throw new ErrorApp(409, "La calibración necesita MQTT (MQTT_HABILITADO=true).");
  if (!d.en_linea) throw new ErrorApp(409, "La báscula no está en línea. Revisa el cable USB y el WiFi.");
  const paso = req.body.paso === "factor" ? "factor" : "tara";
  const pesoReferencia = paso === "factor" ? numero(req.body.pesoReferencia, "El peso de referencia", { min: 10, max: Number(d.capacidad_g) || 5000 }) : null;

  const r = await iot.enviarComando(d.identificador, paso === "tara" ? "tara" : "calibrar", pesoReferencia ? { pesoReferencia } : {}, { espera: 20000 });
  if (!r.ok) throw new ErrorApp(422, r.mensaje || "El dispositivo no pudo calibrarse. Intenta de nuevo sin mover la báscula.");

  await transaccion(async (c) => {
    await c.query(
      `INSERT INTO calibraciones_bascula (hogar_id, dispositivo_id, tipo, offset_crudo, factor_calibracion, peso_referencia_g, usuario_id, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.hogarId, d.id, paso, Number.isFinite(Number(r.offset)) ? Math.round(Number(r.offset)) : (paso === "tara" ? 0 : null),
       paso === "factor" ? Number(r.factor) : null, pesoReferencia, u.id, r.mensaje ? String(r.mensaje).slice(0, 255) : null]
    );
    await c.query("UPDATE dispositivos_iot SET ultima_calibracion = NOW() WHERE id = ?", [d.id]);
    await c.query("INSERT INTO eventos_dispositivo (hogar_id, dispositivo_id, tipo, usuario_id, detalle) VALUES (?, ?, 'calibrado', ?, ?)",
      [u.hogarId, d.id, u.id, paso === "tara" ? "Tara (cero)" : `Factor con ${pesoReferencia} g`]);
  });
  iot.procesar.reiniciarEstabilidad(d.id);
  res.json({ ok: true, paso, factor: r.factor ?? null, offset: r.offset ?? null, pesoMedido: r.pesoMedido ?? null });
}));

module.exports = router;
