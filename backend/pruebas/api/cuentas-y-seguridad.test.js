// Pruebas de la API: cuentas, sesiones, roles, aislamiento entre hogares y
// protecciones (cabeceras, CSRF, errores). Base temporal; se borra al final.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { iniciar, alimento } = require("../ayuda/entorno");

let amb;
let cuentaA; // se reutiliza: el límite real es de 10 cuentas por hora desde la misma red
before(async () => { amb = await iniciar(); });
after(async () => { if (amb) await amb.cerrar(); });

describe("instalación nueva", () => {
  it("la app responde y usa la base de prueba", async () => {
    const r = await amb.navegador()("GET", "/api/salud");
    assert.equal(r.estado, 200);
    assert.equal(r.json.base, amb.base);
  });
  it("entrega las páginas", async () => {
    const pedir = amb.navegador();
    for (const p of ["/", "/login.html", "/registro.html", "/dashboard.html", "/recetas", "/ajustes.html"]) {
      assert.equal((await pedir("GET", p)).estado, 200, p);
    }
    assert.equal((await pedir("GET", "/no-existe.html")).estado, 404);
  });
  it("sin sesión no se ven datos", async () => {
    assert.equal((await amb.navegador()("GET", "/api/estado")).estado, 401);
  });
});

describe("crear cuenta", () => {
  const datos = (extra) => ({ nombre: "Ana López", email: "ana@prueba.test", password: "ClaveSegura2026", hogar: "Casa de Ana", ...extra });
  it("valida nombre, correo y contraseña", async () => {
    const pedir = amb.navegador();
    assert.equal((await pedir("POST", "/api/auth/registro", datos({ nombre: "A" }))).estado, 400);
    assert.equal((await pedir("POST", "/api/auth/registro", datos({ email: "no-es-correo" }))).estado, 400);
    const corta = await pedir("POST", "/api/auth/registro", datos({ password: "1234567" }));
    assert.equal(corta.estado, 400);
    assert.match(corta.json.error, /8 caracteres/);
  });
  it("crea la cuenta y su hogar vacío, con sesión en cookie segura", async () => {
    const pedir = amb.navegador();
    const r = await pedir("POST", "/api/auth/registro", datos());
    assert.equal(r.estado, 200);
    assert.equal(r.json.sesion.rol, "Administrador");
    const cookie = r.setCookie.find((c) => c.startsWith("qhdc_sesion="));
    assert.ok(cookie, "manda la cookie de sesión");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const e = await pedir("GET", "/api/estado");
    assert.equal(e.estado, 200);
    assert.equal(e.json.productos.length, 0);
    assert.equal(e.json.recetas.length, 0);
    assert.equal(e.json.sensores.length, 0);
  });
  it("no permite dos cuentas con el mismo correo", async () => {
    const r = await amb.navegador()("POST", "/api/auth/registro", datos({ email: "ANA@prueba.test" }));
    assert.equal(r.estado, 409);
  });
});

describe("entrar y salir", () => {
  it("contraseña mala → 401; buena → 200; salir cierra la sesión", async () => {
    const pedir = amb.navegador();
    assert.equal((await pedir("POST", "/api/auth/entrar", { email: "ana@prueba.test", password: "otra-cosa" })).estado, 401);
    assert.equal((await pedir("POST", "/api/auth/entrar", { email: "ana@prueba.test", password: "ClaveSegura2026" })).estado, 200);
    assert.equal((await pedir("GET", "/api/estado")).estado, 200);
    assert.equal((await pedir("POST", "/api/auth/salir", {})).estado, 200);
    assert.equal((await pedir("GET", "/api/estado")).estado, 401);
  });
  it("una cookie inventada no abre sesión", async () => {
    const r = await amb.navegador()("GET", "/api/estado", undefined, { cabeceras: { cookie: "qhdc_sesion=inventada123" } });
    assert.equal(r.estado, 401);
  });
});

describe("cada hogar ve solo lo suyo", () => {
  it("otra cuenta no puede ver ni cambiar un alimento ajeno", async () => {
    const a = (cuentaA = await amb.cuentaNueva());
    const b = await amb.cuentaNueva();
    const creado = await a("POST", "/api/alimentos", alimento("Arroz"));
    assert.equal(creado.estado, 201);
    const idArroz = creado.json.id;
    assert.equal((await b("GET", "/api/estado")).json.productos.length, 0);
    assert.equal((await b("PUT", `/api/alimentos/${idArroz}/existencia`, { cantidad: 0 })).estado, 404);
    assert.equal((await b("DELETE", `/api/alimentos/${idArroz}`)).estado, 404);
    const deA = (await a("GET", "/api/estado")).json.productos.find((p) => p.id === idArroz);
    assert.equal(deA.cantidad, 6, "el alimento de A no cambió");
  });
});

describe("roles: administrador y miembro", () => {
  it("un miembro invitado comparte la alacena pero no hace tareas de administrador", async () => {
    const admin = await amb.cuentaNueva();
    await admin("POST", "/api/alimentos", alimento("Frijol"));
    const inv = await admin("POST", "/api/ajustes/invitaciones", { correo: "beto@prueba.test", rol: "miembro" });
    assert.equal(inv.estado, 201);
    const token = new URL(inv.json.enlace).searchParams.get("invitacion");
    const miembro = await amb.cuentaNueva({ email: "beto@prueba.test", invitacion: token });
    const e = (await miembro("GET", "/api/estado")).json;
    assert.equal(e.sesion.rol, "Miembro");
    assert.ok(e.productos.some((p) => p.nombre === "Frijol"), "ve la alacena compartida");
    assert.equal((await miembro("POST", "/api/sensores", { nombre: "Báscula" })).estado, 403);
    assert.equal((await miembro("POST", "/api/ajustes/lugares", { nombre: "Alacena 2" })).estado, 403);
  });
  it("una invitación falsa no sirve", async () => {
    const r = await amb.navegador()("POST", "/api/auth/registro", { nombre: "Intruso", email: "x@prueba.test", password: "ClaveSegura2026", invitacion: "token-falso" });
    assert.ok(r.estado >= 400 && r.estado < 500);
  });
});

describe("protecciones", () => {
  it("cabeceras de seguridad en todas las respuestas", async () => {
    const r = await amb.navegador()("GET", "/login.html");
    const csp = r.cabeceras.get("content-security-policy");
    assert.match(csp, /default-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, "no permite scripts en línea");
    assert.equal(r.cabeceras.get("x-content-type-options"), "nosniff");
    assert.match(r.cabeceras.get("permissions-policy"), /camera=\(self\)/);
    assert.equal(r.cabeceras.get("x-powered-by"), null);
  });
  it("rechaza cambios que vienen de otro sitio (CSRF)", async () => {
    const r = await cuentaA("POST", "/api/alimentos", alimento("Sal de mar"), { cabeceras: { "Sec-Fetch-Site": "cross-site" } });
    assert.equal(r.estado, 403);
  });
  it("errores del cliente responden 4xx con mensaje, nunca 500", async () => {
    const a = cuentaA;
    const malformado = await a("POST", "/api/alimentos", undefined, { cabeceras: { "Content-Type": "application/json" } });
    assert.ok(malformado.estado < 500);
    const roto = await fetch(amb.url + "/api/auth/entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{esto no es json" });
    assert.equal(roto.status, 400);
    const enorme = await fetch(amb.url + "/api/auth/entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: "a".repeat(300000) }) });
    assert.equal(enorme.status, 413);
    const ruta = await a("GET", "/api/no-existe");
    assert.equal(ruta.estado, 404);
    assert.ok(ruta.json.error);
    assert.equal((await a("PUT", "/api/alimentos/abc/existencia", { cantidad: 1 })).estado, 400);
  });
  it("frena a quien intenta adivinar contraseñas (8 intentos por minuto)", async () => {
    const pedir = amb.navegador();
    const estados = [];
    for (let k = 0; k < 9; k++) estados.push((await pedir("POST", "/api/auth/entrar", { email: "ana@prueba.test", password: `mala${k}` })).estado);
    // (otras pruebas de este archivo ya fallaron una vez desde la misma IP)
    const primero = estados.indexOf(429);
    assert.ok(primero > 0, `debe frenar: ${estados}`);
    assert.ok(estados.slice(0, primero).every((e) => e === 401));
    assert.ok(estados.slice(primero).every((e) => e === 429), "sigue frenado");
  });
  it("frena la creación masiva de cuentas: 10 por hora desde la misma red", async () => {
    // Este archivo ya creó (o intentó crear) 10 cuentas desde 127.0.0.1
    const r = await amb.navegador()("POST", "/api/auth/registro", { nombre: "Una más", email: "una.mas@prueba.test", password: "ClaveSegura2026" });
    assert.equal(r.estado, 429);
  });
});
