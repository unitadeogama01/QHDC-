// Pruebas unitarias: reglas de las lecturas del ESP32 (src/modulos/iot/procesar.js)
// y topics MQTT (src/modulos/iot/temas.js). Ningún sensor debe cambiar mal el inventario.
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { reglas, reiniciarEstabilidad } = require("../../src/modulos/iot/procesar");
const temas = require("../../src/modulos/iot/temas");

const { validar, estable, horaDispositivo } = reglas;
const bascula = { id: 900, capacidad_g: 5000, lecturas_estables: 2, umbral_cambio_g: 5 };
const canal = { canal: 1, alimento_id: 7 };

describe("validar: peso", () => {
  it("acepta un peso normal", () => assert.deepEqual(validar(bascula, { tipo: "peso", valor: 812.5 }, canal), { valido: true, motivo: null, valor: 812.5 }));
  it("un poco de ruido negativo cuenta como 0 g", () => assert.equal(validar(bascula, { tipo: "peso", valor: -2 }, canal).valor, 0));
  it("rechaza si la báscula no tiene alimento asignado", () => {
    const r = validar(bascula, { tipo: "peso", valor: 500 }, null);
    assert.equal(r.valido, false);
    assert.match(r.motivo, /no tiene un alimento/);
  });
  it("rechaza lecturas que el ESP32 marcó como inestables", () => assert.equal(validar(bascula, { tipo: "peso", valor: 500, estable: false }, canal).valido, false));
  it("rechaza peso muy negativo (falta tara)", () => assert.match(validar(bascula, { tipo: "peso", valor: -50 }, canal).motivo, /tara/));
  it("rechaza más de la capacidad de la celda (+5 %)", () => {
    assert.equal(validar(bascula, { tipo: "peso", valor: 5250 }, canal).valido, true);  // dentro del 5 %
    assert.equal(validar(bascula, { tipo: "peso", valor: 5300 }, canal).valido, false);
  });
});

describe("validar: DHT22", () => {
  it("acepta temperatura y humedad dentro del rango del sensor", () => {
    assert.equal(validar(bascula, { tipo: "temperatura", valor: 22.8 }).valido, true);
    assert.equal(validar(bascula, { tipo: "humedad", valor: 51 }).valido, true);
  });
  it("rechaza valores imposibles para el DHT22", () => {
    assert.equal(validar(bascula, { tipo: "temperatura", valor: 120 }).valido, false);
    assert.equal(validar(bascula, { tipo: "humedad", valor: 140 }).valido, false);
    assert.equal(validar(bascula, { tipo: "humedad", valor: -1 }).valido, false);
  });
});

describe("estable: un peso solo cuenta tras lecturas parecidas seguidas", () => {
  beforeEach(() => reiniciarEstabilidad(bascula.id));
  it("la primera lectura sola no se aplica", () => assert.equal(estable(bascula, 1, 800), false));
  it("dos lecturas parecidas (≤ 5 g) sí", () => {
    estable(bascula, 1, 800);
    assert.equal(estable(bascula, 1, 803), true);
  });
  it("levantar el frasco un momento no se aplica", () => {
    estable(bascula, 1, 800);
    assert.equal(estable(bascula, 1, 0), false);
    assert.equal(estable(bascula, 1, 800), false);
  });
  it("reiniciarEstabilidad olvida la ventana (tras calibrar)", () => {
    estable(bascula, 1, 800);
    reiniciarEstabilidad(bascula.id);
    assert.equal(estable(bascula, 1, 801), false);
  });
});

describe("horaDispositivo", () => {
  it("acepta segundos, milisegundos e ISO", () => {
    const ms = Date.UTC(2026, 10, 9, 12, 0, 0);
    assert.equal(horaDispositivo(ms / 1000), ms);
    assert.equal(horaDispositivo(ms), ms);
    assert.equal(horaDispositivo(new Date(ms).toISOString()), ms);
  });
  it("ignora horas sin sentido (ESP32 sin NTP: arranca en 1970)", () => {
    assert.equal(horaDispositivo(12345), null);
    assert.equal(horaDispositivo("ayer"), null);
    assert.equal(horaDispositivo(undefined), null);
  });
});

describe("topics MQTT", () => {
  it("arma y separa los topics de un dispositivo", () => {
    const t = temas.tema("esp32-a", "bascula/peso");
    assert.equal(t, `${temas.PREFIJO}/esp32-a/bascula/peso`);
    assert.deepEqual(temas.analizar(t), { identificador: "esp32-a", sufijo: "bascula/peso" });
  });
  it("rechaza topics de otro prefijo o incompletos", () => {
    assert.equal(temas.analizar("otra/esp32-a/bascula/peso"), null);
    assert.equal(temas.analizar(`${temas.PREFIJO}/esp32-a`), null);
  });
  it("un ESP32 solo puede publicar lecturas, estado y respuestas (no comandos)", () => {
    for (const s of ["bascula/peso", "ambiente/temperatura", "ambiente/humedad", "estado", "respuestas"]) assert.equal(temas.puedePublicar("x", s), true, s);
    assert.equal(temas.puedePublicar("x", "comandos"), false);
  });
});
