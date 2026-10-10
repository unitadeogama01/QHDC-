// ============================================================
//  QHDC! — ESTRUCTURA COMPARTIDA DE LA APP (páginas internas)
//
//  Dibuja y controla lo que se repite en todas las páginas:
//  menú lateral, barra superior, navegación inferior (celular),
//  botón de acciones rápidas (+), buscador con Ctrl+K, menú de
//  usuario, avisos con "Deshacer", ventanas, panel lateral y el
//  recorrido guiado. Las páginas usan todo a través del objeto UI.
//
//  Requiere: interaccion.js (Sonido, Efectos, Tema) y datos.js (QHDC)
// ============================================================

const UI = (() => {
  // ---------- Proteger la página ----------
  const sesion = QHDC.sesionActual();
  if (!sesion) {
    window.location.replace("login.html");
  }

  // ---------- Ayudas generales ----------
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const iniciales = (n) => String(n).split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  const normalizar = (t) => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  function fecha(iso, opciones = { day: "numeric", month: "short", year: "numeric" }) {
    const d = iso.length === 10 ? new Date(iso + "T00:00:00") : new Date(iso);
    return d.toLocaleDateString("es-MX", opciones);
  }
  const hora = (iso) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dinero = (n) => "$" + Number(n).toLocaleString("es-MX");

  // ---------- Piezas visuales reutilizables ----------
  const iconoProducto = (p) =>
    `<span class="prod-icono ico-${p.color || "cafe"}" aria-hidden="true"><i class="fa-solid ${p.icono || "fa-box-open"}"></i></span>`;

  // Frasco que se llena según el porcentaje que queda
  function frasco(p, tam = 70) {
    const e = p.estado;
    const clase = e.pct === 0 ? "vacio" : e.nivel === "ok" ? "" : e.nivel;
    return `
      <div class="frasco ${clase}" style="--t:${tam}px; --nivel:${Math.max(e.pct, 0)}%" role="img" aria-label="${esc(p.nombre)}: queda ${e.pct}%">
        <span class="tapa"></span>
        <span class="cuerpo"><span class="liquido"></span></span>
        <span class="icono"><i class="fa-solid ${p.icono}"></i></span>
      </div>`;
  }

  function badgeCaducidad(e) {
    const t = QHDC.textoCaducidad(e.dias);
    if (e.cad === "caducado") return `<span class="badge badge-peligro"><i class="fa-solid fa-skull-crossbones"></i> ${t}</span>`;
    if (e.cad === "urgente") return `<span class="badge badge-peligro"><i class="fa-solid fa-hourglass-end"></i> ${t}</span>`;
    if (e.cad === "pronto") return `<span class="badge badge-aviso"><i class="fa-solid fa-hourglass-half"></i> ${t}</span>`;
    return `<span class="badge badge-ok"><i class="fa-solid fa-leaf"></i> ${t}</span>`;
  }
  function badgeStock(e) {
    if (e.pct === 0) return `<span class="badge badge-peligro"><i class="fa-solid fa-circle-xmark"></i> Se acabó</span>`;
    if (e.nivel === "bajo") return `<span class="badge badge-peligro"><i class="fa-solid fa-arrow-trend-down"></i> Queda poco</span>`;
    if (e.nivel === "medio") return `<span class="badge badge-aviso"><i class="fa-solid fa-minus"></i> A la mitad</span>`;
    return `<span class="badge badge-ok"><i class="fa-solid fa-check"></i> Suficiente</span>`;
  }
  const barra = (e) => `<div class="barra"><span class="${e.nivel === "ok" ? "" : e.nivel}" style="width:${e.pct}%"></span></div>`;

  // ---------- Avisos con acción opcional (ej. Deshacer) ----------
  function toast(texto, { icono = "fa-circle-check", accion = null, duracion = 3200, sonido = null } = {}) {
    let cont = $("#avisos");
    if (!cont) {
      cont = document.createElement("div");
      cont.id = "avisos";
      cont.className = "avisos";
      cont.setAttribute("role", "status");
      cont.setAttribute("aria-live", "polite");
      document.body.appendChild(cont);
    }
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `<i class="fa-solid ${icono}" aria-hidden="true"></i><span>${esc(texto)}</span>
      ${accion ? `<button class="btn btn-mostaza btn-sm" type="button">${esc(accion.texto)}</button>` : ""}
      <span class="progreso" style="animation-duration:${duracion}ms"></span>`;
    cont.appendChild(t);
    if (sonido) Sonido.tocar(sonido);
    const quitar = () => { t.classList.add("sale"); setTimeout(() => t.remove(), 250); };
    const temporizador = setTimeout(quitar, duracion);
    if (accion) {
      t.querySelector("button").addEventListener("click", () => { clearTimeout(temporizador); accion.fn(); quitar(); });
    }
    while (cont.children.length > 3) cont.firstChild.remove();
  }

  // ---------- Ventanas modales ----------
  let ultimoFoco = null;
  function abrirModal(id) {
    const m = document.getElementById(id);
    ultimoFoco = document.activeElement;
    m.classList.add("abierto");
    m.setAttribute("aria-hidden", "false");
    Sonido.abrir();
    const campo = m.querySelector("input:not([type=hidden]), select, textarea, button");
    if (campo) setTimeout(() => campo.focus(), 80);
  }
  function cerrarModal(id) {
    const m = document.getElementById(id);
    if (!m.classList.contains("abierto")) return;
    m.classList.remove("abierto");
    m.setAttribute("aria-hidden", "true");
    Sonido.cerrar();
    if (ultimoFoco) ultimoFoco.focus();
  }

  // ---------- Panel lateral ----------
  function abrirPanel(html) {
    let fondo = $("#panelFondo");
    if (!fondo) {
      document.body.insertAdjacentHTML("beforeend", `
        <div class="panel-fondo" id="panelFondo"></div>
        <aside class="panel" id="panel" role="dialog" aria-modal="true" aria-label="Detalle">
          <div class="panel-cab"><button class="btn-icono con-borde" data-cerrar-panel aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button></div>
          <div class="panel-cuerpo" id="panelCuerpo"></div>
        </aside>`);
      fondo = $("#panelFondo");
      fondo.addEventListener("click", cerrarPanel);
      $("#panel [data-cerrar-panel]").addEventListener("click", cerrarPanel);
    }
    $("#panelCuerpo").innerHTML = html;
    if (!$("#panel").classList.contains("abierto")) Sonido.abrir();
    fondo.classList.add("abierto");
    $("#panel").classList.add("abierto");
    return $("#panelCuerpo");
  }
  function cerrarPanel() {
    const p = $("#panel");
    if (!p || !p.classList.contains("abierto")) return;
    p.classList.remove("abierto");
    $("#panelFondo").classList.remove("abierto");
    Sonido.cerrar();
  }

  // Cerrar ventanas con botón [data-cerrar] o clic en el fondo
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cerrar]");
    if (b) cerrarModal(b.closest(".modal").id);
    if (e.target.classList && e.target.classList.contains("modal")) cerrarModal(e.target.id);
  });

  if (!sesion) {
    return { sesion: null, $, $$, esc, iniciales, normalizar, fecha, hora, dinero, iconoProducto, frasco, badgeCaducidad, badgeStock, barra, toast, abrirModal, cerrarModal, abrirPanel, cerrarPanel, actualizarContadores() {}, tour() {}, registrarRecorrido() {}, iniciarRecorrido() {}, pasosGenerales: () => [] };
  }

  // ==========================================================
  //  MENÚ LATERAL
  // ==========================================================
  const MENU = [
    { grupo: "Mi cocina" },
    { pagina: "dashboard", url: "dashboard.html", icono: "fa-house-chimney", texto: "Inicio" },
    { pagina: "inventario", url: "inventario.html", icono: "fa-jar", texto: "Mi alacena" },
    { pagina: "alertas", url: "alertas.html", icono: "fa-bell", texto: "Avisos", contador: true },
    { pagina: "lista-compras", url: "lista-compras.html", icono: "fa-cart-shopping", texto: "Lista del súper" },
    { grupo: "Ayudantes" },
    { pagina: "asistente", url: "asistente.html", icono: "fa-robot", texto: "Asistente" },
    { pagina: "recetas", url: "recetas.html", icono: "fa-book-open", texto: "Recetas" },
    { pagina: "escanear", url: "escanear.html", icono: "fa-camera", texto: "Escanear" },
    { pagina: "sensores", url: "sensores.html", icono: "fa-microchip", texto: "Dispositivos" },
  ];
  const ACCIONES = [
    { texto: "Agregar alimento", icono: "fa-plus", color: "ico-tomate", url: "inventario.html?nuevo=1" },
    { texto: "Escanear con cámara", icono: "fa-camera", color: "ico-petroleo", url: "escanear.html" },
    { texto: "Anotar en la lista", icono: "fa-cart-plus", color: "ico-mostaza", url: "lista-compras.html?anotar=1" },
    { texto: "¿Qué cocino hoy?", icono: "fa-dice", color: "ico-oliva", url: "dashboard.html?ruleta=1" },
  ];
  const actual = document.body.dataset.pagina;

  function dibujarMenu() {
    const aside = $("#sidebar");
    if (!aside) return;
    aside.innerHTML = `
      <div class="sidebar-cab">
        <a href="dashboard.html" class="logo" aria-label="QHDC! inicio">
          <img src="img/LOGO.png" alt="" class="logo-img">
          <span class="logo-texto">QHDC!</span>
        </a>
        <button class="btn-icono con-borde" id="btnColapsar" type="button" aria-controls="sidebar" data-sonido="suave">
          <i class="fa-solid fa-angles-left solo-escritorio"></i><i class="fa-solid fa-xmark solo-movil"></i>
        </button>
      </div>
      <nav class="menu" aria-label="Secciones">
        ${MENU.map((m) => m.grupo
          ? `<p class="menu-grupo">${m.grupo}</p>`
          : `<a href="${m.url}" data-texto="${m.texto}" ${m.pagina === actual ? 'aria-current="page"' : ""}>
               <span class="ico"><i class="fa-solid ${m.icono}"></i></span> <span class="texto">${m.texto}</span>
               ${m.contador ? '<span class="contador oculto" data-contador></span>' : ""}
             </a>`).join("")}
      </nav>
      <div class="sidebar-hogar" title="${esc(sesion.hogar)}">
        <span class="avatar" style="background:var(--oliva)"><i class="fa-solid fa-house"></i></span>
        <div><strong>${esc(sesion.hogar)}</strong><small>${QHDC.sensores().length} dispositivos · ${QHDC.productos().length} alimentos</small></div>
      </div>`;
    $("#btnColapsar").addEventListener("click", () => {
      if (window.innerWidth <= 900) return cerrarCajon();
      aplicarCompacto(!document.querySelector(".app").classList.contains("menu-compacto"), true);
    });
    aplicarCompacto(Pref.leer("qhdc_menu_compacto", "0") === "1", false);
  }

  // Menú encogido (solo iconos) o extendido; se recuerda la preferencia
  function aplicarCompacto(compacto, guardar) {
    const app = document.querySelector(".app");
    if (!app) return;
    app.classList.toggle("menu-compacto", compacto);
    const b = $("#btnColapsar");
    if (b) {
      const texto = window.innerWidth <= 900 ? "Cerrar menú" : compacto ? "Mostrar el menú completo" : "Encoger el menú";
      b.setAttribute("aria-label", texto);
      b.title = texto;
      b.setAttribute("aria-expanded", !compacto);
    }
    if (guardar) Pref.guardar("qhdc_menu_compacto", compacto ? "1" : "0");
  }

  // ==========================================================
  //  BARRA SUPERIOR
  // ==========================================================
  function dibujarAcciones() {
    const cont = $("#topbarAcciones");
    if (!cont) return;
    cont.innerHTML = `
      <button class="buscar-rapido ocultar-movil" id="btnBuscar" type="button" aria-label="Buscar (Ctrl + K)">
        <i class="fa-solid fa-magnifying-glass"></i><span>Buscar…</span><kbd>Ctrl K</kbd>
      </button>
      <button class="btn-icono ocultar-escritorio" id="btnBuscarMovil" type="button" aria-label="Buscar"><i class="fa-solid fa-magnifying-glass"></i></button>
      <button class="btn-icono" id="btnAyuda" type="button" aria-label="Recorrido de esta pantalla" title="Recorrido de esta pantalla"><i class="fa-solid fa-circle-question"></i></button>
      <button class="btn-icono ocultable" id="btnSonido" type="button" data-sonido="ninguno"></button>
      <button class="btn-icono ocultable" id="btnTema" type="button"></button>
      <a href="alertas.html" class="btn-icono campana" id="campana" aria-label="Avisos"><i class="fa-solid fa-bell"></i><span class="punto oculto" data-contador></span></a>
      <button class="boton-avatar" id="btnAvatar" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Menú de ${esc(sesion.nombre)}">
        <span class="avatar">${esc(iniciales(sesion.nombre))}</span>
      </button>`;
    if (window.innerWidth > 900) $("#btnBuscarMovil").classList.add("oculto");
    $("#btnBuscar").addEventListener("click", abrirPaleta);
    $("#btnBuscarMovil").addEventListener("click", abrirPaleta);
    $("#btnSonido").addEventListener("click", () => Sonido.alternar());
    $("#btnTema").addEventListener("click", () => Tema.alternar());
    $("#btnAvatar").addEventListener("click", alternarMenuUsuario);
    $("#btnAyuda").addEventListener("click", iniciarRecorrido);
    pintarIconosPreferencias();
  }

  function pintarIconosPreferencias() {
    const s = $("#btnSonido"), t = $("#btnTema");
    if (s) {
      s.innerHTML = `<i class="fa-solid ${Sonido.activo() ? "fa-volume-high" : "fa-volume-xmark"}"></i>`;
      s.setAttribute("aria-label", Sonido.activo() ? "Silenciar sonidos" : "Activar sonidos");
      s.title = s.getAttribute("aria-label");
    }
    if (t) {
      const oscuro = Tema.actual() === "oscuro";
      t.innerHTML = `<i class="fa-solid ${oscuro ? "fa-sun" : "fa-moon"}"></i>`;
      t.setAttribute("aria-label", oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
      t.title = t.getAttribute("aria-label");
    }
    $$("#menuUsuario input[data-pref]").forEach((i) => { i.checked = i.dataset.pref === "sonido" ? Sonido.activo() : Tema.actual() === "oscuro"; });
  }
  document.addEventListener("sonido", pintarIconosPreferencias);
  document.addEventListener("tema", pintarIconosPreferencias);

  // Contadores de avisos (menú y campana)
  let pendientesAntes = null;
  function actualizarContadores() {
    const n = QHDC.alertasPendientes();
    $$("[data-contador]").forEach((el) => { el.textContent = n; el.classList.toggle("oculto", n === 0); });
    if (pendientesAntes !== null && n > pendientesAntes) {
      const c = $("#campana");
      if (c) { c.classList.remove("sonando"); void c.offsetWidth; c.classList.add("sonando"); }
      Sonido.alerta();
    }
    pendientesAntes = n;
  }

  // ==========================================================
  //  MENÚ DE USUARIO
  // ==========================================================
  function cerrarMenuUsuario() {
    const m = $("#menuUsuario");
    if (m) { m.remove(); $("#btnAvatar").setAttribute("aria-expanded", "false"); }
  }
  function alternarMenuUsuario(e) {
    e.stopPropagation();
    if ($("#menuUsuario")) return cerrarMenuUsuario();
    const r = $("#btnAvatar").getBoundingClientRect();
    document.body.insertAdjacentHTML("beforeend", `
      <div class="menu-usuario" id="menuUsuario" role="menu" style="top:${r.bottom + 10}px; right:${Math.max(12, innerWidth - r.right)}px">
        <div class="cabeza">
          <span class="avatar">${esc(iniciales(sesion.nombre))}</span>
          <div><strong>${esc(sesion.nombre)}</strong><small>${esc(sesion.rol)} · ${esc(sesion.hogar)}</small></div>
        </div>
        <label class="opcion" role="menuitemcheckbox"><i class="fa-solid fa-moon"></i> Tema oscuro
          <span class="interruptor"><input type="checkbox" data-pref="tema"><span class="riel"></span></span></label>
        <label class="opcion" role="menuitemcheckbox"><i class="fa-solid fa-volume-high"></i> Sonidos
          <span class="interruptor"><input type="checkbox" data-pref="sonido"><span class="riel"></span></span></label>
        <button class="opcion" role="menuitem" id="btnRecorrido" type="button"><i class="fa-solid fa-route"></i> Recorrido de esta pantalla</button>
        <button class="opcion" role="menuitem" id="btnRestablecer" type="button"><i class="fa-solid fa-rotate-left"></i> Restablecer datos</button>
        <button class="opcion peligro" role="menuitem" id="btnSalir" type="button" data-sonido="cerrar"><i class="fa-solid fa-right-from-bracket"></i> Cerrar sesión</button>
      </div>`);
    $("#btnAvatar").setAttribute("aria-expanded", "true");
    Sonido.abrir();
    pintarIconosPreferencias();
    const menu = $("#menuUsuario");
    menu.addEventListener("click", (ev) => ev.stopPropagation());
    $('[data-pref="tema"]', menu).addEventListener("change", () => Tema.alternar());
    $('[data-pref="sonido"]', menu).addEventListener("change", () => Sonido.alternar());
    $("#btnSalir").addEventListener("click", () => { QHDC.cerrarSesion(); location.href = "login.html"; });
    $("#btnRecorrido").addEventListener("click", () => { cerrarMenuUsuario(); iniciarRecorrido(); });
    $("#btnRestablecer").addEventListener("click", () => {
      if (confirm("¿Restablecer la cocina a su estado inicial? Se perderán los cambios.")) { QHDC.reiniciar(); location.reload(); }
    });
  }
  document.addEventListener("click", cerrarMenuUsuario);

  // ==========================================================
  //  ACCIONES RÁPIDAS (+) Y NAVEGACIÓN INFERIOR
  // ==========================================================
  function dibujarAccionesRapidas() {
    document.body.insertAdjacentHTML("beforeend", `
      <button class="fab" id="fab" type="button" aria-expanded="false" aria-controls="accionesRapidas" aria-label="Acciones rápidas" data-sonido="pop">
        <i class="fa-solid fa-plus"></i>
      </button>
      <nav class="nav-inferior" aria-label="Navegación principal">
        <a href="dashboard.html" ${actual === "dashboard" ? 'aria-current="page"' : ""}><i class="fa-solid fa-house-chimney"></i>Inicio</a>
        <a href="inventario.html" ${actual === "inventario" ? 'aria-current="page"' : ""}><i class="fa-solid fa-jar"></i>Alacena</a>
        <button class="fab-movil" id="fabMovil" type="button" aria-expanded="false" aria-label="Acciones rápidas" data-sonido="pop"><i class="fa-solid fa-plus"></i></button>
        <a href="lista-compras.html" ${actual === "lista-compras" ? 'aria-current="page"' : ""}><i class="fa-solid fa-cart-shopping"></i>Lista</a>
        <button type="button" id="btnMas" aria-label="Más secciones"><i class="fa-solid fa-grip"></i>Más</button>
      </nav>`);

    const abrir = (movil) => {
      if ($("#accionesRapidas")) return cerrarAcciones();
      document.body.insertAdjacentHTML("beforeend", `
        <div class="velo-fab" id="veloFab"></div>
        <div class="acciones-rapidas ${movil ? "movil" : ""}" id="accionesRapidas">
          ${ACCIONES.map((a, i) => `<a href="${a.url}" style="--i:${ACCIONES.length - i}">${a.texto}<span class="ico ${a.color}"><i class="fa-solid ${a.icono}"></i></span></a>`).join("")}
        </div>`);
      $("#veloFab").addEventListener("click", cerrarAcciones);
      $("#fab").setAttribute("aria-expanded", "true");
      $("#fabMovil").setAttribute("aria-expanded", "true");
      $("#accionesRapidas a").focus();
    };
    $("#fab").addEventListener("click", () => abrir(false));
    $("#fabMovil").addEventListener("click", () => abrir(true));
    $("#btnMas").addEventListener("click", abrirCajon);
  }
  function cerrarAcciones() {
    const a = $("#accionesRapidas");
    if (!a) return;
    a.remove();
    $("#veloFab").remove();
    $("#fab").setAttribute("aria-expanded", "false");
    $("#fabMovil").setAttribute("aria-expanded", "false");
    Sonido.cerrar();
  }

  // Menú lateral como cajón en celular
  function abrirCajon() {
    $("#sidebar").classList.add("abierto");
    const velo = document.createElement("div");
    velo.className = "velo-menu";
    velo.id = "veloMenu";
    velo.addEventListener("click", cerrarCajon);
    document.body.appendChild(velo);
    Sonido.abrir();
  }
  function cerrarCajon() {
    $("#sidebar").classList.remove("abierto");
    const v = $("#veloMenu");
    if (v) v.remove();
  }

  // ==========================================================
  //  BUSCADOR (Ctrl + K)
  // ==========================================================
  let resultados = [];
  let elegido = 0;

  function fuentesBusqueda() {
    const items = [];
    MENU.filter((m) => m.url).forEach((m) => items.push({ grupo: "Ir a", texto: m.texto, icono: m.icono, url: m.url }));
    ACCIONES.forEach((a) => items.push({ grupo: "Acciones", texto: a.texto, icono: a.icono, url: a.url }));
    items.push({ grupo: "Acciones", texto: Tema.actual() === "oscuro" ? "Usar tema claro" : "Usar tema oscuro", icono: "fa-circle-half-stroke", fn: () => Tema.alternar() });
    items.push({ grupo: "Acciones", texto: Sonido.activo() ? "Silenciar sonidos" : "Activar sonidos", icono: "fa-volume-high", fn: () => Sonido.alternar() });
    QHDC.productos().forEach((p) => items.push({ grupo: "Alimentos", texto: p.nombre, icono: p.icono, url: `inventario.html?id=${p.id}`, extra: QHDC.formatoCantidad(p.cantidad, p.unidad) }));
    QHDC.RECETAS.forEach((r) => items.push({ grupo: "Recetas", texto: r.nombre, icono: r.icono, url: `recetas.html?id=${r.id}`, extra: `${r.tiempo} min` }));
    return items;
  }

  function abrirPaleta() {
    if ($("#paleta")) return;
    cerrarAcciones();
    document.body.insertAdjacentHTML("beforeend", `
      <div class="paleta-fondo" id="paleta">
        <div class="paleta" role="dialog" aria-modal="true" aria-label="Buscar">
          <div class="paleta-entrada">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input id="paletaTexto" placeholder="Busca un alimento, receta o sección…" autocomplete="off" aria-controls="paletaLista">
            <kbd>Esc</kbd>
          </div>
          <div class="paleta-lista" id="paletaLista" role="listbox"></div>
        </div>
      </div>`);
    Sonido.abrir();
    const entrada = $("#paletaTexto");
    entrada.addEventListener("input", () => { elegido = 0; filtrarPaleta(entrada.value); });
    entrada.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); elegido = Math.min(resultados.length - 1, elegido + 1); pintarPaleta(); Sonido.tic(); }
      if (e.key === "ArrowUp") { e.preventDefault(); elegido = Math.max(0, elegido - 1); pintarPaleta(); Sonido.tic(); }
      if (e.key === "Enter" && resultados[elegido]) ejecutar(resultados[elegido]);
    });
    $("#paleta").addEventListener("click", (e) => {
      if (e.target.id === "paleta") return cerrarPaleta();
      const it = e.target.closest("[data-i]");
      if (it) ejecutar(resultados[it.dataset.i]);
    });
    filtrarPaleta("");
    entrada.focus();
  }
  function filtrarPaleta(texto) {
    const t = normalizar(texto.trim());
    const todos = fuentesBusqueda();
    resultados = t ? todos.filter((i) => normalizar(i.texto).includes(t)) : todos.filter((i) => i.grupo !== "Alimentos" && i.grupo !== "Recetas");
    pintarPaleta();
  }
  function pintarPaleta() {
    const lista = $("#paletaLista");
    if (!resultados.length) {
      lista.innerHTML = `<div class="paleta-vacia"><i class="fa-solid fa-carrot"></i> No encontramos nada con ese nombre.</div>`;
      return;
    }
    let grupo = "";
    lista.innerHTML = resultados.map((r, i) => {
      const cab = r.grupo !== grupo ? `<div class="paleta-grupo">${(grupo = r.grupo)}</div>` : "";
      return `${cab}<div class="paleta-item ${i === elegido ? "activo" : ""}" role="option" aria-selected="${i === elegido}" data-i="${i}">
        <span class="ico"><i class="fa-solid ${r.icono}"></i></span>${esc(r.texto)}${r.extra ? `<small>${esc(r.extra)}</small>` : ""}</div>`;
    }).join("");
    const act = $(".paleta-item.activo", lista);
    if (act) act.scrollIntoView({ block: "nearest" });
  }
  function ejecutar(item) {
    cerrarPaleta();
    if (item.fn) item.fn(); else location.href = item.url;
  }
  function cerrarPaleta() {
    const p = $("#paleta");
    if (p) { p.remove(); Sonido.cerrar(); }
  }

  // ---------- Teclado global ----------
  document.addEventListener("keydown", (e) => {
    const escribiendo = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#paleta") ? cerrarPaleta() : abrirPaleta(); }
    if (e.key === "/" && !escribiendo) { e.preventDefault(); abrirPaleta(); }
    if (e.key === "[" && !escribiendo && window.innerWidth > 900) aplicarCompacto(!document.querySelector(".app").classList.contains("menu-compacto"), true);
    if (e.key === "Escape") {
      cerrarPaleta(); cerrarAcciones(); cerrarMenuUsuario(); cerrarPanel(); cerrarCajon();
      $$(".modal.abierto").forEach((m) => cerrarModal(m.id));
    }
  });

  // ==========================================================
  //  RECORRIDOS GUIADOS
  //  Cada pantalla registra sus pasos con UI.registrarRecorrido().
  //  Se muestra solo la primera vez que se visita la pantalla (en
  //  este dispositivo) y se puede repetir con el botón "?".
  //
  //  Un paso: { sel, titulo, texto, estado }
  //   - sel: selector CSS o función que devuelve el elemento
  //   - estado: nombre de un estado que la pantalla sabe preparar
  //     (ej. "panel" abre el detalle de un alimento). Al cambiar de
  //     estado se llama a opciones.base() para volver a la normalidad.
  // ==========================================================
  let recorrido = null;
  let tourActivo = false;
  const esperar = (ms) => new Promise((r) => setTimeout(r, menosMovimiento() ? Math.min(ms, 120) : ms));

  function elementoVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!el.getClientRects().length || r.width === 0 || r.height === 0) return false;
    return r.right > 0 && r.left < innerWidth;   // descarta lo que está fuera de pantalla (ej. el cajón cerrado)
  }

  async function tour(pasos, opciones = {}) {
    if (typeof opciones === "function") opciones = { alTerminar: opciones };
    if (tourActivo || !pasos.length) return;
    tourActivo = true;
    cerrarAcciones(); cerrarMenuUsuario(); cerrarPaleta();
    if (window.innerWidth <= 900) cerrarCajon();
    if (opciones.base) opciones.base();
    // Quita los pasos cuyo elemento no existe en esta pantalla o tamaño (así la numeración es exacta)
    pasos = pasos.filter((p) => p.estado || elementoVisible(typeof p.sel === "function" ? p.sel() : $(p.sel)));

    let i = -1, estadoActual = null, elActual = null, ocupado = false;
    document.body.insertAdjacentHTML("beforeend", `<div class="tour-bloqueo" id="tourBloqueo"></div><div class="tour-foco" id="tourFoco"></div>
      <div class="tour-globo" id="tourGlobo" role="dialog" aria-modal="true" aria-live="polite" aria-labelledby="tourTitulo"></div>`);
    const foco = $("#tourFoco"), globo = $("#tourGlobo");

    async function prepararEstado(deseado) {
      if (deseado === estadoActual) return;
      if (estadoActual && opciones.base) opciones.base();
      if (deseado && opciones.estados && opciones.estados[deseado]) await opciones.estados[deseado]();
      estadoActual = deseado;
      await esperar(deseado ? 520 : 360);
    }

    async function terminar(completo) {
      document.removeEventListener("keydown", teclas, true);
      removeEventListener("resize", recolocar);
      document.removeEventListener("scroll", recolocar, true);
      foco.remove(); globo.remove(); $("#tourBloqueo").remove();
      if (estadoActual && opciones.base) opciones.base();
      tourActivo = false;
      if (opciones.clave) Pref.guardar(opciones.clave, "1");
      if (completo) { Sonido.exito(); toast("¡Listo! Ya conoces esta pantalla", { icono: "fa-route" }); }
      if (opciones.alTerminar) opciones.alTerminar(completo);
    }

    async function ir(dir) {
      if (ocupado) return;
      ocupado = true;
      let j = i;
      for (;;) {
        j += dir;
        if (j < 0) { ocupado = false; return; }
        if (j >= pasos.length) { ocupado = false; return terminar(true); }
        const p = pasos[j];
        await prepararEstado(p.estado || null);
        const el = typeof p.sel === "function" ? p.sel() : $(p.sel);
        if (elementoVisible(el)) { i = j; await mostrar(p, el); break; }
      }
      ocupado = false;
    }

    function recolocar() {
      if (!elActual) return;
      const r = elActual.getBoundingClientRect();
      const top = Math.max(6, r.top - 8), bottom = Math.min(innerHeight - 6, r.bottom + 8);
      Object.assign(foco.style, { top: top + "px", left: r.left - 8 + "px", width: r.width + 16 + "px", height: Math.max(20, bottom - top) + "px" });

      const alto = globo.offsetHeight, ancho = globo.offsetWidth, m = 16;
      let top2, left;
      if (innerWidth < 600) {
        left = 12;
        top2 = r.top + r.height / 2 > innerHeight / 2 ? 12 : innerHeight - alto - 12;
      } else if (innerHeight - r.bottom > alto + m * 2) { top2 = r.bottom + m; left = r.left; }
      else if (r.top > alto + m * 2) { top2 = r.top - alto - m; left = r.left; }
      else if (innerWidth - r.right > ancho + m * 2) { left = r.right + m; top2 = r.top; }
      else if (r.left > ancho + m * 2) { left = r.left - ancho - m; top2 = r.top; }
      else { top2 = innerHeight - alto - 12; left = r.left; }
      left = Math.min(Math.max(12, left), innerWidth - ancho - 12);
      top2 = Math.min(Math.max(12, top2), innerHeight - alto - 12);
      Object.assign(globo.style, { top: top2 + "px", left: left + "px" });
    }

    async function mostrar(p, el) {
      elActual = el;
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: menosMovimiento() ? "auto" : "smooth" });
      await esperar(380);
      const total = pasos.length;
      globo.innerHTML = `
        <div class="tour-arriba"><span class="paso-num">Paso ${i + 1} de ${total}</span>
          <button class="tour-saltar" type="button" data-t="saltar">Saltar recorrido</button></div>
        <h3 id="tourTitulo">${p.titulo}</h3>
        <p>${p.texto}</p>
        <div class="tour-barra"><span style="width:${((i + 1) / total) * 100}%"></span></div>
        <div class="fila tour-botones">
          <button class="btn btn-sm" type="button" data-t="atras" ${i === 0 ? "disabled" : ""} aria-label="Paso anterior"><i class="fa-solid fa-arrow-left"></i></button>
          <button class="btn btn-principal btn-sm" type="button" data-t="sig">${i === total - 1 ? "¡Terminar!" : "Siguiente"} <i class="fa-solid ${i === total - 1 ? "fa-flag-checkered" : "fa-arrow-right"}"></i></button>
        </div>`;
      globo.classList.remove("cambia"); void globo.offsetWidth; globo.classList.add("cambia");
      recolocar();
      setTimeout(recolocar, 350);   // por si una animación o un desplazamiento seguía en curso
      Sonido.tic();
      $('[data-t="sig"]', globo).focus();
      $('[data-t="sig"]', globo).onclick = () => ir(1);
      $('[data-t="atras"]', globo).onclick = () => ir(-1);
      $('[data-t="saltar"]', globo).onclick = () => terminar(false);
    }

    const teclas = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); terminar(false); }
      if (e.key === "ArrowRight") ir(1);
      if (e.key === "ArrowLeft") ir(-1);
    };
    document.addEventListener("keydown", teclas, true);
    addEventListener("resize", recolocar);
    document.addEventListener("scroll", recolocar, true);   // sigue al elemento si algo se desplaza
    ir(1);
  }

  // Pasos de las partes que se repiten en todas las pantallas
  function pasosGenerales() {
    return [
      { sel: "#sidebar .menu", titulo: "Tu menú", texto: "Aquí están todas las secciones de tu cocina. La que estás viendo se pinta de amarillo." },
      { sel: "#btnColapsar", titulo: "Haz más espacio", texto: "Encoge el menú para ver solo los iconos y deja más lugar a lo demás. Tócalo otra vez para abrirlo (o usa la tecla [ )." },
      { sel: ".sidebar-hogar", titulo: "Tu hogar", texto: "El nombre de tu casa, cuántos dispositivos tienes conectados y cuántos alimentos hay." },
      { sel: "#btnBuscar", titulo: "Encuentra lo que sea", texto: "Escribe el nombre de un alimento, una receta o una sección. También se abre con Ctrl + K o la tecla /." },
      { sel: "#btnBuscarMovil", titulo: "Encuentra lo que sea", texto: "Toca la lupa y escribe el nombre de un alimento, una receta o una sección." },
      { sel: "#btnAyuda", titulo: "¿Te perdiste?", texto: "Este botón repite el recorrido de la pantalla en la que estés, cuando quieras." },
      { sel: "#btnSonido", titulo: "Sonidos", texto: "Los botones hacen sonidos suaves. Aquí los silencias o los vuelves a activar." },
      { sel: "#btnTema", titulo: "Día o noche", texto: "Cambia entre el tema claro y el oscuro, el que te sea más cómodo." },
      { sel: "#campana", titulo: "Tus avisos", texto: "El número rojo dice cuántas cosas necesitan tu atención. Tócala para verlas." },
      { sel: "#btnAvatar", titulo: "Tu perfil", texto: "Desde aquí cambias el tema, los sonidos, repites recorridos o cierras sesión." },
      { sel: "#fab", titulo: "El botón +", texto: "Lo más usado a un toque: agregar alimentos, escanear, anotar en la lista o pedir una idea para cocinar." },
      { sel: ".nav-inferior", titulo: "Navega con el pulgar", texto: "Inicio, tu alacena y tu lista siempre abajo. En «Más» están las demás secciones." },
      { sel: "#fabMovil", titulo: "El botón +", texto: "Lo más usado a un toque: agregar alimentos, escanear, anotar en la lista o pedir una idea para cocinar." },
    ];
  }

  // Cada pantalla registra su recorrido; se lanza solo la primera vez o con ?tour=1
  function registrarRecorrido(pasos, opciones = {}) {
    recorrido = { pasos, opciones: { ...opciones, clave: `qhdc_tour_${actual}` } };
    const params = new URLSearchParams(location.search);
    const forzar = params.get("tour");
    // Si se llegó con otra intención (ej. ?nuevo=1 o ?id=3), no se interrumpe con el recorrido
    const otraIntencion = [...params.keys()].some((k) => k !== "tour");
    if (forzar || (!otraIntencion && Pref.leer(recorrido.opciones.clave, "0") !== "1")) setTimeout(iniciarRecorrido, opciones.retraso || 1000);
  }
  function iniciarRecorrido() {
    if (recorrido) tour(recorrido.pasos, recorrido.opciones);
  }

  // ---------- Arranque ----------
  dibujarMenu();
  dibujarAcciones();
  dibujarAccionesRapidas();
  actualizarContadores();
  window.addEventListener("resize", () => {
    const m = $("#btnBuscarMovil");
    if (m) m.classList.toggle("oculto", window.innerWidth > 900);
    aplicarCompacto(Pref.leer("qhdc_menu_compacto", "0") === "1", false);
  });

  return {
    sesion, $, $$, esc, iniciales, normalizar, fecha, hora, dinero,
    iconoProducto, frasco, badgeCaducidad, badgeStock, barra,
    toast, abrirModal, cerrarModal, abrirPanel, cerrarPanel, actualizarContadores,
    tour, registrarRecorrido, iniciarRecorrido, pasosGenerales,
  };
})();
