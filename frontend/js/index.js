// ============================================================
//  QHDC! — Página de bienvenida (index.html)
// ============================================================

const $ = (s) => document.querySelector(s);

// ---------- Menú en celular ----------
const toggle = $("#menuToggle"), links = $("#navLinks");
toggle.addEventListener("click", () => {
  const abierto = links.classList.toggle("abierto");
  toggle.setAttribute("aria-expanded", abierto);
  toggle.innerHTML = `<i class="fa-solid ${abierto ? "fa-xmark" : "fa-bars"}"></i>`;
});
links.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => {
  links.classList.remove("abierto");
  toggle.setAttribute("aria-expanded", false);
  toggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
}));

// Barra con fondo al hacer scroll
const nav = $("#nav");
const fondoNav = () => nav.classList.toggle("con-fondo", scrollY > 10);
addEventListener("scroll", fondoNav, { passive: true });
fondoNav();

// ---------- Tema y sonido ----------
function pintarPreferencias() {
  const oscuro = Tema.actual() === "oscuro";
  $("#btnTema").innerHTML = `<i class="fa-solid ${oscuro ? "fa-sun" : "fa-moon"}"></i>`;
  $("#btnTema").setAttribute("aria-label", oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
  $("#btnSonido").innerHTML = `<i class="fa-solid ${Sonido.activo() ? "fa-volume-high" : "fa-volume-xmark"}"></i>`;
  $("#btnSonido").setAttribute("aria-label", Sonido.activo() ? "Silenciar sonidos" : "Activar sonidos");
}
$("#btnTema").addEventListener("click", () => Tema.alternar());
$("#btnSonido").addEventListener("click", () => Sonido.alternar());
document.addEventListener("tema", pintarPreferencias);
document.addEventListener("sonido", pintarPreferencias);
pintarPreferencias();

// Si ya hay una sesión abierta, "Entrar" lleva directo a la app
if (Pref.leer("qhdc_sesion", null)) {
  document.querySelectorAll('a[href="login.html"]').forEach((a) => {
    a.href = "dashboard.html";
    const span = a.querySelector("span");
    if (span) span.textContent = "Mi cocina";
  });
}

// ---------- Aparecer al hacer scroll ----------
document.querySelectorAll(".revelar").forEach((grupo) => [...grupo.children].forEach((h, i) => h.style.setProperty("--i", i)));
const observador = new IntersectionObserver((entradas) => {
  entradas.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("visible"); observador.unobserve(e.target); } });
}, { threshold: 0.15 });
document.querySelectorAll(".revelar").forEach((el) => observador.observe(el));

// ---------- Los frascos del refri suben y bajan solos ----------
const frascos = ["#f1", "#f2", "#f3"].map((s) => $(s));
if (!menosMovimiento()) {
  setInterval(() => {
    frascos.forEach((f) => {
      const nivel = Math.round(10 + Math.random() * 85);
      f.style.setProperty("--nivel", nivel + "%");
      f.className = `frasco ${nivel <= 25 ? "bajo" : nivel <= 50 ? "medio" : ""}`;
    });
  }, 2600);
}

// ---------- Plato "¿Qué hay de comer?" ----------
const platillos = [
  ["fa-bowl-food", "Arroz con pollo"], ["fa-fire-burner", "Tinga de pollo"], ["fa-egg", "Omelette de espinaca"],
  ["fa-utensils", "Chilaquiles verdes"], ["fa-wheat-awn", "Pasta al pomodoro"], ["fa-fish", "Pescado al limón"],
];
let girando = false;
$("#platoHero").addEventListener("click", () => {
  if (girando) return;
  girando = true;
  const plato = $("#platoHero");
  plato.classList.remove("listo");
  plato.classList.add("girando");
  let n = 0;
  const total = menosMovimiento() ? 1 : 14;
  const paso = () => {
    const [icono, nombre] = platillos[Math.floor(Math.random() * platillos.length)];
    $("#platoIcono").innerHTML = `<i class="fa-solid ${icono}"></i>`;
    if (++n < total) {
      Sonido.tic();
      $("#platoTexto").innerHTML = `${nombre}<small>Pensando…</small>`;
      setTimeout(paso, 50 + n * n * 2);
    } else {
      plato.classList.remove("girando");
      plato.classList.add("listo");
      $("#platoTexto").innerHTML = `¡${nombre}!<small>Toca para otra idea</small>`;
      Sonido.exito();
      const r = plato.getBoundingClientRect();
      Efectos.confeti(r.left + 40, r.top + 30);
      girando = false;
    }
  };
  paso();
});
