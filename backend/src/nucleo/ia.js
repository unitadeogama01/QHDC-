// ============================================================
//  Conexión con Claude (núcleo compartido: la usan escaneos, asistente y recetas)
//
//  La clave ANTHROPIC_API_KEY vive solo en el servidor (.env).
//  Todas las llamadas piden una respuesta JSON con esquema fijo
//  (salida estructurada) y usan fallbacks "default": si el modelo
//  declina, la API reintenta con el modelo recomendado.
// ============================================================
const { config } = require("./config");
const { ErrorApp } = require("./errores");

let cliente = null;
function sdk() {
  const Anthropic = require("@anthropic-ai/sdk");
  return Anthropic.default || Anthropic;
}
function claude() {
  if (!cliente) {
    const Clase = sdk();
    cliente = new Clase({ apiKey: config.ia.clave, timeout: 90_000, maxRetries: 2 });
  }
  return cliente;
}

const disponible = () => Boolean(config.ia.clave) && config.ia.modelo !== "simulado";

/** Traduce los errores del SDK a mensajes para la app. */
function errorDeApi(e) {
  const A = sdk();
  if (e instanceof A.AuthenticationError) return new ErrorApp(503, "La clave de la IA (ANTHROPIC_API_KEY) no es válida.");
  if (e instanceof A.PermissionDeniedError) return new ErrorApp(503, "La clave de la IA no tiene permiso para usar este modelo.");
  if (e instanceof A.RateLimitError) return new ErrorApp(429, "La IA está ocupada. Espera unos segundos y vuelve a intentar.");
  if (e instanceof A.BadRequestError) return new ErrorApp(502, `La IA rechazó la solicitud: ${e.message}`);
  if (e instanceof A.APIConnectionError) return new ErrorApp(503, "No hay conexión con el servicio de IA. Revisa el internet del servidor.");
  if (e instanceof A.APIError) return new ErrorApp(502, `Error del servicio de IA (${e.status || "?"}). Intenta de nuevo.`);
  return e;
}

/**
 * Llama a Claude y devuelve el JSON que cumple `esquema`.
 * @returns {{ datos, modelo, uso }}
 */
async function pedirJson({ sistema, contenido, esquema, esfuerzo = "medium", maxTokens = 16000 }) {
  if (!disponible()) throw new ErrorApp(503, "La IA no está configurada en el servidor (ANTHROPIC_API_KEY).");
  let r;
  try {
    r = await claude().beta.messages.create({
      model: config.ia.modelo,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: sistema,
      output_config: { effort: esfuerzo, format: { type: "json_schema", schema: esquema } },
      messages: [{ role: "user", content: contenido }],
    });
  } catch (e) {
    throw errorDeApi(e);
  }
  if (r.stop_reason === "refusal") throw new ErrorApp(422, "La IA no pudo responder a esto. Intenta con otras palabras.");
  if (r.stop_reason === "max_tokens") throw new ErrorApp(502, "La respuesta de la IA quedó incompleta. Intenta de nuevo.");
  const texto = r.content.find((b) => b.type === "text");
  try {
    return {
      datos: JSON.parse(texto ? texto.text : ""),
      modelo: r.model || config.ia.modelo,
      uso: r.usage ? { entrada: r.usage.input_tokens, salida: r.usage.output_tokens } : null,
    };
  } catch (e) {
    throw new ErrorApp(502, "La IA respondió en un formato inesperado. Intenta de nuevo.");
  }
}

module.exports = { pedirJson, disponible, errorDeApi };
