// ============================================================
//  /api/lista — Lista del súper (HU-07)
//  Lo sugerido lo calcula la base (vista_lista_sugerida); aquí se
//  guarda lo que la familia marca, anota o termina de comprar.
// ============================================================
const express = require("express");
const { transaccion } = require("../../nucleo/db");
const { ErrorApp, async_, texto, numero, id } = require("../../nucleo/errores");
const inv = require("../inventario/servicio");
const { mismoNombre, normalizar } = require("../inventario/nombres");
const { leerCantidad } = require("../inventario/cantidades");

const router = express.Router();

/** Id de la lista activa (la crea si no existe) */
async function listaActiva(c, hogarId, usuarioId) {
  await c.query("CALL sp_generar_lista(?, ?, @lista)", [hogarId, usuarioId]);
  const [[r]] = await c.query("SELECT @lista AS id");
  return r.id;
}

/** Interpreta las claves de la app: p-5 = alimento 5 · x-12 = artículo anotado 12 */
function clave(valor) {
  const m = /^([px])-(\d+)$/.exec(String(valor || ""));
  if (!m) throw new ErrorApp(400, "Artículo no válido.");
  return { tipo: m[1], id: Number(m[2]) };
}

// Marcar / desmarcar en el carrito
router.put("/comprado", async_(async (req, res) => {
  const u = req.usuario;
  const k = clave(req.body.clave);
  const comprado = Boolean(req.body.comprado);
  await transaccion(async (c) => {
    const lista = await listaActiva(c, u.hogarId, u.id);
    if (k.tipo === "p") {
      await c.query(
        `INSERT INTO lista_compras_items (hogar_id, lista_id, alimento_id, motivo, agregado_por, comprado, comprado_en, comprado_por)
         VALUES (?, ?, ?, 'manual', ?, ?, IF(?, NOW(), NULL), IF(?, ?, NULL))
         ON DUPLICATE KEY UPDATE comprado = VALUES(comprado), comprado_en = VALUES(comprado_en), comprado_por = VALUES(comprado_por)`,
        [u.hogarId, lista, k.id, u.id, comprado, comprado, comprado, u.id]
      );
    } else {
      const [r] = await c.query(
        "UPDATE lista_compras_items SET comprado = ?, comprado_en = IF(?, NOW(), NULL), comprado_por = IF(?, ?, NULL) WHERE hogar_id = ? AND id = ?",
        [comprado, comprado, comprado, u.id, u.hogarId, k.id]
      );
      if (!r.affectedRows) throw new ErrorApp(404, "Ese artículo ya no está en la lista.");
    }
  });
  res.json({ ok: true });
}));

// Anotar algo a mano ("Servilletas") o lo que falta de una receta
router.post("/extras", async_(async (req, res) => {
  const u = req.usuario;
  const nombre = texto(req.body.nombre, "El nombre");
  const cantidad = String(req.body.cantidad || "1").trim().slice(0, 60) || "1";
  const precio = numero(req.body.precio || 0, "El precio", { max: 1e6 });
  const recetaId = req.body.recetaId ? id(req.body.recetaId) : null;
  const nuevo = await transaccion(async (c) => {
    const lista = await listaActiva(c, u.hogarId, u.id);
    const [r] = await c.query(
      `INSERT INTO lista_compras_items (hogar_id, lista_id, nombre_libre, cantidad_texto, precio_estimado, prioridad, motivo, receta_id, agregado_por)
       VALUES (?, ?, ?, ?, ?, 'baja', ?, ?, ?)`,
      [u.hogarId, lista, nombre, cantidad, precio, recetaId ? "receta" : "manual", recetaId, u.id]
    );
    return r.insertId;
  });
  res.status(201).json({ id: nuevo });
}));

router.delete("/extras/:id", async_(async (req, res) => {
  await transaccion((c) => c.query("DELETE FROM lista_compras_items WHERE hogar_id = ? AND id = ? AND alimento_id IS NULL", [req.usuario.hogarId, id(req.params.id)]));
  res.json({ ok: true });
}));

// ---------- Lo anotado a mano, al comprarlo, entra a la alacena ----------
/** Datos para crear el alimento: del catálogo si lo conoce; si no, de la cantidad escrita ("2 piezas", "500 g"). */
async function fichaDeCompra(c, nombre, cantidadTexto) {
  const [[cat]] = await c.query(
    `SELECT ca.icono, ca.color, ca.cantidad_tipica AS cantidad, ca.vida_util_dias AS vida, ca.precio_estimado AS precio,
            ca.ubicacion_sugerida, cg.nombre AS categoria, um.codigo AS unidad
       FROM catalogo_alimentos ca JOIN categorias_alimento cg ON cg.id = ca.categoria_id JOIN unidades_medida um ON um.id = ca.unidad_id
      WHERE ca.nombre = ?`, [nombre]);
  let { cantidad, unidad } = leerCantidad(cantidadTexto);
  if (cat && (!unidad || unidad === cat.unidad)) { unidad = cat.unidad; cantidad = cantidad || Number(cat.cantidad); }
  if (!unidad) unidad = "pz";
  if (!(cantidad > 0)) cantidad = 1;
  const UBICACION = { refrigerador: "Refrigerador", congelador: "Congelador", despensa: "Despensa" };
  const vida = cat ? cat.vida : null;
  return {
    nombre, unidad, cantidad, capacidad: cantidad,
    categoria: cat ? cat.categoria : "Otros",
    ubicacion: cat ? UBICACION[cat.ubicacion_sugerida] || "Despensa" : "Despensa",
    // La caducidad solo se pone si se conoce la vida útil del alimento
    caducidad: vida ? new Date(Date.now() + vida * 864e5).toISOString().slice(0, 10) : null,
    vida, icono: cat ? cat.icono : "fa-basket-shopping", color: cat ? cat.color : "cafe",
    precio: cat && cat.precio ? Number(cat.precio) : 0, origen: "manual",
  };
}

// "Terminé de comprar": lo marcado entra a la alacena y la lista se cierra.
// Lo anotado a mano también entra (se rellena si ya existe o se crea).
// Lo que no se compró pasa a la lista nueva.
router.post("/finalizar", async_(async (req, res) => {
  const u = req.usuario;
  const total = await transaccion(async (c) => {
    const lista = await listaActiva(c, u.hogarId, u.id);
    const [comprados] = await c.query(
      `SELECT it.id, it.alimento_id, it.nombre_libre, it.cantidad_texto, a.activo FROM lista_compras_items it
         LEFT JOIN alimentos a ON a.hogar_id = it.hogar_id AND a.id = it.alimento_id
        WHERE it.hogar_id = ? AND it.lista_id = ? AND it.comprado`,
      [u.hogarId, lista]
    );
    const [activos] = await c.query("SELECT id, nombre FROM alimentos WHERE hogar_id = ? AND activo", [u.hogarId]);
    for (const it of comprados) {
      let alimentoId = it.alimento_id && it.activo ? it.alimento_id : null;
      if (!alimentoId && it.nombre_libre) {
        // Anotado a mano: si ya existe ese alimento se rellena; si no, se crea
        const nombre = String(it.nombre_libre).trim();
        const existe = activos.find((a) => normalizar(a.nombre) === normalizar(nombre)) || activos.find((a) => mismoNombre(a.nombre, nombre));
        if (existe) alimentoId = existe.id;
        else {
          const nuevo = await inv.crearAlimento(c, { hogarId: u.hogarId, usuarioId: u.id, info: await fichaDeCompra(c, nombre, it.cantidad_texto) });
          activos.push({ id: nuevo, nombre });
          await c.query("UPDATE lista_compras_items SET movimiento_id = ? WHERE id = ?", [await inv.ultimaEntrada(c, u.hogarId, nuevo), it.id]);
          continue;
        }
      }
      if (alimentoId) {
        const movimiento = await inv.rellenar(c, { hogarId: u.hogarId, alimentoId, usuarioId: u.id, origen: "compra" });
        await c.query("UPDATE lista_compras_items SET movimiento_id = ? WHERE id = ?", [movimiento, it.id]);
      }
    }
    if (comprados.length) {
      const [nueva] = await c.query("INSERT INTO listas_compras (hogar_id, creada_por) VALUES (?, ?)", [u.hogarId, u.id]);
      await c.query("UPDATE lista_compras_items SET lista_id = ? WHERE hogar_id = ? AND lista_id = ? AND NOT comprado", [nueva.insertId, u.hogarId, lista]);
      await c.query("UPDATE listas_compras SET estado = 'completada', completada_en = NOW() WHERE hogar_id = ? AND id = ?", [u.hogarId, lista]);
    }
    return comprados.length;
  });
  res.json({ total });
}));

module.exports = router;
