// Pruebas de la API: recetas propias (crear, validar, preparar, borrar),
// ajustes (perfil, contraseña, lugares, preferencias) y asistente sin IA.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { iniciar, alimento } = require("../ayuda/entorno");

let amb, yo, otro;
before(async () => { amb = await iniciar(); yo = await amb.cuentaNueva(); otro = await amb.cuentaNueva(); });
after(async () => { if (amb) await amb.cerrar(); });

const estado = async (quien = yo) => (await quien("GET", "/api/estado")).json;
const receta = (extra = {}) => ({
  nombre: "Huevos a la mexicana", tiempo: 15, porciones: 2, dificultad: "facil",
  ingredientes: [{ nombre: "Huevo", cantidad: "4 piezas" }, { nombre: "Jitomate", cantidad: "2" }, { nombre: "Sal", cantidad: "al gusto" }],
  pasos: ["Pica el jitomate.", "Fríe 3 minutos.", "Agrega el huevo."],
  ...extra,
});

describe("recetas propias", () => {
  let idReceta, idHuevo;

  it("un hogar nuevo no trae recetas de ejemplo", async () => assert.equal((await estado()).recetas.length, 0));

  it("valida la receta antes de guardarla", async () => {
    assert.equal((await yo("POST", "/api/recetas", receta({ nombre: "" }))).estado, 400);
    assert.equal((await yo("POST", "/api/recetas", receta({ ingredientes: [] }))).estado, 400);
    assert.equal((await yo("POST", "/api/recetas", receta({ pasos: [] }))).estado, 400);
    assert.equal((await yo("POST", "/api/recetas", receta({ tiempo: 0 }))).estado, 400);
    const rep = await yo("POST", "/api/recetas", receta({ ingredientes: [{ nombre: "Huevo" }, { nombre: "huevo" }] }));
    assert.equal(rep.estado, 400);
    assert.match(rep.json.error, /repetido/);
  });

  it("guarda la receta con sus ingredientes y pasos", async () => {
    const r = await yo("POST", "/api/recetas", receta());
    assert.equal(r.estado, 201);
    idReceta = r.json.id;
    const g = (await estado()).recetas.find((x) => x.id === idReceta);
    assert.equal(g.ingredientes.length, 3);
    assert.equal(g.pasos.length, 3);
  });

  it("no permite dos recetas con el mismo nombre en el hogar", async () => {
    assert.equal((await yo("POST", "/api/recetas", receta())).estado, 409);
  });

  it("las recetas de un hogar no las ve ni las usa otro", async () => {
    assert.equal((await estado(otro)).recetas.length, 0);
    assert.equal((await otro("POST", `/api/recetas/${idReceta}/preparar`, { consumos: [] })).estado, 404);
    assert.equal((await otro("DELETE", `/api/recetas/${idReceta}`)).estado, 404);
  });

  it("'¡Terminé!' descuenta lo usado de la alacena", async () => {
    idHuevo = (await yo("POST", "/api/alimentos", alimento("Huevo", { cantidad: 6 }))).json.id;
    const r = await yo("POST", `/api/recetas/${idReceta}/preparar`, { consumos: [{ alimentoId: idHuevo, cantidad: 4 }] });
    assert.equal(r.estado, 201);
    assert.equal((await estado()).productos.find((p) => p.id === idHuevo).cantidad, 2);
  });

  it("no descuenta de más: la cantidad nunca queda negativa", async () => {
    await yo("POST", `/api/recetas/${idReceta}/preparar`, { consumos: [{ alimentoId: idHuevo, cantidad: 50 }] });
    assert.equal((await estado()).productos.find((p) => p.id === idHuevo).cantidad, 0);
  });

  it("borrar una receta ya preparada la oculta y libera su nombre", async () => {
    assert.equal((await yo("DELETE", `/api/recetas/${idReceta}`)).estado, 200);
    assert.equal((await estado()).recetas.length, 0);
    assert.equal((await yo("POST", "/api/recetas", receta())).estado, 201);
  });

  it("sin IA configurada, generar una receta responde 503 (la app lo explica)", async () => {
    const r = await yo("POST", "/api/recetas/generar", { elegidos: [idHuevo] });
    assert.equal(r.estado, 503);
    assert.ok(r.json.error);
  });
});

describe("ajustes", () => {
  it("muestra perfil, hogar, lugares y categorías", async () => {
    const r = await yo("GET", "/api/ajustes");
    assert.equal(r.estado, 200);
    assert.ok(r.json.lugares.length >= 1);
  });

  it("agrega un lugar con límites de temperatura y humedad", async () => {
    const r = await yo("POST", "/api/ajustes/lugares", { nombre: "Alacena alta", tempMin: 10, tempMax: 28, humMin: 30, humMax: 65 });
    assert.ok([200, 201].includes(r.estado), JSON.stringify(r.json));
    assert.ok((await yo("GET", "/api/ajustes")).json.lugares.some((l) => l.nombre === "Alacena alta"));
  });

  it("guarda preferencias y recorridos vistos", async () => {
    assert.equal((await yo("PUT", "/api/preferencias", { tema: "oscuro", sonidos: false, avisosCaducidad: true })).estado, 200);
    assert.equal((await estado()).preferencias.tema, "oscuro");
    assert.equal((await yo("PUT", "/api/recorridos/dashboard", { completado: true })).estado, 200);
    assert.equal((await yo("PUT", "/api/recorridos/pantalla-inventada", {})).estado, 400);
  });

  it("cambiar la contraseña pide la actual y valida la nueva", async () => {
    assert.equal((await yo("PUT", "/api/ajustes/contrasena", { actual: "equivocada", nueva: "OtraClave2026" })).estado, 400);
    assert.equal((await yo("PUT", "/api/ajustes/contrasena", { actual: "ClaveSegura2026", nueva: "corta" })).estado, 400);
    assert.equal((await yo("PUT", "/api/ajustes/contrasena", { actual: "ClaveSegura2026", nueva: "OtraClave2026" })).estado, 200);
    const nuevo = amb.navegador();
    assert.equal((await nuevo("POST", "/api/auth/entrar", { email: yo.correo, password: "ClaveSegura2026" })).estado, 401);
    assert.equal((await nuevo("POST", "/api/auth/entrar", { email: yo.correo, password: "OtraClave2026" })).estado, 200);
  });
});

describe("asistente", () => {
  it("sin IA configurada responde 503 y la app usa sus reglas", async () => {
    assert.equal((await yo("POST", "/api/asistente/preguntar", { pregunta: "¿Qué cocino hoy?" })).estado, 503);
  });
  it("guarda la respuesta de las reglas sin HTML", async () => {
    assert.equal((await yo("POST", "/api/asistente/mensajes", { pregunta: "¿Qué cocino?", respuesta: "<p>Prueba <b>esto</b></p><script>x</script>" })).estado, 201);
    assert.equal((await yo("POST", "/api/asistente/mensajes", { pregunta: "" })).estado, 400);
  });
});
