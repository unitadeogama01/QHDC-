// ============================================================
//  Asistente "Chef QHDC" con Claude (HU-05, HU-06, HU-08)
//
//  Reparto de trabajo:
//   * El SERVIDOR calcula todo lo exacto desde MySQL: cantidades,
//     días para caducar, días que alcanza cada alimento, lista del
//     súper, recetas con sus ingredientes disponibles y faltantes.
//   * CLAUDE solo redacta la respuesta y elige qué recomendar a partir
//     de esos datos (no calcula existencias ni inventa alimentos).
//   * El SERVIDOR valida la respuesta: solo deja referencias a
//     alimentos y recetas que existen, y para una receta nueva marca
//     de forma exacta qué ingredientes hay y cuáles faltan.
// ============================================================
const { consulta } = require("../../nucleo/db");
const hogar = require("../hogar/estado");
const { pedirJson } = require("../../nucleo/ia");

const { normalizar, palabras, coincideNombre, esBasico } = require("../inventario/nombres");
const INTENCIONES = ["usar_primero", "comprar", "cocinar", "duracion", "frescura", "saludo", "otra"];

const hoy = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const diasHasta = (iso) => Math.round((new Date(iso + "T00:00:00") - hoy()) / 86400000);

/** Busca el alimento de la alacena que corresponde a un ingrediente ("Leche" ↔ "Leche deslactosada"). */
function buscarAlimento(productos, nombre) {
  const n = normalizar(nombre);
  if (!n) return null;
  const exacto = (p) => normalizar(p.nombre) === n;
  const hay = (p) => !p.e || p.e.disponible;
  const candidatos = productos.filter((p) => exacto(p) || coincideNombre(p.nombre, nombre));
  // Primero el que se llama igual y hay; luego cualquiera que haya
  return candidatos.find((p) => exacto(p) && hay(p)) || candidatos.find(hay) || candidatos.find(exacto) || candidatos[0] || null;
}

/** Estado exacto de un alimento (mismas reglas que la base y la app). */
function estadoAlimento(p) {
  const dias = diasHasta(p.caducidad);
  const pct = p.capacidad > 0 ? Math.min(100, Math.round((p.cantidad / p.capacidad) * 100)) : 0;
  const caducidad = dias < 0 ? "caducado" : dias <= 1 ? "urgente" : dias <= Math.max(3, p.aviso || 3) ? "pronto" : "ok";
  const alcanzaDias = p.consumoDiario > 0 ? Math.floor(p.cantidad / p.consumoDiario) : null;
  return { dias, pct, caducidad, alcanzaDias, disponible: p.cantidad > 0 && caducidad !== "caducado" };
}

/** Todo lo que el asistente sabe de la cocina, calculado en el servidor. */
async function contexto(usuario) {
  const h = usuario.hogarId;
  const [productos, recetas, sensores, lista, [frescura]] = await Promise.all([
    hogar.productos(h),
    hogar.recetas(h),
    hogar.sensores(h),
    consulta("SELECT nombre, motivo, prioridad FROM vista_lista_sugerida WHERE hogar_id = ? ORDER BY prioridad = 'alta' DESC, nombre", [h]),
    consulta("SELECT frescura, caducados, urgentes, pronto, bajos FROM vista_frescura_hogar WHERE hogar_id = ?", [h]),
  ]);
  const extras = await consulta(
    `SELECT it.nombre_libre AS nombre FROM lista_compras_items it
       JOIN listas_compras l ON l.hogar_id = it.hogar_id AND l.id = it.lista_id AND l.estado = 'activa'
      WHERE it.hogar_id = ? AND it.alimento_id IS NULL AND NOT it.comprado`, [h]);

  const alacena = productos.map((p) => ({ ...p, e: estadoAlimento(p) }));
  const recetasEval = recetas.map((r) => {
    const ingredientes = r.ingredientes.map((i) => {
      const p = buscarAlimento(alacena, i.nombre);
      return { nombre: i.nombre, cantidad: i.cantidad, tengo: Boolean(p && p.e.disponible) || (!p && esBasico(i.nombre)), porCaducar: Boolean(p && p.e.disponible && ["urgente", "pronto"].includes(p.e.caducidad)) };
    });
    return { id: r.id, nombre: r.nombre, tiempo: r.tiempo, porciones: r.porciones, ingredientes,
      faltan: ingredientes.filter((i) => !i.tengo).map((i) => i.nombre), aprovecha: ingredientes.filter((i) => i.porCaducar).map((i) => i.nombre) };
  }).sort((a, b) => (b.aprovecha.length * 3 - b.faltan.length * 2) - (a.aprovecha.length * 3 - a.faltan.length * 2));

  return { usuario, alacena, recetas: recetasEval, sensores, lista, extras, frescura: frescura || null };
}

/** Texto compacto con los datos exactos para Claude. */
function contextoTexto(c) {
  const fecha = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const lineas = [`Hoy es ${fecha}. Hogar de ${c.usuario.nombre.split(" ")[0]}.`, "", "ALACENA (nombre | cantidad | % de lleno | caducidad | te alcanza):"];
  for (const p of c.alacena) {
    const cad = p.e.caducidad === "caducado" ? `CADUCÓ hace ${-p.e.dias} d` : p.e.dias === 0 ? "caduca HOY" : `caduca en ${p.e.dias} d`;
    lineas.push(`- ${p.nombre} | ${+p.cantidad.toFixed(3)} ${p.unidad} | ${p.e.pct}% | ${cad} | ${p.e.alcanzaDias === null ? "sin datos de consumo" : `~${p.e.alcanzaDias} d (usa ${+p.consumoDiario.toFixed(3)} ${p.unidad}/día)`} | ${p.ubicacion || ""}`);
  }
  if (c.frescura) lineas.push("", `FRESCURA DE LA COCINA: ${c.frescura.frescura}/100 (caducados ${c.frescura.caducados}, urgentes ${c.frescura.urgentes}, pronto ${c.frescura.pronto}, por acabarse ${c.frescura.bajos}).`);
  lineas.push("", "LISTA DEL SÚPER (ya anotado): " + ([...c.lista.map((x) => `${x.nombre} (${x.motivo.replace("_", " ")})`), ...c.extras.map((x) => x.nombre)].join(", ") || "vacía"));
  lineas.push("", "RECETAS GUARDADAS (id | nombre | tiempo | faltan | aprovecha lo que caduca):");
  for (const r of c.recetas) lineas.push(`- ${r.id} | ${r.nombre} | ${r.tiempo} min | faltan: ${r.faltan.join(", ") || "nada"} | aprovecha: ${r.aprovecha.join(", ") || "—"}`);
  const amb = c.sensores.filter((s) => s.enLinea && (typeof s.temperatura === "number" || typeof s.humedad === "number"));
  if (amb.length) lineas.push("", "AMBIENTE (sensor): " + amb.map((s) => `${s.ubicacion}: ${s.temperatura ?? "—"} °C, ${s.humedad ?? "—"} % humedad`).join("; "));
  return lineas.join("\n");
}

const SISTEMA = `Eres "Chef QHDC", el asistente de una despensa inteligente de un hogar en México. Hablas en español de México, cálido y breve.

Recibes los DATOS EXACTOS de la cocina, calculados por el sistema. Reglas:
- Usa SOLO esos datos. Nunca digas que hay un alimento que no aparece en la ALACENA, ni inventes cantidades, fechas o días.
- Para cantidades, caducidades, "te alcanza para" y faltantes, repite los números de los datos; no los recalcules.
- Un alimento con "CADUCÓ" no se recomienda para cocinar: sugiere revisarlo y desecharlo si no está en buen estado.
- La temperatura y la humedad solo describen el ambiente; nunca afirmes que un alimento está echado a perder por ellas.
- Para "qué cocino", prefiere una RECETA GUARDADA (pon su id en receta_id). Si ninguna conviene, propón una receta nueva sencilla (proponer_receta_nueva = true) usando sobre todo alimentos de la ALACENA, en especial los que caducan pronto; sal, pimienta, agua y aceite se pueden usar aunque no estén registrados.
- En "alimentos" pon los nombres EXACTOS (como aparecen en la ALACENA) de los alimentos de los que hablas, máximo 6, en orden de importancia.
- respuesta: de 1 a 4 párrafos cortos, texto simple. Puedes usar líneas que empiecen con "- " para listas cortas. Sin títulos, sin negritas, sin emojis.
- Si preguntan algo que no tiene que ver con la cocina, responde amable que solo ayudas con la despensa, las compras y las recetas.`;

const ESQUEMA = {
  type: "object",
  properties: {
    respuesta: { type: "string" },
    intencion: { type: "string", enum: INTENCIONES },
    alimentos: { type: "array", items: { type: "string" } },
    receta_id: { type: "integer", description: "id de una RECETA GUARDADA recomendada; 0 si ninguna" },
    proponer_receta_nueva: { type: "boolean" },
    receta_nueva: {
      type: "object",
      description: "Solo si proponer_receta_nueva es true; si no, nombre vacío y listas vacías",
      properties: {
        nombre: { type: "string" },
        tiempo_minutos: { type: "integer" },
        porciones: { type: "integer" },
        ingredientes: {
          type: "array",
          items: {
            type: "object",
            properties: { nombre: { type: "string", description: "Nombre del ingrediente; si está en la ALACENA, escríbelo igual" }, cantidad: { type: "string", description: "Ej. 2 piezas, 1 taza, al gusto" } },
            required: ["nombre", "cantidad"],
            additionalProperties: false,
          },
        },
        pasos: { type: "array", items: { type: "string" } },
      },
      required: ["nombre", "tiempo_minutos", "porciones", "ingredientes", "pasos"],
      additionalProperties: false,
    },
  },
  required: ["respuesta", "intencion", "alimentos", "receta_id", "proponer_receta_nueva", "receta_nueva"],
  additionalProperties: false,
};

/**
 * Responde una pregunta con Claude y valida la respuesta contra los datos reales.
 * @param historial [{ autor: 'usuario'|'asistente', contenido }] de la conversación reciente
 */
async function responder(usuario, pregunta, historial = []) {
  const c = await contexto(usuario);
  const charla = historial.slice(-6).map((m) => `${m.autor === "usuario" ? "Persona" : "Chef QHDC"}: ${String(m.contenido).slice(0, 600)}`).join("\n");
  const { datos, modelo, uso } = await pedirJson({
    sistema: SISTEMA,
    esquema: ESQUEMA,
    esfuerzo: "low", // conversación: respuestas rápidas
    contenido: [{
      type: "text",
      text: `DATOS DE LA COCINA\n${contextoTexto(c)}\n\n${charla ? `CONVERSACIÓN RECIENTE\n${charla}\n\n` : ""}PREGUNTA\n${pregunta}`,
    }],
  });

  // ---------- Validación contra los datos reales ----------
  const alimentos = [...new Set((Array.isArray(datos.alimentos) ? datos.alimentos : [])
    .map((n) => buscarAlimento(c.alacena, n)).filter(Boolean).map((p) => p.id))].slice(0, 6);
  const receta = c.recetas.find((r) => r.id === Number(datos.receta_id)) || null;

  let recetaNueva = null;
  const rn = datos.receta_nueva || {};
  if (datos.proponer_receta_nueva && rn.nombre && Array.isArray(rn.ingredientes) && rn.ingredientes.length) {
    const ingredientes = rn.ingredientes.slice(0, 15).map((i) => {
      const p = buscarAlimento(c.alacena, i.nombre);
      const basico = esBasico(i.nombre);
      return {
        nombre: String(i.nombre).slice(0, 80),
        cantidad: String(i.cantidad || "").slice(0, 40),
        alimentoId: p ? p.id : null,
        // Exacto: se tiene si está en la alacena con existencia y sin caducar
        disponible: Boolean(p && p.e.disponible) || (!p && basico),
        basico: !p && basico,
      };
    });
    recetaNueva = {
      nombre: String(rn.nombre).slice(0, 100),
      tiempo: Math.max(1, Math.min(600, Number(rn.tiempo_minutos) || 20)),
      porciones: Math.max(1, Math.min(20, Number(rn.porciones) || 2)),
      ingredientes,
      faltan: ingredientes.filter((i) => !i.disponible).length,
      pasos: (Array.isArray(rn.pasos) ? rn.pasos : []).slice(0, 12).map((p) => String(p).slice(0, 400)),
    };
  }

  return {
    respuesta: String(datos.respuesta || "").slice(0, 2500).trim() || "No tengo una respuesta para eso. ¿Me lo preguntas de otra forma?",
    intencion: INTENCIONES.includes(datos.intencion) ? datos.intencion : "otra",
    alimentos,
    recetaId: receta ? receta.id : null,
    recetaNueva,
    modelo,
    uso,
  };
}

module.exports = { responder, contexto, contextoTexto, buscarAlimento, estadoAlimento, normalizar, palabras, esBasico };
