// ============================================================
//  Sesiones (HU-09)
//
//  Al entrar se genera un token aleatorio. El navegador lo guarda en
//  una cookie httpOnly (JavaScript no la puede leer) y en la base solo
//  se guarda su HASH SHA-256 en sesiones_autenticacion.
//
//  "Perfiles guardados": además se entrega un token de perfil (recordar = TRUE)
//  que el navegador guarda para volver a entrar con un toque.
// ============================================================
const crypto = require("crypto");
const { consulta, una } = require("../../nucleo/db");
const { config } = require("../../nucleo/config");

const COOKIE = "qhdc_sesion";
const HORAS_SESION = 24 * 7;  // una semana
const DIAS_PERFIL = 30;

const hash = (texto) => crypto.createHash("sha256").update(texto).digest("hex");
const tokenNuevo = () => crypto.randomBytes(32).toString("hex");

const ROL_TEXTO = { administrador: "Administrador", miembro: "Miembro" };

/** Crea una sesión y devuelve el token en claro (solo se conoce aquí). */
async function crearSesion(conexion, { usuarioId, hogarId, recordar = false, cliente = null }) {
  const token = tokenNuevo();
  const horas = recordar ? DIAS_PERFIL * 24 : HORAS_SESION;
  await conexion.query(
    `INSERT INTO sesiones_autenticacion (usuario_id, hogar_id, token_hash, descripcion_cliente, recordar, expira_en)
     VALUES (?, ?, ?, ?, ?, NOW() + INTERVAL ? HOUR)`,
    [usuarioId, hogarId, hash(token), cliente ? String(cliente).slice(0, 255) : null, recordar, horas]
  );
  return token;
}

function ponerCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSegura,
    maxAge: HORAS_SESION * 3600 * 1000,
    path: "/",
  });
}

/** Busca la sesión de un token (cookie o token de perfil). */
async function buscarSesion(token, { recordar = false } = {}) {
  if (!token || typeof token !== "string" || token.length > 128) return null;
  return una(
    `SELECT s.id AS sesion_id, u.id AS usuario_id, u.nombre, u.correo, h.id AS hogar_id, h.nombre AS hogar, hm.rol
       FROM sesiones_autenticacion s
       JOIN usuarios u        ON u.id = s.usuario_id AND u.activo
       JOIN hogar_miembros hm ON hm.hogar_id = s.hogar_id AND hm.usuario_id = s.usuario_id AND hm.activo
       JOIN hogares h         ON h.id = s.hogar_id
      WHERE s.token_hash = ? AND s.revocado_en IS NULL AND s.expira_en > NOW() AND s.recordar = ?`,
    [hash(token), recordar]
  );
}

/** Middleware: exige sesión. Deja los datos en req.usuario. */
async function requiereSesion(req, res, next) {
  try {
    const s = await buscarSesion(req.cookies[COOKIE]);
    if (!s) return res.status(401).json({ error: "Tu sesión terminó. Vuelve a entrar." });
    req.usuario = { id: s.usuario_id, nombre: s.nombre, correo: s.correo, hogarId: s.hogar_id, hogar: s.hogar, rol: s.rol, sesionId: s.sesion_id };
    next();
  } catch (e) {
    next(e);
  }
}

/** Middleware: solo administradores del hogar. */
function soloAdministrador(req, res, next) {
  if (req.usuario.rol !== "administrador") return res.status(403).json({ error: "Solo el administrador del hogar puede hacer esto." });
  next();
}

async function revocar(token) {
  if (token) await consulta("UPDATE sesiones_autenticacion SET revocado_en = NOW() WHERE token_hash = ? AND revocado_en IS NULL", [hash(token)]);
}

/** Lo que la app necesita saber de la sesión */
const sesionPublica = (u) => ({ nombre: u.nombre, email: u.correo, rol: ROL_TEXTO[u.rol] || u.rol, hogar: u.hogar });

module.exports = { COOKIE, hash, crearSesion, ponerCookie, buscarSesion, requiereSesion, soloAdministrador, revocar, sesionPublica, ROL_TEXTO };
