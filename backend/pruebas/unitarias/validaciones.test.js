// Pruebas unitarias: validación de todo lo que llega a la API (src/nucleo/errores.js)
// y lectura de cantidades escritas a mano (src/modulos/inventario/cantidades.js).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { ErrorApp, async_, texto, numero, fecha, id, color, icono } = require("../../src/nucleo/errores");
const { leerCantidad } = require("../../src/modulos/inventario/cantidades");

/** Comprueba que fn lance un ErrorApp 400 */
const rechaza = (fn) => assert.throws(fn, (e) => e instanceof ErrorApp && e.estado === 400);

describe("texto", () => {
  it("recorta espacios y acepta lo válido", () => assert.equal(texto("  Arroz  ", "El nombre"), "Arroz"));
  it("rechaza vacío, null y solo espacios", () => {
    rechaza(() => texto("", "El nombre"));
    rechaza(() => texto(null, "El nombre"));
    rechaza(() => texto("   ", "El nombre"));
  });
  it("respeta el largo mínimo y máximo", () => {
    rechaza(() => texto("ab", "Tu nombre", { min: 3 }));
    rechaza(() => texto("x".repeat(121), "El nombre"));
    assert.equal(texto("x".repeat(120), "El nombre").length, 120);
  });
  it("el mensaje dice qué campo falta", () => {
    assert.throws(() => texto("", "El nombre"), { message: "Falta El nombre." });
  });
});

describe("numero", () => {
  it("acepta números y textos numéricos, redondeados a 3 decimales", () => {
    assert.equal(numero("2.5", "La cantidad"), 2.5);
    assert.equal(numero(1.23456, "La cantidad"), 1.235);
    assert.equal(numero(0, "La cantidad"), 0);
  });
  it("rechaza texto, infinito, negativos y fuera de rango", () => {
    rechaza(() => numero("abc", "La cantidad"));
    rechaza(() => numero(Infinity, "La cantidad"));
    rechaza(() => numero(-1, "La cantidad"));
    rechaza(() => numero(21, "Las porciones", { min: 1, max: 20 }));
  });
  it("opcional: vacío es null", () => {
    assert.equal(numero("", "El mínimo", { opcional: true }), null);
    assert.equal(numero(undefined, "El mínimo", { opcional: true }), null);
  });
});

describe("fecha", () => {
  it("acepta AAAA-MM-DD", () => assert.equal(fecha("2026-12-31", "La caducidad"), "2026-12-31"));
  it("rechaza otros formatos y fechas imposibles", () => {
    rechaza(() => fecha("31/12/2026", "La caducidad"));
    rechaza(() => fecha("2026-13-45", "La caducidad"));
    rechaza(() => fecha("", "La caducidad"));
  });
  it("opcional: vacío es null", () => assert.equal(fecha("", "La caducidad", { opcional: true }), null));
});

describe("id", () => {
  it("acepta enteros positivos", () => assert.equal(id("42"), 42));
  it("rechaza cero, negativos, decimales y texto", () => {
    for (const v of [0, -3, 1.5, "abc", null, "1; DROP TABLE usuarios"]) rechaza(() => id(v));
  });
});

describe("color e icono (lista blanca)", () => {
  it("solo colores de la paleta; si no, café", () => {
    assert.equal(color("tomate"), "tomate");
    assert.equal(color("red; background:url(x)"), "cafe");
  });
  it("solo clases fa-… seguras; si no, fa-box-open", () => {
    assert.equal(icono("fa-egg"), "fa-egg");
    assert.equal(icono('fa-egg" onmouseover="alert(1)'), "fa-box-open");
    assert.equal(icono(undefined), "fa-box-open");
  });
});

describe("async_", () => {
  it("pasa los errores de una ruta async al manejador central", async () => {
    const error = new ErrorApp(404, "No existe");
    let recibido = null;
    await async_(async () => { throw error; })({}, {}, (e) => { recibido = e; });
    assert.equal(recibido, error);
  });
});

describe("leerCantidad: lo que se escribe en la lista del súper", () => {
  const casos = [
    ["2 piezas", 2, "pz"],
    ["1,5 kg", 1.5, "kg"],
    ["500 g", 500, "g"],
    ["2 litros", 2, "L"],
    ["250 ml", 250, "ml"],
    ["1 paquete", 1, "pz"],
    ["3 tazas", 3, null],       // unidad desconocida
    ["al gusto", null, null],
    ["", null, null],
    ["0 kg", null, "kg"],       // cero no es una cantidad
  ];
  for (const [t, cantidad, unidad] of casos) {
    it(`"${t}" → ${cantidad} ${unidad}`, () => assert.deepEqual(leerCantidad(t), { cantidad, unidad }));
  }
});
