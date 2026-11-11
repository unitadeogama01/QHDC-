// ============================================================
//  Generar una receta con Claude (borrador para revisar)
//
//  Entrada: los ingredientes que la persona eligió de su alacena, una
//  foto opcional de ingredientes e indicaciones libres ("algo rápido",
//  "sin horno"…). Claude propone UNA receta; el servidor calcula de
//  forma exacta qué ingredientes hay en la alacena y cuáles faltan.
//  Nada se guarda aquí: la persona revisa el borrador y decide.
// ============================================================
const { pedirJson } = require("../../nucleo/ia");
const asistente = require("../asistente/asistente");
const { palabras, esBasico } = require("../inventario/nombres");

const DIFICULTADES = ["muy_facil", "facil", "media", "dificil"];
const ICONOS = ["fa-utensils", "fa-bowl-food", "fa-bowl-rice", "fa-egg", "fa-drumstick-bite", "fa-fish", "fa-carrot",
  "fa-leaf", "fa-pizza-slice", "fa-burger", "fa-cheese", "fa-bread-slice", "fa-mug-hot", "fa-blender", "fa-ice-cream", "fa-cookie", "fa-pepper-hot"];

const ESQUEMA = {
  type: "object",
  properties: {
    nombre: { type: "string" },
    descripcion: { type: "string", description: "Una frase que antoje el platillo" },
    tiempo_minutos: { type: "integer" },
    porciones: { type: "integer" },
    dificultad: { type: "string", enum: DIFICULTADES },
    icono: { type: "string", enum: ICONOS },
    ingredientes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Si está en la ALACENA, escríbelo exactamente igual" },
          cantidad: { type: "string", description: "Ej. 2 piezas, 1 taza, 200 g, al gusto" },
        },
        required: ["nombre", "cantidad"],
        additionalProperties: false,
      },
    },
    pasos: { type: "array", items: { type: "string" } },
    ingredientes_en_foto: { type: "array", items: { type: "string" }, description: "Ingredientes que viste en la foto (vacío si no hay foto)" },
  },
  required: ["nombre", "descripcion", "tiempo_minutos", "porciones", "dificultad", "icono", "ingredientes", "pasos", "ingredientes_en_foto"],
  additionalProperties: false,
};

const SISTEMA = `Eres el chef de una despensa inteligente de un hogar en México. Creas UNA receta casera, clara y realista, en español de México.

Reglas:
- Usa como base los INGREDIENTES ELEGIDOS por la persona y, si hay foto, los ingredientes que se vean en ella.
- Puedes completar con otros alimentos de la ALACENA. Sal, pimienta, agua y aceite se pueden usar aunque no estén registrados.
- Evita ingredientes que no estén en la alacena ni en la foto; si alguno es indispensable, inclúyelo (el sistema lo marcará como faltante), pero que sean pocos.
- No uses alimentos que en la ALACENA aparecen como CADUCADOS.
- Prefiere los que caducan pronto, para aprovecharlos.
- Ingredientes con cantidades concretas. Pasos cortos (uno por acción, máximo 10), en orden; si un paso tiene un tiempo, escribe los minutos ("Hierve 10 minutos").
- Respeta las indicaciones de la persona (tiempo, porciones, sin horno, etc.).
- Si la foto no muestra alimentos, ignórala y usa la alacena.`;

/**
 * @param usuario  req.usuario
 * @param opciones { elegidos: [ids de alimentos], indicaciones, porciones, foto: Buffer JPEG | null }
 * @returns borrador de receta con disponibilidad exacta de cada ingrediente
 */
async function generar(usuario, { elegidos = [], indicaciones = "", porciones = null, foto = null }) {
  const c = await asistente.contexto(usuario);
  const elegidosNombres = c.alacena.filter((p) => elegidos.includes(p.id)).map((p) => p.nombre);
  const alacena = c.alacena.map((p) => {
    const cad = p.e.caducidad === "caducado" ? "CADUCADO" : p.e.dias <= 3 ? `caduca en ${p.e.dias} d` : "ok";
    return `- ${p.nombre}: ${+p.cantidad.toFixed(3)} ${p.unidad} (${cad})`;
  }).join("\n") || "(vacía)";

  const texto = [
    `ALACENA:\n${alacena}`,
    `INGREDIENTES ELEGIDOS: ${elegidosNombres.join(", ") || "ninguno (usa la foto o la alacena)"}`,
    porciones ? `PORCIONES: ${porciones}` : "",
    indicaciones ? `INDICACIONES DE LA PERSONA: ${String(indicaciones).slice(0, 500)}` : "",
    foto ? "Hay una FOTO de ingredientes adjunta." : "",
    "Crea la receta.",
  ].filter(Boolean).join("\n\n");

  const contenido = foto
    ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: foto.toString("base64") } }, { type: "text", text: texto }]
    : [{ type: "text", text: texto }];
  const { datos } = await pedirJson({ sistema: SISTEMA, esquema: ESQUEMA, esfuerzo: "medium", contenido });
  return armarBorrador(datos, c.alacena, porciones);
}

/**
 * Revisa lo que propuso la IA con reglas exactas (no confía en el modelo):
 * límites de tamaño, valores permitidos, ingredientes repetidos y qué hay
 * de verdad en la alacena. Función pura: se prueba sin llamar a Claude.
 * @param datos    JSON que devolvió el modelo
 * @param alacena  alimentos del hogar con su estado (p.e.disponible)
 */
function armarBorrador(datos, alacena, porciones = null) {
  datos = datos && typeof datos === "object" ? datos : {};
  const ingredientes = (Array.isArray(datos.ingredientes) ? datos.ingredientes : []).slice(0, 20).map((i) => {
    const nombre = String((i && i.nombre) || "").trim().slice(0, 100);
    const p = asistente.buscarAlimento(alacena, nombre);
    const basico = !p && esBasico(nombre);
    return {
      nombre,
      cantidad: String((i && i.cantidad) || "al gusto").trim().slice(0, 60),
      alimentoId: p ? p.id : null,
      disponible: Boolean(p && p.e.disponible) || basico,
      basico,
    };
  }).filter((i) => i.nombre);
  // Nombres repetidos no se permiten en la base
  const vistos = new Set();
  const unicos = ingredientes.filter((i) => { const k = palabras(i.nombre).join(" "); if (vistos.has(k)) return false; vistos.add(k); return true; });

  return {
    nombre: String(datos.nombre || "Receta de la casa").trim().slice(0, 150),
    descripcion: String(datos.descripcion || "").trim().slice(0, 500),
    tiempo: Math.max(1, Math.min(600, Number(datos.tiempo_minutos) || 30)),
    porciones: Math.max(1, Math.min(20, Number(porciones || datos.porciones) || 2)),
    dificultad: DIFICULTADES.includes(datos.dificultad) ? datos.dificultad : "facil",
    icono: ICONOS.includes(datos.icono) ? datos.icono : "fa-utensils",
    ingredientes: unicos,
    faltan: unicos.filter((i) => !i.disponible).length,
    pasos: (Array.isArray(datos.pasos) ? datos.pasos : []).slice(0, 15).map((p) => String(p).trim().slice(0, 500)).filter(Boolean),
    enFoto: (Array.isArray(datos.ingredientes_en_foto) ? datos.ingredientes_en_foto : []).slice(0, 20).map((x) => String(x).slice(0, 60)),
  };
}

module.exports = { generar, armarBorrador, DIFICULTADES, ICONOS };
