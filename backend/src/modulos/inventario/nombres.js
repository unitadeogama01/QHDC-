// ============================================================
//  Comparar nombres de alimentos (misma regla que frontend/js/datos.js)
//  Por palabras, sin acentos, mayúsculas ni plurales:
//    "Huevos" ↔ "Huevo", "Queso" ↔ "Queso Oaxaca", "Limones" ↔ "Limón"
//  pero "Sal" no coincide con "Salsa" ni "Papa" con "Papaya".
// ============================================================
const normalizar = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "en", "con", "y", "al", "a"]);
/** Palabras importantes, en singular: "Huevos de rancho" → ["huevo", "rancho"] */
const palabras = (t) => normalizar(t).split(/[^a-z0-9]+/).filter((w) => w && !VACIAS.has(w)).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w));
const mismaPalabra = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && Math.abs(a.length - b.length) === 1 && (a.startsWith(b) || b.startsWith(a)));

/** Uno está contenido en el otro, palabra por palabra ("Queso" ↔ "Queso Oaxaca") */
function coincideNombre(a, b) {
  const A = palabras(a), B = palabras(b);
  if (!A.length || !B.length) return false;
  const [corta, larga] = A.length <= B.length ? [A, B] : [B, A];
  return corta.every((w) => larga.some((v) => mismaPalabra(w, v)));
}

/** Mismo alimento salvo acentos, mayúsculas y plural ("huevos" = "Huevo"; "Leche" ≠ "Leche de coco") */
const mismoNombre = (a, b) => { const A = palabras(a), B = palabras(b); return A.length > 0 && A.length === B.length && A.every((w, i) => mismaPalabra(w, B[i])); };

// Lo que casi toda cocina tiene y no se registra en la alacena
const BASICOS = ["sal", "pimienta", "agua", "aceite", "azucar"];
/** "Sal", "Aceite", "Sal y pimienta"… se dan por hechos si no están registrados */
const esBasico = (nombre) => { const p = palabras(nombre); return p.length > 0 && p.every((w) => BASICOS.includes(w)); };

module.exports = { normalizar, palabras, coincideNombre, mismoNombre, esBasico, BASICOS };
