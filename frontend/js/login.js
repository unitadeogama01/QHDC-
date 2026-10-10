// ============================================================
//  QHDC! — Entrar (login.html)
//  Perfiles guardados en el dispositivo (un toque) o correo y
//  contraseña con "Otra cuenta".
// ============================================================

if (QHDC.sesionActual()) location.replace("dashboard.html");

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iniciales = (n) => n.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

// ---------- Tema ----------
function pintarTema() {
  const oscuro = Tema.actual() === "oscuro";
  $("#btnTema").innerHTML = `<i class="fa-solid ${oscuro ? "fa-sun" : "fa-moon"}"></i>`;
  $("#btnTema").setAttribute("aria-label", oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
}
$("#btnTema").addEventListener("click", () => Tema.alternar());
document.addEventListener("tema", pintarTema);
pintarTema();

// ---------- Perfiles ----------
$("#perfiles").innerHTML = QHDC.perfiles().slice(0, 5).map((p) => `
  <button class="perfil" type="button" data-email="${esc(p.email)}" data-sonido="ninguno">
    <span class="cara">${esc(iniciales(p.nombre))}</span>
    <strong>${esc(p.nombre.split(" ")[0])}</strong>
    <small>${esc(p.rol)}</small>
  </button>`).join("") + `
  <button class="perfil otra" type="button" id="otraCuenta" aria-expanded="false" aria-controls="formLogin">
    <span class="cara"><i class="fa-solid fa-plus"></i></span>
    <strong>Otra cuenta</strong>
    <small>Con correo</small>
  </button>`;

$("#perfiles").addEventListener("click", (e) => {
  const b = e.target.closest(".perfil");
  if (!b) return;
  if (b.id === "otraCuenta") {
    const oculto = $("#formLogin").classList.toggle("oculto");
    b.setAttribute("aria-expanded", !oculto);
    if (!oculto) { Sonido.abrir(); $("#email").focus(); }
    return;
  }
  b.classList.add("entrando");
  Sonido.exito();
  setTimeout(() => {
    if (QHDC.entrarComoPerfil(b.dataset.email)) location.href = "dashboard.html";
  }, 550);
});

// ---------- Correo y contraseña ----------
function error(texto, campo) {
  $("#error span").textContent = texto;
  const caja = $("#error");
  caja.classList.add("oculto"); void caja.offsetWidth; caja.classList.remove("oculto");
  if (campo) { campo.classList.remove("invalido"); void campo.offsetWidth; campo.classList.add("invalido"); campo.focus(); }
  Sonido.alerta();
}
$("#formLogin").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = $("#email"), pass = $("#password");
  [email, pass].forEach((c) => c.classList.remove("invalido"));
  if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return error("Escribe un correo válido.", email);
  if (!pass.value) return error("Escribe tu contraseña.", pass);
  if (!QHDC.iniciarSesion(email.value.trim(), pass.value)) return error("El correo o la contraseña no coinciden.", pass);
  Sonido.exito();
  location.href = "dashboard.html";
});

document.querySelectorAll(".ver-clave").forEach((b) => b.addEventListener("click", () => {
  const c = document.getElementById(b.dataset.para);
  const ver = c.type === "password";
  c.type = ver ? "text" : "password";
  b.innerHTML = `<i class="fa-solid ${ver ? "fa-eye-slash" : "fa-eye"}"></i>`;
  b.setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña");
}));
