// ============================================================
//  QHDC! — Escanear (escanear.html)
//  HU-10 Identificación de alimentos mediante IA.
//
//  La cámara y la subida de fotos son reales. El reconocimiento lo
//  hace QHDC.detectarAlimentos(); cuando exista el modelo de visión
//  en el servidor, solo se cambia esa función.
// ============================================================

const { $, $$, esc, toast } = UI;
const video = $("#video"), foto = $("#foto"), lienzo = $("#lienzo");
let stream = null, detectados = [], fotoActual = null;
const recientes = [];

// Ubicación (en %) de cada alimento dentro de la foto del refrigerador guardada
const CAJAS_REFRI = {
  "Manzana": { x: 8, y: 14, w: 26, h: 20 },
  "Leche": { x: 40, y: 8, w: 15, h: 27 },
  "Limón": { x: 66, y: 22, w: 20, h: 13 },
  "Queso Oaxaca": { x: 9, y: 48, w: 29, h: 18 },
  "Huevo": { x: 50, y: 49, w: 24, h: 20 },
  "Zanahoria": { x: 75, y: 40, w: 17, h: 27 },
  "Brócoli": { x: 15, y: 67, w: 25, h: 32 },
  "Yogur natural": { x: 57, y: 78, w: 19, h: 20 },
};

// ---------- Etapas ----------
function etapa(n) {
  $$("#pasos li").forEach((li, i) => { li.classList.toggle("activo", i === n); li.classList.toggle("hecho", i < n); });
}
function controles(cual) {
  ["ctrlInicio", "ctrlCamara", "ctrlFoto"].forEach((id) => $("#" + id).classList.toggle("oculto", id !== cual));
}
function apagarCamara() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.classList.add("oculto");
}
function mostrarFoto(entrada) {
  apagarCamara();
  fotoActual = entrada;
  foto.src = entrada.url;
  foto.classList.remove("oculto");
  $("#visorInicio").classList.add("oculto");
  $("#cajas").innerHTML = "";
  detectados = [];
  dibujarResultados();
  controles("ctrlFoto");
  $("#btnReconocer").disabled = false;
  etapa(1);
}
function reiniciar() {
  apagarCamara();
  fotoActual = null;
  foto.classList.add("oculto");
  $("#visorInicio").classList.remove("oculto");
  $("#cajas").innerHTML = "";
  detectados = [];
  dibujarResultados();
  controles("ctrlInicio");
  etapa(0);
}
function guardarReciente(url, etiqueta, refri = false) {
  const entrada = { url, etiqueta, refri };
  recientes.unshift(entrada);
  dibujarRecientes();
  return entrada;
}

// ---------- Cámara ----------
$("#btnCamara").addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    video.classList.remove("oculto");
    $("#visorInicio").classList.add("oculto");
    controles("ctrlCamara");
  } catch (e) {
    Sonido.alerta();
    toast("No pudimos abrir la cámara. Puedes subir una foto.", { icono: "fa-camera" });
  }
});
$("#btnCapturar").addEventListener("click", () => {
  lienzo.width = video.videoWidth || 800;
  lienzo.height = video.videoHeight || 600;
  lienzo.getContext("2d").drawImage(video, 0, 0, lienzo.width, lienzo.height);
  Sonido.foto();
  const f = $("#flash"); f.classList.remove("activo"); void f.offsetWidth; f.classList.add("activo");
  mostrarFoto(guardarReciente(lienzo.toDataURL("image/jpeg", 0.85), "Ahora"));
});
$("#btnCancelar").addEventListener("click", reiniciar);
$("#btnOtra").addEventListener("click", reiniciar);

$("#archivo").addEventListener("change", (e) => {
  const a = e.target.files[0];
  if (!a) return;
  const lector = new FileReader();
  lector.onload = () => { Sonido.pop(); mostrarFoto(guardarReciente(lector.result, "Subida")); };
  lector.readAsDataURL(a);
  e.target.value = "";
});

// ---------- Fotos recientes ----------
function dibujarRecientes() {
  $("#recientes").innerHTML = recientes.map((r, i) => `
    <button class="miniatura" type="button" data-r="${i}" aria-label="Usar foto: ${esc(r.etiqueta)}">
      <img src="${r.url}" alt=""><small>${esc(r.etiqueta)}</small>
    </button>`).join("");
}
$("#recientes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-r]");
  if (b) mostrarFoto(recientes[b.dataset.r]);
});

// Foto del refrigerador que ya estaba en el historial (dibujada con canvas)
function fotoRefrigerador() {
  const c = document.createElement("canvas");
  c.width = 800; c.height = 600;
  const g = c.getContext("2d");
  g.fillStyle = "#e9f1f4"; g.fillRect(0, 0, 800, 600);
  g.fillStyle = "#cfdde3"; [200, 400].forEach((y) => g.fillRect(0, y, 800, 14));
  const bola = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const caja = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  bola(120, 150, 45, "#e8562a"); bola(200, 160, 40, "#d9481f");
  caja(330, 60, 90, 140, "#ffffff"); caja(330, 60, 90, 30, "#4a7fb5");
  bola(560, 170, 28, "#f2b33d"); bola(620, 170, 28, "#f2b33d");
  caja(90, 300, 200, 90, "#f3dfb6");
  for (let i = 0; i < 6; i++) bola(420 + (i % 3) * 55, 320 + Math.floor(i / 3) * 45, 22, "#f7ecd9");
  caja(620, 250, 40, 150, "#e8742a"); caja(680, 260, 40, 140, "#e8742a");
  caja(150, 470, 160, 110, "#6b8e3d"); bola(230, 470, 70, "#7da447");
  caja(470, 480, 120, 100, "#fbf6ee"); caja(470, 480, 120, 25, "#7a6556");
  return c.toDataURL("image/jpeg", 0.9);
}

// ---------- Reconocer ----------
$("#btnReconocer").addEventListener("click", () => {
  $("#btnReconocer").disabled = true;
  $("#visor").classList.add("analizando");
  Sonido.escaneo();
  setTimeout(() => {
    $("#visor").classList.remove("analizando");
    let lista;
    if (fotoActual && fotoActual.refri) {
      const catalogo = QHDC.detectarAlimentos.catalogo();
      lista = Object.keys(CAJAS_REFRI).sort(() => Math.random() - 0.5).slice(0, 4)
        .map((n) => ({ ...catalogo.find((a) => a.nombre === n), confianza: Math.round(86 + Math.random() * 13), caja: CAJAS_REFRI[n] }));
    } else {
      lista = QHDC.detectarAlimentos().map((a, i) => ({ ...a, caja: { x: (i % 2) * 50 + 6 + Math.random() * 8, y: Math.floor(i / 2) * 50 + 10 + Math.random() * 6, w: 32, h: 30 } }));
    }
    detectados = lista.map((a) => ({ ...a, elegido: true, caducidad: QHDC.enDias(a.vida) }));
    $("#cajas").innerHTML = detectados.map((a, i) => `
      <div class="caja" data-caja="${i}" style="left:${a.caja.x}%;top:${a.caja.y}%;width:${a.caja.w}%;height:${a.caja.h}%;animation-delay:${i * 0.15}s">
        <span>${esc(a.nombre)} · ${a.confianza}%</span>
      </div>`).join("");
    detectados.forEach((_, i) => setTimeout(Sonido.pop, i * 150));
    dibujarResultados();
    etapa(2);
  }, menosMovimiento() ? 300 : 2100);
});

// ---------- Resultados ----------
const pasoDe = (u) => (u === "pz" ? 1 : u === "L" ? 0.5 : u === "g" ? 100 : 1);

function dibujarResultados() {
  $("#numEncontrados").textContent = detectados.length;
  $("#sinResultados").classList.toggle("oculto", detectados.length > 0);
  $("#btnAgregar").classList.toggle("oculto", detectados.length === 0);
  $("#detectados").innerHTML = detectados.map((a, i) => `
    <li class="detectado ${a.elegido ? "" : "fuera"}" data-i="${i}" style="--i:${i}">
      <label class="interruptor"><input type="checkbox" ${a.elegido ? "checked" : ""} aria-label="Agregar ${esc(a.nombre)}"><span class="riel"></span></label>
      <span class="prod-icono ico-${a.color}"><i class="fa-solid ${a.icono}"></i></span>
      <div>
        <strong>${esc(a.nombre)}</strong>
        <span class="confianza"><span class="barra"><span style="width:${a.confianza}%"></span></span> ${a.confianza}% seguro</span>
      </div>
      <div class="ajustes">
        <span class="paso-cant">
          <button class="btn-icono" type="button" data-d="-1" aria-label="Menos" data-sonido="bajar"><i class="fa-solid fa-minus"></i></button>
          <output>${QHDC.formatoCantidad(a.cantidad, a.unidad)}</output>
          <button class="btn-icono" type="button" data-d="1" aria-label="Más" data-sonido="subir"><i class="fa-solid fa-plus"></i></button>
        </span>
        <input class="control" type="date" value="${a.caducidad}" aria-label="Fecha de caducidad de ${esc(a.nombre)}">
      </div>
    </li>`).join("");
  actualizarBoton();
}
function actualizarBoton() {
  const n = detectados.filter((a) => a.elegido).length;
  $("#btnAgregar").innerHTML = `<i class="fa-solid fa-jar"></i> Guardar ${n} en mi alacena`;
  $("#btnAgregar").disabled = n === 0;
}

$("#detectados").addEventListener("click", (e) => {
  const b = e.target.closest("[data-d]");
  if (!b) return;
  const li = b.closest("li"), a = detectados[li.dataset.i];
  a.cantidad = Math.max(pasoDe(a.unidad), +(a.cantidad + Number(b.dataset.d) * pasoDe(a.unidad)).toFixed(2));
  $("output", li).textContent = QHDC.formatoCantidad(a.cantidad, a.unidad);
});
$("#detectados").addEventListener("change", (e) => {
  const li = e.target.closest("li"), a = detectados[li.dataset.i];
  if (e.target.type === "checkbox") {
    a.elegido = e.target.checked;
    li.classList.toggle("fuera", !a.elegido);
    const caja = $(`[data-caja="${li.dataset.i}"]`);
    if (caja) caja.classList.toggle("descartada", !a.elegido);
    actualizarBoton();
  } else if (e.target.type === "date") {
    a.caducidad = e.target.value;
  }
});

$("#btnAgregar").addEventListener("click", () => {
  const elegidos = detectados.filter((a) => a.elegido);
  QHDC.agregarDesdeCamara(elegidos);
  Sonido.exito();
  Efectos.confeti();
  UI.actualizarContadores();
  toast(`${elegidos.length} alimentos guardados en tu alacena`, {
    icono: "fa-jar", accion: { texto: "Ver", fn: () => (location.href = "inventario.html") },
  });
  reiniciar();
});

window.addEventListener("beforeunload", apagarCamara);

// ---------- Arranque ----------
guardarReciente(fotoRefrigerador(), "Refrigerador", true);
reiniciar();

// ============================================================
//  RECORRIDO DE ESTA PANTALLA
// ============================================================
const fotoRefri = () => recientes.find((r) => r.refri) || recientes[0];
UI.registrarRecorrido([
  { sel: ".topbar-titulo", titulo: "Escanear", texto: "Registra tus compras con una foto, sin escribir nada." },
  { sel: "#pasos", titulo: "Tres pasos", texto: "Foto, reconocer y confirmar. Aquí ves en cuál vas." },
  { sel: "#visor", titulo: "El visor", texto: "Aquí verás tu cámara o la foto que elijas." },
  { sel: "#btnCamara", titulo: "Abrir cámara", texto: "Usa la cámara de tu celular o computadora. Te pedirá permiso la primera vez." },
  { sel: 'label[for="archivo"]', titulo: "Subir foto", texto: "¿Ya tienes una foto? Elígela de tu galería." },
  { sel: ".recientes", titulo: "Fotos recientes", texto: "Las fotos que tomaste quedan aquí para volver a usarlas." },
  { sel: "#btnReconocer", estado: "foto", titulo: "Reconocer", texto: "Con la foto lista, toca aquí y la inteligencia artificial busca los alimentos." },
  { sel: "#btnOtra", estado: "foto", titulo: "Otra foto", texto: "Si no salió bien, toma otra." },
  { sel: "#cajas", estado: "resultados", titulo: "Lo que encontramos", texto: "Cada alimento reconocido se marca con un recuadro y qué tan seguros estamos." },
  { sel: "#detectados .detectado", estado: "resultados", titulo: "Revisa cada uno", texto: "Puedes corregir lo que haga falta antes de guardar." },
  { sel: "#detectados .interruptor", estado: "resultados", titulo: "¿Lo agregamos?", texto: "Apaga el interruptor si no quieres guardar ese alimento." },
  { sel: "#detectados .paso-cant", estado: "resultados", titulo: "¿Cuánto es?", texto: "Ajusta la cantidad con + y −." },
  { sel: '#detectados input[type="date"]', estado: "resultados", titulo: "Caducidad", texto: "Te sugerimos una fecha; cámbiala si la etiqueta dice otra." },
  { sel: "#btnAgregar", estado: "resultados", titulo: "Guardar", texto: "Todo lo marcado pasa a tu alacena de una vez." },
], {
  base: reiniciar,
  estados: {
    foto: () => mostrarFoto(fotoRefri()),
    resultados: async () => {
      mostrarFoto(fotoRefri());
      $("#btnReconocer").click();
      await new Promise((r) => setTimeout(r, menosMovimiento() ? 400 : 2400));
    },
  },
});
