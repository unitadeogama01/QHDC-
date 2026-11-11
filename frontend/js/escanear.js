// ============================================================
//  QHDC! — Escanear (escanear.html)
//  HU-10 Identificación de alimentos mediante IA.
//
//  Flujo real:
//   1. Foto: cámara en vivo (getUserMedia), cámara nativa del teléfono
//      (input con capture, si el navegador no permite la cámara en vivo)
//      o galería/archivos. Se valida, se gira según el EXIF y se reduce a
//      1600 px en JPEG antes de subirla. Vista previa → "Otra foto" o
//      "Reconocer alimentos".
//   2. Reconocer: la foto se sube al servidor (HTTPS) y el servidor le
//      pide a la IA (Claude) que proponga los alimentos.
//   3. Confirmar: se puede corregir nombre, tipo, cantidad y caducidad;
//      lo dudoso llega desmarcado con "Revisar". Solo al tocar "Guardar"
//      cambia la alacena.
// ============================================================

const { $, $$, esc, toast } = UI;
const video = $("#video"), foto = $("#foto"), lienzo = $("#lienzo");
const LADO_MAXIMO = 1600;
const MAX_MB_ORIGINAL = 25; // antes de comprimir (las fotos de celular pesan 3–12 MB)
let stream = null, detectados = [], fotoActual = null, enDemo = false;
const recientesLocales = []; // fotos de esta visita que aún no se suben

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
  enDemo = false;
  foto.classList.add("oculto");
  $("#visorInicio").classList.remove("oculto");
  $("#cajas").innerHTML = "";
  detectados = [];
  dibujarResultados();
  controles("ctrlInicio");
  $("#btnReconocer").disabled = false;
  $("#visor").classList.remove("analizando");
  etapa(0);
}

// ---------- Preparar la imagen (validar, girar, reducir) ----------
async function decodificar(archivo) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(archivo, { imageOrientation: "from-image" }); } catch (e) { /* se intenta con <img> */ }
  }
  return new Promise((ok, mal) => {
    const img = new Image();
    const url = URL.createObjectURL(archivo);
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error("No se pudo leer la imagen.")); };
    img.src = url;
  });
}
async function prepararImagen(archivo) {
  if (!archivo.type.startsWith("image/")) throw new Error("Ese archivo no es una imagen. Elige una foto JPG, PNG o WebP.");
  if (archivo.size > MAX_MB_ORIGINAL * 1024 * 1024) throw new Error(`La foto pesa más de ${MAX_MB_ORIGINAL} MB.`);
  const img = await decodificar(archivo);
  const ancho = img.width || img.naturalWidth, alto = img.height || img.naturalHeight;
  if (!ancho || !alto) throw new Error("No se pudo leer la imagen.");
  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto));
  lienzo.width = Math.round(ancho * escala);
  lienzo.height = Math.round(alto * escala);
  lienzo.getContext("2d").drawImage(img, 0, 0, lienzo.width, lienzo.height);
  return lienzoABlob();
}
function lienzoABlob() {
  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo preparar la foto."))), "image/jpeg", 0.85));
}
async function usarArchivo(archivo, origen) {
  try {
    const blob = await prepararImagen(archivo);
    Sonido.pop();
    mostrarFoto(guardarReciente({ url: URL.createObjectURL(blob), blob, origen, etiqueta: origen === "galeria" ? "Subida" : "Ahora" }));
  } catch (e) {
    Sonido.alerta();
    toast(e.message, { icono: "fa-image" });
  }
}
function guardarReciente(entrada) {
  recientesLocales.unshift(entrada);
  if (recientesLocales.length > 4) recientesLocales.pop();
  dibujarRecientes();
  return entrada;
}

// ---------- Cámara ----------
const camaraEnVivo = () => window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
$("#btnCamara").addEventListener("click", async () => {
  if (!camaraEnVivo()) { $("#archivoCamara").click(); return; } // p. ej. celular por HTTP en la red local
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } } });
    video.srcObject = stream;
    video.classList.remove("oculto");
    $("#visorInicio").classList.add("oculto");
    controles("ctrlCamara");
  } catch (e) {
    // Sin permiso o sin cámara: se ofrece la cámara nativa del teléfono / elegir archivo
    Sonido.alerta();
    toast("No pudimos abrir la cámara aquí. Usa la del teléfono o sube una foto.", { icono: "fa-camera" });
    $("#archivoCamara").click();
  }
});
$("#btnCapturar").addEventListener("click", async () => {
  const ancho = video.videoWidth || 800, alto = video.videoHeight || 600;
  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto));
  lienzo.width = Math.round(ancho * escala);
  lienzo.height = Math.round(alto * escala);
  lienzo.getContext("2d").drawImage(video, 0, 0, lienzo.width, lienzo.height);
  Sonido.foto();
  const f = $("#flash"); f.classList.remove("activo"); void f.offsetWidth; f.classList.add("activo");
  const blob = await lienzoABlob();
  mostrarFoto(guardarReciente({ url: URL.createObjectURL(blob), blob, origen: "camara", etiqueta: "Ahora" }));
});
$("#btnCancelar").addEventListener("click", reiniciar);
$("#btnOtra").addEventListener("click", reiniciar);

$("#archivo").addEventListener("change", (e) => {
  const a = e.target.files[0];
  e.target.value = "";
  if (a) usarArchivo(a, "galeria");
});
$("#archivoCamara").addEventListener("change", (e) => {
  const a = e.target.files[0];
  e.target.value = "";
  if (a) usarArchivo(a, "camara");
});

// ---------- Fotos recientes (las de esta visita + las guardadas en el servidor) ----------
function recientes() {
  const servidor = QHDC.escaneos().filter((e) => e.imagen).map((e) => ({
    url: e.imagen, origen: "galeria", servidor: true,
    etiqueta: e.alimentos.length ? e.alimentos.slice(0, 2).join(", ") : UI.fecha(e.fecha, { day: "numeric", month: "short" }),
  }));
  return recientesLocales.concat(servidor).slice(0, 8);
}
function dibujarRecientes() {
  const lista = recientes();
  $(".recientes").classList.toggle("oculto", lista.length === 0);
  $("#recientes").innerHTML = lista.map((r, i) => `
    <button class="miniatura" type="button" data-r="${i}" aria-label="Usar foto: ${esc(r.etiqueta)}">
      <img src="${esc(r.url)}" alt="" loading="lazy"><small>${esc(r.etiqueta)}</small>
    </button>`).join("");
}
$("#recientes").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-r]");
  if (!b) return;
  const r = recientes()[b.dataset.r];
  if (!r.servidor) { mostrarFoto(r); return; }
  // Foto guardada en el servidor: se vuelve a analizar como un escaneo nuevo
  try {
    const resp = await fetch(r.url, { credentials: "same-origin" });
    if (!resp.ok) throw new Error("Esa foto ya no está disponible.");
    const blob = await resp.blob();
    mostrarFoto({ ...r, url: URL.createObjectURL(blob), blob, servidor: false });
  } catch (err) {
    toast(err.message, { icono: "fa-image" });
  }
});

// ---------- Reconocer ----------
function dibujarCajas() {
  $("#cajas").innerHTML = detectados.map((a, i) => `
    <div class="caja ${a.elegido ? "" : "descartada"}" data-caja="${i}" style="left:${a.caja.x}%;top:${a.caja.y}%;width:${a.caja.w}%;height:${a.caja.h}%;animation-delay:${i * 0.15}s">
      <span>${esc(a.nombre)} · ${a.confianza}%</span>
    </div>`).join("");
}

$("#btnReconocer").addEventListener("click", async () => {
  if (!fotoActual || !fotoActual.blob) return;
  $("#btnReconocer").disabled = true;
  $("#visor").classList.add("analizando");
  Sonido.escaneo();
  try {
    if (!fotoActual.escaneoId) {
      const subida = await QHDC.subirFoto(fotoActual.blob, fotoActual.origen);
      fotoActual.escaneoId = subida.escaneoId;
    }
    const r = await QHDC.analizarFoto(fotoActual.escaneoId);
    detectados = r.alimentos.map((a) => ({ ...a, sugerido: a.nombre }));
    dibujarCajas();
    detectados.forEach((_, i) => setTimeout(Sonido.pop, i * 150));
    dibujarResultados();
    etapa(2);
    if (r.simulado) toast("Modo de demostración: la IA no está configurada en el servidor (ANTHROPIC_API_KEY).", { icono: "fa-flask" });
    else if (!detectados.length) toast(r.observaciones || "No encontramos alimentos. Prueba con más luz o más de cerca.", { icono: "fa-magnifying-glass" });
    else if (detectados.some((a) => a.revisar)) toast("Revisa los marcados: la IA no está segura de ellos.", { icono: "fa-circle-exclamation" });
  } catch (e) {
    Sonido.alerta();
    toast(e.message, { icono: "fa-triangle-exclamation" });
    $("#btnReconocer").disabled = false;
  }
  $("#visor").classList.remove("analizando");
});

// ---------- Resultados (se pueden corregir antes de guardar) ----------
const pasoDe = (u) => (u === "pz" ? 1 : u === "L" ? 0.5 : u === "g" ? 100 : 1);
const CATEGORIAS = () => QHDC.CATEGORIAS || [];

function dibujarResultados() {
  $("#numEncontrados").textContent = detectados.length;
  $("#sinResultados").classList.toggle("oculto", detectados.length > 0);
  $("#btnAgregar").classList.toggle("oculto", detectados.length === 0);
  $("#detectados").innerHTML = detectados.map((a, i) => `
    <li class="detectado ${a.elegido ? "" : "fuera"}" data-i="${i}" style="--i:${i}">
      <label class="interruptor"><input type="checkbox" ${a.elegido ? "checked" : ""} aria-label="Agregar ${esc(a.nombre)}"><span class="riel"></span></label>
      <span class="prod-icono ico-${esc(a.color)}"><i class="fa-solid ${esc(a.icono)}"></i></span>
      <div>
        <input class="control nombre-detectado" data-campo="nombre" value="${esc(a.nombre)}" maxlength="120" aria-label="Nombre del alimento (puedes corregirlo)">
        <span class="confianza"><span class="barra"><span style="width:${a.confianza}%"></span></span> ${a.confianza}% seguro
          ${a.revisar ? '<span class="badge badge-aviso"><i class="fa-solid fa-circle-exclamation"></i> Revisar</span>' : ""}
          ${a.existenteId ? '<span class="badge badge-ok"><i class="fa-solid fa-jar"></i> Ya lo tienes</span>' : ""}</span>
      </div>
      <div class="ajustes">
        <span class="paso-cant">
          <button class="btn-icono" type="button" data-d="-1" aria-label="Menos" data-sonido="bajar"><i class="fa-solid fa-minus"></i></button>
          <output title="${a.cantidadContada ? "Contado en la foto" : "Cantidad sugerida: ajústala"}">${QHDC.formatoCantidad(a.cantidad, a.unidad)}</output>
          <button class="btn-icono" type="button" data-d="1" aria-label="Más" data-sonido="subir"><i class="fa-solid fa-plus"></i></button>
        </span>
        <input class="control" type="date" value="${esc(a.caducidad)}" aria-label="Fecha de caducidad de ${esc(a.nombre)} (sugerida, revísala en la etiqueta)">
        ${a.existenteId || !CATEGORIAS().length ? "" : `
        <select class="control" data-campo="categoria" style="grid-column:1/-1" aria-label="Tipo de alimento">
          ${CATEGORIAS().map((c) => `<option ${c === a.categoria ? "selected" : ""}>${esc(c)}</option>`).join("")}
        </select>`}
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
  } else if (e.target.dataset.campo === "categoria") {
    a.categoria = e.target.value;
  }
});
$("#detectados").addEventListener("input", (e) => {
  if (e.target.dataset.campo !== "nombre") return;
  const li = e.target.closest("li"), a = detectados[li.dataset.i];
  a.nombre = e.target.value;
  const etiqueta = $(`[data-caja="${li.dataset.i}"] span`);
  if (etiqueta) etiqueta.textContent = `${a.nombre} · ${a.confianza}%`;
});

$("#btnAgregar").addEventListener("click", async () => {
  if (enDemo) { reiniciar(); return; } // el recorrido no guarda nada
  const elegidos = detectados.filter((a) => a.elegido);
  if (elegidos.some((a) => !a.nombre.trim())) { toast("Escribe el nombre de cada alimento marcado.", { icono: "fa-pen" }); return; }
  const b = $("#btnAgregar");
  b.disabled = true;
  b.innerHTML = '<i class="fa-solid fa-rotate"></i> Guardando…';
  try {
    const r = await QHDC.confirmarEscaneo(fotoActual.escaneoId, detectados);
    Sonido.exito();
    Efectos.confeti();
    UI.actualizarContadores();
    toast(`${r.guardados} alimento${r.guardados === 1 ? "" : "s"} guardado${r.guardados === 1 ? "" : "s"} en tu alacena`, {
      icono: "fa-jar", accion: { texto: "Ver", fn: () => (location.href = "inventario.html") },
    });
    const i = recientesLocales.indexOf(fotoActual);
    if (i >= 0) recientesLocales.splice(i, 1); // ya está en el servidor
    reiniciar();
    dibujarRecientes();
  } catch (e) {
    Sonido.alerta();
    toast(e.message, { icono: "fa-triangle-exclamation" });
    actualizarBoton();
  }
});

window.addEventListener("beforeunload", apagarCamara);
document.addEventListener("qhdc:datos", dibujarRecientes);

// ---------- Arranque ----------
reiniciar();
dibujarRecientes();

// ============================================================
//  RECORRIDO DE ESTA PANTALLA
//  Usa una foto dibujada y resultados de ejemplo: no sube nada ni
//  llama a la IA.
// ============================================================
function fotoDemo() {
  const c = document.createElement("canvas");
  c.width = 800; c.height = 600;
  const g = c.getContext("2d");
  g.fillStyle = "#e9f1f4"; g.fillRect(0, 0, 800, 600);
  g.fillStyle = "#cfdde3"; [200, 400].forEach((y) => g.fillRect(0, y, 800, 14));
  const bola = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const caja = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  bola(120, 150, 45, "#e8562a"); bola(200, 160, 40, "#d9481f");
  caja(330, 60, 90, 140, "#ffffff"); caja(330, 60, 90, 30, "#4a7fb5");
  for (let i = 0; i < 6; i++) bola(420 + (i % 3) * 55, 320 + Math.floor(i / 3) * 45, 22, "#f7ecd9");
  caja(150, 470, 160, 110, "#6b8e3d"); bola(230, 470, 70, "#7da447");
  return { url: c.toDataURL("image/jpeg", 0.9), etiqueta: "Ejemplo" };
}
function resultadosDemo() {
  enDemo = true;
  const ejemplo = [
    { nombre: "Manzana", icono: "fa-apple-whole", color: "tomate", unidad: "pz", cantidad: 2, cantidadContada: true, confianza: 94, caja: { x: 8, y: 14, w: 26, h: 20 } },
    { nombre: "Leche", icono: "fa-glass-water", color: "cafe", unidad: "L", cantidad: 1, cantidadContada: false, confianza: 88, caja: { x: 40, y: 8, w: 15, h: 27 } },
    { nombre: "Huevo", icono: "fa-egg", color: "mostaza", unidad: "pz", cantidad: 6, cantidadContada: true, confianza: 91, caja: { x: 50, y: 49, w: 24, h: 20 } },
    { nombre: "Brócoli", icono: "fa-leaf", color: "oliva", unidad: "pz", cantidad: 1, cantidadContada: true, confianza: 52, caja: { x: 15, y: 67, w: 25, h: 32 }, revisar: true },
  ];
  detectados = ejemplo.map((a) => ({ ...a, categoria: "Otros", caducidad: QHDC.enDias(7), elegido: !a.revisar }));
  dibujarCajas();
  dibujarResultados();
  etapa(2);
}
UI.registrarRecorrido([
  { sel: ".topbar-titulo", titulo: "Escanear", texto: "Registra tus compras con una foto, sin escribir nada." },
  { sel: "#pasos", titulo: "Tres pasos", texto: "Foto, reconocer y confirmar. Aquí ves en cuál vas." },
  { sel: "#visor", titulo: "El visor", texto: "Aquí verás tu cámara o la foto que elijas." },
  { sel: "#btnCamara", titulo: "Abrir cámara", texto: "Usa la cámara de tu celular o computadora. Te pedirá permiso la primera vez." },
  { sel: 'label[for="archivo"]', titulo: "Subir foto", texto: "¿Ya tienes una foto? Elígela de tu galería." },
  { sel: ".recientes", titulo: "Fotos recientes", texto: "Tus últimas fotos quedan aquí para volver a usarlas." },
  { sel: "#btnReconocer", estado: "foto", titulo: "Reconocer", texto: "Con la foto lista, toca aquí y la inteligencia artificial busca los alimentos." },
  { sel: "#btnOtra", estado: "foto", titulo: "Otra foto", texto: "Si no salió bien, toma otra." },
  { sel: "#cajas", estado: "resultados", titulo: "Lo que encontramos", texto: "Cada alimento reconocido se marca con un recuadro y qué tan seguros estamos." },
  { sel: "#detectados .detectado", estado: "resultados", titulo: "Revisa cada uno", texto: "Corrige el nombre si la IA se equivocó. Nada se guarda hasta que tú lo confirmes." },
  { sel: "#detectados .badge-aviso", estado: "resultados", titulo: "Revisar", texto: "Si la IA no está segura, el alimento llega apagado: revísalo y enciéndelo si es correcto." },
  { sel: "#detectados .interruptor", estado: "resultados", titulo: "¿Lo agregamos?", texto: "Apaga el interruptor si no quieres guardar ese alimento." },
  { sel: "#detectados .paso-cant", estado: "resultados", titulo: "¿Cuánto es?", texto: "Una foto no dice cuánto pesa algo: ajusta la cantidad con + y −." },
  { sel: '#detectados input[type="date"]', estado: "resultados", titulo: "Caducidad", texto: "Te sugerimos una fecha; cámbiala por la que dice la etiqueta." },
  { sel: "#btnAgregar", estado: "resultados", titulo: "Guardar", texto: "Todo lo marcado pasa a tu alacena de una vez." },
], {
  base: reiniciar,
  estados: {
    foto: () => mostrarFoto(fotoDemo()),
    resultados: async () => {
      mostrarFoto(fotoDemo());
      resultadosDemo();
    },
  },
});
