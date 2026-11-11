// ============================================================
//  /api/auth — Entrar, crear cuenta, perfiles y salir (HU-09)
// ============================================================
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const { consulta, una, transaccion } = require("../../nucleo/db");
const { config } = require("../../nucleo/config");
const { ErrorApp, async_, texto } = require("../../nucleo/errores");
const A = require("./sesiones");

const router = express.Router();

// Freno simple contra adivinar contraseñas: 8 intentos fallidos por minuto por IP
// (LIMITE_INTENTOS_ENTRAR en .env)
const intentos = new Map();
function frenar(req) {
  const ip = req.ip;
  const ahora = Date.now();
  const r = intentos.get(ip);
  if (r && r.hasta > ahora && r.veces >= config.limites.intentosEntrarPorMinuto) throw new ErrorApp(429, "Demasiados intentos. Espera un minuto.");
}
function fallo(req) {
  const ahora = Date.now();
  const r = intentos.get(req.ip);
  if (!r || r.hasta < ahora) intentos.set(req.ip, { veces: 1, hasta: ahora + 60000 });
  else r.veces++;
}

const correo = (v) => {
  const c = String(v || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(c) || c.length > 255) throw new ErrorApp(400, "Ese correo no parece válido.");
  return c;
};

async function buscarCuenta(email) {
  return una(
    `SELECT u.id, u.nombre, u.correo, u.contrasena_hash, hm.hogar_id, hm.rol, h.nombre AS hogar
       FROM usuarios u
       JOIN hogar_miembros hm ON hm.usuario_id = u.id AND hm.activo
       JOIN hogares h ON h.id = hm.hogar_id
      WHERE u.correo = ? AND u.activo
      ORDER BY hm.unido_en LIMIT 1`,
    [email]
  );
}

/** Abre la sesión: cookie + token de perfil para "entrar con un toque" */
async function abrirSesion(req, res, cuenta, { conPerfil = true } = {}) {
  const cliente = req.get("user-agent");
  const tokens = await transaccion(async (c) => {
    const sesion = await A.crearSesion(c, { usuarioId: cuenta.id, hogarId: cuenta.hogar_id, cliente });
    const perfil = conPerfil ? await A.crearSesion(c, { usuarioId: cuenta.id, hogarId: cuenta.hogar_id, recordar: true, cliente }) : null;
    await c.query("UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?", [cuenta.id]);
    return { sesion, perfil };
  });
  A.ponerCookie(res, tokens.sesion);
  const publica = A.sesionPublica(cuenta);
  res.json({ sesion: publica, perfil: tokens.perfil ? { nombre: publica.nombre, email: publica.email, rol: publica.rol, token: tokens.perfil } : null });
}

// ---------- Entrar con correo y contraseña ----------
router.post("/entrar", async_(async (req, res) => {
  frenar(req);
  const email = correo(req.body.email);
  const password = String(req.body.password || "");
  const cuenta = await buscarCuenta(email);
  if (!cuenta || !(await bcrypt.compare(password, cuenta.contrasena_hash))) {
    fallo(req);
    throw new ErrorApp(401, "El correo o la contraseña no coinciden.");
  }
  await abrirSesion(req, res, cuenta);
}));

// ---------- Entrar con un perfil guardado en el dispositivo ----------
router.post("/perfil", async_(async (req, res) => {
  frenar(req);
  const s = await A.buscarSesion(req.body.token, { recordar: true });
  if (!s || s.correo !== String(req.body.email || "").toLowerCase()) {
    fallo(req);
    throw new ErrorApp(401, "Este perfil ya no es válido. Entra con tu contraseña.");
  }
  await abrirSesion(req, res, { id: s.usuario_id, nombre: s.nombre, correo: s.correo, hogar_id: s.hogar_id, rol: s.rol, hogar: s.hogar }, { conPerfil: false });
}));

// ---------- Crear cuenta (y su hogar) ----------
const PERSONAS = { "1 a 2": "1-2", "3 a 4": "3-4", "5 o más": "5+", "1-2": "1-2", "3-4": "3-4", "5+": "5+" };
const LUGARES = { refrigerador: "Refrigerador", despensa: "Despensa", congelador: "Congelador" };

// ---------- Invitaciones ----------
// El enlace trae el token en claro; en la base solo está su hash.
async function invitacionVigente(token) {
  if (!token || typeof token !== "string" || token.length > 100) return null;
  return una(
    `SELECT i.id, i.hogar_id, i.correo, i.rol, h.nombre AS hogar FROM invitaciones_hogar i JOIN hogares h ON h.id = i.hogar_id
      WHERE i.token_hash = ? AND i.aceptada_en IS NULL AND i.expira_en > NOW()`,
    [A.hash(token)]
  );
}

router.get("/invitacion/:token", async_(async (req, res) => {
  const inv = await invitacionVigente(req.params.token);
  if (!inv) throw new ErrorApp(404, "Esta invitación ya no es válida. Pide una nueva.");
  res.json({ hogar: inv.hogar, correo: inv.correo, rol: A.ROL_TEXTO[inv.rol] || inv.rol });
}));

/**
 * Crea la cuenta y la une a un hogar: el de la invitación, o uno nuevo del
 * que es administradora. (Registro normal, registro por invitación y Google.)
 */
async function crearCuenta({ nombre, email, contrasenaHash, googleSub = null, invitacion = null, hogar = "Mi casa", personas = "3-4", lugares = ["Refrigerador", "Despensa"] }) {
  return transaccion(async (c) => {
    const [u] = await c.query("INSERT INTO usuarios (nombre, correo, contrasena_hash, google_sub) VALUES (?, ?, ?, ?)", [nombre, email, contrasenaHash, googleSub]);
    await c.query("INSERT INTO preferencias_usuario (usuario_id) VALUES (?)", [u.insertId]);
    if (invitacion) {
      const [r] = await c.query("UPDATE invitaciones_hogar SET aceptada_en = NOW() WHERE id = ? AND aceptada_en IS NULL AND expira_en > NOW()", [invitacion.id]);
      if (!r.affectedRows) throw new ErrorApp(409, "Esta invitación ya se usó o venció.");
      await c.query("INSERT INTO hogar_miembros (hogar_id, usuario_id, rol) VALUES (?, ?, ?)", [invitacion.hogar_id, u.insertId, invitacion.rol]);
      return { id: u.insertId, nombre, correo: email, hogar_id: invitacion.hogar_id, rol: invitacion.rol, hogar: invitacion.hogar };
    }
    const [h] = await c.query("INSERT INTO hogares (nombre, personas, creado_por) VALUES (?, ?, ?)", [hogar, personas, u.insertId]);
    await c.query("INSERT INTO hogar_miembros (hogar_id, usuario_id, rol) VALUES (?, ?, 'administrador')", [h.insertId, u.insertId]);
    for (const [i, l] of lugares.entries()) {
      await c.query("INSERT INTO ubicaciones_almacenamiento (hogar_id, nombre, tipo, orden) VALUES (?, ?, ?, ?)", [h.insertId, l, l.toLowerCase(), i + 1]);
    }
    return { id: u.insertId, nombre, correo: email, hogar_id: h.insertId, rol: "administrador", hogar };
  });
}

/** Invitación del cuerpo de la petición (si viene) ya revisada contra el correo. */
async function invitacionPara(token, email) {
  if (!token) return null;
  const inv = await invitacionVigente(token);
  if (!inv) throw new ErrorApp(400, "Esta invitación ya no es válida. Pide una nueva.");
  if (inv.correo !== email) throw new ErrorApp(400, `Esta invitación es para ${inv.correo}. Usa ese correo.`);
  return inv;
}

router.post("/registro", async_(async (req, res) => {
  const nombre = texto(req.body.nombre, "Tu nombre", { min: 3, max: 100 });
  const email = correo(req.body.email);
  const password = String(req.body.password || "");
  if (password.length < 8) throw new ErrorApp(400, "Usa al menos 8 caracteres en tu contraseña.");
  if (password.length > 200) throw new ErrorApp(400, "La contraseña es demasiado larga.");
  const hogar = texto(req.body.hogar || "Mi casa", "El nombre del hogar", { max: 100 });
  const personas = PERSONAS[String(req.body.personas || "").trim()] || "3-4";
  let lugares = (Array.isArray(req.body.lugares) ? req.body.lugares : [])
    .map((l) => LUGARES[String(l).trim().toLowerCase()]).filter(Boolean);
  if (!lugares.length) lugares = ["Refrigerador", "Despensa"];
  lugares = [...new Set(lugares)];

  if (await una("SELECT id FROM usuarios WHERE correo = ?", [email])) throw new ErrorApp(409, "Ese correo ya tiene una cuenta.");
  const invitacion = await invitacionPara(req.body.invitacion, email);
  const contrasenaHash = await bcrypt.hash(password, 12);
  const cuenta = await crearCuenta({ nombre, email, contrasenaHash, invitacion, hogar, personas, lugares });
  await abrirSesion(req, res, cuenta);
}));

// ---------- Entrar con Google (opcional) ----------
// El navegador recibe un "ID token" de Google; aquí se verifica su firma,
// que sea para nuestra app (audience) y que el correo esté verificado.
router.get("/config", (req, res) => res.json({ google: config.google.clientId || null }));

let clienteGoogle = null;
router.post("/google", async_(async (req, res) => {
  if (!config.google.clientId) throw new ErrorApp(404, "El inicio de sesión con Google no está configurado.");
  frenar(req);
  if (!clienteGoogle) clienteGoogle = new OAuth2Client(config.google.clientId);
  let datos = null;
  try {
    const ticket = await clienteGoogle.verifyIdToken({ idToken: String(req.body.credential || ""), audience: config.google.clientId });
    datos = ticket.getPayload();
  } catch (e) { /* token falso, vencido o de otra app */ }
  if (!datos || !datos.sub || !datos.email || !datos.email_verified) {
    fallo(req);
    throw new ErrorApp(401, "Google no confirmó tu cuenta. Intenta de nuevo.");
  }
  const email = String(datos.email).toLowerCase();

  // ¿Ya existe? Por su cuenta de Google o por su correo (y se vinculan)
  const existente = await una(
    `SELECT u.id, u.nombre, u.correo, u.google_sub, hm.hogar_id, hm.rol, h.nombre AS hogar
       FROM usuarios u
       JOIN hogar_miembros hm ON hm.usuario_id = u.id AND hm.activo
       JOIN hogares h ON h.id = hm.hogar_id
      WHERE (u.google_sub = ? OR u.correo = ?) AND u.activo
      ORDER BY u.google_sub = ? DESC, hm.unido_en LIMIT 1`,
    [datos.sub, email, datos.sub]
  );
  if (existente) {
    if (existente.google_sub && existente.google_sub !== datos.sub) throw new ErrorApp(409, "Ese correo está vinculado a otra cuenta de Google.");
    if (!existente.google_sub) await consulta("UPDATE usuarios SET google_sub = ? WHERE id = ? AND google_sub IS NULL", [datos.sub, existente.id]);
    return abrirSesion(req, res, existente);
  }
  if (await una("SELECT id FROM usuarios WHERE correo = ?", [email])) {
    throw new ErrorApp(409, "Esa cuenta ya no tiene un hogar activo. Pide a tu familia que te invite de nuevo.");
  }

  // Cuenta nueva: se une al hogar de la invitación o crea el suyo
  const invitacion = await invitacionPara(req.body.invitacion, email);
  const nombre = String(datos.name || email.split("@")[0]).slice(0, 100);
  const contrasenaHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12); // no se usa: entra con Google
  const cuenta = await crearCuenta({
    nombre, email, contrasenaHash, googleSub: datos.sub, invitacion,
    hogar: `Casa de ${nombre.split(" ")[0]}`.slice(0, 100),
  });
  await abrirSesion(req, res, cuenta);
}));

// ---------- Sesión actual ----------
router.get("/sesion", A.requiereSesion, (req, res) => res.json({ sesion: A.sesionPublica(req.usuario) }));

// ---------- Salir ----------
router.post("/salir", async_(async (req, res) => {
  await A.revocar(req.cookies[A.COOKIE]);
  res.clearCookie(A.COOKIE, { path: "/" });
  res.json({ ok: true });
}));

module.exports = router;
