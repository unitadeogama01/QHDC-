// ============================================================
//  Identificación de alimentos en una foto (Claude, desde el backend)
//
//  La clave ANTHROPIC_API_KEY vive solo en el servidor (.env): el
//  navegador nunca la ve. La IA PROPONE qué alimentos hay, con su nivel
//  de confianza y su recuadro; la persona confirma o corrige antes de
//  que algo entre al inventario. La IA no estima peso ni caducidad.
//
//  Sin clave (o con IA_MODELO=simulado) se usa un modo de demostración
//  que elige alimentos del catálogo al azar y lo marca como simulado.
// ============================================================
const { pedirJson, disponible } = require("../../nucleo/ia");

function esquema(categorias) {
  return {
    type: "object",
    properties: {
      alimentos: {
        type: "array",
        description: "Alimentos visibles en la foto, uno por tipo de alimento",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string", description: "Nombre común en español de México, sin marca. Ej.: Leche, Manzana, Arroz" },
            categoria: { type: "string", enum: categorias },
            confianza: { type: "number", description: "Qué tan seguro estás, de 0 a 1" },
            piezas_visibles: { type: "integer", description: "Piezas que se pueden contar con claridad; 0 si no se pueden contar (granos, líquidos, envases opacos)" },
            caja: {
              type: "object",
              description: "Recuadro que rodea el alimento, en porcentaje de la imagen (0 a 100)",
              properties: { x: { type: "number" }, y: { type: "number" }, ancho: { type: "number" }, alto: { type: "number" } },
              required: ["x", "y", "ancho", "alto"],
              additionalProperties: false,
            },
          },
          required: ["nombre", "categoria", "confianza", "piezas_visibles", "caja"],
          additionalProperties: false,
        },
      },
      observaciones: { type: "string", description: "Comentario breve si la foto está borrosa, oscura o no tiene alimentos; vacío si todo está bien" },
    },
    required: ["alimentos", "observaciones"],
    additionalProperties: false,
  };
}

const SISTEMA = `Eres el módulo de visión de una despensa inteligente de un hogar en México.
Recibes una foto tomada con un celular (refrigerador, alacena, bolsas del súper o alimentos sobre una mesa) y devuelves los alimentos que ves.

Reglas:
- Solo alimentos y bebidas. Ignora trastes, muebles, personas y objetos que no se comen.
- Usa nombres comunes en español de México, en singular y sin marca ("Leche", no "Leche Lala 1 L"). Si el nombre coincide con uno de la lista de nombres conocidos, escríbelo exactamente igual.
- Un elemento por tipo de alimento: si hay 6 manzanas, es un solo elemento "Manzana" con piezas_visibles = 6.
- piezas_visibles solo cuando se pueden contar con claridad; si no (granos, líquidos, envases opacos o amontonados), pon 0.
- No estimes peso, volumen ni fecha de caducidad: la persona los completa.
- confianza debe reflejar tu seguridad real: baja (menos de 0.6) si el alimento está tapado, borroso, lejos o se confunde con otro.
- La caja encierra el alimento (o el grupo de piezas) en porcentajes de la imagen: x, y = esquina superior izquierda.
- Si no hay alimentos o la foto no sirve, devuelve una lista vacía y explícalo en observaciones.`;

/**
 * Pide a Claude identificar los alimentos de una foto JPEG.
 * @returns {{ modelo, simulado, alimentos: [{nombre, categoria, confianza, piezas_visibles, caja}], observaciones, respuesta }}
 */
async function identificarAlimentos(jpeg, { categorias, nombresConocidos }) {
  if (!disponible()) return simular({ categorias, nombresConocidos });

  const { datos, modelo, uso } = await pedirJson({
    sistema: SISTEMA,
    esquema: esquema(categorias),
    esfuerzo: "medium",
    contenido: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
      { type: "text", text: `Nombres conocidos (úsalos si coinciden): ${nombresConocidos.join(", ")}.\n\nIdentifica los alimentos de esta foto.` },
    ],
  });
  return {
    modelo,
    simulado: false,
    alimentos: Array.isArray(datos.alimentos) ? datos.alimentos.slice(0, 20) : [],
    observaciones: String(datos.observaciones || "").slice(0, 500),
    respuesta: { ...datos, uso },
  };
}

// ---------- Modo de demostración (sin clave) ----------
function simular({ categorias, nombresConocidos }) {
  const azar = [...nombresConocidos].sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 2));
  return {
    modelo: "simulado",
    simulado: true,
    alimentos: azar.map((nombre, i) => ({
      nombre,
      categoria: categorias[0],
      confianza: Math.round((0.5 + Math.random() * 0.49) * 100) / 100,
      piezas_visibles: 0,
      caja: { x: (i % 2) * 50 + 6 + Math.random() * 8, y: Math.floor(i / 2) * 50 + 10 + Math.random() * 6, ancho: 32, alto: 30 },
    })),
    observaciones: "Modo de demostración: configura ANTHROPIC_API_KEY para reconocer la foto de verdad.",
    respuesta: null,
  };
}

module.exports = { identificarAlimentos, disponible };
