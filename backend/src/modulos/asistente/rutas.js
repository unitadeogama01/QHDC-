// ============================================================
//  /api/asistente — Chef QHDC con Claude (con sesión)
//
//    POST /api/asistente/preguntar   { pregunta } → respuesta validada
//    POST /api/asistente/mensajes    { pregunta, respuesta } guarda lo que
//                                    respondieron las reglas de la app
//                                    cuando la IA no estaba disponible
//
//  El servidor arma los datos exactos de la cocina, Claude redacta la
//  respuesta y el servidor la valida (ver asistente.js de este módulo).
//  La pregunta y la respuesta se guardan en conversaciones_asistente /
//  mensajes_asistente (las escribe el servidor, no el navegador).
//  Si la IA no está disponible responde 503 y la app usa sus reglas.
// ============================================================
const express = require("express");
const { consulta, transaccion } = require("../../nucleo/db");
const { ErrorApp, async_, texto } = require("../../nucleo/errores");
const { disponible } = require("../../nucleo/ia");
const ia = require("./asistente");

const router = express.Router();

// Freno simple de costo: 20 preguntas por minuto por usuario
const ritmo = new Map();
function frenar(usuarioId) {
  const ahora = Date.now();
  const r = ritmo.get(usuarioId);
  if (!r || r.hasta < ahora) { ritmo.set(usuarioId, { veces: 1, hasta: ahora + 60000 }); return; }
  if (++r.veces > 20) throw new ErrorApp(429, "Muchas preguntas seguidas. Espera un minuto.");
}

router.post("/preguntar", async_(async (req, res) => {
  const u = req.usuario;
  const pregunta = texto(req.body.pregunta, "La pregunta", { max: 1000 });
  if (!disponible()) throw new ErrorApp(503, "La IA no está configurada en el servidor.");
  frenar(u.id);

  // Conversación de las últimas 2 horas (o una nueva) y sus últimos mensajes
  const { convId, historial } = await transaccion(async (c) => {
    const [[conv]] = await c.query(
      "SELECT id FROM conversaciones_asistente WHERE hogar_id = ? AND usuario_id = ? AND iniciada_en > NOW() - INTERVAL 2 HOUR ORDER BY id DESC LIMIT 1",
      [u.hogarId, u.id]
    );
    if (conv) {
      const [m] = await c.query(
        "SELECT autor, contenido FROM mensajes_asistente WHERE hogar_id = ? AND conversacion_id = ? ORDER BY creado_en DESC, id DESC LIMIT 6",
        [u.hogarId, conv.id]
      );
      return { convId: conv.id, historial: m.reverse() };
    }
    const [n] = await c.query("INSERT INTO conversaciones_asistente (hogar_id, usuario_id) VALUES (?, ?)", [u.hogarId, u.id]);
    return { convId: n.insertId, historial: [] };
  });

  const r = await ia.responder(u, pregunta, historial);

  await transaccion((c) => c.query(
    `INSERT INTO mensajes_asistente (hogar_id, conversacion_id, autor, contenido, intencion, alimento_id, creado_en) VALUES
       (?, ?, 'usuario', ?, ?, ?, NOW(3)), (?, ?, 'asistente', ?, ?, ?, NOW(3) + INTERVAL 1000 MICROSECOND)`,
    [u.hogarId, convId, pregunta, r.intencion, r.alimentos[0] || null,
     u.hogarId, convId, r.respuesta, r.intencion, r.alimentos[0] || null]
  ));

  res.json({
    respuesta: r.respuesta,
    intencion: r.intencion,
    alimentos: r.alimentos,      // ids de alimentos reales de la alacena
    recetaId: r.recetaId,        // id de una receta guardada, o null
    recetaNueva: r.recetaNueva,  // receta propuesta con disponibilidad exacta, o null
  });
}));

// ---------- Respuestas de respaldo (reglas de la app) ----------
const INTENCIONES = [
  ["duracion", /(dura|alcanza|cuanto|queda)/],
  ["usar_primero", /(primero|caduc|vence|echar a perder|usar|urgente)/],
  ["comprar", /(compr|super|lista|falta|acab)/],
  ["frescura", /(como esta|frescura|resumen)/],
  ["cocinar", /(cocin|comer|receta|prepar|platillo|comida|cena|desayun)/],
  ["saludo", /^(hola|buen|que tal)/],
];
const normalizar = (t) => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const sinHtml = (t) => String(t).replace(/<\/(p|li|div)>|<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

router.post("/mensajes", async_(async (req, res) => {
  const u = req.usuario;
  const pregunta = texto(req.body.pregunta, "La pregunta", { max: 1000 });
  const respuesta = sinHtml(req.body.respuesta || "").slice(0, 4000) || "…";
  const t = normalizar(pregunta);
  const intencion = (INTENCIONES.find(([, re]) => re.test(t)) || ["otra"])[0];
  const alimentos = await consulta("SELECT id, nombre FROM alimentos WHERE hogar_id = ? AND activo", [u.hogarId]);
  const alimento = alimentos.find((a) => normalizar(a.nombre).split(" ").some((p) => p.length > 3 && t.includes(p)));

  await transaccion(async (c) => {
    // Se sigue la conversación de las últimas 2 horas o se empieza una nueva
    const [[conv]] = await c.query(
      "SELECT id FROM conversaciones_asistente WHERE hogar_id = ? AND usuario_id = ? AND iniciada_en > NOW() - INTERVAL 2 HOUR ORDER BY id DESC LIMIT 1",
      [u.hogarId, u.id]
    );
    let convId = conv && conv.id;
    if (!convId) {
      const [n] = await c.query("INSERT INTO conversaciones_asistente (hogar_id, usuario_id) VALUES (?, ?)", [u.hogarId, u.id]);
      convId = n.insertId;
    }
    await c.query(
      `INSERT INTO mensajes_asistente (hogar_id, conversacion_id, autor, contenido, intencion, alimento_id, creado_en) VALUES
         (?, ?, 'usuario', ?, ?, ?, NOW(3)), (?, ?, 'asistente', ?, ?, ?, NOW(3) + INTERVAL 1000 MICROSECOND)`,
      [u.hogarId, convId, pregunta, intencion, alimento ? alimento.id : null, u.hogarId, convId, respuesta, intencion, alimento ? alimento.id : null]
    );
  });
  res.status(201).json({ ok: true });
}));

module.exports = router;
