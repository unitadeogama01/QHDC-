// ============================================================
//  Errores y validaciones compartidas
// ============================================================

/** Error con código HTTP y mensaje para mostrar en la app. */
class ErrorApp extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

/** Envuelve rutas async para que los errores lleguen al manejador central. */
const async_ = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const texto = (v, campo, { min = 1, max = 120 } = {}) => {
  const t = String(v ?? "").trim();
  if (t.length < min) throw new ErrorApp(400, `Falta ${campo}.`);
  if (t.length > max) throw new ErrorApp(400, `${campo} es demasiado largo.`);
  return t;
};

const numero = (v, campo, { min = 0, max = 1e9, opcional = false } = {}) => {
  if ((v === undefined || v === null || v === "") && opcional) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ErrorApp(400, `${campo} no es válido.`);
  return Math.round(n * 1000) / 1000;
};

const fecha = (v, campo, { opcional = false } = {}) => {
  if (!v && opcional) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) || Number.isNaN(Date.parse(v))) throw new ErrorApp(400, `${campo} no es una fecha válida.`);
  return String(v);
};

const id = (v, campo = "El identificador") => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorApp(400, `${campo} no es válido.`);
  return n;
};

const COLORES = ["tomate", "oliva", "mostaza", "cafe", "petroleo"];
const color = (v) => (COLORES.includes(v) ? v : "cafe");
const icono = (v) => (/^fa-[a-z0-9-]{2,36}$/.test(String(v || "")) ? v : "fa-box-open");

module.exports = { ErrorApp, async_, texto, numero, fecha, id, color, icono };
