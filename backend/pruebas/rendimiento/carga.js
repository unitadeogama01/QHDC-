// ============================================================
//  Prueba de carga (rendimiento)        npm run rendimiento
//
//  1. Crea una base temporal con el script SQL real.
//  2. Arranca el servidor en OTRO proceso (como en producción), sin MQTT,
//     sin simulador y sin IA, con los límites por IP subidos (todo sale de
//     esta computadora; ver LIMITE_* en .env.example).
//  3. Llena datos realistas: N hogares con alimentos, recetas, lista y un
//     ESP32; el hogar 1 con UNA SEMANA de lecturas (~400 mil, lo que guarda
//     la app con un DHT22 cada 3 s).
//  4. Simula a N familias usando la app a la vez y mide cada escenario.
//  5. Borra todo.
//
//  Opciones:  --usuarios 20  --segundos 15  --lecturas 403200  --conexiones 10
//  Resultado: tabla en pantalla y pruebas/rendimiento/resultados/<fecha>.json
// ============================================================
const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { performance } = require("perf_hooks");

const arg = (nombre, porDefecto) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 ? Number(process.argv[i + 1]) : porDefecto;
};
const USUARIOS = arg("usuarios", 20);
const SEGUNDOS = arg("segundos", 15);
const LECTURAS = arg("lecturas", 403200);
const CONEXIONES_DB = arg("conexiones", 10);

// Límites altos SOLO para esta prueba (antes de cargar el entorno)
Object.assign(process.env, {
  LIMITE_API_POR_MINUTO: "1000000", LIMITE_ACCESO_15MIN: "100000", LIMITE_REGISTRO_HORA: "100000",
  LIMITE_INTENTOS_ENTRAR: "100000", LIMITE_IOT_POR_MINUTO: "1000000", DB_CONEXIONES: String(CONEXIONES_DB),
});
const { crearBase, borrarBase, conexionSinBase, BASE, CARPETA_FOTOS, alimento, dia } = require("../ayuda/entorno");

const BACKEND = path.join(__dirname, "..", "..");
const log = (...a) => console.log(...a);

function puertoLibre() {
  return new Promise((ok) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
}

/** Un "navegador" mínimo con su cookie de sesión */
function navegador(url) {
  let cookie = "";
  return async (metodo, ruta, cuerpo) => {
    const r = await fetch(url + ruta, {
      method: metodo,
      headers: { ...(cookie ? { cookie } : {}), ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
    const sc = r.headers.getSetCookie().find((c) => c.startsWith("qhdc_sesion="));
    if (sc) cookie = sc.split(";")[0];
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (e) { /* no era JSON */ }
    return { estado: r.status, json, bytes: texto.length };
  };
}

async function arrancarServidor(puerto) {
  const hijo = spawn(process.execPath, ["server.js"], {
    cwd: BACKEND,
    env: { ...process.env, PUERTO: String(puerto) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let salida = "";
  hijo.stdout.on("data", (d) => { salida += d; });
  hijo.stderr.on("data", (d) => { salida += d; });
  hijo.registro = () => salida; // lo que imprimió el servidor (para revisar errores)
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${puerto}/api/salud`)).ok) return hijo; } catch (e) { /* aún no */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  hijo.kill();
  throw new Error(`El servidor no arrancó:\n${salida}`);
}

// ---------- Datos realistas ----------
const ALIMENTOS = ["Huevo", "Leche", "Arroz", "Frijol negro", "Jitomate", "Cebolla", "Queso Oaxaca", "Tortillas", "Pollo", "Aguacate",
  "Limón", "Pan", "Yogur natural", "Zanahoria", "Café"];

async function llenarHogar(url, k) {
  const pedir = navegador(url);
  const r = await pedir("POST", "/api/auth/registro", { nombre: `Familia ${k}`, email: `familia${k}@carga.test`, password: "ClaveSegura2026", hogar: `Casa ${k}` });
  if (r.estado !== 200) throw new Error(`registro: ${r.estado} ${JSON.stringify(r.json)}`);
  const ids = [];
  for (const [i, nombre] of ALIMENTOS.entries()) {
    const a = await pedir("POST", "/api/alimentos", alimento(nombre, { cantidad: 2 + (i % 5), capacidad: 8, caducidad: dia((i % 12) - 1) }));
    ids.push(a.json.id);
  }
  for (const [i, nombre] of ["Huevos a la mexicana", "Arroz rojo", "Molletes"].entries()) {
    await pedir("POST", "/api/recetas", {
      nombre, tiempo: 20 + i * 10, porciones: 4,
      ingredientes: [{ nombre: ALIMENTOS[i], cantidad: "2" }, { nombre: ALIMENTOS[i + 4], cantidad: "1" }, { nombre: "Sal", cantidad: "al gusto" }, { nombre: "Chile", cantidad: "1" }],
      pasos: ["Prepara los ingredientes.", "Cocina 10 minutos.", "Sirve."],
    });
  }
  for (const n of ["Servilletas", "Azúcar", "Detergente", "Galletas"]) await pedir("POST", "/api/lista/extras", { nombre: n, cantidad: "1" });
  const d = await pedir("POST", "/api/sensores", { nombre: "Báscula de la despensa" });
  return { pedir, ids, dispositivoId: d.json.id };
}

async function llenarLecturas(dispositivoId, cantidad) {
  const c = await conexionSinBase();
  try {
    await c.query(`USE \`${BASE}\``);
    const [[{ hogarId }]] = await c.query("SELECT hogar_id AS hogarId FROM dispositivos_iot WHERE id = ?", [dispositivoId]);
    await c.query("SET SESSION cte_max_recursion_depth = 2000000");
    // Temperatura y humedad alternadas cada 1.5 s, hacia atrás desde ahora (una semana = 403 200)
    await c.query(
      `INSERT INTO lecturas_sensor (hogar_id, dispositivo_id, tipo_lectura, valor, unidad, origen, leido_en, recibido_en, valido)
       WITH RECURSIVE n (i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ? - 1)
       SELECT ?, ?, IF(i % 2 = 0, 'temperatura', 'humedad'), IF(i % 2 = 0, 18 + (i % 90) / 10, 40 + (i % 300) / 10),
              IF(i % 2 = 0, '°C', '%'), 'simulador', NOW(3) - INTERVAL ((? - i) * 1500000) MICROSECOND, NOW(3) - INTERVAL ((? - i) * 1500000) MICROSECOND, TRUE
         FROM n`,
      [cantidad, hogarId, dispositivoId, cantidad, cantidad]
    );
  } finally {
    await c.end();
  }
}

async function cronometrar(nombre, fn) {
  const t0 = performance.now();
  const r = await fn();
  const s = ((performance.now() - t0) / 1000).toFixed(1);
  log(`   ${nombre}: ${s} s`);
  return { r, segundos: Number(s) };
}

// ---------- Escenarios ----------
const percentil = (ordenados, p) => ordenados.length ? ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)] : 0;

/** N usuarios virtuales repiten `paso(usuario)` durante SEGUNDOS; mide cada petición. */
async function escenario(nombre, usuarios, paso) {
  const tiempos = [];
  const tipos = new Map(); // "500 Algo salió mal…" → veces
  let errores = 0, bytes = 0;
  const anotar = (t) => { errores++; tipos.set(t, (tipos.get(t) || 0) + 1); };
  const fin = performance.now() + SEGUNDOS * 1000;
  await Promise.all(usuarios.map(async (u) => {
    while (performance.now() < fin) {
      const t0 = performance.now();
      try {
        const r = await paso(u);
        tiempos.push(performance.now() - t0);
        bytes += r.bytes || 0;
        if (r.estado >= 400) anotar(`${r.estado} ${(r.json && r.json.error) || ""}`.trim());
      } catch (e) {
        anotar(`sin respuesta: ${e.message}`);
      }
    }
  }));
  for (const [t, n] of tipos) log(`      error ×${n}: ${t}`);
  tiempos.sort((a, b) => a - b);
  const fila = {
    escenario: nombre,
    usuarios: usuarios.length,
    peticiones: tiempos.length,
    "por segundo": Math.round(tiempos.length / SEGUNDOS),
    "p50 ms": Math.round(percentil(tiempos, 50)),
    "p95 ms": Math.round(percentil(tiempos, 95)),
    "p99 ms": Math.round(percentil(tiempos, 99)),
    "máx ms": Math.round(tiempos[tiempos.length - 1] || 0),
    errores,
    "KB por respuesta": tiempos.length ? Math.round(bytes / tiempos.length / 1024) : 0,
  };
  log(`   ${nombre}: ${fila["por segundo"]}/s · p95 ${fila["p95 ms"]} ms · errores ${errores}`);
  return fila;
}

(async () => {
  const puerto = await puertoLibre();
  const url = `http://127.0.0.1:${puerto}`;
  let servidor = null;
  log(`\nPrueba de carga · ${USUARIOS} usuarios · ${SEGUNDOS} s por escenario · ${LECTURAS} lecturas en el hogar 1 · ${CONEXIONES_DB} conexiones a MySQL`);
  try {
    log("1) Base temporal y servidor");
    const tBase = await cronometrar("crear base con el script SQL", crearBase);
    servidor = await arrancarServidor(puerto);

    log("2) Datos de prueba");
    const { r: hogares } = await cronometrar(`${USUARIOS} hogares (alimentos, recetas, lista, ESP32)`, async () => {
      const lista = [];
      for (let k = 1; k <= USUARIOS; k++) lista.push(await llenarHogar(url, k));
      return lista;
    });
    const tLect = await cronometrar(`${LECTURAS} lecturas en el hogar 1`, () => llenarLecturas(hogares[0].dispositivoId, LECTURAS));
    const tResumen = await cronometrar("tarea de cada hora (sp_resumir_lecturas)", async () => {
      const c = await conexionSinBase();
      try { await c.query(`USE \`${BASE}\``); await c.query("CALL sp_resumir_lecturas()"); } finally { await c.end(); }
    });
    const ultimoId = async (u) => { const e = await u.pedir("GET", "/api/estado"); return e.json.lecturas.reduce((m, l) => Math.max(m, l.id), 0); };
    for (const h of hogares) h.desde = await ultimoId(h);
    // Calentamiento: la primera vez MySQL carga páginas a memoria
    await Promise.all(hogares.map((h) => h.pedir("GET", "/api/estado")));

    log("3) Escenarios");
    const familia1 = Array.from({ length: USUARIOS }, () => hogares[0]);
    const resultados = [];
    resultados.push(await escenario("Abrir una pantalla (GET /api/estado)", hogares, (h) => h.pedir("GET", "/api/estado")));
    resultados.push(await escenario("Hogar con 1 semana de lecturas (GET /api/estado)", familia1, (h) => h.pedir("GET", "/api/estado")));
    resultados.push(await escenario("Dispositivos en vivo (GET /api/sensores/vivo)", hogares, (h) => h.pedir("GET", `/api/sensores/vivo?desde=${h.desde}`)));
    resultados.push(await escenario("Cambiar una cantidad (PUT existencia)", hogares, (h) => {
      h.n = (h.n || 0) + 1;
      return h.pedir("PUT", `/api/alimentos/${h.ids[h.n % h.ids.length]}/existencia`, { cantidad: 1 + (h.n % 6) });
    }));
    resultados.push(await escenario("Página (GET /dashboard.html)", hogares, (h) => h.pedir("GET", "/dashboard.html")));
    resultados.push(await escenario("Uso mixto (35 % estado · 50 % en vivo · 15 % cambios)", hogares, (h) => {
      const x = Math.random();
      h.n = (h.n || 0) + 1;
      if (x < 0.35) return h.pedir("GET", "/api/estado");
      if (x < 0.85) return h.pedir("GET", `/api/sensores/vivo?desde=${h.desde}`);
      return h.pedir("PUT", `/api/alimentos/${h.ids[h.n % h.ids.length]}/existencia`, { cantidad: 1 + (h.n % 6) });
    }));

    log("\nResultados");
    console.table(resultados);
    const informe = {
      fecha: new Date().toISOString(), node: process.version, plataforma: `${process.platform} ${process.arch}`,
      parametros: { usuarios: USUARIOS, segundos: SEGUNDOS, lecturas: LECTURAS, conexionesDb: CONEXIONES_DB },
      preparacion: { crearBaseS: tBase.segundos, lecturasS: tLect.segundos, resumenHoraS: tResumen.segundos },
      resultados,
    };
    const carpeta = path.join(__dirname, "resultados");
    fs.mkdirSync(carpeta, { recursive: true });
    const archivo = path.join(carpeta, `${informe.fecha.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(archivo, JSON.stringify(informe, null, 2));
    fs.writeFileSync(archivo.replace(/\.json$/, "-servidor.log"), servidor.registro());
    log(`Guardado en ${path.relative(BACKEND, archivo)} (y el registro del servidor en …-servidor.log)`);
    const errores = servidor.registro().split("\n").filter((l) => /^\s*(Error|code:|sqlMessage:|errno:)/.test(l));
    if (errores.length) log(`\nErrores del servidor (primeros):\n${[...new Set(errores)].slice(0, 6).join("\n")}`);
  } finally {
    if (servidor) servidor.kill();
    await new Promise((r) => setTimeout(r, 500));
    await borrarBase().catch((e) => log("No se pudo borrar la base temporal:", e.message));
    fs.rmSync(CARPETA_FOTOS, { recursive: true, force: true });
    log("Base temporal borrada.");
  }
})().catch((e) => { console.error("✖", e.message); process.exit(1); });
