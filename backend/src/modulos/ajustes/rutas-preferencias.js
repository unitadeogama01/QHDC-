// ============================================================
//  Preferencias de cada usuario (con sesión)
//
//    PUT /api/preferencias           Tema, sonidos, menú, vista de la
//                                    alacena y qué avisos ver
//    PUT /api/recorridos/:pantalla   Recorridos guiados ya vistos
//
//  Se guardan para que se sincronicen entre dispositivos.
// ============================================================
const express = require("express");
const { consulta } = require("../../nucleo/db");
const { ErrorApp, async_ } = require("../../nucleo/errores");

const router = express.Router();

router.put("/preferencias", async_(async (req, res) => {
  const b = req.body;
  const campos = [];
  const valores = [];
  if (["sistema", "claro", "oscuro"].includes(b.tema)) { campos.push("tema = ?"); valores.push(b.tema); }
  if (typeof b.sonidos === "boolean") { campos.push("sonidos = ?"); valores.push(b.sonidos); }
  if (typeof b.menuCompacto === "boolean") { campos.push("menu_compacto = ?"); valores.push(b.menuCompacto); }
  // Qué avisos ver (Ajustes → Avisos)
  if (typeof b.avisosCaducidad === "boolean") { campos.push("notificar_caducidad = ?"); valores.push(b.avisosCaducidad); }
  if (typeof b.avisosExistencias === "boolean") { campos.push("notificar_existencias_bajas = ?"); valores.push(b.avisosExistencias); }
  if (typeof b.avisosDispositivos === "boolean") { campos.push("notificar_dispositivos = ?"); valores.push(b.avisosDispositivos); }
  if (["frascos", "lista"].includes(b.vistaAlacena)) { campos.push("vista_alacena = ?"); valores.push(b.vistaAlacena); }
  if (!campos.length) return res.json({ ok: true });
  await consulta("INSERT IGNORE INTO preferencias_usuario (usuario_id) VALUES (?)", [req.usuario.id]);
  await consulta(`UPDATE preferencias_usuario SET ${campos.join(", ")} WHERE usuario_id = ?`, [...valores, req.usuario.id]);
  res.json({ ok: true });
}));

const PANTALLAS = ["dashboard", "inventario", "alertas", "lista-compras", "asistente", "recetas", "escanear", "sensores"];
router.put("/recorridos/:pantalla", async_(async (req, res) => {
  if (!PANTALLAS.includes(req.params.pantalla)) throw new ErrorApp(400, "Pantalla no válida.");
  await consulta(
    `INSERT INTO recorridos_vistos (usuario_id, pantalla, completado) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE completado = VALUES(completado), visto_en = NOW()`,
    [req.usuario.id, req.params.pantalla, req.body.completado !== false]
  );
  res.json({ ok: true });
}));

module.exports = router;
