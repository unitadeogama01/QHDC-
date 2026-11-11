// ============================================================
//  QHDC! — Avisos (alertas.html)
//  HU-04 Avisos antes de que los alimentos caduquen.
//  Cada aviso es una nota pegada al refri; al marcarla como
//  vista se "despega" y pasa a la sección de vistos.
// ============================================================

const { $, $$, esc, iconoProducto, toast } = UI;
let tipo = "";

function acciones(a) {
  if (a.tipo === "caducidad") return `
    <a class="btn btn-sm btn-principal" href="recetas.html"><i class="fa-solid fa-utensils"></i> Cocinar algo</a>
    <a class="btn btn-sm" href="inventario.html?id=${a.productoId}"><i class="fa-solid fa-jar"></i> Ver</a>`;
  if (a.tipo === "stock") return `<a class="btn btn-sm btn-mostaza" href="lista-compras.html"><i class="fa-solid fa-cart-shopping"></i> Ir a la lista</a>`;
  return `<a class="btn btn-sm" href="sensores.html"><i class="fa-solid fa-microchip"></i> Revisar</a>`;
}

function dibujar() {
  const todas = QHDC.alertas();
  const pendientes = todas.filter((a) => !a.leida);
  const vistas = todas.filter((a) => a.leida);

  $("#resumen").textContent = pendientes.length
    ? `${pendientes.length} ${pendientes.length === 1 ? "cosa necesita" : "cosas necesitan"} tu atención`
    : "Todo bajo control";
  $$("[data-num]").forEach((el) => {
    const n = pendientes.filter((a) => !el.dataset.num || a.tipo === el.dataset.num).length;
    el.textContent = n || "";
    el.classList.toggle("oculto", !n);
  });

  const visibles = pendientes.filter((a) => !tipo || a.tipo === tipo);
  $("#sinAvisos").classList.toggle("oculto", visibles.length > 0);
  $("#btnTodas").disabled = pendientes.length === 0;
  $("#tablero").innerHTML = visibles.map((a, i) => {
    const p = a.productoId ? QHDC.producto(a.productoId) : null;
    const giro = [-1.6, 1.2, -0.6, 1.8, -1.2, 0.8][i % 6];
    return `
      <article class="nota ${a.nivel}" data-id="${a.id}" style="--giro:${giro}deg">
        <button class="btn-icono listo" type="button" aria-label="Marcar como visto" title="Marcar como visto" data-sonido="ninguno"><i class="fa-solid fa-check"></i></button>
        <div class="nota-cab">
          ${p ? iconoProducto(p) : `<span class="prod-icono"><i class="fa-solid ${a.icono}"></i></span>`}
          <h3>${esc(a.titulo)}</h3>
        </div>
        <p>${esc(a.detalle)}</p>
        <div class="nota-acciones">${acciones(a)}</div>
      </article>`;
  }).join("");
  Efectos.escalonar(document);
  $$("#tablero .nota").forEach((n, i) => { n.style.setProperty("--i", i); n.classList.add("aparecer"); });

  $("#numVistos").textContent = vistas.length;
  $("#vistos").classList.toggle("oculto", vistas.length === 0);
  $("#listaVistos").innerHTML = vistas.map((a) => `
    <li data-id="${a.id}"><i class="fa-solid ${a.icono}"></i><span>${esc(a.titulo)}</span>
      <button class="btn btn-sm btn-fantasma" type="button" data-volver>Volver a mostrar</button></li>`).join("");

  dibujarSemana();
  UI.actualizarContadores();
}

// Lo que caduca en cada día de los próximos 7
function dibujarSemana() {
  const productos = QHDC.productos();
  $("#dias").innerHTML = Array.from({ length: 7 }, (_, d) => {
    const fecha = new Date(QHDC.enDias(d) + "T00:00:00");
    const cosas = productos.filter((p) => p.estado.dias === d || (d === 0 && p.estado.dias < 0));
    return `
      <li class="dia ${d === 0 ? "hoy" : ""}">
        <span class="nombre">${d === 0 ? "Hoy" : d === 1 ? "Mañana" : fecha.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", "")}</span>
        <span class="num">${fecha.getDate()}</span>
        <div class="cosas">
          ${cosas.length
            ? cosas.map((p) => `<a href="inventario.html?id=${p.id}" title="${esc(p.nombre)}" aria-label="${esc(p.nombre)}">${iconoProducto(p)}</a>`).join("")
            : '<span class="nada">Libre</span>'}
        </div>
      </li>`;
  }).join("");
}

// Marcar una nota como vista (se despega)
$("#tablero").addEventListener("click", (e) => {
  const b = e.target.closest(".listo");
  if (!b) return;
  const nota = b.closest(".nota");
  Sonido.marcar();
  nota.classList.add("despegando");
  setTimeout(() => {
    QHDC.marcarLeida(nota.dataset.id, true);
    dibujar();
    toast("Aviso marcado como visto", {
      icono: "fa-check", accion: { texto: "Deshacer", fn: () => { QHDC.marcarLeida(nota.dataset.id, false); Sonido.pop(); dibujar(); } },
    });
  }, 450);
});

$("#listaVistos").addEventListener("click", (e) => {
  if (!e.target.closest("[data-volver]")) return;
  QHDC.marcarLeida(e.target.closest("li").dataset.id, false);
  dibujar();
});

$("#btnTodas").addEventListener("click", () => {
  $$("#tablero .nota").forEach((n, i) => setTimeout(() => n.classList.add("despegando"), i * 60));
  Sonido.exito();
  setTimeout(() => {
    QHDC.alertas().forEach((a) => QHDC.marcarLeida(a.id, true));
    dibujar();
  }, 500 + $$("#tablero .nota").length * 60);
});

$("#filtros").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (!c) return;
  $$("#filtros .chip").forEach((x) => x.setAttribute("aria-pressed", x === c));
  tipo = c.dataset.tipo;
  dibujar();
});

dibujar();

// ============================================================
//  RECORRIDO DE ESTA PANTALLA
// ============================================================
UI.registrarRecorrido([
  { sel: ".topbar-titulo", titulo: "Tus avisos", texto: "Aquí te avisamos lo que necesita tu atención. Debajo del título ves cuántas cosas son." },
  { sel: ".semana", titulo: "Tu semana", texto: "Lo que caduca cada uno de los próximos 7 días, de un vistazo." },
  { sel: ".dia.hoy", titulo: "Hoy", texto: "El día de hoy está resaltado. Aquí también aparece lo que ya caducó." },
  { sel: () => $(".dia .cosas a"), titulo: "Toca un alimento", texto: "Cada icono es un alimento que caduca ese día. Tócalo para abrirlo en tu alacena." },
  { sel: "#filtros", titulo: "Filtra tus avisos", texto: "Ve solo los de caducidad, los de cosas que se acaban o los de tus dispositivos. El número rojo cuenta los pendientes." },
  { sel: "#btnTodas", titulo: "Todo visto", texto: "Si ya revisaste todo, márcalo de una vez." },
  { sel: "#tablero .nota", titulo: "Una nota en tu refri", texto: "Cada aviso es una nota. El color del imán dice qué tan urgente es: rojo urgente, amarillo pronto y azul para dispositivos." },
  { sel: "#tablero .nota .listo", titulo: "Marcar como visto", texto: "Toca la palomita y la nota se despega. Si te equivocas, puedes deshacerlo." },
  { sel: "#tablero .nota .nota-acciones", titulo: "Resuélvelo al momento", texto: "Cada nota trae lo que puedes hacer: cocinar algo, ver el alimento o ir a la lista." },
  { sel: "#vistos summary", titulo: "Ya vistos", texto: "Las notas que marcaste se guardan aquí. Puedes volver a mostrarlas cuando quieras." },
]);
