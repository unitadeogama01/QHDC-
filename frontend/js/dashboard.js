// ============================================================
//  QHDC! — Inicio (dashboard.html)
//  Resumen de toda la cocina (HU-09), ruleta "¿Qué hay de comer?"
//  (HU-08), índice de frescura y recorrido de bienvenida.
// ============================================================

const { $, esc, frasco, badgeCaducidad, iconoProducto, dinero } = UI;

function dibujar() {
  const productos = QHDC.productos();
  const sensores = QHDC.sensores();
  const compras = QHDC.listaCompras().items.filter((i) => !i.comprado);

  // ---------- Saludo según la hora ----------
  const h = new Date().getHours();
  const saludo = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  $("#saludo").textContent = `${saludo}, ${UI.sesion.nombre.split(" ")[0]}`;
  const hoy = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  $("#fechaHoy").textContent = hoy.charAt(0).toUpperCase() + hoy.slice(1);

  // ---------- Frescura ----------
  const f = QHDC.frescura();
  const anillo = $("#anillo");
  anillo.style.setProperty("--color", f.valor >= 75 ? "var(--oliva)" : f.valor >= 50 ? "var(--mostaza)" : "var(--tomate)");
  requestAnimationFrame(() => anillo.style.setProperty("--valor", f.valor));
  Efectos.contar($("#frescuraValor"), f.valor, { duracion: 1400 });
  const [titulo, frase] =
    f.valor >= 85 ? ["¡Cocina impecable!", "Casi todo está fresco y tienes lo necesario."] :
    f.valor >= 65 ? ["Vas muy bien", "Hay algunos alimentos que conviene usar estos días."] :
    f.valor >= 45 ? ["Necesita atención", "Varios alimentos están por caducar o por acabarse."] :
                    ["¡A cocinar ya!", "Tienes alimentos caducados o a punto de caducar."];
  $("#frescuraTitulo").textContent = titulo;
  $("#frescuraFrase").textContent = frase;
  $("#frescuraDetalle").innerHTML = [
    f.caducados && `<li class="badge badge-peligro"><i class="fa-solid fa-skull-crossbones"></i> ${f.caducados} caducado${f.caducados > 1 ? "s" : ""}</li>`,
    f.urgentes && `<li class="badge badge-peligro"><i class="fa-solid fa-hourglass-end"></i> ${f.urgentes} urgente${f.urgentes > 1 ? "s" : ""}</li>`,
    f.pronto && `<li class="badge badge-aviso"><i class="fa-solid fa-hourglass-half"></i> ${f.pronto} pronto</li>`,
    f.bajos && `<li class="badge badge-aviso"><i class="fa-solid fa-arrow-trend-down"></i> ${f.bajos} por acabarse</li>`,
  ].filter(Boolean).join("") || `<li class="badge badge-ok"><i class="fa-solid fa-check"></i> Todo en orden</li>`;

  // ---------- Atajos ----------
  Efectos.contar($("#nAlimentos"), productos.length);
  Efectos.contar($("#nCaducar"), productos.filter((p) => ["caducado", "urgente", "pronto"].includes(p.estado.cad)).length);
  Efectos.contar($("#nComprar"), compras.length);
  Efectos.contar($("#nSensores"), sensores.filter((s) => s.enLinea).length);

  // ---------- Úsalo pronto (estante de frascos) ----------
  const pronto = productos.filter((p) => p.cantidad > 0).sort((a, b) => a.estado.dias - b.estado.dias).slice(0, 8);
  $("#estante").innerHTML = pronto.map((p) => `
    <a class="estante-item" href="inventario.html?id=${p.id}">
      ${frasco(p, 66)}
      <strong>${esc(p.nombre)}</strong>
      <small>${QHDC.formatoCantidad(p.cantidad, p.unidad)}</small>
      ${badgeCaducidad(p.estado)}
    </a>`).join("");
  Efectos.escalonar($("#seccionPronto"));

  // ---------- Asistente ----------
  $("#textoIA").textContent = QHDC.resumenIA();

  // ---------- Lista ----------
  $("#listaCompras").innerHTML = compras.slice(0, 4).map((i) => `
    <li>
      ${i.producto ? iconoProducto(i.producto) : '<span class="prod-icono ico-cafe"><i class="fa-solid fa-basket-shopping"></i></span>'}
      <div class="info"><strong>${esc(i.nombre)}</strong><small>${esc(i.motivo)}</small></div>
      <strong>${dinero(i.precio)}</strong>
    </li>`).join("") || `<li><div class="info"><strong>Nada pendiente</strong><small>Tu despensa está completa</small></div></li>`;
  $("#totalCompras").textContent = dinero(compras.reduce((s, i) => s + i.precio, 0));

  // ---------- Dispositivos ----------
  const ICONO = { peso: "fa-scale-balanced", gas: "fa-wind", temperatura: "fa-temperature-low" };
  $("#dispositivos").innerHTML = sensores.map((s) => `
    <a class="disp ${s.enLinea ? "" : "apagado"}" href="sensores.html">
      <span class="prod-icono ${s.enLinea ? "ico-petroleo" : "ico-cafe"}"><i class="fa-solid ${ICONO[s.tipo]}"></i></span>
      <span>
        <strong>${esc(s.nombre)}</strong>
        <small class="estado">${s.enLinea ? '<span class="punto-vivo"></span> En línea' : '<i class="fa-solid fa-plug-circle-xmark"></i> Sin conexión'}</small>
      </span>
    </a>`).join("");
}

// ============================================================
//  RULETA "¿QUÉ HAY DE COMER?"
//  Pasa rápido por varias recetas, frena poco a poco y se detiene
//  en la mejor según lo que hay en casa.
// ============================================================
let girando = false;
let indiceGanadora = 0;

function girarRuleta() {
  if (girando) return;
  girando = true;
  const recetas = QHDC.recetasSugeridas();
  const ganadora = recetas[indiceGanadora % recetas.length];
  indiceGanadora++;
  const plato = $("#ruletaPlato");
  const boton = $("#btnRuleta");
  boton.disabled = true;
  $("#verPlatillo").classList.add("oculto");
  plato.classList.remove("listo");

  const pasos = menosMovimiento() ? 1 : 16;
  let n = 0;
  const mostrar = (r) => {
    $(".ruleta-icono", plato).innerHTML = `<i class="fa-solid ${r.icono}"></i>`;
    $("#ruletaNombre").textContent = r.nombre;
    $("#ruletaDetalle").textContent = `${r.tiempo} min · tienes ${r.ingredientes.length - r.faltan} de ${r.ingredientes.length}`;
  };
  const tick = () => {
    n++;
    if (n < pasos) {
      mostrar(recetas[(n * 3) % recetas.length]);
      plato.classList.remove("girando"); void plato.offsetWidth; plato.classList.add("girando");
      Sonido.tic();
      setTimeout(tick, 40 + n * n * 1.6);
    } else {
      mostrar(ganadora);
      plato.classList.remove("girando");
      plato.classList.add("listo");
      Sonido.exito();
      const r = plato.getBoundingClientRect();
      Efectos.confeti(r.left + r.width / 2, r.top + r.height / 2);
      const urg = ganadora.ingredientes.filter((i) => i.urgente).map((i) => i.nombre.toLowerCase());
      $("#ruletaPista").textContent = urg.length
        ? `¡${ganadora.nombre}! Así aprovechas ${urg.join(" y ")} antes de que caduque${urg.length > 1 ? "n" : ""}.`
        : `¡${ganadora.nombre}! Tienes casi todo lo que necesitas.`;
      $("#verPlatillo").href = `recetas.html?id=${ganadora.id}`;
      $("#verPlatillo").classList.remove("oculto");
      boton.innerHTML = '<i class="fa-solid fa-rotate"></i> Otra idea';
      boton.disabled = false;
      girando = false;
    }
  };
  tick();
}
$("#btnRuleta").addEventListener("click", girarRuleta);

// ============================================================
//  RECORRIDO DE ESTA PANTALLA (primera vez, o con el botón "?")
//  Incluye al final las partes comunes de la app (menú, barra, +).
// ============================================================
dibujar();
const params = new URLSearchParams(location.search);
if (params.get("ruleta")) setTimeout(girarRuleta, 500);

UI.registrarRecorrido([
  { sel: ".topbar-titulo", titulo: "¡Bienvenido a tu cocina!", texto: "Te mostraremos cada parte en un minuto. Puedes saltar el recorrido cuando quieras." },
  { sel: "#ruletaTarjeta", titulo: "¿Qué hay de comer?", texto: "Cuando no sepas qué cocinar, aquí te proponemos un platillo con lo que ya tienes en casa." },
  { sel: "#btnRuleta", titulo: "Sorpréndeme", texto: "Tócalo y la ruleta elige la mejor receta. Si no te convence, tócalo otra vez para otra idea." },
  { sel: ".ruleta-ventana", titulo: "El platillo elegido", texto: "Aquí aparece la receta con su tiempo y cuántos ingredientes ya tienes." },
  { sel: "#frescuraTarjeta", titulo: "Frescura de tu cocina", texto: "Un número del 0 al 100 que resume todo. Sube cuando aprovechas tus alimentos y baja si algo caduca." },
  { sel: "#frescuraDetalle", titulo: "¿Por qué ese número?", texto: "Estas etiquetas te dicen qué lo está bajando: caducados, urgentes o cosas por acabarse." },
  { sel: ".atajo:nth-child(1)", titulo: "Tus alimentos", texto: "Cuántos alimentos tienes registrados. Tócalo para ir a tu alacena." },
  { sel: ".atajo:nth-child(2)", titulo: "Por caducar", texto: "Lo que caduca en los próximos días. Tócalo para ver tus avisos." },
  { sel: ".atajo:nth-child(3)", titulo: "Por comprar", texto: "Cuántas cosas hay en tu lista del súper ahora mismo." },
  { sel: ".atajo:nth-child(4)", titulo: "Dispositivos activos", texto: "Las básculas y sensores que están enviando datos en este momento." },
  { sel: "#estante", titulo: "Úsalo pronto", texto: "Tus alimentos ordenados por fecha: los primeros son los que caducan antes. Desliza para ver más." },
  { sel: "#estante .estante-item", titulo: "Un frasco = un alimento", texto: "Entre más lleno, más te queda. Verde es suficiente, amarillo a la mitad y rojo queda poco. Tócalo para ver el detalle." },
  { sel: "#tarjetaAsistente .burbuja-ia", titulo: "Tu asistente", texto: "Un resumen de lo más importante de tu cocina hoy, en palabras sencillas." },
  { sel: "#preguntasRapidas", titulo: "Pregúntale", texto: "Toca una pregunta y el asistente te responde con tus propios datos." },
  { sel: ".ticket-mini", titulo: "Para el súper", texto: "Lo primero de tu lista de compras y cuánto gastarías, aproximadamente." },
  { sel: "#dispositivos", titulo: "Tus dispositivos", texto: "El estado de cada báscula y sensor. El punto verde significa que está en línea." },
  ...UI.pasosGenerales(),
]);
