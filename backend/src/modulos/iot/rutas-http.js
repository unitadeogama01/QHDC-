// ============================================================
//  /api/iot — Entrada HTTP para los ESP32 (alternativa a MQTT)
//
//  El camino principal es MQTT (ver src/modulos/iot y docs/mqtt.md).
//  Esta ruta se conserva para pruebas, para el simulador sin MQTT y
//  para un firmware que no pueda usar MQTT. Aplica exactamente las
//  mismas reglas (src/modulos/iot/procesar.js).
//
//  No usan cookie: cada dispositivo manda su identificador y su clave
//  (la base guarda solo el hash SHA-256 de la clave).
//
//  POST /api/iot/configuracion  → qué alimento hay en cada canal
//  POST /api/iot/lecturas       → manda lecturas
//  {
//    "identificador": "<identificador del dispositivo>",
//    "clave": "<la clave que dio Vincular dispositivo>",
//    "lecturas": [
//      { "tipo": "peso", "canal": 1, "valor": 812.5, "msgId": "a1-17", "estable": true },
//      { "tipo": "temperatura", "valor": 22.8 },
//      { "tipo": "humedad", "valor": 51 }
//    ]
//  }
// ============================================================
const express = require("express");
const { consulta } = require("../../nucleo/db");
const { ErrorApp, async_ } = require("../../nucleo/errores");
const { dispositivos, procesar } = require("./index");

const router = express.Router();

async function autenticar(req) {
  const { identificador, clave } = req.body || {};
  if (!identificador || !clave) throw new ErrorApp(401, "Faltan identificador y clave del dispositivo.");
  const d = await dispositivos.autenticar(identificador, clave);
  if (!d) throw new ErrorApp(401, "Dispositivo no reconocido.");
  return d;
}

router.post("/configuracion", async_(async (req, res) => {
  const d = await autenticar(req);
  const canales = await consulta(
    `SELECT da.canal, da.alimento_id, a.nombre, um.codigo AS unidad, a.cantidad_llena AS capacidad, da.tara, da.factor_conversion AS factor,
            (SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes_alimento l
              WHERE l.hogar_id = da.hogar_id AND l.alimento_id = da.alimento_id AND l.estado = 'disponible') AS cantidad
       FROM dispositivo_alimentos da
       JOIN alimentos a ON a.hogar_id = da.hogar_id AND a.id = da.alimento_id AND a.activo
       JOIN unidades_medida um ON um.id = a.unidad_id
      WHERE da.dispositivo_id = ? AND da.activo ORDER BY da.canal`,
    [d.id]
  );
  // Última lectura válida de cada tipo, usando el índice (dispositivo, tipo, fecha):
  // agrupar todas las lecturas del dispositivo era lento con una semana de datos.
  const ultimas = (await consulta(
    `SELECT t.tipo AS tipo_lectura,
            (SELECT s.valor FROM lecturas_sensor s FORCE INDEX (idx_lecturas_tipo)
              WHERE s.dispositivo_id = ? AND s.tipo_lectura = t.tipo AND s.valido
              ORDER BY s.leido_en DESC LIMIT 1) AS valor
       FROM (SELECT 'peso' AS tipo UNION ALL SELECT 'temperatura' UNION ALL SELECT 'humedad' UNION ALL SELECT 'gas') t`,
    [d.id]
  )).filter((u) => u.valor !== null);
  const [{ segundos } = {}] = await consulta(
    "SELECT TIMESTAMPDIFF(SECOND, ultima_conexion, NOW(3)) AS segundos FROM dispositivos_iot WHERE id = ?", [d.id]
  );
  res.json({
    dispositivo: { id: d.id, nombre: d.nombre, tipo: d.tipo, estado: d.estado, capacidadG: d.capacidad_g, segundosSinDatos: segundos ?? null },
    canales,
    ultimas: Object.fromEntries(ultimas.map((u) => [u.tipo_lectura, Number(u.valor)])),
  });
}));

router.post("/lecturas", async_(async (req, res) => {
  const d = await autenticar(req);
  if (d.estado !== "activo") throw new ErrorApp(423, "El dispositivo está en pausa.");
  const lecturas = Array.isArray(req.body.lecturas) ? req.body.lecturas : [];
  if (!lecturas.length) throw new ErrorApp(400, "No llegaron lecturas.");
  const r = await procesar.registrarLecturas(d, lecturas, { origen: req.body.origen === "simulador" ? "simulador" : "http" });
  res.json({ ok: true, ...r });
}));

module.exports = router;
