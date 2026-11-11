// ============================================================
//  QHDC! — Recetas (recetas.html)
//  HU-08 Recetas con los alimentos disponibles.
//  Incluye "Sorpréndeme" y un modo cocina paso a paso con
//  temporizador cuando el paso menciona minutos.
// ============================================================

const { $, $$, esc, toast, abrirModal, cerrarModal } = UI;
let filtro = "todas", texto = "", abierta = null;
const FONDO = { tomate: "var(--tomate-claro)", oliva: "var(--oliva-claro)", mostaza: "var(--mostaza-claro)", cafe: "var(--superficie-2)", petroleo: "var(--info-fondo)" };

function sticker(i) {
  if (i.urgente) return `<span class="badge badge-peligro"><i class="fa-solid fa-hourglass-half"></i> ${esc(i.nombre)}</span>`;
  if (i.disponible) return `<span class="badge badge-ok"><i class="fa-solid fa-check"></i> ${esc(i.nombre)}</span>`;
  return `<span class="badge"><i class="fa-solid fa-cart-plus"></i> ${esc(i.nombre)}</span>`;
}

function listaFiltrada() {
  const t = UI.normalizar(texto);
  return QHDC.recetasSugeridas().filter((r) =>
    (filtro !== "urgentes" || r.urgentes > 0) &&
    (filtro !== "completas" || r.faltan === 0) &&
    (filtro !== "rapidas" || r.tiempo <= 20) &&
    (!t || UI.normalizar(r.nombre).includes(t) || r.ingredientes.some((i) => UI.normalizar(i.nombre).includes(t))));
}

function dibujar() {
  const lista = listaFiltrada();
  const hay = QHDC.recetasSugeridas().length > 0;
  $("#sinRecetas").classList.toggle("oculto", lista.length > 0);
  $("#sinRecetasTitulo").textContent = hay ? "Ninguna receta coincide" : "Aún no tienes recetas";
  $("#sinRecetasTexto").textContent = hay
    ? "Prueba con otro ingrediente o quita el filtro."
    : "Crea la primera con los ingredientes de tu alacena, con una foto o escribiéndola tú.";
  $("#btnCrearVacio").classList.toggle("oculto", hay);
  $("#btnSorpresa").disabled = !hay;
  $("#recetas").innerHTML = lista.map((r, k) => `
    <button class="receta aparecer" style="--i:${k}" type="button" data-id="${r.id}" data-sonido="abrir" aria-label="${esc(r.nombre)}, ${r.tiempo} minutos">
      <div class="receta-arte" style="background-color:${FONDO[r.color]}">
        ${r.urgentes ? `<span class="badge badge-peligro"><i class="fa-solid fa-hand-holding-heart"></i> Salva ${r.urgentes} alimento${r.urgentes > 1 ? "s" : ""}</span>` : ""}
        <span class="plato"><i class="fa-solid ${r.icono}"></i></span>
      </div>
      <div class="receta-cuerpo">
        <h3>${esc(r.nombre)}</h3>
        <div class="meta"><span><i class="fa-solid fa-clock"></i> ${r.tiempo} min</span><span><i class="fa-solid fa-user-group"></i> ${r.porciones}</span><span><i class="fa-solid fa-signal"></i> ${r.dificultad}</span></div>
        <div class="stickers">${r.ingredientes.map(sticker).join("")}</div>
        <div class="en-casa">
          <span class="puntos" aria-hidden="true">${r.ingredientes.map((i) => `<span class="${i.disponible ? "si" : ""}"></span>`).join("")}</span>
          ${r.faltan === 0 ? "Tienes todo" : `Tienes ${r.ingredientes.length - r.faltan} de ${r.ingredientes.length}`}
        </div>
      </div>
    </button>`).join("");
}

// ---------- Detalle ----------
function abrirReceta(id) {
  const r = QHDC.recetasSugeridas().find((x) => x.id === Number(id));
  if (!r) return;
  abierta = r;
  $("#portada").style.backgroundColor = FONDO[r.color];
  $("#portada").innerHTML = `<span class="plato"><i class="fa-solid ${r.icono}"></i></span>
    <button class="btn-icono con-borde" type="button" data-cerrar aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>`;
  $("#tituloReceta").textContent = r.nombre;
  $("#metaReceta").innerHTML = `<span><i class="fa-solid fa-clock"></i> ${r.tiempo} min</span><span><i class="fa-solid fa-user-group"></i> ${r.porciones} porciones</span><span><i class="fa-solid fa-signal"></i> ${r.dificultad}</span>`;
  $("#ingredientes").innerHTML = r.ingredientes.map((i) => `
    <li><span>${esc(i.nombre)} <span class="cant">· ${esc(i.cantidad)}</span></span>
      ${i.urgente ? '<span class="badge badge-peligro"><i class="fa-solid fa-hourglass-half"></i> Úsalo ya</span>'
        : i.disponible ? '<span class="badge badge-ok"><i class="fa-solid fa-check"></i> En casa</span>'
        : '<span class="badge"><i class="fa-solid fa-cart-plus"></i> Falta</span>'}</li>`).join("");
  $("#pasos").innerHTML = r.pasos.map((p) => `<li>${esc(p)}</li>`).join("");
  $("#btnFaltantes").disabled = r.faltan === 0;
  $("#btnFaltantes").innerHTML = r.faltan === 0 ? '<i class="fa-solid fa-check"></i> Tienes todo' : '<i class="fa-solid fa-cart-plus"></i> Anotar lo que falta';
  abrirModal("modalReceta");
}
$("#recetas").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) abrirReceta(b.dataset.id); });

$("#btnFaltantes").addEventListener("click", () => {
  const faltan = abierta.ingredientes.filter((i) => !i.disponible);
  faltan.forEach((i) => QHDC.agregarExtra(i.nombre, i.cantidad, i.producto ? i.producto.precio : 0, abierta.id));
  Sonido.marcar();
  $("#btnFaltantes").disabled = true;
  $("#btnFaltantes").innerHTML = '<i class="fa-solid fa-check"></i> Anotado en tu lista';
  toast(`Anotamos ${faltan.length} ${faltan.length === 1 ? "ingrediente" : "ingredientes"} en tu lista`, { icono: "fa-cart-plus" });
});

// ---------- Borrar una receta del hogar ----------
$("#btnBorrarReceta").addEventListener("click", async () => {
  if (!abierta || !confirm(`¿Borrar la receta "${abierta.nombre}"?`)) return;
  try {
    await QHDC.borrarReceta(abierta.id);
    Sonido.borrar();
    cerrarModal("modalReceta");
    toast("Receta borrada", { icono: "fa-trash" });
    dibujar();
  } catch (e) {
    Sonido.alerta();
    toast(e.message, { icono: "fa-triangle-exclamation" });
  }
});

// ============================================================
//  CREAR RECETA: con ingredientes elegidos, con una foto (IA) o a mano.
//  Lo que propone la IA es un borrador: se revisa y se guarda solo si
//  la persona quiere.
// ============================================================
let modo = "ingredientes", borrador = null, fotoBlob = null;
const elegidos = new Set();

function abrirCrear() {
  modo = "ingredientes";
  borrador = null;
  fotoBlob = null;
  elegidos.clear();
  $("#indicaciones").value = "";
  $("#porcionesIA").value = "";
  $("#vistaFotoReceta").classList.add("oculto");
  dibujarElegir();
  mostrarModo();
  abrirModal("modalCrear");
}
$("#btnCrear").addEventListener("click", abrirCrear);
$("#btnCrearVacio").addEventListener("click", abrirCrear);

function mostrarModo() {
  $$("#modosCrear .chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.modo === modo));
  const manual = modo === "manual";
  $("#pedirIA").classList.toggle("oculto", manual);
  $("#campoElegir").classList.toggle("oculto", modo !== "ingredientes");
  $("#campoFoto").classList.toggle("oculto", modo !== "foto");
  if (manual) mostrarEditor(null);
  else {
    $("#formReceta").classList.add("oculto");
    $("#btnGuardarReceta").classList.add("oculto");
    $("#btnOtraIdea").classList.add("oculto");
  }
}
$("#modosCrear").addEventListener("click", (e) => {
  const c = e.target.closest("[data-modo]");
  if (!c) return;
  modo = c.dataset.modo;
  mostrarModo();
});

// Ingredientes de la alacena que se pueden elegir (primero lo que caduca pronto)
function dibujarElegir() {
  const disponibles = QHDC.productos()
    .filter((p) => p.cantidad > 0 && p.estado.cad !== "caducado")
    .sort((a, b) => a.estado.dias - b.estado.dias);
  $("#sinAlacena").classList.toggle("oculto", disponibles.length > 0);
  $("#elegirIngredientes").innerHTML = disponibles.map((p) => `
    <button class="chip" type="button" data-elegir="${p.id}" aria-pressed="${elegidos.has(p.id)}">
      ${UI.iconoProducto(p)} ${esc(p.nombre)}${["urgente", "pronto"].includes(p.estado.cad) ? ' <i class="fa-solid fa-hourglass-half" title="Caduca pronto"></i>' : ""}
    </button>`).join("");
}
$("#elegirIngredientes").addEventListener("click", (e) => {
  const c = e.target.closest("[data-elegir]");
  if (!c) return;
  const idP = Number(c.dataset.elegir);
  if (elegidos.has(idP)) elegidos.delete(idP); else elegidos.add(idP);
  c.setAttribute("aria-pressed", elegidos.has(idP));
});

// Foto: se reduce en el teléfono antes de enviarla (y el servidor no la guarda)
async function comprimir(archivo) {
  const img = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(img.width * escala);
  lienzo.height = Math.round(img.height * escala);
  lienzo.getContext("2d").drawImage(img, 0, 0, lienzo.width, lienzo.height);
  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo leer la foto."))), "image/jpeg", 0.85));
}
$("#fotoReceta").addEventListener("change", async (e) => {
  const archivo = e.target.files[0];
  e.target.value = "";
  if (!archivo) return;
  if (!archivo.type.startsWith("image/")) { toast("Elige una imagen (JPG, PNG o WebP).", { icono: "fa-image" }); return; }
  try {
    fotoBlob = await comprimir(archivo);
    $("#vistaFotoReceta").src = URL.createObjectURL(fotoBlob);
    $("#vistaFotoReceta").classList.remove("oculto");
    Sonido.pop();
  } catch (err) {
    toast(err.message, { icono: "fa-image" });
  }
});

async function pedirReceta() {
  if (modo === "ingredientes" && !elegidos.size) { toast("Elige al menos un ingrediente.", { icono: "fa-basket-shopping" }); return; }
  if (modo === "foto" && !fotoBlob) { toast("Primero elige o toma una foto.", { icono: "fa-camera" }); return; }
  const botones = [$("#btnGenerar"), $("#btnOtraIdea")];
  const antes = botones.map((b) => b.innerHTML);
  botones.forEach((b) => { b.disabled = true; b.innerHTML = '<i class="fa-solid fa-rotate"></i> Pensando una receta…'; });
  Sonido.escaneo();
  try {
    borrador = await QHDC.generarReceta({
      elegidos: modo === "ingredientes" ? [...elegidos] : [],
      foto: modo === "foto" ? fotoBlob : null,
      indicaciones: $("#indicaciones").value.trim(),
      porciones: $("#porcionesIA").value,
    });
    mostrarEditor(borrador);
    Sonido.exito();
  } catch (e) {
    Sonido.alerta();
    toast(e.message, { icono: "fa-triangle-exclamation" });
  }
  botones.forEach((b, k) => { b.disabled = false; b.innerHTML = antes[k]; });
}
$("#btnGenerar").addEventListener("click", pedirReceta);
$("#btnOtraIdea").addEventListener("click", pedirReceta);

// Editor: borrador de la IA o receta en blanco
function filaIngrediente(i = {}) {
  const badge = i.disponible === undefined ? "<span></span>"
    : i.disponible ? '<span class="badge badge-ok"><i class="fa-solid fa-check"></i> Tienes</span>'
    : '<span class="badge"><i class="fa-solid fa-cart-plus"></i> Falta</span>';
  return `<li>
    <input class="control" data-ing="nombre" maxlength="100" value="${esc(i.nombre || "")}" placeholder="Ingrediente" aria-label="Ingrediente">
    <input class="control" data-ing="cantidad" maxlength="60" value="${esc(i.cantidad || "")}" placeholder="Cantidad" aria-label="Cantidad">
    ${badge}
    <button class="btn-icono" type="button" data-quitar-ing aria-label="Quitar ingrediente"><i class="fa-solid fa-xmark"></i></button>
  </li>`;
}
function mostrarEditor(r) {
  $("#formReceta").classList.remove("oculto");
  $("#rNombre").value = r ? r.nombre : "";
  $("#rTiempo").value = r ? r.tiempo : 30;
  $("#rPorciones").value = r ? r.porciones : 2;
  $("#rDificultad").value = r ? r.dificultad : "facil";
  $("#rIngredientes").innerHTML = (r ? r.ingredientes : [{}, {}]).map(filaIngrediente).join("");
  $("#rPasos").value = r ? r.pasos.join("\n") : "";
  $("#notaBorrador").innerHTML = r
    ? `<i class="fa-solid fa-wand-magic-sparkles"></i> Propuesta de la IA${r.faltan ? ` · te faltan ${r.faltan} ingrediente${r.faltan === 1 ? "" : "s"}` : " · tienes todo"}.
       Revísala y cámbiala si quieres; solo se guarda si tocas <b>Guardar receta</b>.${r.enFoto && r.enFoto.length ? `<br>En la foto vi: ${esc(r.enFoto.join(", "))}.` : ""}`
    : "Escribe tu receta: ingredientes con su cantidad y los pasos, uno por renglón.";
  $("#btnGuardarReceta").classList.remove("oculto");
  $("#btnOtraIdea").classList.toggle("oculto", !r);
  (r ? $("#rNombre") : $("#rNombre")).focus();
}
$("#btnAgregarIng").addEventListener("click", () => {
  $("#rIngredientes").insertAdjacentHTML("beforeend", filaIngrediente());
  $("#rIngredientes li:last-child input").focus();
});
$("#rIngredientes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-quitar-ing]");
  if (b) b.closest("li").remove();
});

$("#btnGuardarReceta").addEventListener("click", async () => {
  const ingredientes = $$("#rIngredientes li").map((li) => ({
    nombre: $('[data-ing="nombre"]', li).value.trim(),
    cantidad: $('[data-ing="cantidad"]', li).value.trim() || "al gusto",
  })).filter((i) => i.nombre);
  const pasos = $("#rPasos").value.split("\n").map((p) => p.trim()).filter(Boolean);
  if (!$("#rNombre").value.trim()) { toast("Ponle un nombre a la receta.", { icono: "fa-pen" }); $("#rNombre").focus(); return; }
  if (!ingredientes.length) { toast("Agrega al menos un ingrediente.", { icono: "fa-basket-shopping" }); return; }
  if (!pasos.length) { toast("Escribe al menos un paso.", { icono: "fa-list-ol" }); $("#rPasos").focus(); return; }
  const b = $("#btnGuardarReceta");
  b.disabled = true;
  try {
    const nuevoId = await QHDC.guardarReceta({
      nombre: $("#rNombre").value.trim(),
      tiempo: Number($("#rTiempo").value) || 30,
      porciones: Number($("#rPorciones").value) || 2,
      dificultad: $("#rDificultad").value,
      icono: borrador ? borrador.icono : undefined,
      descripcion: borrador ? borrador.descripcion : undefined,
      ingredientes,
      pasos,
    });
    Sonido.exito();
    Efectos.confeti();
    cerrarModal("modalCrear");
    toast("Receta guardada", { icono: "fa-book-open" });
    dibujar();
    setTimeout(() => abrirReceta(nuevoId), 400);
  } catch (e) {
    Sonido.alerta();
    toast(e.message, { icono: "fa-triangle-exclamation" });
  }
  b.disabled = false;
});

// ============================================================
//  MODO COCINA
// ============================================================
let paso = 0, reloj = null, restante = 0;

function abrirModoCocina() {
  cerrarModal("modalReceta");
  paso = 0;
  $("#modoCocina").classList.remove("oculto");
  $("#mcReceta").textContent = abierta.nombre;
  document.body.style.overflow = "hidden";
  mostrarPaso();
  $("#mcSiguiente").focus();
}
function cerrarModoCocina() {
  detenerReloj();
  $("#modoCocina").classList.add("oculto");
  document.body.style.overflow = "";
}
function mostrarPaso() {
  const total = abierta.pasos.length;
  $("#mcTitulo").textContent = `Paso ${paso + 1} de ${total}`;
  $("#mcProgreso").innerHTML = abierta.pasos.map((_, i) => `<span class="${i < paso ? "hecho" : i === paso ? "actual" : ""}"></span>`).join("");
  const el = $("#mcPaso");
  el.textContent = abierta.pasos[paso];
  el.classList.remove("cambia"); void el.offsetWidth; el.classList.add("cambia");
  $("#mcAtras").disabled = paso === 0;
  $("#mcSiguiente").innerHTML = paso === total - 1 ? '<i class="fa-solid fa-champagne-glasses"></i> ¡Terminé!' : 'Siguiente <i class="fa-solid fa-arrow-right"></i>';
  // Temporizador si el paso habla de minutos
  detenerReloj();
  const m = abierta.pasos[paso].match(/(\d+)\s*minuto/i);
  $("#mcTimer").classList.toggle("oculto", !m);
  if (m) { restante = Number(m[1]) * 60; pintarReloj(false); }
}
function pintarReloj(corriendo) {
  const mm = String(Math.floor(restante / 60)).padStart(2, "0"), ss = String(restante % 60).padStart(2, "0");
  const b = $("#mcTimerBtn");
  b.classList.toggle("corriendo", corriendo);
  $("span", b).textContent = corriendo ? `${mm}:${ss} · detener` : `Temporizador ${mm}:${ss}`;
}
function detenerReloj() { clearInterval(reloj); reloj = null; }
$("#mcTimerBtn").addEventListener("click", () => {
  if (reloj) { detenerReloj(); pintarReloj(false); Sonido.cerrar(); return; }
  Sonido.abrir();
  pintarReloj(true);
  reloj = setInterval(() => {
    restante--;
    pintarReloj(true);
    if (restante <= 0) {
      detenerReloj();
      Sonido.alerta(); setTimeout(Sonido.alerta, 500); setTimeout(Sonido.alerta, 1000);
      $("span", $("#mcTimerBtn")).textContent = "¡Tiempo!";
    }
  }, 1000);
});

function terminar() {
  // Se descuenta una porción de cada ingrediente y queda registrada la receta preparada
  // (la sal, el aceite, etc. sin registrar no se descuentan)
  const consumos = abierta.ingredientes.filter((i) => i.disponible && i.producto).map((i) => ({
    productoId: i.producto.id,
    cantidad: Math.min(i.producto.cantidad, +(i.producto.capacidad * 0.2).toFixed(2)),
  }));
  QHDC.terminarReceta(abierta.id, consumos);
  cerrarModoCocina();
  Sonido.exito();
  Efectos.confeti();
  dibujar();
  UI.actualizarContadores();
  toast("¡Buen provecho! Descontamos los ingredientes de tu alacena", { icono: "fa-utensils", duracion: 4500 });
}

$("#btnCocinar").addEventListener("click", abrirModoCocina);
$("#mcCerrar").addEventListener("click", cerrarModoCocina);
$("#mcAtras").addEventListener("click", () => { if (paso > 0) { paso--; mostrarPaso(); } });
$("#mcSiguiente").addEventListener("click", () => { if (paso < abierta.pasos.length - 1) { paso++; mostrarPaso(); } else terminar(); });
document.addEventListener("keydown", (e) => {
  if ($("#modoCocina").classList.contains("oculto")) return;
  if (e.key === "ArrowRight") $("#mcSiguiente").click();
  if (e.key === "ArrowLeft") $("#mcAtras").click();
  if (e.key === "Escape") cerrarModoCocina();
});

// ============================================================
//  SORPRÉNDEME: recorre las tarjetas y se detiene en la mejor
// ============================================================
$("#btnSorpresa").addEventListener("click", () => {
  filtro = "todas"; texto = ""; $("#buscar").value = "";
  $$("#filtros .chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.filtro === "todas"));
  dibujar();
  const tarjetas = $$("#recetas .receta");
  if (!tarjetas.length) return;
  const vueltas = menosMovimiento() ? 1 : tarjetas.length + 3;
  let i = 0;
  const btn = $("#btnSorpresa");
  btn.disabled = true;
  const avanzar = () => {
    tarjetas.forEach((t) => t.classList.remove("foco"));
    const actual = tarjetas[i % tarjetas.length];
    if (i < vueltas - 1) {
      actual.classList.add("foco");
      Sonido.tic();
      i++;
      setTimeout(avanzar, 70 + i * 14);
    } else {
      tarjetas[0].classList.add("foco");
      tarjetas[0].scrollIntoView({ block: "center", behavior: "smooth" });
      Sonido.exito();
      btn.disabled = false;
      setTimeout(() => { tarjetas[0].classList.remove("foco"); abrirReceta(tarjetas[0].dataset.id); }, 700);
    }
  };
  avanzar();
});

// ---------- Filtros ----------
$("#filtros").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (!c) return;
  $$("#filtros .chip").forEach((x) => x.setAttribute("aria-pressed", x === c));
  filtro = c.dataset.filtro;
  dibujar();
});
$("#buscar").addEventListener("input", (e) => { texto = e.target.value; dibujar(); });

dibujar();
const idInicial = new URLSearchParams(location.search).get("id");
if (idInicial) setTimeout(() => abrirReceta(idInicial), 300);

// ============================================================
//  RECORRIDO DE ESTA PANTALLA
// ============================================================
UI.registrarRecorrido([
  { sel: ".topbar-titulo", titulo: "Recetas", texto: "Ideas para cocinar con lo que ya tienes. Las primeras usan lo que está por caducar." },
  { sel: "#filtros", titulo: "Filtra", texto: "«Salvan comida» usa lo que caduca pronto, «Tengo todo» no requiere comprar nada y «En 20 min» es para cuando hay prisa." },
  { sel: ".barra-recetas .buscador", titulo: "Busca por ingrediente", texto: "Escribe un ingrediente, como «huevo», y verás qué puedes preparar con él." },
  { sel: "#btnSorpresa", titulo: "Sorpréndeme", texto: "¿Indeciso? Recorremos las recetas y te abrimos la mejor para hoy." },
  { sel: "#recetas .receta", titulo: "Una receta", texto: "Toca la tarjeta para ver los ingredientes y los pasos." },
  { sel: "#recetas .receta-arte .badge", titulo: "Salva alimentos", texto: "Te dice cuántos alimentos por caducar aprovecha esta receta." },
  { sel: "#recetas .receta .meta", titulo: "Tiempo y porciones", texto: "Cuánto tarda, para cuántas personas alcanza y qué tan difícil es." },
  { sel: "#recetas .receta .stickers", titulo: "Ingredientes", texto: "Verde: lo tienes. Rojo: lo tienes pero caduca pronto. Gris: te falta." },
  { sel: "#recetas .receta .en-casa", titulo: "¿Cuánto tienes?", texto: "Cada punto es un ingrediente. Los verdes ya están en tu cocina." },
  { sel: "#ingredientes", estado: "detalle", titulo: "Lo que necesitas", texto: "Cada ingrediente con su cantidad y si ya lo tienes." },
  { sel: "#pasos", estado: "detalle", titulo: "Paso a paso", texto: "Las instrucciones, en orden y cortitas." },
  { sel: "#btnFaltantes", estado: "detalle", titulo: "Anota lo que falta", texto: "Un toque y lo que te falta pasa a tu lista del súper." },
  { sel: "#btnCocinar", estado: "detalle", titulo: "Empezar a cocinar", texto: "Abre el modo cocina: letra grande, un paso a la vez." },
  { sel: ".mc-progreso", estado: "cocina", titulo: "Tu avance", texto: "Cada barrita es un paso. Así sabes cuánto te falta." },
  { sel: "#mcPaso", estado: "cocina", titulo: "Un paso a la vez", texto: "Letra grande para leerla desde lejos mientras cocinas." },
  { sel: "#mcTimer", estado: "cocina", titulo: "Temporizador", texto: "Si el paso dice minutos, aparece este botón. Te avisamos con un sonido cuando termine." },
  { sel: ".mc-pie", estado: "cocina", titulo: "Avanza", texto: "Usa estos botones o las flechas del teclado. Al terminar descontamos los ingredientes de tu alacena." },
], {
  base: () => { if (!$("#modoCocina").classList.contains("oculto")) cerrarModoCocina(); cerrarModal("modalReceta"); },
  estados: {
    detalle: () => { const r = $("#recetas .receta"); if (r) abrirReceta(r.dataset.id); },
    cocina: () => {
      const r = $("#recetas .receta");
      if (!r) return;
      abrirReceta(r.dataset.id);
      abrirModoCocina();
      const conMinutos = abierta.pasos.findIndex((x) => /minuto/i.test(x));
      if (conMinutos > 0) { paso = conMinutos; mostrarPaso(); }
    },
  },
});
