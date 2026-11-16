// ============================================================
//  Leer cantidades escritas a mano ("2 piezas", "1.5 kg", "500 g")
//  Se usa al pasar a la alacena lo anotado en la lista del súper.
// ============================================================

// Palabras que la gente escribe → código de unidad de la base (unidades_medida)
const UNIDAD_TEXTO = [
  [/^(kg|kilos?|kilogramos?)$/i, "kg"],
  [/^(g|gr|grs|gramos?)$/i, "g"],
  [/^(l|lt|lts|litros?)$/i, "L"],
  [/^(ml|mililitros?)$/i, "ml"],
  [/^(pz|pza|pzas|piezas?|unidad(es)?|paquetes?|latas?|botellas?|bolsas?|cajas?)$/i, "pz"],
  [/^(manojos?)$/i, "manojo"],
];

/**
 * "2 piezas" → { cantidad: 2, unidad: "pz" } · "1,5 kg" → { cantidad: 1.5, unidad: "kg" }
 * "al gusto" → { cantidad: null, unidad: null } · "3 tazas" → { cantidad: 3, unidad: null }
 * Solo números positivos; la unidad es null si no se reconoce.
 */
function leerCantidad(texto) {
  const m = String(texto || "").trim().match(/^(\d+(?:[.,]\d+)?)\s*([a-záéíóú]+)?/i);
  if (!m) return { cantidad: null, unidad: null };
  const cantidad = Number(m[1].replace(",", "."));
  const unidad = m[2] ? (UNIDAD_TEXTO.find(([re]) => re.test(m[2])) || [])[1] || null : null;
  return { cantidad: cantidad > 0 ? cantidad : null, unidad };
}

module.exports = { leerCantidad };
