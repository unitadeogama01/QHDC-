// Pruebas unitarias: lo que propone la IA para una receta se revisa con reglas
// exactas antes de mostrarse (src/modulos/recetas/generar.js → armarBorrador).
// No se llama a Claude: se le pasan respuestas del modelo, buenas y malas.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { armarBorrador, DIFICULTADES, ICONOS } = require("../../src/modulos/recetas/generar");

const alacena = [
  { id: 1, nombre: "Huevo", e: { disponible: true } },
  { id: 2, nombre: "Jitomate", e: { disponible: true } },
  { id: 3, nombre: "Queso Oaxaca", e: { disponible: false } }, // caducado o agotado
];

describe("armarBorrador", () => {
  it("marca qué ingredientes hay de verdad en la alacena", () => {
    const b = armarBorrador({
      nombre: "Huevos a la mexicana", tiempo_minutos: 15, porciones: 2, dificultad: "facil", icono: "fa-egg",
      ingredientes: [{ nombre: "Huevos", cantidad: "4" }, { nombre: "Jitomate", cantidad: "2" }, { nombre: "Queso", cantidad: "50 g" }, { nombre: "Cebolla", cantidad: "1/4" }],
      pasos: ["Pica.", "Fríe 3 minutos."],
    }, alacena);
    const porNombre = Object.fromEntries(b.ingredientes.map((i) => [i.nombre, i]));
    assert.equal(porNombre.Huevos.disponible, true);
    assert.equal(porNombre.Huevos.alimentoId, 1);
    assert.equal(porNombre.Queso.disponible, false);   // existe pero no está disponible
    assert.equal(porNombre.Cebolla.disponible, false);  // no está en la alacena
    assert.equal(b.faltan, 2);
  });

  it("sal, aceite, etc. cuentan como básicos disponibles", () => {
    const b = armarBorrador({ ingredientes: [{ nombre: "Sal", cantidad: "al gusto" }, { nombre: "Aceite", cantidad: "1 cda" }], pasos: ["x"] }, alacena);
    assert.ok(b.ingredientes.every((i) => i.disponible && i.basico));
    assert.equal(b.faltan, 0);
  });

  it("quita ingredientes repetidos aunque estén en plural", () => {
    const b = armarBorrador({ ingredientes: [{ nombre: "Huevo", cantidad: "2" }, { nombre: "huevos", cantidad: "1" }], pasos: ["x"] }, alacena);
    assert.equal(b.ingredientes.length, 1);
  });

  it("corrige valores fuera de lo permitido", () => {
    const b = armarBorrador({ nombre: "X", tiempo_minutos: 99999, porciones: -3, dificultad: "imposible", icono: "fa-bomba", ingredientes: [], pasos: [] }, alacena);
    assert.equal(b.tiempo, 600);
    assert.equal(b.porciones, 1);   // -3 se ajusta al mínimo permitido
    assert.ok(DIFICULTADES.includes(b.dificultad));
    assert.ok(ICONOS.includes(b.icono));
  });

  it("limita tamaños: 20 ingredientes, 15 pasos y textos largos", () => {
    const b = armarBorrador({
      nombre: "N".repeat(400),
      ingredientes: Array.from({ length: 40 }, (_, k) => ({ nombre: `Ingrediente número ${k}`, cantidad: "1" })),
      pasos: Array.from({ length: 40 }, (_, k) => `Paso ${k} ` + "x".repeat(800)),
    }, alacena);
    assert.equal(b.nombre.length, 150);
    assert.ok(b.ingredientes.length <= 20);
    assert.equal(b.pasos.length, 15);
    assert.ok(b.pasos.every((p) => p.length <= 500));
  });

  it("las porciones que pidió la persona mandan sobre las del modelo", () => {
    assert.equal(armarBorrador({ porciones: 6, ingredientes: [], pasos: [] }, alacena, 2).porciones, 2);
  });

  it("no truena con respuestas vacías o mal formadas", () => {
    for (const malo of [null, undefined, "texto", {}, { ingredientes: "no es lista", pasos: null }, { ingredientes: [null, 5, { nombre: "" }] }]) {
      const b = armarBorrador(malo, alacena);
      assert.equal(typeof b.nombre, "string");
      assert.deepEqual(b.ingredientes, []);
      assert.ok(Array.isArray(b.pasos));
    }
  });
});
