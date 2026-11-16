// ============================================================
//  /api/ajustes — Pantalla Ajustes (con sesión)
//
//    GET    /api/ajustes                       Todo lo de la pantalla
//    PUT    /api/ajustes/perfil                 Nombre y correo
//    PUT    /api/ajustes/contrasena             Cambiar contraseña (cierra las demás sesiones)
//    PUT    /api/ajustes/hogar                  Nombre, personas, días de aviso   (administrador)
//    POST   /api/ajustes/invitaciones           Invitar (devuelve el enlace)       (administrador)
//    DELETE /api/ajustes/invitaciones/:id       Cancelar invitación               (administrador)
//    PUT    /api/ajustes/miembros/:usuarioId    Cambiar rol                        (administrador)
//    DELETE /api/ajustes/miembros/:usuarioId    Quitar del hogar                   (administrador)
//    POST   /api/ajustes/lugares                Nuevo lugar                        (administrador)
//    PUT    /api/ajustes/lugares/:id            Nombre y límites de temp./humedad  (administrador)
//    DELETE /api/ajustes/lugares/:id            Borrar lugar sin uso               (administrador)
//    POST   /api/ajustes/categorias             Nueva categoría del hogar          (administrador)
//    PUT    /api/ajustes/categorias/:id         Renombrar (solo las del hogar)     (administrador)
//    DELETE /api/ajustes/categorias/:id         Borrar (sus alimentos pasan a "Otros") (administrador)
// ============================================================
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { consulta, una, transaccion } = require("../../nucleo/db");
const { ErrorApp, async_, texto, numero, id, icono } = require("../../nucleo/errores");
const { soloAdministrador, hash } = require("../auth/sesiones");

const router = express.Router();

const ROLES = ["administrador", "miembro"];
const PERSONAS = ["1-2", "3-4", "5+"];
const TIPOS_LUGAR = ["refrigerador", "congelador", "despensa", "otro"];
const DIAS_INVITACION = 7;

const correoValido = (v) => {
  const c = String(v || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(c) || c.length > 255) throw new ErrorApp(400, "Ese correo no parece válido.");
  return c;
};
const contrasenaValida = (v) => {
  const p = String(v || "");
  if (p.length < 8) throw new ErrorApp(400, "La contraseña nueva debe tener al menos 8 caracteres.");
  if (p.length > 200) throw new ErrorApp(400, "La contraseña es demasiado larga.");
  return p;
};
const limite = (v, campo, min, max) => (v === null || v === undefined || v === "" ? null : numero(v, campo, { min, max }));

// ---------- Todo lo de la pantalla ----------
router.get("/", async_(async (req, res) => {
  const u = req.usuario;
  const [perfil, hogar, miembros, invitaciones, lugares, categorias] = await Promise.all([
    una("SELECT nombre, correo, google_sub IS NOT NULL AS google FROM usuarios WHERE id = ?", [u.id]),
    una("SELECT nombre, personas, dias_aviso_predeterminado AS diasAviso FROM hogares WHERE id = ?", [u.hogarId]),
    consulta(
      `SELECT u.id, u.nombre, u.correo, hm.rol, hm.unido_en FROM hogar_miembros hm JOIN usuarios u ON u.id = hm.usuario_id
        WHERE hm.hogar_id = ? AND hm.activo AND u.activo ORDER BY hm.rol = 'administrador' DESC, u.nombre`, [u.hogarId]),
    consulta(
      `SELECT id, correo, rol, expira_en FROM invitaciones_hogar
        WHERE hogar_id = ? AND aceptada_en IS NULL AND expira_en > NOW() ORDER BY id DESC`, [u.hogarId]),
    consulta(
      `SELECT v.ubicacion_id AS id, v.ubicacion AS nombre, v.ubicacion_tipo AS tipo, v.personalizado, v.activo,
              v.temp_min_c, v.temp_max_c, v.humedad_min, v.humedad_max,
              (SELECT COUNT(*) FROM alimentos a WHERE a.hogar_id = v.hogar_id AND a.ubicacion_id = v.ubicacion_id AND a.activo) AS alimentos,
              (SELECT COUNT(*) FROM dispositivos_iot d WHERE d.hogar_id = v.hogar_id AND d.ubicacion_id = v.ubicacion_id AND d.estado <> 'baja') AS dispositivos
         FROM vista_umbrales_ambiente v JOIN ubicaciones_almacenamiento u ON u.id = v.ubicacion_id
        WHERE v.hogar_id = ? ORDER BY u.orden, u.id`, [u.hogarId]),
    consulta(
      `SELECT c.id, c.nombre, c.icono, c.hogar_id IS NOT NULL AS propia,
              (SELECT COUNT(*) FROM alimentos a WHERE a.hogar_id = ? AND a.categoria_id = c.id AND a.activo) AS alimentos
         FROM categorias_alimento c WHERE c.hogar_id IS NULL OR c.hogar_id = ? ORDER BY c.hogar_id IS NOT NULL, c.id`, [u.hogarId, u.hogarId]),
  ]);
  const n = (v) => (v === null ? null : Number(v));
  res.json({
    esAdministrador: u.rol === "administrador",
    perfil: { nombre: perfil.nombre, correo: perfil.correo, google: Boolean(perfil.google) },
    hogar,
    miembros: miembros.map((m) => ({ id: m.id, nombre: m.nombre, correo: m.correo, rol: m.rol, yo: m.id === u.id })),
    invitaciones,
    lugares: lugares.map((l) => ({
      id: l.id, nombre: l.nombre, tipo: l.tipo, personalizado: Boolean(l.personalizado), alertas: Boolean(l.activo),
      tempMin: n(l.temp_min_c), tempMax: n(l.temp_max_c), humMin: n(l.humedad_min), humMax: n(l.humedad_max),
      alimentos: Number(l.alimentos), dispositivos: Number(l.dispositivos),
    })),
    categorias: categorias.map((c) => ({ id: c.id, nombre: c.nombre, icono: c.icono, propia: Boolean(c.propia), alimentos: Number(c.alimentos) })),
  });
}));

// ---------- Perfil ----------
router.put("/perfil", async_(async (req, res) => {
  const u = req.usuario;
  const nombre = texto(req.body.nombre, "Tu nombre", { min: 2, max: 100 });
  const correo = correoValido(req.body.correo);
  const otro = await una("SELECT id FROM usuarios WHERE correo = ? AND id <> ?", [correo, u.id]);
  if (otro) throw new ErrorApp(409, "Ese correo ya lo usa otra cuenta.");
  await consulta("UPDATE usuarios SET nombre = ?, correo = ? WHERE id = ?", [nombre, correo, u.id]);
  res.json({ ok: true, nombre, correo });
}));

router.put("/contrasena", async_(async (req, res) => {
  const u = req.usuario;
  const cuenta = await una("SELECT contrasena_hash, google_sub FROM usuarios WHERE id = ?", [u.id]);
  const actual = String(req.body.actual || "");
  // Quien creó su cuenta con Google no conoce la contraseña interna: puede poner una nueva sin ella
  if (!(cuenta.google_sub && !actual) && !(await bcrypt.compare(actual, cuenta.contrasena_hash))) {
    throw new ErrorApp(400, "La contraseña actual no es correcta.");
  }
  const nueva = contrasenaValida(req.body.nueva);
  if (actual && actual === nueva) throw new ErrorApp(400, "La contraseña nueva debe ser distinta de la actual.");
  await transaccion(async (c) => {
    await c.query("UPDATE usuarios SET contrasena_hash = ? WHERE id = ?", [await bcrypt.hash(nueva, 12), u.id]);
    // Por seguridad se cierran las demás sesiones y perfiles guardados (esta sigue abierta)
    await c.query("UPDATE sesiones_autenticacion SET revocado_en = NOW() WHERE usuario_id = ? AND id <> ? AND revocado_en IS NULL", [u.id, u.sesionId]);
  });
  res.json({ ok: true });
}));

// ---------- Hogar ----------
router.put("/hogar", soloAdministrador, async_(async (req, res) => {
  const nombre = texto(req.body.nombre, "El nombre del hogar", { max: 100 });
  const personas = PERSONAS.includes(req.body.personas) ? req.body.personas : "3-4";
  const diasAviso = numero(req.body.diasAviso ?? 3, "Los días de aviso", { min: 0, max: 30 });
  await consulta("UPDATE hogares SET nombre = ?, personas = ?, dias_aviso_predeterminado = ? WHERE id = ?",
    [nombre, personas, Math.round(diasAviso), req.usuario.hogarId]);
  res.json({ ok: true });
}));

// ---------- Invitaciones ----------
// No se envían correos: la app da un enlace para compartir (WhatsApp, etc.).
// El token solo se conoce aquí; en la base se guarda su hash.
router.post("/invitaciones", soloAdministrador, async_(async (req, res) => {
  const u = req.usuario;
  const correo = correoValido(req.body.correo);
  const rol = ROLES.includes(req.body.rol) ? req.body.rol : "miembro";
  const ya = await una(
    `SELECT 1 FROM hogar_miembros hm JOIN usuarios us ON us.id = hm.usuario_id
      WHERE hm.hogar_id = ? AND hm.activo AND us.correo = ?`, [u.hogarId, correo]);
  if (ya) throw new ErrorApp(409, "Esa persona ya es parte de tu hogar.");
  const token = crypto.randomBytes(24).toString("base64url");
  await transaccion(async (c) => {
    // Una invitación vigente por correo: la anterior se reemplaza
    await c.query("DELETE FROM invitaciones_hogar WHERE hogar_id = ? AND correo = ? AND aceptada_en IS NULL", [u.hogarId, correo]);
    await c.query(
      "INSERT INTO invitaciones_hogar (hogar_id, correo, rol, token_hash, invitado_por, expira_en) VALUES (?, ?, ?, ?, ?, NOW() + INTERVAL ? DAY)",
      [u.hogarId, correo, rol, hash(token), u.id, DIAS_INVITACION]
    );
  });
  const origen = `${req.protocol}://${req.get("host")}`;
  res.status(201).json({ enlace: `${origen}/registro.html?invitacion=${encodeURIComponent(token)}`, dias: DIAS_INVITACION });
}));

router.delete("/invitaciones/:id", soloAdministrador, async_(async (req, res) => {
  await consulta("DELETE FROM invitaciones_hogar WHERE hogar_id = ? AND id = ? AND aceptada_en IS NULL", [req.usuario.hogarId, id(req.params.id)]);
  res.json({ ok: true });
}));

// ---------- Miembros ----------
async function administradores(c, hogarId) {
  const [[r]] = await c.query("SELECT COUNT(*) AS n FROM hogar_miembros WHERE hogar_id = ? AND rol = 'administrador' AND activo", [hogarId]);
  return Number(r.n);
}

router.put("/miembros/:usuarioId", soloAdministrador, async_(async (req, res) => {
  const u = req.usuario;
  const usuarioId = id(req.params.usuarioId, "La persona");
  const rol = ROLES.includes(req.body.rol) ? req.body.rol : null;
  if (!rol) throw new ErrorApp(400, "Rol no válido.");
  await transaccion(async (c) => {
    const [[m]] = await c.query("SELECT rol FROM hogar_miembros WHERE hogar_id = ? AND usuario_id = ? AND activo FOR UPDATE", [u.hogarId, usuarioId]);
    if (!m) throw new ErrorApp(404, "Esa persona no está en tu hogar.");
    if (m.rol === "administrador" && rol === "miembro" && (await administradores(c, u.hogarId)) <= 1) {
      throw new ErrorApp(409, "El hogar necesita al menos un administrador.");
    }
    await c.query("UPDATE hogar_miembros SET rol = ? WHERE hogar_id = ? AND usuario_id = ?", [rol, u.hogarId, usuarioId]);
  });
  res.json({ ok: true });
}));

router.delete("/miembros/:usuarioId", soloAdministrador, async_(async (req, res) => {
  const u = req.usuario;
  const usuarioId = id(req.params.usuarioId, "La persona");
  await transaccion(async (c) => {
    const [[m]] = await c.query("SELECT rol FROM hogar_miembros WHERE hogar_id = ? AND usuario_id = ? AND activo FOR UPDATE", [u.hogarId, usuarioId]);
    if (!m) throw new ErrorApp(404, "Esa persona no está en tu hogar.");
    if (m.rol === "administrador" && (await administradores(c, u.hogarId)) <= 1) {
      throw new ErrorApp(409, "No puedes quitar al único administrador.");
    }
    await c.query("UPDATE hogar_miembros SET activo = FALSE WHERE hogar_id = ? AND usuario_id = ?", [u.hogarId, usuarioId]);
    // Pierde el acceso de inmediato
    await c.query("UPDATE sesiones_autenticacion SET revocado_en = NOW() WHERE hogar_id = ? AND usuario_id = ? AND revocado_en IS NULL", [u.hogarId, usuarioId]);
  });
  res.json({ ok: true, yo: usuarioId === u.id });
}));

// ---------- Lugares (y sus límites de temperatura y humedad) ----------
router.post("/lugares", soloAdministrador, async_(async (req, res) => {
  const u = req.usuario;
  const nombre = texto(req.body.nombre, "El nombre del lugar", { max: 80 });
  const tipo = TIPOS_LUGAR.includes(req.body.tipo) ? req.body.tipo : "otro";
  const r = await consulta(
    `INSERT INTO ubicaciones_almacenamiento (hogar_id, nombre, tipo, orden)
     SELECT ?, ?, ?, COALESCE(MAX(orden), 0) + 1 FROM ubicaciones_almacenamiento WHERE hogar_id = ?`,
    [u.hogarId, nombre, tipo, u.hogarId]
  );
  res.status(201).json({ id: r.insertId });
}));

router.put("/lugares/:id", soloAdministrador, async_(async (req, res) => {
  const u = req.usuario;
  const lugarId = id(req.params.id, "El lugar");
  const lugar = await una("SELECT id FROM ubicaciones_almacenamiento WHERE hogar_id = ? AND id = ?", [u.hogarId, lugarId]);
  if (!lugar) throw new ErrorApp(404, "Ese lugar no existe.");
  const nombre = texto(req.body.nombre, "El nombre del lugar", { max: 80 });
  const tempMin = limite(req.body.tempMin, "La temperatura mínima", -40, 80);
  const tempMax = limite(req.body.tempMax, "La temperatura máxima", -40, 80);
  const humMin = limite(req.body.humMin, "La humedad mínima", 0, 100);
  const humMax = limite(req.body.humMax, "La humedad máxima", 0, 100);
  if (tempMin !== null && tempMax !== null && tempMin >= tempMax) throw new ErrorApp(400, "La temperatura mínima debe ser menor que la máxima.");
  if (humMin !== null && humMax !== null && humMin >= humMax) throw new ErrorApp(400, "La humedad mínima debe ser menor que la máxima.");
  await transaccion(async (c) => {
    await c.query("UPDATE ubicaciones_almacenamiento SET nombre = ? WHERE hogar_id = ? AND id = ?", [nombre, u.hogarId, lugarId]);
    await c.query(
      `INSERT INTO umbrales_ambiente (hogar_id, ubicacion_id, temp_min_c, temp_max_c, humedad_min, humedad_max, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE temp_min_c = VALUES(temp_min_c), temp_max_c = VALUES(temp_max_c),
                               humedad_min = VALUES(humedad_min), humedad_max = VALUES(humedad_max), activo = VALUES(activo)`,
      [u.hogarId, lugarId, tempMin, tempMax, humMin, humMax, req.body.alertas !== false]
    );
  });
  res.json({ ok: true });
}));

router.delete("/lugares/:id", soloAdministrador, async_(async (req, res) => {
  const u = req.usuario;
  const lugarId = id(req.params.id, "El lugar");
  const uso = await una(
    `SELECT (SELECT COUNT(*) FROM alimentos WHERE hogar_id = ? AND ubicacion_id = ?) AS alimentos,
            (SELECT COUNT(*) FROM dispositivos_iot WHERE hogar_id = ? AND ubicacion_id = ?) AS dispositivos`,
    [u.hogarId, lugarId, u.hogarId, lugarId]
  );
  if (Number(uso.alimentos) || Number(uso.dispositivos)) {
    throw new ErrorApp(409, "Ese lugar tiene alimentos o dispositivos (también los que eliminaste). Muévelos antes de borrarlo.");
  }
  await transaccion(async (c) => {
    await c.query("DELETE FROM umbrales_ambiente WHERE hogar_id = ? AND ubicacion_id = ?", [u.hogarId, lugarId]);
    await c.query("DELETE FROM ubicaciones_almacenamiento WHERE hogar_id = ? AND id = ?", [u.hogarId, lugarId]);
  });
  res.json({ ok: true });
}));

// ---------- Categorías del hogar ----------
async function nombreLibre(hogarId, nombre, excepto = 0) {
  const choca = await una(
    "SELECT id FROM categorias_alimento WHERE nombre = ? AND (hogar_id IS NULL OR hogar_id = ?) AND id <> ?",
    [nombre, hogarId, excepto]
  );
  if (choca) throw new ErrorApp(409, `Ya existe la categoría "${nombre}".`);
}

router.post("/categorias", soloAdministrador, async_(async (req, res) => {
  const u = req.usuario;
  const nombre = texto(req.body.nombre, "El nombre de la categoría", { max: 80 });
  await nombreLibre(u.hogarId, nombre);
  const r = await consulta("INSERT INTO categorias_alimento (hogar_id, nombre, icono) VALUES (?, ?, ?)",
    [u.hogarId, nombre, req.body.icono ? icono(req.body.icono) : "fa-tag"]);
  res.status(201).json({ id: r.insertId });
}));

router.put("/categorias/:id", soloAdministrador, async_(async (req, res) => {
  const u = req.usuario;
  const catId = id(req.params.id, "La categoría");
  const nombre = texto(req.body.nombre, "El nombre de la categoría", { max: 80 });
  await nombreLibre(u.hogarId, nombre, catId);
  const r = await consulta("UPDATE categorias_alimento SET nombre = ? WHERE id = ? AND hogar_id = ?", [nombre, catId, u.hogarId]);
  if (!r.affectedRows) throw new ErrorApp(403, "Las categorías generales no se pueden cambiar.");
  res.json({ ok: true });
}));

router.delete("/categorias/:id", soloAdministrador, async_(async (req, res) => {
  const u = req.usuario;
  const catId = id(req.params.id, "La categoría");
  await transaccion(async (c) => {
    const [[cat]] = await c.query("SELECT id FROM categorias_alimento WHERE id = ? AND hogar_id = ? FOR UPDATE", [catId, u.hogarId]);
    if (!cat) throw new ErrorApp(403, "Las categorías generales no se pueden borrar.");
    const [[otros]] = await c.query("SELECT id FROM categorias_alimento WHERE hogar_id IS NULL AND nombre = 'Otros'");
    await c.query("UPDATE alimentos SET categoria_id = ? WHERE hogar_id = ? AND categoria_id = ?", [otros ? otros.id : null, u.hogarId, catId]);
    await c.query("UPDATE identificaciones_ia SET categoria_sugerida_id = NULL WHERE hogar_id = ? AND categoria_sugerida_id = ?", [u.hogarId, catId]);
    await c.query("DELETE FROM categorias_alimento WHERE id = ? AND hogar_id = ?", [catId, u.hogarId]);
  });
  res.json({ ok: true });
}));

module.exports = router;
