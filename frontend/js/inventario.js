// ============================================================
//  QHDC! — Mi alacena (inventario.html)
//  HU-01 Registro de alimentos · HU-02 Consulta de cantidades
//  HU-04 Fechas de caducidad
//
//  Vista de "frascos" (cuánto queda de un vistazo) o de lista.
//  Al tocar un alimento se abre un panel con botones + / − para
//  registrar lo que se usa sin escribir nada.
// ============================================================

const { $, $$, esc, frasco, iconoProducto, badgeCaducidad, badgeStock, barra, toast, abrirModal, cerrarModal } = UI;

const filtros = { texto: "", ubicacion: "", orden: "caducidad", vista: Pref.leer("qhdc_vista_alacena", "frascos") };
const UBICACION = {
  Refrigerador: { icono: "fa-snowflake", color: "ico-petroleo" },
  Despensa: { icono: "fa-box-archive", color: "ico-mostaza" },
  Congelador: { icono: "fa-icicles", color: "ico-cafe" },
};
const ORIGEN = { sensor: ["fa-tower-broadcast", "Lo mide un sensor"], camara: ["fa-camera", "Agregado con la cámara"], manual: ["fa-hand-pointer", "Agregado a mano"] };
// Color de fondo que acompaña a cada icono
const COLOR_ICONO = {
  "fa-bowl-rice": "cafe", "fa-wheat-awn": "mostaza", "fa-jar": "cafe", "fa-bread-slice": "mostaza", "fa-glass-water": "petroleo",
  "fa-cheese": "mostaza", "fa-egg": "mostaza", "fa-drumstick-bite": "tomate", "fa-fish": "petroleo", "fa-carrot": "tomate",
  "fa-leaf": "oliva", "fa-pepper-hot": "oliva", "fa-apple-whole": "tomate", "fa-lemon": "oliva", "fa-mug-hot": "cafe",
  "fa-bottle-water": "petroleo", "fa-cookie": "mostaza", "fa-box-open": "cafe",
};

// ============================================================
//  DIBUJAR LA ALACENA
// ============================================================
function listaFiltrada() {
  const t = UI.normalizar(filtros.texto);
  const lista = QHDC.productos().filter((p) =>
    (!t || UI.normalizar(p.nombre).includes(t) || UI.normalizar(p.categoria).includes(t)) &&
    (!filtros.ubicacion || p.ubicacion === filtros.ubicacion));
  if (filtros.orden === "nombre") lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (filtros.orden === "caducidad") lista.sort((a, b) => a.estado.dias - b.estado.dias);
  if (filtros.orden === "cantidad") lista.sort((a, b) => a.estado.pct - b.estado.pct);
  return lista;
}

function dibujar(resaltar, animar = true) {
  const todos = QHDC.productos();
  const atencion = todos.filter((p) => ["caducado", "urgente"].includes(p.estado.cad) || p.estado.nivel === "bajo").length;
  $("#resumen").textContent = `${todos.length} alimentos${atencion ? ` · ${atencion} necesitan atención` : " · todo en orden"}`;

  const lista = listaFiltrada();
  $("#sinResultados").classList.toggle("oculto", lista.length > 0);
  $("#alacena").innerHTML = filtros.vista === "frascos" ? vistaFrascos(lista) : vistaLista(lista);
  if (animar) Efectos.escalonar($("#alacena"));

  if (resaltar) {
    const el = $(`[data-id="${resaltar}"]`);
    if (el) { el.classList.add("resaltado"); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }
}

function vistaFrascos(lista) {
  return Object.keys(UBICACION).map((ub) => {
    const deAqui = lista.filter((p) => p.ubicacion === ub);
    if (!deAqui.length) return "";
    return `
      <section class="repisa">
        <div class="repisa-cab">
          <span class="prod-icono ${UBICACION[ub].color}"><i class="fa-solid ${UBICACION[ub].icono}"></i></span>
          <h2>${ub}</h2><span class="badge">${deAqui.length}</span>
        </div>
        <div class="frascos" data-escalonar>
          ${deAqui.map((p) => {
            const alerta = ["caducado", "urgente"].includes(p.estado.cad);
            return `
            <button class="item-frasco ${alerta ? "alerta" : ""}" type="button" data-id="${p.id}" data-sonido="abrir"
              aria-label="${esc(p.nombre)}, ${QHDC.formatoCantidad(p.cantidad, p.unidad)}, ${QHDC.textoCaducidad(p.estado.dias)}">
              <i class="fa-solid ${ORIGEN[p.origen][0]} origen" title="${ORIGEN[p.origen][1]}" aria-hidden="true"></i>
              ${frasco(p, 74)}
              <strong>${esc(p.nombre)}</strong>
              <span class="cant">${QHDC.formatoCantidad(p.cantidad, p.unidad)}</span>
              ${badgeCaducidad(p.estado)}
            </button>`;
          }).join("")}
        </div>
      </section>`;
  }).join("");
}

function vistaLista(lista) {
  if (!lista.length) return "";
  return `
    <section class="tarjeta">
      <div class="tabla-wrap">
        <table class="tabla lista-tabla">
          <thead><tr><th>Alimento</th><th>Lugar</th><th>Cantidad</th><th>Caducidad</th></tr></thead>
          <tbody>
            ${lista.map((p) => `
              <tr data-id="${p.id}" tabindex="0">
                <td><div class="celda-prod">${iconoProducto(p)}<div><strong>${esc(p.nombre)}</strong><small>${esc(p.categoria)}</small></div></div></td>
                <td><i class="fa-solid ${UBICACION[p.ubicacion].icono} texto-suave"></i> ${p.ubicacion}</td>
                <td class="celda-cant"><b>${QHDC.formatoCantidad(p.cantidad, p.unidad)}</b>${barra(p.estado)}</td>
                <td>${badgeCaducidad(p.estado)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>`;
}

// ============================================================
//  PANEL DE DETALLE (+ / −)
// ============================================================
let abiertoId = null;

function abrirDetalle(id) {
  const p = QHDC.producto(id);
  if (!p) return;
  abiertoId = p.id;
  const paso = QHDC.paso(p);
  const cuerpo = UI.abrirPanel(`
    <div class="detalle">
      <div id="detFrasco">${frasco(p, 120)}</div>
      <h2>${esc(p.nombre)}</h2>
      <p class="sub"><i class="fa-solid ${UBICACION[p.ubicacion].icono}"></i> ${p.ubicacion} · ${esc(p.categoria)}</p>

      <div class="contador-cant">
        <button class="btn-icono con-borde" data-cambio="-1" type="button" aria-label="Usé ${QHDC.formatoCantidad(paso, p.unidad)}" data-sonido="ninguno"><i class="fa-solid fa-minus"></i></button>
        <output id="detCantidad" aria-live="polite">${QHDC.formatoCantidad(p.cantidad, p.unidad)}</output>
        <button class="btn-icono con-borde" data-cambio="1" type="button" aria-label="Agregar ${QHDC.formatoCantidad(paso, p.unidad)}" data-sonido="ninguno"><i class="fa-solid fa-plus"></i></button>
      </div>
      <p class="ayuda">Cada toque son ${QHDC.formatoCantidad(paso, p.unidad)}</p>

      <div class="detalle-datos">
        <div><small>Caducidad</small><strong>${UI.fecha(p.caducidad, { day: "numeric", month: "long" })}</strong><br>${badgeCaducidad(p.estado)}</div>
        <div><small>Existencia</small><strong id="detPct">${p.estado.pct}% lleno</strong><br><span id="detStock">${badgeStock(p.estado)}</span></div>
        <div><small>Te alcanza para</small><strong id="detDias">${p.estado.diasAgotar ?? "—"} días</strong></div>
        <div><small>Origen</small><strong><i class="fa-solid ${ORIGEN[p.origen][0]}"></i> ${ORIGEN[p.origen][1].replace("Agregado ", "")}</strong></div>
      </div>

      <div class="detalle-acciones">
        <button class="btn btn-oliva btn-bloque" data-accion="rellenar" type="button" data-sonido="ninguno"><i class="fa-solid fa-fill-drip"></i> Lo volví a comprar</button>
        <button class="btn" data-accion="editar" type="button"><i class="fa-solid fa-pen"></i> Editar</button>
        <button class="btn btn-peligro" data-accion="eliminar" type="button" data-sonido="ninguno"><i class="fa-solid fa-trash"></i> Quitar</button>
      </div>
    </div>`);

  cuerpo.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.cambio) cambiarCantidad(Number(b.dataset.cambio) * paso);
    if (b.dataset.accion === "rellenar") {
      QHDC.rellenar(abiertoId);
      Sonido.exito();
      toast(`${p.nombre} está lleno otra vez`, { icono: "fa-fill-drip" });
      refrescar();
    }
    if (b.dataset.accion === "editar") { UI.cerrarPanel(); abrirFormulario(QHDC.producto(abiertoId)); }
    if (b.dataset.accion === "eliminar") eliminar(abiertoId);
  };
}

function cambiarCantidad(delta) {
  const p = QHDC.ajustar(abiertoId, delta);
  Sonido.tocar(delta < 0 ? "bajar" : "subir");
  const f = $("#detFrasco .frasco");
  f.style.setProperty("--nivel", p.estado.pct + "%");
  f.className = `frasco ${p.estado.pct === 0 ? "vacio" : p.estado.nivel === "ok" ? "" : p.estado.nivel}`;
  $("#detCantidad").textContent = QHDC.formatoCantidad(p.cantidad, p.unidad);
  $("#detPct").textContent = `${p.estado.pct}% lleno`;
  $("#detStock").innerHTML = badgeStock(p.estado);
  $("#detDias").textContent = `${p.estado.diasAgotar ?? "—"} días`;
  dibujar(null, false);
  UI.actualizarContadores();
  if (p.cantidad === 0) {
    // Al llegar a 0 entra solo a la lista del súper
    toast(`Se acabó ${p.nombre.toLowerCase()}: ya está en tu lista`, {
      icono: "fa-cart-plus", sonido: "alerta", duracion: 5000,
      accion: { texto: "Ver lista", fn: () => (location.href = "lista-compras.html") },
    });
  }
}

function refrescar() {
  if (abiertoId && QHDC.producto(abiertoId)) abrirDetalle(abiertoId);
  dibujar(null, false);
  UI.actualizarContadores();
}

function eliminar(id) {
  const borrado = QHDC.eliminarProducto(id);
  UI.cerrarPanel();
  Sonido.borrar();
  dibujar();
  UI.actualizarContadores();
  toast(`${borrado.nombre} se quitó de la alacena`, {
    icono: "fa-trash", duracion: 6000,
    accion: { texto: "Deshacer", fn: () => { QHDC.restaurarProducto(borrado); Sonido.pop(); dibujar(borrado.id); UI.actualizarContadores(); } },
  });
}

// Clic en un frasco o una fila
$("#alacena").addEventListener("click", (e) => {
  const el = e.target.closest("[data-id]");
  if (el) abrirDetalle(el.dataset.id);
});
$("#alacena").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("tr[data-id]")) abrirDetalle(e.target.dataset.id);
});

// ============================================================
//  FILTROS
// ============================================================
$("#buscar").addEventListener("input", (e) => { filtros.texto = e.target.value; dibujar(); });
$("#orden").addEventListener("change", (e) => { filtros.orden = e.target.value; dibujar(); });

function grupoBotones(cont, clave, alCambiar) {
  cont.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $$("button", cont).forEach((x) => x.setAttribute("aria-pressed", x === b));
    alCambiar(b.dataset[clave]);
  });
}
grupoBotones($("#filtroUbicacion"), "ubicacion", (v) => { filtros.ubicacion = v; dibujar(); });
grupoBotones($("#vista"), "vista", (v) => { filtros.vista = v; Pref.guardar("qhdc_vista_alacena", v); dibujar(); });
$$("#vista button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.vista === filtros.vista));

// ============================================================
//  FORMULARIO
// ============================================================
const form = $("#formProducto");
const SUGERIDOS = [
  ...QHDC.detectarAlimentos.catalogo(),
  { nombre: "Arroz", categoria: "Granos y cereales", icono: "fa-bowl-rice", unidad: "g", cantidad: 1000, vida: 365, precio: 32 },
  { nombre: "Pan de caja", categoria: "Granos y cereales", icono: "fa-bread-slice", unidad: "pz", cantidad: 1, vida: 8, precio: 48 },
  { nombre: "Café", categoria: "Bebidas", icono: "fa-mug-hot", unidad: "g", cantidad: 400, vida: 180, precio: 95 },
];

function llenarSelect(sel, opciones) { sel.innerHTML = opciones.map((o) => `<option>${o}</option>`).join(""); }
llenarSelect($("#fCategoria"), QHDC.CATEGORIAS);
llenarSelect($("#fUbicacion"), QHDC.UBICACIONES);
llenarSelect($("#fUnidad"), QHDC.UNIDADES);

$("#selectorIconos").innerHTML = QHDC.ICONOS.map((i) =>
  `<button type="button" role="radio" aria-checked="false" data-icono="${i.clase}" aria-label="${i.nombre}" title="${i.nombre}" data-sonido="suave"><i class="fa-solid ${i.clase}"></i></button>`).join("");

function elegirIcono(clase) {
  $("#fIcono").value = clase;
  $("#fColor").value = COLOR_ICONO[clase] || "cafe";
  $$("#selectorIconos button").forEach((b) => b.setAttribute("aria-checked", b.dataset.icono === clase));
  $("#vistaPrevia").innerHTML = `<span class="prod-icono ico-${$("#fColor").value} cambio"><i class="fa-solid ${clase}"></i></span>`;
}
$("#selectorIconos").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) elegirIcono(b.dataset.icono); });

$("#sugerencias").innerHTML = SUGERIDOS.map((s, i) => `<button type="button" class="chip" data-s="${i}" data-sonido="pop"><i class="fa-solid ${s.icono}"></i> ${s.nombre}</button>`).join("");
$("#sugerencias").addEventListener("click", (e) => {
  const b = e.target.closest("[data-s]");
  if (!b) return;
  const s = SUGERIDOS[b.dataset.s];
  form.elements.nombre.value = s.nombre;
  form.elements.categoria.value = s.categoria;
  form.elements.unidad.value = s.unidad;
  form.elements.cantidad.value = s.cantidad;
  form.elements.capacidad.value = s.cantidad;
  form.elements.caducidad.value = QHDC.enDias(s.vida);
  form.elements.precio.value = s.precio;
  form.elements.ubicacion.value = s.categoria === "Granos y cereales" || s.categoria === "Bebidas" ? "Despensa" : "Refrigerador";
  elegirIcono(s.icono);
});

function abrirFormulario(p, nombre = "") {
  form.reset();
  $("#errorProducto").classList.add("oculto");
  $("#tituloModal").textContent = p ? `Editar ${p.nombre.toLowerCase()}` : "Agregar alimento";
  $("#sugerencias").classList.toggle("oculto", !!p);
  const v = p || { id: "", nombre, categoria: QHDC.CATEGORIAS[0], ubicacion: "Refrigerador", unidad: "pz", caducidad: QHDC.enDias(7), aviso: 3, icono: "fa-box-open" };
  ["id", "nombre", "categoria", "ubicacion", "cantidad", "unidad", "capacidad", "caducidad", "aviso", "precio"].forEach((k) => {
    if (v[k] !== undefined) form.elements[k].value = v[k];
  });
  elegirIcono(v.icono);
  abrirModal("modalProducto");
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form));
  const error = (texto, campo) => {
    $("#errorProducto").innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${texto}`;
    $("#errorProducto").classList.remove("oculto");
    if (campo) { form.elements[campo].classList.remove("invalido"); void form.offsetWidth; form.elements[campo].classList.add("invalido"); form.elements[campo].focus(); }
    Sonido.alerta();
  };
  if (!d.nombre.trim()) return error("Escribe el nombre del alimento.", "nombre");
  if (d.cantidad === "" || Number(d.cantidad) < 0) return error("¿Cuánto tienes? Escribe la cantidad.", "cantidad");
  if (!d.caducidad) return error("Elige la fecha de caducidad para poder avisarte.", "caducidad");
  if (!d.capacidad || Number(d.capacidad) < Number(d.cantidad)) d.capacidad = d.cantidad;

  const nuevo = !d.id;
  const g = QHDC.guardarProducto(d);
  cerrarModal("modalProducto");
  Sonido.exito();
  dibujar(g.id);
  UI.actualizarContadores();
  toast(nuevo ? `${g.nombre} ya está en tu alacena` : `${g.nombre} actualizado`, { icono: "fa-jar" });
  if (nuevo) Efectos.confeti(innerWidth / 2, innerHeight / 3);
});

$("#btnAgregar").addEventListener("click", () => abrirFormulario());
$("#btnAgregarBuscado").addEventListener("click", () => abrirFormulario(null, filtros.texto));

// ============================================================
//  ARRANQUE (?id=5 abre ese alimento · ?nuevo=1 abre el formulario)
// ============================================================
const params = new URLSearchParams(location.search);
const idInicial = Number(params.get("id"));
dibujar(idInicial || null);
if (idInicial) setTimeout(() => abrirDetalle(idInicial), 500);
if (params.get("nuevo")) setTimeout(() => abrirFormulario(), 300);

// ============================================================
//  RECORRIDO DE ESTA PANTALLA
// ============================================================
const primerAlimento = () => $("#alacena [data-id]");
UI.registrarRecorrido([
  { sel: ".topbar-titulo", titulo: "Tu alacena", texto: "Aquí está todo lo que hay en tu cocina. Debajo del título te decimos cuántos alimentos necesitan atención." },
  { sel: ".buscador", titulo: "Buscar", texto: "Escribe el nombre o el tipo de alimento y la alacena se filtra al instante." },
  { sel: "#filtroUbicacion", titulo: "¿Dónde está?", texto: "Muestra solo lo del refri, la despensa o el congelador." },
  { sel: "#orden", titulo: "Ordenar", texto: "Elige ver primero lo que caduca antes, lo que se está acabando o por nombre." },
  { sel: "#vista", titulo: "Frascos o lista", texto: "Cambia entre la vista de frascos y una lista compacta. Recordamos la que prefieras." },
  { sel: "#btnAgregar", titulo: "Agregar alimento", texto: "Registra algo nuevo. En celular lo encuentras en el botón + de abajo." },
  { sel: ".repisa-cab", titulo: "Repisas", texto: "Tus alimentos se acomodan por lugar, como en tu cocina real. El número dice cuántos hay en cada repisa." },
  { sel: primerAlimento, titulo: "Un frasco = un alimento", texto: "Entre más lleno, más te queda. Verde es suficiente, amarillo a la mitad y rojo queda poco." },
  { sel: () => $("#alacena .item-frasco .badge"), titulo: "Su caducidad", texto: "La etiqueta dice cuándo caduca. Roja si es hoy o mañana, amarilla si es pronto y verde si hay tiempo." },
  { sel: () => $("#alacena .item-frasco .origen"), titulo: "¿Cómo llegó?", texto: "El icono de la esquina dice si lo mide un sensor, si lo agregaste con la cámara o a mano." },
  { sel: () => $("#alacena .item-frasco.alerta"), titulo: "¡Atención!", texto: "El signo de exclamación marca lo que caduca hoy, mañana o que ya caducó." },
  { sel: "#detFrasco", estado: "panel", titulo: "El detalle", texto: "Al tocar un frasco se abre este panel con todo lo de ese alimento." },
  { sel: ".contador-cant", estado: "panel", titulo: "Usa los botones + y −", texto: "Cuando uses un poco, toca −. Si compras más, toca +. No hay que escribir nada." },
  { sel: ".detalle-datos", estado: "panel", titulo: "Datos clave", texto: "Cuándo caduca, qué tan lleno está, cuántos días te alcanza y de dónde vino el dato." },
  { sel: '[data-accion="rellenar"]', estado: "panel", titulo: "Lo volví a comprar", texto: "Un toque y el frasco vuelve a estar lleno." },
  { sel: '[data-accion="editar"]', estado: "panel", titulo: "Editar", texto: "Cambia el nombre, la cantidad, la fecha o el icono." },
  { sel: '[data-accion="eliminar"]', estado: "panel", titulo: "Quitar", texto: "Lo saca de tu alacena. Si fue un error, aparece un botón para deshacerlo." },
  { sel: "#sugerencias", estado: "form", titulo: "Agregar en un toque", texto: "Toca un alimento frecuente y llenamos casi todo el formulario por ti." },
  { sel: () => $("#fNombre").closest(".form-cabeza"), estado: "form", titulo: "¿Qué alimento es?", texto: "Escribe su nombre. A la izquierda ves cómo se verá su icono." },
  { sel: () => $("#fUbicacion").closest(".campos-2"), estado: "form", titulo: "Lugar y tipo", texto: "Dónde lo guardas y qué tipo de alimento es." },
  { sel: () => $("#fCantidad").closest(".campos-3"), estado: "form", titulo: "Cantidad", texto: "Cuánto tienes, en qué unidad y cuánto es «lleno» para calcular el nivel del frasco." },
  { sel: () => $("#fCaducidad").closest(".campos-2"), estado: "form", titulo: "Caducidad y aviso", texto: "La fecha en que caduca y con cuántos días de anticipación quieres que te avisemos." },
  { sel: "#selectorIconos", estado: "form", titulo: "Elige un icono", texto: "Así lo reconoces de un vistazo en tu alacena." },
  { sel: () => $("#fPrecio").closest(".campo"), estado: "form", titulo: "Precio", texto: "Opcional. Sirve para calcular cuánto gastarás en el súper." },
  { sel: '#formProducto button[type="submit"]', estado: "form", titulo: "Guardar", texto: "¡Y listo! Tu alimento aparece en su repisa." },
], {
  base: () => { UI.cerrarPanel(); cerrarModal("modalProducto"); },
  estados: {
    panel: () => { const el = primerAlimento(); if (el) abrirDetalle(el.dataset.id); },
    form: () => abrirFormulario(),
  },
});
