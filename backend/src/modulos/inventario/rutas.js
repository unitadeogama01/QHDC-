// ============================================================
//  /api/alimentos — Mi alacena (HU-01, HU-02, HU-04)
// ============================================================
const express = require("express");
const { consulta, una, transaccion } = require("../../nucleo/db");
const { ErrorApp, async_, numero, fecha, id } = require("../../nucleo/errores");
const inv = require("./servicio");

const router = express.Router();

// Nuevo alimento (formulario "+" o alimentos frecuentes)
router.post("/", async_(async (req, res) => {
  const u = req.usuario;
  const alimentoId = await transaccion((c) => inv.crearAlimento(c, { hogarId: u.hogarId, usuarioId: u.id, info: req.body }));
  res.status(201).json({ id: alimentoId });
}));

// Editar ficha
router.put("/:id", async_(async (req, res) => {
  const u = req.usuario;
  await transaccion((c) => inv.editarAlimento(c, { hogarId: u.hogarId, alimentoId: id(req.params.id), usuarioId: u.id, info: req.body }));
  res.json({ ok: true });
}));

// Eliminar (baja lógica, se puede deshacer)
router.delete("/:id", async_(async (req, res) => {
  const r = await consulta("UPDATE alimentos SET activo = FALSE WHERE hogar_id = ? AND id = ?", [req.usuario.hogarId, id(req.params.id)]);
  if (!r.affectedRows) throw new ErrorApp(404, "Ese alimento ya no existe.");
  res.json({ ok: true });
}));

// Deshacer eliminar
router.post("/:id/restaurar", async_(async (req, res) => {
  const h = req.usuario.hogarId;
  const a = await una("SELECT nombre FROM alimentos WHERE hogar_id = ? AND id = ?", [h, id(req.params.id)]);
  if (!a) throw new ErrorApp(404, "Ese alimento ya no existe.");
  await consulta("UPDATE alimentos SET activo = TRUE WHERE hogar_id = ? AND id = ?", [h, req.params.id]);
  res.json({ ok: true });
}));

// Cambiar cantidad: botones + / −, "Usé un poco", ajustes
router.put("/:id/existencia", async_(async (req, res) => {
  const u = req.usuario;
  const datos = {
    hogarId: u.hogarId,
    alimentoId: id(req.params.id),
    usuarioId: u.id,
    cantidad: numero(req.body.cantidad, "La cantidad"),
    caducidad: fecha(req.body.caducidad, "La fecha de caducidad", { opcional: true }),
    capacidad: numero(req.body.capacidad, "La cantidad de lleno", { min: 0.001, opcional: true }),
    origen: ["manual", "compra", "camara"].includes(req.body.origen) ? req.body.origen : "manual",
  };
  await transaccion((c) => inv.fijarExistencia(c, datos));
  res.json({ ok: true });
}));

// Rellenar el frasco
router.post("/:id/rellenar", async_(async (req, res) => {
  const u = req.usuario;
  await transaccion((c) => inv.rellenar(c, { hogarId: u.hogarId, alimentoId: id(req.params.id), usuarioId: u.id, origen: "compra" }));
  res.json({ ok: true });
}));

module.exports = router;
