// Pruebas del frontend: la lógica de frontend/js/datos.js (objeto QHDC) se carga
// en Node con un navegador simulado y un /api/estado de prueba.
//  - Recetas con ingredientes básicos (sal, aceite) no deben romper la pantalla
//    (fallo real del 2026-11-09: Recetas y el asistente dejaron de cargar).
//  - La app y el servidor deben decidir igual qué alimento es cada ingrediente.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buscarAlimento, estadoAlimento } = require("../../src/modulos/asistente/asistente");

const ARCHIVO = path.join(__dirname, "..", "..", "..", "frontend", "js", "datos.js");
const dia = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** Carga datos.js con el estado indicado y devuelve el objeto QHDC. */
async function cargarQHDC(estado) {
  const respuesta = (cuerpo) => ({ ok: true, status: 200, json: async () => cuerpo });
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Promise, JSON, Math, Date, Intl,
    fetch: async (url) => respuesta(String(url).endsWith("/api/estado") ? estado : {}),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { protocol: "http:", pathname: "/recetas.html", search: "", replace() {}, reload() {} },
    document: { addEventListener() {}, dispatchEvent() {}, documentElement: { dataset: {} }, querySelectorAll: () => [], querySelector: () => null },
    navigator: { onLine: true },
    CustomEvent: function CustomEvent(tipo) { this.type = tipo; },
    addEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ARCHIVO, "utf8") + "\n;globalThis.QHDC = QHDC;", ctx, { filename: "datos.js" });
  for (let i = 0; i < 100 && ctx.QHDC.recetasSugeridas().length !== estado.recetas.length; i++) await new Promise((r) => setTimeout(r, 10));
  return ctx.QHDC;
}

const producto = (id, nombre, { cantidad = 2, capacidad = 4, caducidad = dia(10) } = {}) =>
  ({ id, nombre, cantidad, capacidad, caducidad, unidad: "pz", categoria: "Otros", ubicacion: "Despensa", consumoDiario: 0, historial: [] });
const receta = (id, nombre, ingredientes) =>
  ({ id, nombre, icono: "fa-utensils", color: "cafe", tiempo: 15, porciones: 2, dificultad: "Fácil", ingredientes: ingredientes.map((n) => ({ nombre: n, cantidad: "1" })), pasos: ["Paso."] });
const estadoBase = (productos, recetas) => ({ sesion: { nombre: "Prueba", rol: "Administrador" }, productos, recetas, sensores: [], lecturas: [], listaExtra: [], comprados: [] });

describe("datos.js: recetas sugeridas", () => {
  it("una receta con sal y aceite sin registrar no rompe la pantalla (fallo del 2026-11-09)", async () => {
    const Q = await cargarQHDC(estadoBase(
      [producto(1, "Huevo", { caducidad: dia(1) })],
      [receta(10, "Huevos fritos", ["Huevos", "Sal", "Aceite", "Cebolla"])]
    ));
    const [r] = Q.recetasSugeridas(); // antes lanzaba TypeError
    const ing = Object.fromEntries(r.ingredientes.map((i) => [i.nombre, i]));
    assert.equal(ing.Huevos.disponible, true);
    assert.equal(ing.Huevos.urgente, true);          // caduca mañana
    assert.equal(ing.Sal.disponible, true);          // básico
    assert.equal(ing.Sal.urgente, false);            // un básico nunca es urgente
    assert.equal(ing.Aceite.disponible, true);
    assert.equal(ing.Cebolla.disponible, false);
    assert.equal(r.faltan, 1);
    assert.match(Q.resumenIA(), /huevos fritos/i);   // el resumen del asistente también funciona
  });

  it("sin recetas, el resumen del asistente no falla", async () => {
    const Q = await cargarQHDC(estadoBase([producto(1, "Huevo")], []));
    assert.equal(Q.recetasSugeridas().length, 0);
    assert.equal(typeof Q.resumenIA(), "string");
  });

  it("primero las recetas que aprovechan lo que caduca pronto", async () => {
    const Q = await cargarQHDC(estadoBase(
      [producto(1, "Pan", { caducidad: dia(30) }), producto(2, "Pollo", { caducidad: dia(1) })],
      [receta(1, "Pan tostado", ["Pan"]), receta(2, "Pollo asado", ["Pollo"])]
    ));
    assert.equal(Q.recetasSugeridas()[0].nombre, "Pollo asado");
  });

  it("un alimento caducado no cuenta como disponible", async () => {
    const Q = await cargarQHDC(estadoBase([producto(1, "Leche", { caducidad: dia(-2) })], [receta(1, "Licuado", ["Leche"])]));
    assert.equal(Q.recetasSugeridas()[0].ingredientes[0].disponible, false);
  });
});

describe("datos.js y el servidor comparan los nombres igual", () => {
  const productos = [
    producto(1, "Huevo"), producto(2, "Queso Oaxaca"), producto(3, "Leche", { cantidad: 0 }), producto(4, "Leche deslactosada"),
    producto(5, "Salsa verde"), producto(6, "Limón"), producto(7, "Papaya"), producto(8, "Pechuga de pollo"),
  ];
  const ingredientes = ["Huevos", "Queso", "queso oaxaca rallado", "Leche", "Sal", "Limones", "Papa", "Pollo", "Chile serrano", "Aceite de oliva"];

  it("para cada ingrediente eligen el mismo alimento (o ninguno)", async () => {
    const Q = await cargarQHDC(estadoBase(productos, ingredientes.map((n, k) => receta(k + 1, `R${k}`, [n]))));
    const alacenaServidor = productos.map((p) => ({ ...p, e: estadoAlimento(p) }));
    for (const r of Q.recetasSugeridas()) {
      const i = r.ingredientes[0];
      const app = i.producto ? i.producto.nombre : null;
      const s = buscarAlimento(alacenaServidor, i.nombre);
      assert.equal(app, s ? s.nombre : null, `ingrediente "${i.nombre}"`);
    }
  });
});
