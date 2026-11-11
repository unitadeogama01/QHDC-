// ============================================================
//  QHDC! — Dispositivos (sensores.html)
//  HU-03 Actualización automática mediante sensores IoT
//
//  Cada 3 segundos se piden al servidor las lecturas nuevas que
//  mandaron los ESP32 (QHDC.simularCiclo) y se actualizan los valores
//  en su lugar, sin redibujar toda la página.
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

// ¿La celda de carga mandó peso hace poco? (2 min; el firmware manda al menos cada 30 s)
const basculaActiva = (s) => Boolean(s.ultimoPeso) && Date.now() - new Date(s.ultimoPeso).getTime() < 2 * 60 * 1000;

// Temperatura y humedad del DHT22 (mismo bloque que usaba el sensor de frescura)
function ambiente(s) {
  if (typeof s.temperatura !== "number" && typeof s.humedad !== "number") return "";
  return `
    <div class="ambiente" style="margin-top:12px">
      <div><strong data-temp>${typeof s.temperatura === "number" ? `${s.temperatura} °C` : "—"}</strong><small>Temperatura</small></div>
      <div><strong data-hum>${typeof s.humedad === "number" ? `${s.humedad}%` : "—"}</strong><small>Humedad</small></div>
    </div>`;
}

// Batería, o "USB" si el ESP32 está conectado por cable (sin batería)
function energia(s) {
  if (s.bateria === null || s.bateria === undefined) return '<span title="Alimentado por USB"><i class="fa-solid fa-plug"></i> USB</span>';
  return `<span class="${s.bateria < 20 ? "bateria-baja" : ""}"><i class="fa-solid ${s.bateria < 20 ? "fa-battery-quarter" : s.bateria < 60 ? "fa-battery-half" : "fa-battery-three-quarters"}"></i> ${s.bateria}%</span>`;
}

// ---------- Cuerpo de cada tipo de dispositivo ----------
function cuerpo(s) {
  if (!s.enLinea) {
    return `<div class="vacio" style="padding:18px 0"><div class="ilustra" style="background:var(--superficie-2);color:var(--texto-suave)"><i class="fa-solid fa-plug-circle-xmark"></i></div>
      <strong>Sin conexión</strong><p>Revisa que esté encendido y cerca de tu WiFi.</p></div>`;
  }
  if (s.tipo === "peso") {
    // El ESP32 puede estar en línea (p. ej. por el DHT22) sin que la celda de carga mande datos
    if (!basculaActiva(s)) {
      return `<div class="vacio" data-bascula="no" style="padding:12px 0"><div class="ilustra" style="background:var(--superficie-2);color:var(--texto-suave)"><i class="fa-solid fa-scale-unbalanced"></i></div>
          <strong>Báscula sin conectar</strong><p>El ESP32 está en línea, pero todavía no llegan datos de la celda de carga (HX711).</p></div>` + ambiente(s);
    }
    const pesados = s.productos.map((pid) => QHDC.producto(pid)).filter(Boolean);
    const plataforma = pesados.length
      ? `<div class="plataforma" data-bascula="si">${pesados.map((p) => {
          anteriores[p.id] = p.cantidad;
          return `
            <div class="pesado" data-prod="${p.id}">
              ${frasco(p, 46)}
              <div class="info"><strong>${esc(p.nombre)}</strong><small class="texto-suave">${p.estado.pct}% lleno</small></div>
              <div><span class="peso">${QHDC.formatoCantidad(p.cantidad, p.unidad)}</span><span class="delta"></span></div>
            </div>`;
        }).join("")}</div>`
      : `<div class="vacio" data-bascula="si" style="padding:12px 0"><div class="ilustra" style="background:var(--mostaza-claro);color:var(--tinta)"><i class="fa-solid fa-jar"></i></div>
          <strong>Sin alimento asignado</strong><p>Toca <b>Calibrar</b> y elige qué alimento está sobre la báscula.</p></div>`;
    return plataforma + ambiente(s);
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
  if (!QHDC.sensores().length) {
    // Hogar sin ningún ESP32 vinculado todavía
    $("#dispositivos").innerHTML = `
      <div class="tarjeta vacio" style="grid-column:1/-1">
        <div class="ilustra" style="background:var(--petroleo-claro);color:var(--petroleo)"><i class="fa-solid fa-microchip"></i></div>
        <strong>Aún no tienes dispositivos</strong>
        <p>Vincula tu ESP32 (báscula y sensor de temperatura y humedad) con <b>Vincular dispositivo</b>. Te daremos su identificador y su clave para el firmware.</p>
      </div>`;
    return;
  }
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
          ${energia(s)}
        </div>
        ${s.enLinea
          ? (s.tipo === "peso"
            ? `<button class="btn btn-sm" type="button" data-calibrar="${s.id}"><i class="fa-solid fa-sliders"></i> Calibrar</button>`
            : `<button class="btn btn-sm" type="button" data-probar="${s.id}" data-sonido="ninguno"><i class="fa-solid fa-sliders"></i> Probar</button>`)
          : `<button class="btn btn-sm btn-principal" type="button" data-conectar="${s.id}" data-sonido="ninguno"><i class="fa-solid fa-rotate"></i> Reintentar conexión</button>`}
      </div>
    </article>`).join("");
}

// ---------- Actualizar valores en su lugar ----------
function actualizarValores() {
  const sensores = QHDC.sensores();
  // Si un dispositivo se conectó/desconectó, apareció uno nuevo o cambió el
  // alimento de la báscula, se vuelve a dibujar todo (es raro y es barato).
  const cambio = sensores.length !== $$("[data-sensor]").length || sensores.some((s) => {
    const t = $(`[data-sensor="${s.id}"]`);
    const bascula = t && $("[data-bascula]", t);
    return !t || t.classList.contains("apagado") === s.enLinea
      || (s.tipo === "peso" && s.enLinea && (!bascula || bascula.dataset.bascula !== (basculaActiva(s) ? "si" : "no")))
      || (s.tipo === "peso" && s.enLinea && s.productos.join() !== $$("[data-prod]", t).map((x) => x.dataset.prod).join());
  });
  if (cambio) { dibujarDispositivos(); return; }

  sensores.forEach((s) => {
    const tarjeta = $(`[data-sensor="${s.id}"]`);
    if (!tarjeta || !s.enLinea) return;
    const temp = $("[data-temp]", tarjeta), hum = $("[data-hum]", tarjeta);
    if (temp && typeof s.temperatura === "number") temp.textContent = `${s.temperatura} °C`;
    if (hum && typeof s.humedad === "number") hum.textContent = `${s.humedad}%`;
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
// Nombre e icono de una lectura que no es de un alimento
const LECTURA = {
  temperatura: ["Temperatura", "fa-temperature-half"],
  humedad: ["Humedad", "fa-droplet"],
  gas: ["Calidad del aire", "fa-wind"],
};
function lineaRegistro(l, nuevo) {
  const s = QHDC.sensores().find((x) => x.id === l.sensorId);
  const p = l.productoId ? QHDC.producto(l.productoId) : null;
  const [nombre, icono] = LECTURA[l.tipo] || ["Lectura", "fa-wave-square"];
  return `<li class="${nuevo ? "nuevo" : ""}">
    <span class="prod-icono ${p ? `ico-${p.color}` : "ico-petroleo"}" style="width:30px;height:30px;font-size:0.8rem"><i class="fa-solid ${p ? p.icono : icono}"></i></span>
    <span>${p ? esc(p.nombre) : nombre}<br><time>${UI.hora(l.fecha)} · ${s ? esc(s.nombre) : ""}</time></span>
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
// Pone un botón en modo "trabajando…" y devuelve cómo regresarlo
function ocupado(b, texto) {
  const antes = b.innerHTML;
  b.disabled = true;
  b.classList.add("girando");
  b.innerHTML = `<i class="fa-solid fa-rotate"></i> ${texto}`;
  return (nuevo = antes) => { b.disabled = false; b.classList.remove("girando"); b.innerHTML = nuevo; };
}

$("#dispositivos").addEventListener("click", async (e) => {
  const calibrar = e.target.closest("[data-calibrar]");
  if (calibrar) { abrirCalibracion(Number(calibrar.dataset.calibrar)); return; }

  // "Reintentar conexión" o "Probar": se le pregunta al dispositivo si responde
  const b = e.target.closest("[data-conectar], [data-probar]");
  if (!b) return;
  const listo = ocupado(b, b.dataset.conectar ? "Conectando…" : "Probando…");
  Sonido.escaneo();
  try {
    const s = await QHDC.reconectarSensor(b.dataset.conectar || b.dataset.probar);
    if (s.enLinea) {
      Sonido.exito();
      toast(`${s.nombre} está en línea`, { icono: "fa-wifi" });
    } else {
      Sonido.alerta();
      toast(`${s.nombre} no responde. Revisa el cable USB y que tenga WiFi.`, { icono: "fa-plug-circle-xmark" });
    }
  } catch (err) {
    Sonido.alerta();
    toast(err.message, { icono: "fa-triangle-exclamation" });
  }
  listo();
  dibujarDispositivos();
  UI.actualizarContadores();
});

// ---------- Vincular un ESP32 nuevo ----------
$("#btnVincular").addEventListener("click", () => {
  $("#vincularForm").classList.remove("oculto");
  $("#claveCaja").classList.add("oculto");
  $("#btnCrearDispositivo").classList.remove("oculto");
  $("#btnListoVincular").classList.add("oculto");
  $("#btnCopiar").innerHTML = '<i class="fa-solid fa-copy"></i> Copiar';
  abrirModal("modalVincular");
});
$("#btnCrearDispositivo").addEventListener("click", async () => {
  const b = $("#btnCrearDispositivo");
  const listo = ocupado(b, "Creando…");
  try {
    const r = await QHDC.vincularDispositivo($("#nombreNuevo").value.trim());
    $("#claveNueva").innerHTML = `ID_DISPOSITIVO: ${esc(r.identificador)}<br>CLAVE_DISPOSITIVO: ${esc(r.clave)}`;
    $("#claveNueva").dataset.copiar = `#define ID_DISPOSITIVO    "${r.identificador}"\n#define CLAVE_DISPOSITIVO "${r.clave}"`;
    $("#vincularForm").classList.add("oculto");
    $("#claveCaja").classList.remove("oculto");
    b.classList.add("oculto");
    $("#btnListoVincular").classList.remove("oculto");
    Sonido.exito();
    dibujarDispositivos();
  } catch (err) {
    Sonido.alerta();
    toast(err.message, { icono: "fa-triangle-exclamation" });
  }
  listo();
});
$("#btnCopiar").addEventListener("click", () => {
  navigator.clipboard?.writeText($("#claveNueva").dataset.copiar || $("#claveNueva").textContent).catch(() => {});
  Sonido.marcar();
  $("#btnCopiar").innerHTML = '<i class="fa-solid fa-check"></i> Copiada';
});

// ---------- Calibrar báscula (real: el ESP32 ejecuta la tara y el factor) ----------
let calibrando = null; // id del dispositivo abierto en la ventana

function estadoCalibracion(texto, tipo = "") {
  const el = $("#calEstado");
  el.innerHTML = texto;
  el.style.color = tipo === "error" ? "var(--tomate)" : tipo === "ok" ? "var(--oliva)" : "";
}

function abrirCalibracion(id) {
  const s = QHDC.sensores().find((x) => x.id === id);
  if (!s) return;
  calibrando = id;
  const actual = s.productos[0];
  const pesables = QHDC.productos().filter((p) => ["g", "kg", "pz"].includes(p.unidad));
  $("#calAlimento").innerHTML = `<option value="">Elige un alimento…</option>` + pesables.map((p) =>
    `<option value="${p.id}" data-unidad="${p.unidad}" ${p.id === actual ? "selected" : ""}>${esc(p.nombre)} (${p.unidad})</option>`).join("");
  mostrarCampoPieza();
  estadoCalibracion(s.ultimaCalibracion
    ? `<i class="fa-solid fa-clock-rotate-left"></i> Última calibración: ${UI.fecha(s.ultimaCalibracion)}`
    : "Esta báscula todavía no se ha calibrado.");
  abrirModal("modalCalibrar");
}
function mostrarCampoPieza() {
  const op = $("#calAlimento").selectedOptions[0];
  $("#calCampoPieza").classList.toggle("oculto", !op || op.dataset.unidad !== "pz");
}
$("#calAlimento").addEventListener("change", mostrarCampoPieza);

$("#calGuardarAlimento").addEventListener("click", async () => {
  const alimentoId = Number($("#calAlimento").value);
  if (!alimentoId) { estadoCalibracion("Primero elige un alimento.", "error"); return; }
  const b = $("#calGuardarAlimento");
  const listo = ocupado(b, "Guardando…");
  try {
    const pieza = $("#calCampoPieza").classList.contains("oculto") ? undefined : Number($("#calPesoPieza").value) || undefined;
    await QHDC.asignarAlimentoBascula(calibrando, alimentoId, pieza);
    Sonido.marcar();
    estadoCalibracion(`<i class="fa-solid fa-check"></i> Listo: ${esc($("#calAlimento").selectedOptions[0].textContent)} está sobre la báscula.`, "ok");
    dibujarDispositivos();
  } catch (err) {
    Sonido.alerta();
    estadoCalibracion(esc(err.message), "error");
  }
  listo();
});

async function pasoCalibracion(b, paso) {
  const peso = Number($("#calPeso").value);
  if (paso === "factor" && !(peso >= 10)) { estadoCalibracion("Escribe el peso de referencia en gramos (10 g o más).", "error"); return; }
  const listo = ocupado(b, paso === "tara" ? "Poniendo en cero…" : "Calibrando…");
  estadoCalibracion('<i class="fa-solid fa-hourglass-half"></i> Esperando a la báscula… no la toques.');
  Sonido.escaneo();
  try {
    const r = await QHDC.calibrarBascula(calibrando, paso, paso === "factor" ? peso : undefined);
    Sonido.exito();
    estadoCalibracion(paso === "tara"
      ? '<i class="fa-solid fa-check"></i> Báscula en cero. Ahora coloca el peso de referencia (paso 2).'
      : `<i class="fa-solid fa-check"></i> ¡Calibrada! Quita el peso de referencia y vuelve a poner el alimento.${r.factor ? ` <small>(factor ${r.factor})</small>` : ""}`, "ok");
    toast(paso === "tara" ? "Báscula en cero" : "Báscula calibrada", { icono: "fa-sliders" });
  } catch (err) {
    Sonido.alerta();
    estadoCalibracion(esc(err.message), "error");
  }
  listo();
}
$("#calTara").addEventListener("click", (e) => pasoCalibracion(e.currentTarget, "tara"));
$("#calFactor").addEventListener("click", (e) => pasoCalibracion(e.currentTarget, "factor"));

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
  { sel: ".aparato .ambiente", titulo: "Temperatura y humedad", texto: "El sensor DHT22 mide el ambiente del lugar. Si sale del rango configurado te llegará un aviso." },
  { sel: ".aparato .metricas", titulo: "Señal y energía", texto: "Qué tan buena es su conexión WiFi y si está conectado por USB o con batería." },
  { sel: "[data-calibrar]", titulo: "Calibrar", texto: "Elige qué alimento está sobre la báscula, ponla en cero y calíbrala con un peso conocido." },
  { sel: ".medidor-gas", titulo: "Sensor de frescura", texto: "Detecta los gases que sueltan los alimentos al echarse a perder. Si la aguja llega a rojo, revisa tu refri." },
  { sel: () => { const b = $("[data-conectar]"); return b && b.closest(".aparato"); }, titulo: "Sin conexión", texto: "Si un dispositivo se desconecta lo verás así, y también te llegará un aviso." },
  { sel: "[data-conectar]", titulo: "Reintentar", texto: "Revisa que esté encendido y toca aquí para volver a conectarlo." },
  { sel: ".actividad", titulo: "Actividad", texto: "Cada dato que llega, con la hora exacta. Lo más nuevo aparece arriba." },
]);
