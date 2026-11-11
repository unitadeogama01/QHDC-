// Pruebas de la API: ESP32 (vincular, lecturas por HTTP con sus reglas,
// báscula → inventario) y fotos (subir, validar, analizar, confirmar, privacidad).
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { iniciar, alimento } = require("../ayuda/entorno");

let amb, yo, otro;
before(async () => { amb = await iniciar(); yo = await amb.cuentaNueva(); otro = await amb.cuentaNueva(); });
after(async () => { if (amb) await amb.cerrar(); });

const estado = async (quien = yo) => (await quien("GET", "/api/estado")).json;

describe("dispositivos (ESP32)", () => {
  let disp;
  const lecturas = (l, cred = disp) => amb.navegador()("POST", "/api/iot/lecturas", { identificador: cred.identificador, clave: cred.clave, lecturas: l });

  it("vincular da un identificador y una clave nuevos", async () => {
    const r = await yo("POST", "/api/sensores", { nombre: "Báscula de prueba" });
    assert.equal(r.estado, 201);
    disp = r.json;
    assert.match(disp.identificador, /^esp32-/);
    assert.ok(disp.clave.length >= 16);
    assert.equal((await estado()).sensores.length > 0, true);
  });

  it("sin clave o con clave equivocada no se aceptan lecturas", async () => {
    assert.equal((await amb.navegador()("POST", "/api/iot/lecturas", { lecturas: [{ tipo: "humedad", valor: 50 }] })).estado, 401);
    assert.equal((await lecturas([{ tipo: "humedad", valor: 50 }], { identificador: disp.identificador, clave: "equivocada" })).estado, 401);
    assert.equal((await lecturas([])).estado, 400);
  });

  it("guarda temperatura y humedad válidas", async () => {
    const r = await lecturas([{ tipo: "temperatura", valor: 22.5 }, { tipo: "humedad", valor: 51 }]);
    assert.equal(r.estado, 200);
    assert.equal(r.json.guardadas, 2);
    assert.equal(r.json.invalidas, 0);
  });

  it("valores imposibles se guardan como inválidos (no cambian nada)", async () => {
    const r = await lecturas([{ tipo: "humedad", valor: 150 }, { tipo: "temperatura", valor: 200 }]);
    assert.equal(r.json.invalidas, 2);
  });

  it("la app muestra la última temperatura y humedad válidas (sin recorrer el historial)", async () => {
    const ver = async () => (await estado()).sensores.find((s) => s.id === disp.id);
    await lecturas([{ tipo: "temperatura", valor: 23.4 }, { tipo: "humedad", valor: 55 }]);
    assert.equal((await ver()).temperatura, 23.4);
    assert.equal((await ver()).humedad, 55);
    // Inválida (fuera de rango): no cambia lo que se muestra
    await lecturas([{ tipo: "humedad", valor: 150 }]);
    assert.equal((await ver()).humedad, 55);
    // Atrasada (llega tarde con la hora del ESP32): tampoco
    await lecturas([{ tipo: "humedad", valor: 30, ts: Date.now() - 5 * 60 * 1000 }]);
    assert.equal((await ver()).humedad, 55);
  });

  it("un mensaje repetido (mismo msgId) se ignora", async () => {
    await lecturas([{ tipo: "temperatura", valor: 21, msgId: "m-1" }]);
    const r = await lecturas([{ tipo: "temperatura", valor: 21, msgId: "m-1" }]);
    assert.equal(r.json.duplicadas, 1);
    assert.equal(r.json.guardadas, 0);
  });

  it("tipos desconocidos se ignoran", async () => {
    assert.equal((await lecturas([{ tipo: "radiacion", valor: 1 }])).json.ignoradas, 1);
  });

  it("peso sin alimento asignado no toca el inventario", async () => {
    assert.equal((await lecturas([{ tipo: "peso", valor: 500 }])).json.invalidas, 1);
  });

  it("con alimento asignado, el peso estable actualiza la alacena", async () => {
    const idArroz = (await yo("POST", "/api/alimentos", alimento("Arroz", { unidad: "g", cantidad: 1000, capacidad: 2000 }))).json.id;
    assert.equal((await yo("PUT", `/api/sensores/${disp.id}/alimento`, { alimentoId: idArroz })).estado, 200);
    const primera = await lecturas([{ tipo: "peso", valor: 800, msgId: "p-1" }]);
    assert.equal(primera.json.aplicadas, 0, "una sola lectura no basta");
    const segunda = await lecturas([{ tipo: "peso", valor: 802, msgId: "p-2" }]);
    assert.equal(segunda.json.aplicadas, 1);
    const arroz = (await estado()).productos.find((p) => p.id === idArroz);
    assert.ok(Math.abs(arroz.cantidad - 802) <= 5, `cantidad ${arroz.cantidad}`);
  });

  it("la báscula no acepta alimentos que no se pesan (litros)", async () => {
    const idLeche = (await yo("POST", "/api/alimentos", alimento("Leche", { unidad: "L", cantidad: 1, capacidad: 2 }))).json.id;
    assert.equal((await yo("PUT", `/api/sensores/${disp.id}/alimento`, { alimentoId: idLeche })).estado, 400);
  });

  it("otro hogar no puede usar ni ver el dispositivo", async () => {
    assert.equal((await otro("POST", `/api/sensores/${disp.id}/conectar`, {})).estado, 404);
    assert.equal((await estado(otro)).sensores.length, 0);
  });

  it("lo que cambia en vivo se consulta sin recargar todo", async () => {
    const r = await yo("GET", "/api/sensores/vivo?desde=0");
    assert.equal(r.estado, 200);
    assert.ok(r.json.lecturas.length > 0);
  });
});

describe("fotos de alimentos", () => {
  let escaneo;
  const foto = async () => sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 230, g: 80, b: 40 } } }).jpeg().toBuffer();
  const subir = (contenido, tipo = "image/jpeg", nombre = "foto.jpg", quien = yo) => {
    const f = new FormData();
    f.append("foto", new Blob([contenido], { type: tipo }), nombre);
    return quien("POST", "/api/escaneos/foto", f, { form: true });
  };

  it("acepta una foto JPEG", async () => {
    const r = await subir(await foto());
    assert.equal(r.estado, 201);
    escaneo = r.json;
    assert.ok(escaneo.escaneoId);
  });

  it("rechaza archivos que no son imagen aunque digan .jpg", async () => {
    const r = await subir(Buffer.from("esto es texto, no una foto"), "image/jpeg", "falsa.jpg");
    assert.equal(r.estado, 415);
    assert.equal((await subir(Buffer.from("hola"), "text/plain", "nota.txt")).estado, 400);
  });

  it("la foto solo la ve su hogar", async () => {
    const mia = await yo("GET", `/api/imagenes/${escaneo.imagenId}`);
    assert.equal(mia.estado, 200);
    assert.equal(mia.cabeceras.get("content-type"), "image/jpeg");
    assert.equal((await otro("GET", `/api/imagenes/${escaneo.imagenId}`)).estado, 404);
    assert.equal((await amb.navegador()("GET", `/api/imagenes/${escaneo.imagenId}`)).estado, 401);
  });

  const alacena = async () => (await estado()).productos.map((p) => `${p.nombre}:${p.cantidad}`).sort();

  it("sin IA, el análisis funciona en modo demostración, lo dice y no cambia la alacena", async () => {
    const antes = await alacena();
    const r = await yo("POST", `/api/escaneos/${escaneo.escaneoId}/analizar`, {});
    assert.equal(r.estado, 200);
    assert.equal(r.json.simulado, true);
    assert.ok(r.json.alimentos.length > 0);
    escaneo.propuestas = r.json.alimentos;
    assert.deepEqual(await alacena(), antes, "analizar solo propone");
  });

  it("al confirmar, lo elegido entra a la alacena (y solo una vez)", async () => {
    // El modo demostración elige alimentos del catálogo al azar: pueden existir ya (se suman)
    const p = escaneo.propuestas[0];
    const cantidad = p.cantidad || 1;
    const previo = (await estado()).productos.find((x) => x.nombre === p.nombre);
    const r = await yo("POST", `/api/escaneos/${escaneo.escaneoId}/confirmar`, {
      alimentos: [{ identificacionId: p.identificacionId, elegido: true, nombre: p.nombre, cantidad, caducidad: p.caducidad || null }],
    });
    assert.equal(r.estado, 200);
    assert.equal(r.json.guardados, 1);
    const ahora = (await estado()).productos.find((x) => x.nombre === p.nombre);
    assert.ok(ahora, `${p.nombre} está en la alacena`);
    assert.ok(Math.abs(ahora.cantidad - ((previo ? previo.cantidad : 0) + cantidad)) < 0.01, `cantidad ${ahora.cantidad}`);
    assert.equal((await yo("POST", `/api/escaneos/${escaneo.escaneoId}/confirmar`, { alimentos: [] })).estado, 409, "no se confirma dos veces");
  });

  it("otro hogar no puede analizar ni confirmar el escaneo", async () => {
    assert.equal((await otro("POST", `/api/escaneos/${escaneo.escaneoId}/analizar`, {})).estado, 404);
  });

  it("borrar la foto la elimina", async () => {
    assert.equal((await yo("DELETE", `/api/imagenes/${escaneo.imagenId}`)).estado, 200);
    assert.equal((await yo("GET", `/api/imagenes/${escaneo.imagenId}`)).estado, 404);
  });
});
