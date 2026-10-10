// ============================================================
//  QHDC! — Crear cuenta (registro.html)
//  Registro en 3 pasos cortos: tú, tu hogar y tu contraseña.
// ============================================================

if (QHDC.sesionActual()) location.replace("dashboard.html");

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let etapa = 0;
const TITULOS = ["¡Hola! ¿Cómo te llamas?", "Cuéntanos de tu hogar", "Último paso: tu contraseña"];

// ---------- Tema ----------
function pintarTema() {
  const oscuro = Tema.actual() === "oscuro";
  $("#btnTema").innerHTML = `<i class="fa-solid ${oscuro ? "fa-sun" : "fa-moon"}"></i>`;
  $("#btnTema").setAttribute("aria-label", oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
}
$("#btnTema").addEventListener("click", () => Tema.alternar());
document.addEventListener("tema", pintarTema);
pintarTema();

// ---------- Mostrar etapa ----------
function mostrar() {
  $$(".etapa").forEach((e) => e.classList.toggle("oculto", Number(e.dataset.etapa) !== etapa));
  $$("#etapas span").forEach((s, i) => s.classList.toggle("hecha", i <= etapa));
  $("#tituloEtapa").textContent = TITULOS[etapa];
  $("#textoEtapa").textContent = `Paso ${etapa + 1} de 3`;
  $("#btnAtras").style.visibility = etapa === 0 ? "hidden" : "visible";
  $("#btnSiguiente").innerHTML = etapa === 2 ? '<i class="fa-solid fa-house-circle-check"></i> Crear mi cocina' : 'Continuar <i class="fa-solid fa-arrow-right"></i>';
  $("#error").classList.add("oculto");
  const primero = $(`.etapa[data-etapa="${etapa}"] input`);
  if (primero) primero.focus();
}

function error(texto, campo) {
  $("#error span").textContent = texto;
  const c = $("#error"); c.classList.add("oculto"); void c.offsetWidth; c.classList.remove("oculto");
  if (campo) { campo.classList.remove("invalido"); void campo.offsetWidth; campo.classList.add("invalido"); campo.focus(); }
  Sonido.alerta();
  return false;
}

function validar() {
  if (etapa === 0) {
    if ($("#nombre").value.trim().length < 3) return error("Escribe tu nombre.", $("#nombre"));
    if (!/^\S+@\S+\.\S+$/.test($("#email").value.trim())) return error("Ese correo no parece válido.", $("#email"));
  }
  if (etapa === 1 && !$("#hogar").value.trim()) return error("Ponle un nombre a tu hogar.", $("#hogar"));
  if (etapa === 2) {
    if ($("#password").value.length < 6) return error("Usa al menos 6 caracteres.", $("#password"));
    if ($("#password").value !== $("#confirmar").value) return error("Las contraseñas no coinciden.", $("#confirmar"));
    if (!$("#terminos").checked) return error("Acepta los términos para continuar.");
  }
  return true;
}

$("#formRegistro").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!validar()) return;
  if (etapa < 2) { etapa++; Sonido.subir(); mostrar(); return; }
  const r = QHDC.registrar({ nombre: $("#nombre").value, email: $("#email").value, password: $("#password").value, hogar: $("#hogar").value });
  if (r.error) { etapa = 0; mostrar(); return error(r.error, $("#email")); }
  Sonido.exito();
  Efectos.confeti();
  // Cuenta nueva: se vuelven a mostrar los recorridos de todas las pantallas
  try { Object.keys(localStorage).filter((k) => k.startsWith("qhdc_tour_")).forEach((k) => localStorage.removeItem(k)); } catch (err) { /* sin almacenamiento */ }
  setTimeout(() => (location.href = "dashboard.html"), 900);
});
$("#btnAtras").addEventListener("click", () => { if (etapa > 0) { etapa--; mostrar(); } });

// ---------- Chips (selección) ----------
$("#personas").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (c) $$("#personas .chip").forEach((x) => x.setAttribute("aria-pressed", x === c));
});
$("#lugares").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (c) c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") !== "true");
});

// ---------- Contraseña ----------
$("#password").addEventListener("input", () => {
  const v = $("#password").value;
  let n = 0;
  if (v.length >= 6) n++;
  if (/\d/.test(v) && /[a-z]/i.test(v)) n++;
  if (v.length >= 10 || /[^a-z0-9]/i.test(v)) n++;
  n = v ? Math.max(1, n) : 0;
  $("#fuerza").dataset.nivel = n;
  $("#fuerzaTexto").textContent = ["", "Débil", "Aceptable", "¡Muy segura!"][n];
});
$$(".ver-clave").forEach((b) => b.addEventListener("click", () => {
  const c = document.getElementById(b.dataset.para);
  const ver = c.type === "password";
  c.type = ver ? "text" : "password";
  b.innerHTML = `<i class="fa-solid ${ver ? "fa-eye-slash" : "fa-eye"}"></i>`;
}));

mostrar();
