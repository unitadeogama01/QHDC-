// ============================================================
//  QHDC! — Entrar (login.html)
//  Perfiles guardados en el dispositivo (un toque) o correo y
//  contraseña con "Otra cuenta". La primera vez en un dispositivo
//  no hay perfiles: el formulario aparece abierto.
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

// Sin perfiles guardados: se muestra directo el formulario
if (!QHDC.perfiles().length) {
  $("#formLogin").classList.remove("oculto");
  $("#otraCuenta").setAttribute("aria-expanded", "true");
}

$("#perfiles").addEventListener("click", async (e) => {
  const b = e.target.closest(".perfil");
  if (!b || b.classList.contains("entrando")) return;
  if (b.id === "otraCuenta") {
    const oculto = $("#formLogin").classList.toggle("oculto");
    b.setAttribute("aria-expanded", !oculto);
    if (!oculto) { Sonido.abrir(); $("#email").focus(); }
    return;
  }
  b.classList.add("entrando");
  Sonido.exito();
  const espera = new Promise((ok) => setTimeout(ok, 550)); // deja ver la animación
  try {
    const sesion = await QHDC.entrarComoPerfil(b.dataset.email);
    await espera;
    if (sesion) return (location.href = "dashboard.html");
    // El perfil expiró: se pide la contraseña con el correo ya escrito
    b.remove();
    $("#formLogin").classList.remove("oculto");
    $("#email").value = b.dataset.email;
    error("Tu perfil guardado expiró. Escribe tu contraseña.", $("#password"));
  } catch (err) {
    await espera;
    b.classList.remove("entrando");
    $("#formLogin").classList.remove("oculto");
    error(err.message);
  }
});

// ---------- Correo y contraseña ----------
function error(texto, campo) {
  $("#error span").textContent = texto;
  const caja = $("#error");
  caja.classList.add("oculto"); void caja.offsetWidth; caja.classList.remove("oculto");
  if (campo) { campo.classList.remove("invalido"); void campo.offsetWidth; campo.classList.add("invalido"); campo.focus(); }
  Sonido.alerta();
}
$("#formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#email"), pass = $("#password");
  const boton = $('#formLogin button[type="submit"]');
  [email, pass].forEach((c) => c.classList.remove("invalido"));
  if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return error("Escribe un correo válido.", email);
  if (!pass.value) return error("Escribe tu contraseña.", pass);
  boton.disabled = true;
  try {
    if (!(await QHDC.iniciarSesion(email.value.trim(), pass.value))) return error("El correo o la contraseña no coinciden.", pass);
    Sonido.exito();
    location.href = "dashboard.html";
  } catch (err) {
    error(err.message);
  } finally {
    boton.disabled = false;
  }
});

document.querySelectorAll(".ver-clave").forEach((b) => b.addEventListener("click", () => {
  const c = document.getElementById(b.dataset.para);
  const ver = c.type === "password";
  c.type = ver ? "text" : "password";
  b.innerHTML = `<i class="fa-solid ${ver ? "fa-eye-slash" : "fa-eye"}"></i>`;
  b.setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña");
}));

// ---------- Entrar con Google (solo si el servidor lo tiene configurado) ----------
// Google entrega un "credential" (token firmado); el servidor lo verifica.
(async () => {
  const { google: clientId } = await QHDC.configuracionAcceso();
  if (!clientId) return;
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client";
  s.async = true;
  s.onload = () => {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (respuesta) => {
        try {
          await QHDC.entrarConGoogle(respuesta.credential);
          Sonido.exito();
          location.href = "dashboard.html";
        } catch (err) {
          $("#formLogin").classList.remove("oculto");
          error(err.message);
        }
      },
    });
    window.google.accounts.id.renderButton($("#botonGoogle"), { theme: "outline", size: "large", text: "continue_with", shape: "pill", locale: "es" });
    $("#google").classList.remove("oculto");
  };
  document.head.appendChild(s);
})();
