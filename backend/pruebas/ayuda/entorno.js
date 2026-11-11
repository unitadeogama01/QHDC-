// ============================================================
//  Entorno para las pruebas de la API
//
//  iniciar():
//   1. Configura variables SOLO para esta prueba: base temporal
//      (qhdc_prueba_…), sin MQTT, sin simulador, sin IA (no se llama
//      a Claude ni se gasta dinero) y fotos en una carpeta temporal.
//   2. Crea la base con database/qhdc_base_de_datos.sql (el mismo
//      script de una instalación nueva).
//   3. Arranca la app en un puerto libre.
//  cerrar(): apaga la app y BORRA la base y las fotos temporales.
//
//  Necesita MySQL 8 y un usuario que pueda crear y borrar bases
//  (DB_HOST, DB_USUARIO, DB_CONTRASENA de backend/.env o del sistema).
// ============================================================
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const BASE = `qhdc_prueba_${process.pid}_${crypto.randomBytes(3).toString("hex")}`;
const CARPETA_FOTOS = fs.mkdtempSync(path.join(os.tmpdir(), "qhdc-fotos-"));

// Antes de cargar cualquier archivo de src/ (config.js lee el entorno una sola vez)
Object.assign(process.env, {
  DB_NOMBRE: BASE,
  MQTT_HABILITADO: "false",
  SIMULADOR: "false",
  ANTHROPIC_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
  COOKIE_SEGURA: "false",
  IMAGENES_CARPETA: CARPETA_FOTOS,
});

const mysql = require("mysql2/promise");
const { config } = require("../../src/nucleo/config");
const { dividirScript, conOtraBase } = require("./script-sql");

const SCRIPT = path.join(__dirname, "..", "..", "..", "database", "qhdc_base_de_datos.sql");

async function conexionSinBase() {
  try {
    return await mysql.createConnection({
      host: config.db.host, port: config.db.puerto, user: config.db.usuario, password: config.db.contrasena,
      charset: "UTF8MB4_0900_AI_CI",
    });
  } catch (e) {
    throw new Error(`Las pruebas de la API necesitan MySQL 8 encendido (${config.db.host}:${config.db.puerto}, usuario ${config.db.usuario}): ${e.message}`);
  }
}

async function crearBase() {
  const c = await conexionSinBase();
  try {
    for (const s of conOtraBase(dividirScript(fs.readFileSync(SCRIPT, "utf8")), BASE)) await c.query(s);
  } finally {
    await c.end();
  }
}

async function borrarBase() {
  const c = await conexionSinBase();
  try { await c.query(`DROP DATABASE IF EXISTS \`${BASE}\``); } finally { await c.end(); }
}

/** Un "navegador": guarda sus cookies y manda peticiones a la API. */
function navegador(url) {
  const cookies = new Map();
  return async function pedir(metodo, ruta, cuerpo, { form = false, cabeceras = {} } = {}) {
    const r = await fetch(url + ruta, {
      method: metodo,
      headers: {
        ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(cuerpo !== undefined && !form ? { "Content-Type": "application/json" } : {}),
        ...cabeceras,
      },
      body: form ? cuerpo : cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      redirect: "manual",
    });
    for (const sc of r.headers.getSetCookie()) {
      const [par] = sc.split(";");
      const [k, ...v] = par.split("=");
      const valor = v.join("=");
      if (!valor || /max-age=0|expires=thu, 01 jan 1970/i.test(sc)) cookies.delete(k.trim()); else cookies.set(k.trim(), valor);
    }
    const tipo = r.headers.get("content-type") || "";
    const json = tipo.includes("json") ? await r.json() : null;
    if (!json) await r.arrayBuffer();
    return { estado: r.status, json, cabeceras: r.headers, setCookie: r.headers.getSetCookie() };
  };
}

let servidor = null;
let contador = 0;

async function iniciar() {
  await crearBase();
  const { crearApp } = require("../../src/app");
  servidor = await new Promise((ok) => { const s = crearApp().listen(0, "127.0.0.1", () => ok(s)); });
  const url = `http://127.0.0.1:${servidor.address().port}`;
  return {
    url,
    base: BASE,
    navegador: () => navegador(url),
    /** Crea una cuenta nueva (con su hogar) y devuelve su navegador con la sesión abierta. */
    async cuentaNueva(datos = {}) {
      const pedir = navegador(url);
      const correo = datos.email || `persona${++contador}.${crypto.randomBytes(2).toString("hex")}@prueba.test`;
      const r = await pedir("POST", "/api/auth/registro", { nombre: "Persona de prueba", email: correo, password: "ClaveSegura2026", hogar: "Hogar de prueba", ...datos });
      if (r.estado !== 200) throw new Error(`No se pudo crear la cuenta: ${r.estado} ${JSON.stringify(r.json)}`);
      pedir.correo = correo;
      return pedir;
    },
    async cerrar() {
      if (servidor) await new Promise((ok) => servidor.close(ok));
      try { await require("../../src/nucleo/db").pool.end(); } catch (e) { /* ya cerrada */ }
      await borrarBase();
      fs.rmSync(CARPETA_FOTOS, { recursive: true, force: true });
    },
  };
}

/** Fecha AAAA-MM-DD a n días de hoy */
const dia = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** Datos de un alimento nuevo para POST /api/alimentos */
const alimento = (nombre, extra = {}) => ({
  nombre, categoria: "Otros", ubicacion: "Despensa", unidad: "pz", cantidad: 6, capacidad: 12,
  caducidad: dia(10), icono: "fa-box-open", color: "cafe", origen: "manual", ...extra,
});

module.exports = { iniciar, dia, alimento, crearBase, borrarBase, conexionSinBase, BASE, CARPETA_FOTOS };
