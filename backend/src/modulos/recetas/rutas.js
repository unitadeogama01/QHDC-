// ============================================================
//  /api/recetas — Recetas propias de cada hogar (con sesión)
//
//    POST   /api/recetas/generar   Borrador con IA: ingredientes elegidos,
//                                  foto opcional (multipart "foto") e
//                                  indicaciones. NO se guarda.
//    POST   /api/recetas           Guardar una receta (escrita a mano o
//                                  el borrador de la IA ya revisado)
//    DELETE /api/recetas/:id       Borrar una receta del hogar
//    POST   /api/recetas/:id/preparar  Modo cocina "¡Terminé!": descuenta
//                                  lo usado y queda en el historial
//
//  Cada hogar ve SOLO sus recetas: ya no se cargan recetas generales.
// ============================================================
const express = require("express");
const multer = require("multer");
const { una, transaccion } = require("../../nucleo/db");
const { ErrorApp, async_, texto, numero, id, icono } = require("../../nucleo/errores");
const { config } = require("../../nucleo/config");
const imagenes = require("../../nucleo/imagenes");
const { disponible } = require("../../nucleo/ia");
const inv = require("../inventario/servicio");
const iaRecetas = require("./generar");

const router = express.Router();
const COLORES = ["tomate", "oliva", "mostaza", "cafe", "petroleo"];

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.imagenes.maxMB * 1024 * 1024, files: 1, fields: 10, fieldSize: 4000 },
  fileFilter: (req, archivo, cb) => cb(null, /^image\//.test(archivo.mimetype)),
});
function fotoOpcional(req, res, next) {
  subida.single("foto")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return next(new ErrorApp(413, `La foto pesa más de ${config.imagenes.maxMB} MB.`));
    next(new ErrorApp(400, "No se pudo recibir la foto."));
  });
}

// ---------- Borrador con IA ----------
router.post("/generar", fotoOpcional, async_(async (req, res) => {
  if (!disponible()) throw new ErrorApp(503, "La IA no está configurada en el servidor (ANTHROPIC_API_KEY).");
  let elegidos = req.body.elegidos;
  if (typeof elegidos === "string") { try { elegidos = JSON.parse(elegidos); } catch (e) { elegidos = []; } }
  elegidos = (Array.isArray(elegidos) ? elegidos : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 30);
  // La foto se revisa (tipo real, tamaño) y se reduce, pero NO se guarda
  const foto = req.file ? (await imagenes.procesar(req.file.buffer)).buffer : null;
  if (!elegidos.length && !foto) throw new ErrorApp(400, "Elige al menos un ingrediente o sube una foto.");
  const porciones = req.body.porciones ? numero(req.body.porciones, "Las porciones", { min: 1, max: 20 }) : null;
  const borrador = await iaRecetas.generar(req.usuario, {
    elegidos, foto, porciones, indicaciones: String(req.body.indicaciones || "").slice(0, 500),
  });
  res.json(borrador);
}));

// ---------- Guardar ----------
const minutosDe = (paso) => { const m = String(paso).match(/(\d{1,3})\s*min/i); return m ? Math.min(600, Number(m[1])) || null : null; };

router.post("/", async_(async (req, res) => {
  const u = req.usuario;
  const b = req.body;
  const nombre = texto(b.nombre, "El nombre de la receta", { max: 150 });
  const ingredientes = (Array.isArray(b.ingredientes) ? b.ingredientes : []).slice(0, 30)
    .map((i) => ({ nombre: String(i.nombre || "").trim().slice(0, 100), cantidad: String(i.cantidad || "al gusto").trim().slice(0, 60) || "al gusto" }))
    .filter((i) => i.nombre);
  const pasos = (Array.isArray(b.pasos) ? b.pasos : []).map((p) => String(p).trim().slice(0, 500)).filter(Boolean).slice(0, 30);
  if (!ingredientes.length) throw new ErrorApp(400, "Agrega al menos un ingrediente.");
  if (!pasos.length) throw new ErrorApp(400, "Agrega al menos un paso.");
  const repetido = new Set();
  for (const i of ingredientes) {
    const k = i.nombre.toLowerCase();
    if (repetido.has(k)) throw new ErrorApp(400, `El ingrediente "${i.nombre}" está repetido.`);
    repetido.add(k);
  }
  const tiempo = Math.round(numero(b.tiempo ?? 30, "El tiempo", { min: 1, max: 600 }));
  const porciones = Math.round(numero(b.porciones ?? 2, "Las porciones", { min: 1, max: 20 }));
  const dificultad = iaRecetas.DIFICULTADES.includes(b.dificultad) ? b.dificultad : "facil";
  const color = COLORES.includes(b.color) ? b.color : COLORES[nombre.length % COLORES.length];

  const recetaId = await transaccion(async (c) => {
    const [r] = await c.query(
      `INSERT INTO recetas (hogar_id, nombre, descripcion, porciones, tiempo_minutos, dificultad, icono, color, creada_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.hogarId, nombre, b.descripcion ? String(b.descripcion).slice(0, 500) : null, porciones, tiempo, dificultad,
       b.icono ? icono(b.icono) : "fa-utensils", color, u.id]
    );
    for (const [k, i] of ingredientes.entries()) {
      await c.query(
        "INSERT INTO receta_ingredientes (receta_id, orden, nombre, palabra_clave, cantidad_texto) VALUES (?, ?, ?, ?, ?)",
        [r.insertId, k + 1, i.nombre, i.nombre.slice(0, 60), i.cantidad]
      );
    }
    for (const [k, p] of pasos.entries()) {
      await c.query("INSERT INTO receta_pasos (receta_id, orden, texto, minutos_temporizador) VALUES (?, ?, ?, ?)",
        [r.insertId, k + 1, p, minutosDe(p)]);
    }
    return r.insertId;
  }).catch((e) => {
    if (e.code === "ER_DUP_ENTRY") throw new ErrorApp(409, `Ya tienes una receta llamada "${nombre}". Usa otro nombre.`);
    throw e;
  });
  res.status(201).json({ id: recetaId });
}));

// ---------- Borrar ----------
router.delete("/:id", async_(async (req, res) => {
  const u = req.usuario;
  const recetaId = id(req.params.id, "La receta");
  const receta = await una("SELECT id FROM recetas WHERE id = ? AND hogar_id = ? AND activa", [recetaId, u.hogarId]);
  if (!receta) throw new ErrorApp(404, "Esa receta no existe.");
  const usada = await una("SELECT 1 AS si FROM recetas_preparadas WHERE receta_id = ? LIMIT 1", [recetaId]);
  if (usada) {
    // Ya se preparó alguna vez: se oculta para conservar el historial (y se libera su nombre)
    await transaccion((c) => c.query(
      "UPDATE recetas SET activa = FALSE, nombre = LEFT(CONCAT(nombre, ' (borrada ', id, ')'), 150) WHERE id = ?", [recetaId]));
  } else {
    await transaccion((c) => c.query("DELETE FROM recetas WHERE id = ?", [recetaId])); // ingredientes y pasos se borran en cascada
  }
  res.json({ ok: true });
}));

// ---------- Modo cocina: "¡Terminé!" ----------
router.post("/:id/preparar", async_(async (req, res) => {
  const u = req.usuario;
  const recetaId = id(req.params.id);
  const receta = await una("SELECT id, porciones FROM recetas WHERE id = ? AND activa AND hogar_id = ?", [recetaId, u.hogarId]);
  if (!receta) throw new ErrorApp(404, "Esa receta no existe.");
  const consumos = Array.isArray(req.body.consumos) ? req.body.consumos.slice(0, 30) : [];
  const preparada = await transaccion(async (c) => {
    const [r] = await c.query("INSERT INTO recetas_preparadas (hogar_id, receta_id, usuario_id, porciones) VALUES (?, ?, ?, ?)", [u.hogarId, recetaId, u.id, receta.porciones]);
    for (const x of consumos) {
      const alimentoId = id(x.alimentoId, "El alimento");
      const usar = numero(x.cantidad, "La cantidad");
      if (!usar) continue;
      const total = await inv.totalActual(c, u.hogarId, alimentoId);
      await inv.fijarExistencia(c, { hogarId: u.hogarId, alimentoId, usuarioId: u.id, cantidad: Math.max(0, inv.r3(total - usar)), origen: "receta", recetaPreparadaId: r.insertId });
    }
    return r.insertId;
  });
  res.status(201).json({ id: preparada });
}));

module.exports = router;
