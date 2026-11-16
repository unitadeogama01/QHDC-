// ============================================================
//  QHDC! — Lista del súper (lista-compras.html)
//  HU-07 Lista de compras automática
// ============================================================

const { $, $$, esc, iconoProducto, toast, dinero } = UI;
const GRUPOS = [
  { id: "alta", titulo: "Urgente", icono: "fa-fire" },
  { id: "media", titulo: "Pronto", icono: "fa-clock" },
  { id: "baja", titulo: "Tú lo anotaste", icono: "fa-pen" },
];

function renglon(i) {
  return `
    <div class="renglon ${i.comprado ? "comprado" : ""}" data-clave="${i.clave}">
      <label class="casilla">
        <input type="checkbox" ${i.comprado ? "checked" : ""} aria-label="${esc(i.nombre)} ya está en el carrito">
        <span><i class="fa-solid fa-check"></i></span>
      </label>
      <div class="info">
        <span class="nombre">${esc(i.nombre)}</span>
        <small><i class="fa-solid ${i.icono}"></i> ${esc(i.extra ? i.cantidad : `${i.cantidad} · ${i.motivo}`)}</small>
      </div>
      <span class="precio">${dinero(i.precio)}</span>
      ${i.extra ? `<button class="btn-icono quitar" type="button" data-quitar aria-label="Quitar ${esc(i.nombre)}" data-sonido="ninguno"><i class="fa-solid fa-xmark"></i></button>` : "<span></span>"}
    </div>`;
}

function dibujar(animar = false) {
  const { items, suficiente } = QHDC.listaCompras();
  $("#ticketFecha").textContent = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }) + " · " + UI.sesion.hogar;

  $("#grupos").innerHTML = GRUPOS.map((g) => {
    const del = items.filter((i) => i.prioridad === g.id);
    if (!del.length) return "";
    return `<section class="grupo"><h3><i class="fa-solid ${g.icono}"></i> ${g.titulo} <span class="badge">${del.length}</span></h3>${del.map(renglon).join("")}</section>`;
  }).join("") || `<div class="vacio"><div class="ilustra"><i class="fa-solid fa-basket-shopping"></i></div><strong>¡Tienes todo!</strong><p>No necesitas ir al súper por ahora.</p></div>`;

  const marcados = items.filter((i) => i.comprado);
  const pct = items.length ? Math.round((marcados.length / items.length) * 100) : 0;
  $("#numArticulos").textContent = items.length;
  $("#enCarrito").textContent = dinero(marcados.reduce((s, i) => s + i.precio, 0));
  Efectos.contar($("#total"), items.reduce((s, i) => s + i.precio, 0), { duracion: 600, prefijo: "$" });
  $("#anilloCarrito").style.setProperty("--valor", pct);
  $("#pctCarrito").textContent = `${pct}%`;
  $("#textoCarrito").textContent = !items.length ? "Nada que comprar." : pct === 100 ? "¡Todo listo! Ya puedes pagar." : `Te faltan ${items.length - marcados.length} de ${items.length} cosas.`;
  $("#btnTerminar").disabled = marcados.length === 0;

  $("#yaTienes").innerHTML = suficiente.map((p) => `<a class="badge badge-ok" href="inventario.html?id=${p.id}"><i class="fa-solid ${p.icono}"></i> ${esc(p.nombre)} · ${p.estado.pct}%</a>`).join("")
    || '<span class="texto-suave texto-chico">Nada por ahora.</span>';

  if (animar) { $("#ticket").classList.remove("nuevo"); void $("#ticket").offsetWidth; $("#ticket").classList.add("nuevo"); }
}

// ---------- Marcar ----------
$("#grupos").addEventListener("change", (e) => {
  if (e.target.type !== "checkbox") return;
  const fila = e.target.closest(".renglon");
  fila.classList.toggle("comprado", e.target.checked);
  Sonido.tocar(e.target.checked ? "marcar" : "suave");
  QHDC.marcarComprado(fila.dataset.clave, e.target.checked);
  setTimeout(dibujar, 380);
});

// ---------- Quitar ----------
$("#grupos").addEventListener("click", (e) => {
  if (!e.target.closest("[data-quitar]")) return;
  const fila = e.target.closest(".renglon");
  fila.classList.add("sale");
  Sonido.borrar();
  setTimeout(() => { QHDC.eliminarExtra(fila.dataset.clave); dibujar(); }, 280);
});

// ---------- Anotar ----------
$("#formAnotar").addEventListener("submit", (e) => {
  e.preventDefault();
  const nombre = $("#nuevo").value.trim();
  if (!nombre) { $("#nuevo").classList.remove("invalido"); void $("#nuevo").offsetWidth; $("#nuevo").classList.add("invalido"); return; }
  QHDC.agregarExtra(nombre, "1", 0);
  $("#nuevo").value = "";
  Sonido.pop();
  dibujar();
});

// ---------- Terminar compra ----------
$("#btnTerminar").addEventListener("click", () => {
  const ticket = $("#ticket");
  ticket.classList.add("imprimiendo");
  Sonido.exito();
  Efectos.confeti(innerWidth / 2, innerHeight * 0.6);
  setTimeout(() => {
    const n = QHDC.finalizarCompra();
    ticket.classList.remove("imprimiendo");
    dibujar(true);
    UI.actualizarContadores();
    toast(`¡Compra lista! Actualizamos ${n} ${n === 1 ? "cosa" : "cosas"} en tu alacena`, { icono: "fa-bag-shopping" });
  }, 900);
});

$("#btnImprimir").addEventListener("click", () => window.print());

dibujar();
if (new URLSearchParams(location.search).get("anotar")) setTimeout(() => $("#nuevo").focus(), 300);

// ============================================================
//  RECORRIDO DE ESTA PANTALLA
// ============================================================
UI.registrarRecorrido([
  { sel: ".ticket-cab", titulo: "Tu lista del súper", texto: "Se arma sola con lo que se te está acabando, lo que caducó y lo que vas a necesitar pronto." },
  { sel: "#formAnotar", titulo: "Anota algo más", texto: "¿Te falta algo que no registramos? Escríbelo aquí y presiona +." },
  { sel: "#grupos .grupo h3", titulo: "Por prioridad", texto: "Primero lo urgente, luego lo que necesitarás pronto y al final lo que tú anotaste." },
  { sel: "#grupos .renglon .casilla", titulo: "Al carrito", texto: "Mientras compras, toca la casilla y el producto se tacha." },
  { sel: "#grupos .renglon .info", titulo: "¿Por qué está aquí?", texto: "Debajo de cada producto te decimos cuánto comprar y por qué lo agregamos." },
  { sel: "#grupos .renglon .precio", titulo: "Precio aproximado", texto: "Lo que suele costar, para que sepas cuánto llevar." },
  { sel: "#grupos .renglon .quitar", titulo: "Quitar", texto: "Lo que tú anotaste se puede quitar con esta X." },
  { sel: ".ticket-pie", titulo: "Totales", texto: "Cuántos artículos son, cuánto llevas en el carrito y el total aproximado." },
  { sel: "#btnTerminar", titulo: "Terminé de comprar", texto: "Al tocarlo, lo que marcaste se rellena solo en tu alacena." },
  { sel: "#btnImprimir", titulo: "Imprimir", texto: "Si prefieres llevarla en papel, imprime solo la lista." },
  { sel: ".carrito", titulo: "Tu avance", texto: "El anillo se llena conforme marcas productos." },
  { sel: "#yaTienes", titulo: "No lo compres", texto: "Esto ya lo tienes de sobra en casa. Así evitas comprar repetido." },
]);
