// ============================================================
//  Identificación de alimentos por foto (HU-10) — con sesión
//
//  Flujo (las fotos viajan por HTTP, nunca por MQTT):
//   1. POST /api/escaneos/foto            multipart "foto" → se valida y guarda en privado
//   2. POST /api/escaneos/:id/analizar     Claude propone los alimentos (no cambia el inventario)
//   3. POST /api/escaneos/:id/confirmar    la persona confirma/corrige → se registra en el inventario
//      GET  /api/imagenes/:id              ver la foto (solo el hogar dueño)
//      DELETE /api/imagenes/:id            borrar la foto
//
//  Reglas: nada entra al inventario sin confirmación; lo que la IA no ve
//  con seguridad (confianza < IA_CONFIANZA_MINIMA) llega desmarcado y con
//  "Revisar"; la cantidad solo se sugiere si se pudieron contar piezas; la
//  caducidad es una sugerencia según la vida útil del alimento.
// ============================================================
const express = require("express");
const multer = require("multer");
const { consulta, una, transaccion } = require("../../nucleo/db");
const { ErrorApp, async_, texto, numero, fecha, id } = require("../../nucleo/errores");
const { config } = require("../../nucleo/config");
const imagenes = require("../../nucleo/imagenes");
const vision = require("./vision");
const inv = require("../inventario/servicio");

const router = express.Router();

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.imagenes.maxMB * 1024 * 1024, files: 1, fields: 5, fieldSize: 1000 },
  fileFilter: (req, archivo, cb) => cb(null, /^image\//.test(archivo.mimetype)), // filtro rápido; el tipo real lo revisa sharp
});

function recibirFoto(req, res, next) {
  subida.single("foto")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return next(new ErrorApp(413, `La foto pesa más de ${config.imagenes.maxMB} MB.`));
    next(new ErrorApp(400, "No se pudo recibir la foto."));
  });
}

const normalizar = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const capitalizar = (t) => { const s = String(t || "").trim().replace(/\s+/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
const pct = (v) => Math.max(0, Math.min(100, Number(v) || 0));
// Cantidad de partida cuando la foto no permite contar (la persona la ajusta)
const CANTIDAD_INICIAL = { g: 100, ml: 250, kg: 1, L: 1, pz: 1, manojo: 1 };
const hoyMas = (dias) => { const d = new Date(); d.setDate(d.getDate() + Number(dias || 7)); return d.toISOString().slice(0, 10); };

async function escaneoDelHogar(req) {
  const e = await una(
    "SELECT id, hogar_id, imagen_id, estado FROM escaneos WHERE hogar_id = ? AND id = ?",
    [req.usuario.hogarId, id(req.params.id, "El escaneo")]
  );
  if (!e) throw new ErrorApp(404, "Ese escaneo no existe.");
  return e;
}

/** Lo que el servidor sabe de los alimentos: catálogo y alacena del hogar. */
async function conocidos(hogarId) {
  const [catalogo, alacena, categorias] = await Promise.all([
    consulta(
      `SELECT c.id, c.nombre, cat.id AS categoria_id, cat.nombre AS categoria, u.codigo AS unidad, c.icono, c.color,
              c.cantidad_tipica AS cantidad, c.vida_util_dias AS vida, COALESCE(c.precio_estimado, 0) AS precio, c.ubicacion_sugerida
         FROM catalogo_alimentos c JOIN categorias_alimento cat ON cat.id = c.categoria_id JOIN unidades_medida u ON u.id = c.unidad_id`
    ),
    consulta(
      `SELECT a.id, a.nombre, cat.nombre AS categoria, u.codigo AS unidad, a.icono, a.color, a.vida_util_dias AS vida,
              COALESCE(a.precio_estimado, 0) AS precio
         FROM alimentos a JOIN unidades_medida u ON u.id = a.unidad_id LEFT JOIN categorias_alimento cat ON cat.id = a.categoria_id
        WHERE a.hogar_id = ? AND a.activo`, [hogarId]
    ),
    consulta("SELECT id, nombre, icono FROM categorias_alimento WHERE hogar_id IS NULL OR hogar_id = ? ORDER BY hogar_id IS NOT NULL, id", [hogarId]),
  ]);
  return { catalogo, alacena, categorias };
}

// ---------- 1. Subir la foto ----------
router.post("/escaneos/foto", recibirFoto, async_(async (req, res) => {
  if (!req.file) throw new ErrorApp(400, "No llegó ninguna foto (solo se aceptan imágenes).");
  const u = req.usuario;
  const img = await imagenes.guardar(req.file.buffer, { hogarId: u.hogarId, usuarioId: u.id, nombreOriginal: req.file.originalname });
  const origen = req.body.origen === "galeria" ? "galeria" : "camara";
  const r = await consulta(
    "INSERT INTO escaneos (hogar_id, usuario_id, imagen_id, referencia_imagen, origen, estado) VALUES (?, ?, ?, ?, ?, 'pendiente')",
    [u.hogarId, u.id, img.id, img.rutaRelativa, origen]
  );
  res.status(201).json({ escaneoId: r.insertId, imagenId: img.id, imagenUrl: `/api/imagenes/${img.id}` });
}));

// ---------- 2. Analizar con IA (solo propone) ----------
router.post("/escaneos/:id/analizar", async_(async (req, res) => {
  const u = req.usuario;
  const e = await escaneoDelHogar(req);
  if (e.estado === "confirmado") throw new ErrorApp(409, "Este escaneo ya se guardó.");
  if (!e.imagen_id) throw new ErrorApp(400, "Este escaneo no tiene foto.");
  const foto = await imagenes.leer(u.hogarId, e.imagen_id);
  const k = await conocidos(u.hogarId);
  const nombresConocidos = [...new Set([...k.alacena.map((a) => a.nombre), ...k.catalogo.map((c) => c.nombre)])].slice(0, 200);

  let ia;
  try {
    ia = await vision.identificarAlimentos(foto.buffer, { categorias: k.categorias.map((c) => c.nombre), nombresConocidos });
  } catch (err) {
    await consulta("UPDATE escaneos SET estado = 'error', error_mensaje = ? WHERE id = ?", [String(err.message).slice(0, 255), e.id]);
    throw err;
  }

  // Lo que dijo la IA + reglas exactas del servidor (catálogo, alacena, unidades)
  const vistos = new Set();
  const propuestas = [];
  for (const d of ia.alimentos) {
    const nombre = capitalizar(d.nombre).slice(0, 120);
    if (!nombre || vistos.has(normalizar(nombre))) continue;
    vistos.add(normalizar(nombre));
    const existente = k.alacena.find((a) => normalizar(a.nombre) === normalizar(nombre));
    const cat = k.catalogo.find((c) => normalizar(c.nombre) === normalizar(nombre));
    const categoriaIa = k.categorias.find((c) => c.nombre === d.categoria);
    const categoria = (existente && existente.categoria) || (cat && cat.categoria) || (categoriaIa && categoriaIa.nombre) || "Otros";
    const unidad = (existente && existente.unidad) || (cat && cat.unidad) || "pz";
    const piezas = Math.max(0, Math.round(Number(d.piezas_visibles) || 0));
    const contada = unidad === "pz" && piezas > 0;
    const confianza = Math.max(0, Math.min(1, Number(d.confianza) || 0));
    const revisar = confianza < config.ia.confianzaMinima;
    const vida = (existente && existente.vida) || (cat && cat.vida) || 7;
    propuestas.push({
      nombre,
      resultadoTexto: String(d.nombre || nombre).slice(0, 120),
      categoria,
      categoriaId: (k.categorias.find((c) => c.nombre === categoria) || {}).id || null,
      unidad,
      cantidad: contada ? piezas : Number((cat && cat.cantidad) || CANTIDAD_INICIAL[unidad] || 1),
      cantidadContada: contada,
      caducidad: hoyMas(vida),
      vida,
      icono: (existente && existente.icono) || (cat && cat.icono) || (k.categorias.find((c) => c.nombre === categoria) || {}).icono || "fa-box-open",
      color: (existente && existente.color) || (cat && cat.color) || "cafe",
      precio: Number((existente && existente.precio) || (cat && cat.precio) || 0),
      existenteId: existente ? existente.id : null,
      catalogoId: cat ? cat.id : null,
      confianza,
      revisar,
      elegido: !revisar,
      caja: { x: pct(d.caja && d.caja.x), y: pct(d.caja && d.caja.y), w: pct(d.caja && d.caja.ancho), h: pct(d.caja && d.caja.alto) },
    });
  }

  await transaccion(async (c) => {
    await c.query("DELETE FROM identificaciones_ia WHERE hogar_id = ? AND escaneo_id = ? AND estado = 'pendiente'", [u.hogarId, e.id]);
    for (const p of propuestas) {
      const [r] = await c.query(
        `INSERT INTO identificaciones_ia (hogar_id, escaneo_id, resultado_texto, confianza, caja_x, caja_y, caja_ancho, caja_alto,
                catalogo_id, categoria_sugerida_id, requiere_revision, alimento_sugerido_id, cantidad_sugerida, caducidad_sugerida, incluir, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')`,
        [u.hogarId, e.id, p.nombre, p.confianza, p.caja.x, p.caja.y, p.caja.w, p.caja.h, p.catalogoId, p.categoriaId,
         p.revisar, p.existenteId, p.cantidad, p.caducidad, p.elegido]
      );
      p.identificacionId = r.insertId;
    }
    await c.query(
      "UPDATE escaneos SET estado = 'analizado', analizado_en = NOW(), modelo = ?, respuesta_ia = ?, error_mensaje = NULL WHERE id = ?",
      [String(ia.modelo).slice(0, 100), ia.respuesta ? JSON.stringify(ia.respuesta) : null, e.id]
    );
  });

  res.json({
    simulado: ia.simulado,
    observaciones: ia.observaciones,
    alimentos: propuestas.map((p) => ({
      identificacionId: p.identificacionId, nombre: p.nombre, categoria: p.categoria, unidad: p.unidad,
      cantidad: p.cantidad, cantidadContada: p.cantidadContada, caducidad: p.caducidad, vida: p.vida,
      icono: p.icono, color: p.color, precio: p.precio, existenteId: p.existenteId,
      confianza: Math.round(p.confianza * 100), revisar: p.revisar, elegido: p.elegido, caja: p.caja,
    })),
  });
}));

// ---------- 3. Confirmar: solo aquí cambia el inventario ----------
router.post("/escaneos/:id/confirmar", async_(async (req, res) => {
  const u = req.usuario;
  const e = await escaneoDelHogar(req);
  if (e.estado === "confirmado") throw new ErrorApp(409, "Este escaneo ya se guardó.");
  if (e.estado !== "analizado") throw new ErrorApp(409, "Primero hay que reconocer la foto.");
  const enviados = Array.isArray(req.body.alimentos) ? req.body.alimentos.slice(0, 30) : [];
  const unidades = (await consulta("SELECT codigo FROM unidades_medida")).map((x) => x.codigo);
  const categorias = (await consulta("SELECT nombre FROM categorias_alimento WHERE hogar_id IS NULL OR hogar_id = ?", [u.hogarId])).map((x) => x.nombre);

  const guardados = await transaccion(async (c) => {
    const [filas] = await c.query(
      `SELECT i.id, i.resultado_texto, i.cantidad_sugerida, i.caducidad_sugerida, i.catalogo_id, cat.nombre AS categoria
         FROM identificaciones_ia i LEFT JOIN categorias_alimento cat ON cat.id = i.categoria_sugerida_id
        WHERE i.hogar_id = ? AND i.escaneo_id = ? AND i.estado = 'pendiente' FOR UPDATE`,
      [u.hogarId, e.id]
    );
    let n = 0;
    for (const fila of filas) {
      const a = enviados.find((x) => Number(x.identificacionId) === fila.id);
      if (!a || a.elegido === false) {
        await c.query("UPDATE identificaciones_ia SET estado = 'rechazada', incluir = FALSE WHERE id = ?", [fila.id]);
        continue;
      }
      const nombre = capitalizar(texto(a.nombre, "El nombre", { max: 120 }));
      if (nombre.includes("�")) throw new ErrorApp(400, `El nombre "${nombre}" tiene caracteres dañados. Vuelve a escribirlo.`);
      const cantidad = numero(a.cantidad, `La cantidad de ${nombre}`, { min: 0.001, max: 1e6 });
      const caducidad = fecha(a.caducidad, `La caducidad de ${nombre}`, { opcional: true });
      const [[existe]] = await c.query("SELECT id, cantidad_llena FROM alimentos WHERE hogar_id = ? AND nombre = ? AND activo FOR UPDATE", [u.hogarId, nombre]);
      let alimentoId;
      if (existe) {
        const total = await inv.totalActual(c, u.hogarId, existe.id);
        const nuevo = inv.r3(total + cantidad);
        await inv.fijarExistencia(c, { hogarId: u.hogarId, alimentoId: existe.id, usuarioId: u.id, cantidad: nuevo, caducidad,
          capacidad: Math.max(Number(existe.cantidad_llena), nuevo), origen: "camara" });
        alimentoId = existe.id;
      } else {
        const [[cat]] = await c.query(
          `SELECT c.icono, c.color, c.vida_util_dias AS vida, c.precio_estimado AS precio, c.ubicacion_sugerida, u.codigo AS unidad
             FROM catalogo_alimentos c JOIN unidades_medida u ON u.id = c.unidad_id WHERE c.nombre = ?`, [nombre]);
        const categoria = categorias.includes(a.categoria) ? a.categoria : (fila.categoria || "Otros");
        const unidad = (cat && cat.unidad) || (unidades.includes(a.unidad) ? a.unidad : "pz");
        const ubicacion = cat ? { refrigerador: "Refrigerador", congelador: "Congelador", despensa: "Despensa" }[cat.ubicacion_sugerida] || "Despensa"
          : (["Granos y cereales", "Bebidas", "Otros"].includes(categoria) ? "Despensa" : "Refrigerador");
        alimentoId = await inv.crearAlimento(c, {
          hogarId: u.hogarId, usuarioId: u.id,
          info: { nombre, categoria, ubicacion, unidad, cantidad, capacidad: cantidad, caducidad, origen: "camara",
                  icono: (cat && cat.icono) || a.icono, color: (cat && cat.color) || a.color, precio: (cat && cat.precio) || 0, vida: cat && cat.vida },
        });
      }
      const movimiento = await inv.ultimaEntrada(c, u.hogarId, alimentoId);
      const corregida = normalizar(nombre) !== normalizar(fila.resultado_texto)
        || Number(fila.cantidad_sugerida) !== cantidad || String(fila.caducidad_sugerida || "") !== String(caducidad || "");
      await c.query(
        `UPDATE identificaciones_ia SET estado = ?, incluir = TRUE, alimento_confirmado_id = ?, cantidad_confirmada = ?,
                caducidad_confirmada = ?, confirmada_en = NOW(), movimiento_id = ? WHERE id = ?`,
        [corregida ? "corregida" : "confirmada", alimentoId, cantidad, caducidad, movimiento, fila.id]
      );
      n++;
    }
    await c.query("UPDATE escaneos SET estado = ? WHERE id = ?", [n ? "confirmado" : "descartado", e.id]);
    return n;
  });
  res.json({ ok: true, guardados });
}));

// ---------- Fotos (privadas) ----------
router.get("/imagenes/:id", async_(async (req, res) => {
  const img = await imagenes.leer(req.usuario.hogarId, id(req.params.id, "La foto"));
  res.set({ "Content-Type": img.tipo_mime, "Cache-Control": "private, max-age=86400", "Content-Disposition": "inline" });
  res.send(img.buffer);
}));

router.delete("/imagenes/:id", async_(async (req, res) => {
  await imagenes.eliminar(req.usuario.hogarId, id(req.params.id, "La foto"));
  res.json({ ok: true });
}));

module.exports = router;
