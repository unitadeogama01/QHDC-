// ============================================================
//  /api/avisos — Avisos del hogar (HU-04) · con sesión
//
//    PUT /api/avisos/leida        { clave, leida } marcar / desmarcar
//    GET /api/avisos/historial    ?dias=30 avisos activos y ya resueltos
//
//  Los avisos los genera la base (sp_generar_avisos) al sincronizar el
//  hogar; aquí solo se marca lo leído y se consulta el historial.
// ============================================================
const express = require("express");
const { consulta, una, transaccion } = require("../../nucleo/db");
const { async_, texto, numero } = require("../../nucleo/errores");

const router = express.Router();

router.put("/leida", async_(async (req, res) => {
  const u = req.usuario;
  const clave = texto(req.body.clave, "El aviso", { max: 60 });
  const leida = req.body.leida !== false;
  let aviso = await una("SELECT id FROM notificaciones WHERE hogar_id = ? AND clave = ? AND activa ORDER BY id DESC LIMIT 1", [u.hogarId, clave]);
  if (!aviso) {
    // Puede que el aviso sea nuevo: se recalculan los avisos y se busca otra vez
    await transaccion((c) => c.query("CALL sp_generar_avisos(?)", [u.hogarId]));
    aviso = await una("SELECT id FROM notificaciones WHERE hogar_id = ? AND clave = ? AND activa ORDER BY id DESC LIMIT 1", [u.hogarId, clave]);
  }
  if (!aviso) return res.json({ ok: true }); // el problema ya se resolvió
  if (leida) await consulta("INSERT IGNORE INTO notificaciones_lecturas (notificacion_id, usuario_id) VALUES (?, ?)", [aviso.id, u.id]);
  else await consulta("DELETE FROM notificaciones_lecturas WHERE notificacion_id = ? AND usuario_id = ?", [aviso.id, u.id]);
  res.json({ ok: true });
}));

// Historial: avisos de los últimos N días (activos y ya resueltos)
router.get("/historial", async_(async (req, res) => {
  const u = req.usuario;
  const dias = Math.round(numero(req.query.dias ?? 30, "Los días", { min: 1, max: 90 }));
  const filas = await consulta(
    `SELECT n.id, n.clave, n.tipo, n.nivel, n.titulo, n.mensaje, n.creada_en, n.resuelta_en, n.activa,
            (nl.notificacion_id IS NOT NULL) AS leida
       FROM notificaciones n
       LEFT JOIN notificaciones_lecturas nl ON nl.notificacion_id = n.id AND nl.usuario_id = ?
      WHERE n.hogar_id = ? AND n.creada_en > NOW() - INTERVAL ? DAY
      ORDER BY n.creada_en DESC, n.id DESC LIMIT 200`,
    [u.id, u.hogarId, dias]
  );
  res.json({
    dias,
    avisos: filas.map((n) => ({
      id: n.id, clave: n.clave, tipo: n.tipo, nivel: n.nivel, titulo: n.titulo, mensaje: n.mensaje,
      creado: n.creada_en, resuelto: n.resuelta_en, activo: Boolean(n.activa), leido: Boolean(n.leida),
    })),
  });
}));

module.exports = router;
