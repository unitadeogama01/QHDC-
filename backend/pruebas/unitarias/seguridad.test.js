// Pruebas unitarias: protección contra peticiones de otros sitios (CSRF)
// en src/nucleo/seguridad.js → mismoOrigen.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mismoOrigen } = require("../../src/nucleo/seguridad");

/** Simula una petición y dice si pasó (next) o se rechazó (403). */
function probar({ metodo = "POST", cabeceras = {} }) {
  const h = Object.fromEntries(Object.entries(cabeceras).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { method: metodo, get: (n) => h[n.toLowerCase()] };
  let estado = null;
  let paso = false;
  const res = { status(c) { estado = c; return this; }, json() { return this; } };
  mismoOrigen(req, res, () => { paso = true; });
  return paso ? "pasa" : estado;
}

describe("mismoOrigen", () => {
  it("las lecturas (GET) siempre pasan", () => assert.equal(probar({ metodo: "GET", cabeceras: { "Sec-Fetch-Site": "cross-site" } }), "pasa"));
  it("POST desde la propia app pasa", () => assert.equal(probar({ cabeceras: { "Sec-Fetch-Site": "same-origin" } }), "pasa"));
  it("POST desde otro sitio se rechaza con 403", () => {
    assert.equal(probar({ cabeceras: { "Sec-Fetch-Site": "cross-site" } }), 403);
    assert.equal(probar({ cabeceras: { "Sec-Fetch-Site": "same-site" } }), 403);
  });
  it("navegadores sin Sec-Fetch-Site: compara Origin con Host", () => {
    assert.equal(probar({ cabeceras: { Origin: "http://localhost:3000", Host: "localhost:3000" } }), "pasa");
    assert.equal(probar({ cabeceras: { Origin: "https://malo.example", Host: "localhost:3000" } }), 403);
    assert.equal(probar({ cabeceras: { Origin: "no es una url", Host: "localhost:3000" } }), 403);
  });
  it("sin Origin (ESP32, herramientas) pasa: la cookie SameSite ya protege", () => assert.equal(probar({ cabeceras: {} }), "pasa"));
});
