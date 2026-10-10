// ============================================================
//  QHDC! — Dispositivos (sensores.html)
//  HU-03 Actualización automática mediante sensores IoT
//
//  Cada 3 segundos se reciben lecturas (QHDC.simularCiclo hace lo
//  mismo que los ESP32 reales mientras no exista el hardware) y se
//  actualizan los valores en su lugar, sin redibujar toda la página.
// ============================================================

const { $, $$, esc, frasco, toast, abrirModal } = UI;
const ICONO = { peso: "fa-scale-balanced", gas: "fa-wind", temperatura: "fa-temperature-low" };
const INTERVALO = 3000;
let temporizador = null;
let ultimaLectura = Date.now();
const anteriores = {};

const barrasSenal = (dbm) => (dbm > -60 ? 4 : dbm > -70 ? 3 : dbm > -80 ? 2 : 1);
const nivelGas = (ppm) => Math.min(1, Math.max(0, (ppm - 150) / 400));
function estadoAire(ppm) {
  if (ppm > 400) return ["peligro", "fa-triangle-exclamation", "Algo se está echando a perder"];
  if (ppm > 280) return ["aviso", "fa-circle-exclamation", "Los olores van en aumento"];
  return ["ok", "fa-leaf", "Aire fresco"];
}

// ---------- Cuerpo de cada tipo de dispositivo ----------
function cuerpo(s) {
  if (!s.enLinea) {
    return `<div class="vacio" style="padding:18px 0"><div class="ilustra" style="background:var(--superficie-2);color:var(--texto-suave)"><i class="fa-solid fa-plug-circle-xmark"></i></div>
      <strong>Sin conexión</strong><p>Revisa que esté encendido y cerca de tu WiFi.</p></div>`;
  }
  if (s.tipo === "peso") {
    return `<div class="plataforma">${s.productos.map((pid) => {
      const p = QHDC.producto(pid);
      if (!p) return "";
      anteriores[pid] = p.cantidad;
      return `
        <div class="pesado" data-prod="${pid}">
          ${frasco(p, 46)}
          <div class="info"><strong>${esc(p.nombre)}</strong><small class="texto-suave">${p.estado.pct}% lleno</small></div>
          <div><span class="peso">${QHDC.formatoCantidad(p.cantidad, p.unidad)}</span><span class="delta"></span></div>
        </div>`;
    }).join("")}</div>`;
  }
  if (s.tipo === "gas") {
    const [clase, icono, texto] = estadoAire(s.gas);
    return `
      <div class="medidor-gas">
        <div class="arco" style="--p:${nivelGas(s.gas)}"><span class="aguja"></span></div>
        <span class="lectura-gas" data-gas>${s.gas} ppm</span>
        <span class="estado-aire ${clase}" data-aire><i class="fa-solid ${icono}"></i> ${texto}</span>
      </div>
      <div class="ambiente">
        <div><strong data-temp>${s.temperatura} °C</strong><small>Temperatura</small></div>
        <div><strong data-hum>${s.humedad}%</strong><small>Humedad</small></div>
      </div>`;
  }
  return `
    <div class="termometro">
      <div class="tubo"><span style="height:${Math.min(100, Math.max(5, ((s.temperatura + 25) / 25) * 100))}%"></span></div>
      <div><strong>${s.temperatura} °C</strong><p class="texto-suave">Lo ideal es −18 °C o menos</p></div>
    </div>`;
}

function dibujarDispositivos() {
  $("#dispositivos").innerHTML = QHDC.sensores().map((s, i) => `
    <article class="tarjeta aparato ${s.enLinea ? "" : "apagado"} aparecer" style="--i:${i}" data-sensor="${s.id}">
      <div class="aparato-cab">
        <span class="led" aria-hidden="true"></span>
        <div><h3>${esc(s.nombre)}</h3><small><i class="fa-solid ${ICONO[s.tipo]}"></i> ${esc(s.modelo)} · ${esc(s.ubicacion)}</small></div>
        ${s.enLinea ? '<span class="badge badge-ok"><i class="fa-solid fa-wifi"></i> En línea</span>' : '<span class="badge badge-peligro"><i class="fa-solid fa-plug-circle-xmark"></i> Desconectado</span>'}
      </div>
      <div class="aparato-cuerpo">${cuerpo(s)}</div>
      <div class="aparato-pie">
        <div class="metricas">
          <span title="Señal WiFi"><span class="senal" aria-hidden="true">${[1, 2, 3, 4].map((n) => `<i class="${n <= (s.enLinea ? barrasSenal(s.senal) : 0) ? "on" : ""}"></i>`).join("")}</span>${s.enLinea ? ["", "Débil", "Regular", "Buena", "Excelente"][barrasSenal(s.senal)] : "Sin señal"}</span>
          <span class="${s.bateria < 20 ? "bateria-baja" : ""}"><i class="fa-solid ${s.bateria < 20 ? "fa-battery-quarter" : s.bateria < 60 ? "fa-battery-half" : "fa-battery-three-quarters"}"></i> ${s.bateria}%</span>
        </div>
        ${s.enLinea
          ? `<button class="btn btn-sm" type="button" data-calibrar="${s.id}"><i class="fa-solid fa-sliders"></i> ${s.tipo === "peso" ? "Calibrar" : "Probar"}</button>`
          : `<button class="btn btn-sm btn-principal" type="button" data-conectar="${s.id}" data-sonido="ninguno"><i class="fa-solid fa-rotate"></i> Reintentar conexión</button>`}
      </div>
    </article>`).join("");
}

// ---------- Actualizar valores en su lugar ----------
function actualizarValores() {
  QHDC.sensores().forEach((s) => {
    const tarjeta = $(`[data-sensor="${s.id}"]`);
    if (!tarjeta || !s.enLinea) return;
    const led = $(".led", tarjeta);
    led.classList.remove("parpadea"); void led.offsetWidth; led.classList.add("parpadea");

    if (s.tipo === "peso") {
      s.productos.forEach((pid) => {
        const p = QHDC.producto(pid);
        const fila = $(`[data-prod="${pid}"]`, tarjeta);
        if (!p || !fila) return;
        const dif = Math.round(p.cantidad - (anteriores[pid] ?? p.cantidad));
        anteriores[pid] = p.cantidad;
        $(".peso", fila).textContent = QHDC.formatoCantidad(p.cantidad, p.unidad);
        $(".texto-suave", fila).textContent = `${p.estado.pct}% lleno`;
        const f = $(".frasco", fila);
        f.style.setProperty("--nivel", p.estado.pct + "%");
        f.className = `frasco ${p.estado.nivel === "ok" ? "" : p.estado.nivel}`;
        const d = $(".delta", fila);
        if (Math.abs(dif) >= 3) {
          d.className = `delta ${dif < 0 ? "baja" : "sube"}`;
          d.innerHTML = `<i class="fa-solid ${dif < 0 ? "fa-caret-down" : "fa-caret-up"}"></i> ${Math.abs(dif)} ${p.unidad}`;
          fila.classList.remove("cambio"); void fila.offsetWidth; fila.classList.add("cambio");
        } else {
          d.textContent = "";
        }
      });
    }
    if (s.tipo === "gas") {
      $(".arco", tarjeta).style.setProperty("--p", nivelGas(s.gas));
      $("[data-gas]", tarjeta).textContent = `${s.gas} ppm`;
      $("[data-temp]", tarjeta).textContent = `${s.temperatura} °C`;
      $("[data-hum]", tarjeta).textContent = `${s.humedad}%`;
      const [clase, icono, texto] = estadoAire(s.gas);
      const el = $("[data-aire]", tarjeta);
      if (!el.classList.contains(clase)) {
        el.className = `estado-aire ${clase}`;
        el.innerHTML = `<i class="fa-solid ${icono}"></i> ${texto}`;
      }
    }
  });
}

// ---------- Registro de actividad ----------
function lineaRegistro(l, nuevo) {
  const s = QHDC.sensores().find((x) => x.id === l.sensorId);
  const p = l.productoId ? QHDC.producto(l.productoId) : null;
  return `<li class="${nuevo ? "nuevo" : ""}">
    <span class="prod-icono ${p ? `ico-${p.color}` : "ico-petroleo"}" style="width:30px;height:30px;font-size:0.8rem"><i class="fa-solid ${p ? p.icono : "fa-wind"}"></i></span>
    <span>${p ? esc(p.nombre) : "Calidad del aire"}<br><time>${UI.hora(l.fecha)} · ${s ? esc(s.nombre) : ""}</time></span>
    <b>${l.valor} ${l.unidad}</b></li>`;
}
function dibujarRegistro() {
  $("#registro").innerHTML = QHDC.lecturas(14).map((l) => lineaRegistro(l, false)).join("");
}
function agregarAlRegistro(nuevas) {
  const lista = $("#registro");
  nuevas.slice().reverse().forEach((l) => lista.insertAdjacentHTML("afterbegin", lineaRegistro(l, true)));
  while (lista.children.length > 24) lista.lastElementChild.remove();
}

// ---------- Ciclo en vivo ----------
function ciclo() {
  const nuevas = QHDC.simularCiclo();
  ultimaLectura = Date.now();
  actualizarValores();
  agregarAlRegistro(nuevas);
  UI.actualizarContadores();
}
setInterval(() => {
  const s = Math.round((Date.now() - ultimaLectura) / 1000);
  $("#ultimaVez").textContent = temporizador ? (s < 2 ? "Recibiendo datos" : `Última lectura hace ${s} s`) : "Actualizaciones en pausa";
}, 1000);

function reanudar(activo) {
  clearInterval(temporizador);
  temporizador = activo ? setInterval(ciclo, INTERVALO) : null;
  $("#indicador").classList.toggle("pausa", !activo);
  $("#indicador span:last-child").textContent = activo ? "En vivo" : "En pausa";
  const b = $("#btnPausa");
  b.setAttribute("aria-pressed", !activo);
  b.innerHTML = activo ? '<i class="fa-solid fa-pause"></i> Pausar' : '<i class="fa-solid fa-play"></i> Reanudar';
}
$("#btnPausa").addEventListener("click", () => reanudar(!temporizador));

// ---------- Botones de cada dispositivo ----------
$("#dispositivos").addEventListener("click", (e) => {
  const conectar = e.target.closest("[data-conectar]");
  const calibrar = e.target.closest("[data-calibrar]");
  const b = conectar || calibrar;
  if (!b) return;
  b.disabled = true;
  b.classList.add("girando");
  b.innerHTML = `<i class="fa-solid fa-rotate"></i> ${conectar ? "Conectando…" : "Ajustando…"}`;
  Sonido.escaneo();
  setTimeout(() => {
    if (conectar) {
      const s = QHDC.alternarSensor(conectar.dataset.conectar);
      Sonido.exito();
      toast(`${s.nombre} está en línea`, { icono: "fa-wifi" });
      dibujarDispositivos();
      UI.actualizarContadores();
    } else {
      Sonido.marcar();
      toast("Listo, el dispositivo quedó ajustado", { icono: "fa-sliders" });
      b.disabled = false;
      b.classList.remove("girando");
      b.innerHTML = '<i class="fa-solid fa-check"></i> Ajustado';
    }
  }, conectar ? 1800 : 1300);
});

// ---------- Vincular ----------
$("#btnVincular").addEventListener("click", () => {
  $("#claveNueva").textContent = "qhdc-" + Math.random().toString(36).slice(2, 6) + "-" + Math.random().toString(36).slice(2, 6);
  abrirModal("modalVincular");
});
$("#btnCopiar").addEventListener("click", () => {
  navigator.clipboard?.writeText($("#claveNueva").textContent).catch(() => {});
  Sonido.marcar();
  $("#btnCopiar").innerHTML = '<i class="fa-solid fa-check"></i> Copiada';
});

dibujarDispositivos();
dibujarRegistro();
reanudar(true);

// ============================================================
//  RECORRIDO DE ESTA PANTALLA
// ============================================================
UI.registrarRecorrido([
  { sel: ".topbar-titulo", titulo: "Tus dispositivos", texto: "Las básculas y sensores de tu cocina. Ellos actualizan tu alacena sin que hagas nada." },
  { sel: "#indicador", titulo: "En vivo", texto: "Mientras veas el punto verde, estás recibiendo datos al momento." },
  { sel: "#ultimaVez", titulo: "Última lectura", texto: "Cuánto tiempo pasó desde el último dato recibido." },
  { sel: "#btnPausa", titulo: "Pausar", texto: "Detiene las actualizaciones en pantalla por un momento. Tócalo otra vez para reanudar." },
  { sel: "#btnVincular", titulo: "Agregar un dispositivo", texto: "Te guiamos en 3 pasos para conectar una báscula o sensor nuevo." },
  { sel: ".aparato .aparato-cab", titulo: "Cada dispositivo", texto: "Su nombre, de qué está hecho, dónde está y si está en línea. El foquito parpadea cada vez que manda un dato." },
  { sel: ".aparato .plataforma", titulo: "Lo que pesa", texto: "Los alimentos que están sobre esta báscula y cuánto pesan ahora." },
  { sel: ".aparato .pesado", titulo: "Cambios al momento", texto: "Cuando alguien toma un poco, verás la flecha roja con lo que se usó. El frasco baja solo." },
  { sel: ".aparato .metricas", titulo: "Señal y batería", texto: "Qué tan buena es su conexión WiFi y cuánta batería le queda." },
  { sel: "[data-calibrar]", titulo: "Calibrar", texto: "Si una báscula marca raro, ajústala con este botón." },
  { sel: ".medidor-gas", titulo: "Sensor de frescura", texto: "Detecta los gases que sueltan los alimentos al echarse a perder. Si la aguja llega a rojo, revisa tu refri." },
  { sel: () => { const b = $("[data-conectar]"); return b && b.closest(".aparato"); }, titulo: "Sin conexión", texto: "Si un dispositivo se desconecta lo verás así, y también te llegará un aviso." },
  { sel: "[data-conectar]", titulo: "Reintentar", texto: "Revisa que esté encendido y toca aquí para volver a conectarlo." },
  { sel: ".actividad", titulo: "Actividad", texto: "Cada dato que llega, con la hora exacta. Lo más nuevo aparece arriba." },
]);
