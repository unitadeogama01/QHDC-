// ============================================================
//  QHDC! — Asistente (asistente.html)
//  HU-05 Qué consumir primero · HU-06 Predicción de consumo
//
//  Conversación tipo chat. Las preguntas las responde la IA (Claude)
//  desde el servidor, con los datos exactos de la cocina; el servidor
//  guarda la conversación. Si la IA no está disponible, responder()
//  arma la respuesta con reglas sobre los mismos datos.
// ============================================================

const { $, $$, esc, iconoProducto, badgeCaducidad } = UI;
const caja = $("#mensajes");

// ---------- Agregar mensajes ----------
function bajar() { caja.scrollTo({ top: caja.scrollHeight, behavior: menosMovimiento() ? "auto" : "smooth" }); }

function mensajeYo(texto) {
  caja.insertAdjacentHTML("beforeend", `<div class="msg yo"><div class="burbuja">${esc(texto)}</div></div>`);
  bajar();
}

function mensajeIA(html, retraso = 650) {
  return new Promise((listo) => {
    caja.insertAdjacentHTML("beforeend", `<div class="msg ia escribiendo" id="escribiendo"><span class="mini-robot"><i class="fa-solid fa-robot"></i></span><div class="burbuja" aria-label="Escribiendo"><span></span><span></span><span></span></div></div>`);
    bajar();
    setTimeout(() => {
      $("#escribiendo").remove();
      caja.insertAdjacentHTML("beforeend", `<div class="msg ia"><span class="mini-robot"><i class="fa-solid fa-robot"></i></span><div class="burbuja">${html}</div></div>`);
      Sonido.pop();
      bajar();
      listo();
    }, menosMovimiento() ? 0 : retraso);
  });
}

// ---------- Respuestas ----------
const listaCosas = (items) => `<ul class="cosas">${items.join("")}</ul>`;

function responderUsarPrimero() {
  const lista = QHDC.consumirPrimero().slice(0, 5);
  if (!lista.length) return "<p>¡Buenas noticias! Nada caduca en los próximos 7 días.</p>";
  const primero = lista[0];
  return `<p>Esto es lo que te conviene usar primero:</p>
    ${listaCosas(lista.map((p) => `<li>${iconoProducto(p)}<span class="n">${esc(p.nombre)}</span>${badgeCaducidad(p.estado)}</li>`))}
    <p>${esc(primero.razon)}${primero.receta ? ` Podrías preparar <a href="recetas.html?id=${primero.receta.id}"><b><u>${esc(primero.receta.nombre.toLowerCase())}</u></b></a>.` : ""}</p>`;
}

function responderComprar() {
  const pronto = QHDC.predicciones().filter((p) => p.diasAgotar <= 7).slice(0, 6);
  if (!pronto.length) return "<p>Por ahora tienes de todo. No necesitas ir al súper esta semana.</p>";
  return `<p>Según lo que consumes, esto se te va a acabar pronto:</p>
    ${listaCosas(pronto.map((p) => `<li>${iconoProducto(p)}<span class="n">${esc(p.nombre)}</span><span class="badge ${p.diasAgotar <= 3 ? "badge-peligro" : "badge-aviso"}">${p.diasAgotar === 0 ? "Ya no hay" : `${p.diasAgotar} ${p.diasAgotar === 1 ? "día" : "días"}`}</span></li>`))}
    <p>Ya están en tu lista del súper.</p>
    <div class="fila"><a class="btn btn-sm btn-mostaza" href="lista-compras.html"><i class="fa-solid fa-cart-shopping"></i> Abrir mi lista</a></div>`;
}

function responderCocinar() {
  const r = QHDC.recetasSugeridas()[0];
  if (!r) {
    return `<p>Todavía no tienes recetas guardadas.</p>
      <div class="fila"><a class="btn btn-sm btn-principal" href="recetas.html"><i class="fa-solid fa-wand-magic-sparkles"></i> Crear una receta</a></div>`;
  }
  const urg = r.ingredientes.filter((i) => i.urgente).map((i) => i.nombre.toLowerCase());
  return `<p>Te recomiendo esta:</p>
    <div class="receta-msg">
      <span class="prod-icono ico-${r.color}"><i class="fa-solid ${r.icono}"></i></span>
      <div><strong>${esc(r.nombre)}</strong><br><small class="texto-suave">${r.tiempo} min · tienes ${r.ingredientes.length - r.faltan} de ${r.ingredientes.length} ingredientes</small></div>
    </div>
    <p>${urg.length ? `Así aprovechas ${urg.join(" y ")} antes de que caduque${urg.length > 1 ? "n" : ""}.` : "Tienes casi todo en casa."}</p>
    <div class="fila"><a class="btn btn-sm btn-principal" href="recetas.html?id=${r.id}"><i class="fa-solid fa-book-open"></i> Ver receta</a></div>`;
}

function responderDuracion(p) {
  const pred = QHDC.predicciones().find((x) => x.id === p.id);
  if (!pred) return `<p>Todavía no tengo suficientes datos de cuánto ${esc(p.nombre.toLowerCase())} usas.</p>`;
  const fecha = UI.fecha(pred.fechaAgotar, { weekday: "long", day: "numeric", month: "long" });
  return `<p>Tienes <b>${QHDC.formatoCantidad(p.cantidad, p.unidad)}</b> de ${esc(p.nombre.toLowerCase())} y usas unos <b>${QHDC.formatoCantidad(pred.promedio, p.unidad)}</b> al día.</p>
    <p>${pred.diasAgotar === 0 ? "Ya casi no queda: conviene comprar hoy." : `Te alcanza para <b>${pred.diasAgotar} ${pred.diasAgotar === 1 ? "día" : "días"}</b>, más o menos hasta el ${fecha}.`}</p>`;
}

function responderFrescura() {
  const f = QHDC.frescura();
  return `<p>Tu cocina tiene una frescura de <b>${f.valor} de 100</b>.</p>
    <p>${f.caducados ? `Hay ${f.caducados} alimento${f.caducados > 1 ? "s" : ""} caducado${f.caducados > 1 ? "s" : ""}. ` : ""}${f.urgentes ? `${f.urgentes} caduca${f.urgentes > 1 ? "n" : ""} hoy o mañana. ` : ""}${f.bajos ? `${f.bajos} se está${f.bajos > 1 ? "n" : ""} acabando.` : ""}</p>
    <p>Usar primero lo que caduca es la forma más rápida de subirla.</p>`;
}

// Entiende la pregunta por palabras clave
function responder(texto) {
  const t = UI.normalizar(texto);
  const producto = QHDC.productos().find((p) => UI.normalizar(p.nombre).split(" ").some((pal) => pal.length > 3 && t.includes(pal)));
  if (producto && /(dura|alcanza|cuanto|queda|acaba)/.test(t)) return responderDuracion(producto);
  if (/(primero|caduc|vence|echar a perder|usar|urgente)/.test(t)) return responderUsarPrimero();
  if (/(compr|super|lista|falta|acab)/.test(t)) return responderComprar();
  if (/(como esta|frescura|resumen)/.test(t)) return responderFrescura();
  if (/(cocin|comer|receta|prepar|platillo|comida|cena|desayun)/.test(t)) return responderCocinar();
  if (producto) return responderDuracion(producto);
  return `<p>Mmm, no estoy seguro de haber entendido. Puedo decirte:</p>
    <p>• qué usar primero · • qué comprar · • qué cocinar · • cuánto te dura un alimento (ej. «¿cuánto me dura la leche?»)</p>`;
}

// ============================================================
//  RESPUESTAS CON IA (Claude, desde el servidor)
//  El texto lo redacta la IA; las tarjetas (alimentos, recetas,
//  disponibilidad de ingredientes) se arman con datos reales que el
//  servidor ya validó.
// ============================================================
function textoAHtml(texto) {
  return String(texto).split(/\n+/).map((l) => l.trim()).filter(Boolean)
    .map((l) => (/^[-•*]\s+/.test(l) ? `<p>• ${esc(l.replace(/^[-•*]\s+/, ""))}</p>` : `<p>${esc(l)}</p>`)).join("");
}

function tarjetaRecetaNueva(r) {
  const tengo = r.ingredientes.length - r.faltan;
  return `
    <div class="receta-msg">
      <span class="prod-icono ico-oliva"><i class="fa-solid fa-wand-magic-sparkles"></i></span>
      <div><strong>${esc(r.nombre)}</strong><br><small class="texto-suave">${r.tiempo} min · ${r.porciones} porciones · tienes ${tengo} de ${r.ingredientes.length} ingredientes</small></div>
    </div>
    ${listaCosas(r.ingredientes.map((i) => {
      const p = i.alimentoId ? QHDC.producto(i.alimentoId) : null;
      return `<li>${p ? iconoProducto(p) : `<span class="prod-icono"><i class="fa-solid ${i.basico ? "fa-jar" : "fa-basket-shopping"}"></i></span>`}
        <span class="n">${esc(i.nombre)}${i.cantidad ? ` <small class="texto-suave">· ${esc(i.cantidad)}</small>` : ""}</span>
        ${i.disponible ? '<span class="badge badge-ok"><i class="fa-solid fa-check"></i> Tienes</span>' : '<span class="badge badge-peligro"><i class="fa-solid fa-xmark"></i> Falta</span>'}</li>`;
    }))}
    ${r.pasos.length ? `<details class="datos"><summary>Ver pasos</summary>${r.pasos.map((p, n) => `<p><b>${n + 1}.</b> ${esc(p)}</p>`).join("")}</details>` : ""}
    ${r.faltan ? `<div class="fila"><button class="btn btn-sm btn-mostaza" type="button" data-anotar='${esc(JSON.stringify(r.ingredientes.filter((i) => !i.disponible).map((i) => [i.nombre, i.cantidad])))}'><i class="fa-solid fa-cart-plus"></i> Anotar lo que falta</button></div>` : ""}`;
}

function htmlRespuestaIA(r) {
  let html = textoAHtml(r.respuesta);
  const alimentos = r.alimentos.map((id) => QHDC.producto(id)).filter(Boolean);
  if (alimentos.length) html += listaCosas(alimentos.map((p) => `<li>${iconoProducto(p)}<span class="n">${esc(p.nombre)}</span>${badgeCaducidad(p.estado)}</li>`));
  const receta = r.recetaId ? QHDC.recetasSugeridas().find((x) => x.id === r.recetaId) : null;
  if (receta) {
    html += `<div class="receta-msg">
        <span class="prod-icono ico-${receta.color}"><i class="fa-solid ${receta.icono}"></i></span>
        <div><strong>${esc(receta.nombre)}</strong><br><small class="texto-suave">${receta.tiempo} min · tienes ${receta.ingredientes.length - receta.faltan} de ${receta.ingredientes.length} ingredientes</small></div>
      </div>
      <div class="fila"><a class="btn btn-sm btn-principal" href="recetas.html?id=${receta.id}"><i class="fa-solid fa-book-open"></i> Ver receta</a></div>`;
  }
  if (r.recetaNueva) html += tarjetaRecetaNueva(r.recetaNueva);
  if (r.intencion === "comprar") html += `<div class="fila"><a class="btn btn-sm btn-mostaza" href="lista-compras.html"><i class="fa-solid fa-cart-shopping"></i> Abrir mi lista</a></div>`;
  return html;
}

// "Anotar lo que falta" de una receta propuesta por la IA
caja.addEventListener("click", (e) => {
  const b = e.target.closest("[data-anotar]");
  if (!b) return;
  const faltan = JSON.parse(b.dataset.anotar);
  faltan.forEach(([nombre, cantidad]) => QHDC.agregarExtra(nombre, cantidad || "1", 0));
  Sonido.exito();
  b.disabled = true;
  b.innerHTML = '<i class="fa-solid fa-check"></i> Anotado';
  UI.toast(`Anotamos ${faltan.length} ${faltan.length === 1 ? "ingrediente" : "ingredientes"} en tu lista`, { icono: "fa-cart-plus" });
});

// Muestra "escribiendo…" mientras llega la respuesta
function escribiendo(mostrar) {
  const e = $("#escribiendo");
  if (!mostrar) { if (e) e.remove(); return; }
  if (e) return;
  caja.insertAdjacentHTML("beforeend", `<div class="msg ia escribiendo" id="escribiendo"><span class="mini-robot"><i class="fa-solid fa-robot"></i></span><div class="burbuja" aria-label="Escribiendo"><span></span><span></span><span></span></div></div>`);
  bajar();
}

let iaDisponible = true; // si el servidor no tiene IA, se usan las reglas sin volver a intentar
let ocupado = false;

async function preguntar(texto) {
  if (!texto.trim() || ocupado) return;
  ocupado = true;
  Sonido.subir();
  mensajeYo(texto);
  if (iaDisponible) {
    escribiendo(true);
    try {
      const r = await QHDC.preguntarAsistente(texto);
      escribiendo(false);
      await mensajeIA(htmlRespuestaIA(r), 0);
      ocupado = false;
      return;
    } catch (e) {
      escribiendo(false);
      if (e.estado === 503) iaDisponible = false; // no configurada: reglas desde ahora
      else if (e.estado === 429) { await mensajeIA(`<p>${esc(e.message)}</p>`, 0); ocupado = false; return; }
    }
  }
  // Respaldo: respuestas con reglas sobre los datos de la cocina
  const respuesta = responder(texto);
  QHDC.registrarConversacion(texto, respuesta);
  await mensajeIA(respuesta);
  ocupado = false;
}

// ---------- Eventos ----------
$("#formPregunta").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("#pregunta").value;
  $("#pregunta").value = "";
  preguntar(t);
});
$("#sugeridas").addEventListener("click", (e) => {
  const c = e.target.closest("[data-pregunta]");
  if (c) preguntar(c.dataset.pregunta);
});

// ============================================================
//  TE ALCANZA PARA (HU-06)
// ============================================================
function dibujarAlcanza() {
  $("#alcanza").innerHTML = QHDC.predicciones().map((p) => {
    const nivel = p.diasAgotar <= 3 ? "bajo" : p.diasAgotar <= 7 ? "medio" : "";
    return `<li>
      ${iconoProducto(p)}
      <strong>${esc(p.nombre)}</strong>
      <span class="dias">${p.diasAgotar} d</span>
      <div class="barra" title="${p.diasAgotar} de 30 días"><span class="${nivel}" style="width:${Math.min(100, (p.diasAgotar / 30) * 100)}%"></span></div>
    </li>`;
  }).join("");
}

// ============================================================
//  GRÁFICA DE CONSUMO (últimos 7 días)
// ============================================================
function dias() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return i === 6 ? "Hoy" : d.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", "");
  });
}
function dibujarGrafica() {
  const p = QHDC.producto($("#productoGrafica").value);
  if (!p) return;
  const v = p.historial, max = Math.max(...v) * 1.2 || 1, prom = v.reduce((s, x) => s + x, 0) / v.length;
  const nombres = dias();
  const iMax = v.indexOf(Math.max(...v));
  $("#grafica").setAttribute("aria-label", `Consumo diario de ${p.nombre} en los últimos 7 días`);
  $("#grafica").innerHTML = `<div class="promedio" style="bottom:${(prom / max) * 100}%"><span>promedio</span></div>` +
    v.map((x, i) => `<div class="col" tabindex="0" style="--i:${i}">
      <span class="tip">${nombres[i]}: ${QHDC.formatoCantidad(x, p.unidad)}</span>
      ${i === iMax || i === 6 ? `<span class="etq">${+x.toFixed(1)}</span>` : ""}
      <span class="v" style="height:${(x / max) * 100}%"></span></div>`).join("");
  $("#eje").innerHTML = nombres.map((d) => `<span>${d}</span>`).join("");
  $("#resumenGrafica").textContent = `Usas en promedio ${QHDC.formatoCantidad(+prom.toFixed(2), p.unidad)} al día.`;
  $("#tablaGrafica").innerHTML = v.map((x, i) => `<tr><td>${nombres[i]}</td><td>${QHDC.formatoCantidad(x, p.unidad)}</td></tr>`).join("");
}
$("#productoGrafica").innerHTML = QHDC.predicciones().map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
$("#productoGrafica").addEventListener("change", () => { dibujarGrafica(); Sonido.suave(); });

// ============================================================
//  ARRANQUE
// ============================================================
dibujarAlcanza();
dibujarGrafica();

(async () => {
  const nombre = UI.sesion.nombre.split(" ")[0];
  await mensajeIA(`<p>¡Hola, ${esc(nombre)}! Ya revisé tu cocina.</p><p>${esc(QHDC.resumenIA())}</p>`, 500);
  const p = new URLSearchParams(location.search).get("p");
  const preguntas = { caduca: "¿Qué debo usar primero?", comprar: "¿Qué necesito comprar?", cocinar: "¿Qué cocino hoy?" };
  if (preguntas[p]) preguntar(preguntas[p]);
})();

// ============================================================
//  RECORRIDO DE ESTA PANTALLA
// ============================================================
UI.registrarRecorrido([
  { sel: ".chat-cab", titulo: "Tu asistente", texto: "Chef QHDC conoce todo lo que hay en tu cocina y te responde en palabras sencillas." },
  { sel: "#mensajes", titulo: "La conversación", texto: "Aquí aparecen tus preguntas y sus respuestas. Algunas traen botones para ir directo a lo que necesitas." },
  { sel: "#sugeridas", titulo: "Preguntas rápidas", texto: "¿No sabes qué preguntar? Toca una de estas. Desliza para ver más." },
  { sel: "#pregunta", titulo: "Pregunta lo que quieras", texto: "Escribe con tus palabras, por ejemplo: «¿cuánto me dura el café?» o «¿qué cocino hoy?»." },
  { sel: '#formPregunta button[type="submit"]', titulo: "Enviar", texto: "Toca aquí o presiona Enter." },
  { sel: () => $("#alcanza").closest(".tarjeta"), titulo: "Te alcanza para", texto: "Cuántos días te dura cada alimento según lo que consumes. Los primeros son los que se acaban antes." },
  { sel: "#productoGrafica", titulo: "Elige un alimento", texto: "Cambia el alimento para ver cuánto has usado cada día." },
  { sel: "#grafica", titulo: "Tu consumo", texto: "Cada barra es un día. La línea punteada es tu promedio. Pasa el dedo o el mouse sobre una barra para ver el número exacto." },
  { sel: ".datos summary", titulo: "En tabla", texto: "Si prefieres números, aquí ves los mismos datos como tabla." },
]);
