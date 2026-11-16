// Pruebas unitarias: comparar nombres de alimentos (src/modulos/inventario/nombres.js)
// y buscar un ingrediente en la alacena (src/modulos/asistente/asistente.js).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizar, palabras, coincideNombre, mismoNombre, esBasico } = require("../../src/modulos/inventario/nombres");
const { buscarAlimento, estadoAlimento } = require("../../src/modulos/asistente/asistente");

describe("normalizar y palabras", () => {
  it("quita acentos, mayúsculas y espacios de los extremos", () => {
    assert.equal(normalizar("  Limón ÁCIDO "), "limon acido");
    assert.equal(normalizar(null), "");
  });
  it("separa en palabras importantes, en singular y sin conectores", () => {
    assert.deepEqual(palabras("Huevos de rancho"), ["huevo", "rancho"]);
    assert.deepEqual(palabras("Pechuga de pollo"), ["pechuga", "pollo"]);
    assert.deepEqual(palabras("sal"), ["sal"]); // palabras cortas no se tocan
  });
});

describe("coincideNombre: ingrediente ↔ alimento", () => {
  const casos = [
    ["Huevo", "Huevos", true],
    ["Queso Oaxaca", "Queso", true],
    ["Queso Oaxaca", "queso oaxaca rallado", true],
    ["Limón", "Limones", true],
    ["Jitomate", "jitomates", true],
    ["Salsa verde", "Sal", false],   // "sal" no es "salsa"
    ["Papaya", "Papa", false],       // "papa" no es "papaya"
    ["Leche", "Pan", false],
    ["", "Huevo", false],
  ];
  for (const [a, b, esperado] of casos) {
    it(`"${a}" ${esperado ? "sí" : "no"} coincide con "${b}"`, () => assert.equal(coincideNombre(a, b), esperado));
  }
});

describe("mismoNombre: el mismo alimento escrito distinto", () => {
  it("ignora plural, acentos y mayúsculas", () => {
    assert.equal(mismoNombre("huevos", "Huevo"), true);
    assert.equal(mismoNombre("Limones", "limón"), true);
  });
  it("no confunde alimentos distintos", () => {
    assert.equal(mismoNombre("Leche", "Leche de coco"), false);
    assert.equal(mismoNombre("Pan", "Pan dulce"), false);
  });
});

describe("esBasico: sal, pimienta, agua, aceite y azúcar", () => {
  it("reconoce los básicos solos o combinados", () => {
    for (const b of ["Sal", "aceite", "Agua", "Azúcar", "Sal y pimienta"]) assert.equal(esBasico(b), true, b);
  });
  it("no considera básico algo que solo los menciona", () => {
    for (const b of ["Aceite de oliva", "Agua de jamaica", "Salsa", ""]) assert.equal(esBasico(b), false, b);
  });
});

describe("buscarAlimento: qué alimento de la alacena es el ingrediente", () => {
  const alacena = [
    { id: 1, nombre: "Huevo", e: { disponible: true } },
    { id: 2, nombre: "Leche", e: { disponible: false } },            // se acabó
    { id: 3, nombre: "Leche deslactosada", e: { disponible: true } },
    { id: 4, nombre: "Salsa verde", e: { disponible: true } },
  ];
  it("encuentra por plural", () => assert.equal(buscarAlimento(alacena, "Huevos").id, 1));
  it("prefiere uno que sí hay sobre el que se acabó", () => assert.equal(buscarAlimento(alacena, "Leche").id, 3));
  it("no confunde la sal con la salsa", () => assert.equal(buscarAlimento(alacena, "Sal"), null));
  it("devuelve null si no existe o el nombre está vacío", () => {
    assert.equal(buscarAlimento(alacena, "Chile serrano"), null);
    assert.equal(buscarAlimento(alacena, ""), null);
  });
});

describe("estadoAlimento: mismas reglas que la base y la app", () => {
  const dia = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  it("caducado si la fecha ya pasó", () => {
    const e = estadoAlimento({ cantidad: 1, capacidad: 1, caducidad: dia(-1) });
    assert.equal(e.caducidad, "caducado");
    assert.equal(e.disponible, false);
  });
  it("disponible si hay cantidad y no ha caducado", () => {
    const e = estadoAlimento({ cantidad: 2, capacidad: 4, caducidad: dia(10) });
    assert.equal(e.disponible, true);
    assert.equal(e.pct, 50);
  });
  it("no disponible si se acabó", () => assert.equal(estadoAlimento({ cantidad: 0, capacidad: 4, caducidad: dia(10) }).disponible, false));
});
