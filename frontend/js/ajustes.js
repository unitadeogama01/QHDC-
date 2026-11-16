// ============================================================
//  QHDC! — Ajustes (ajustes.html)
//  Perfil y contraseña · hogar, miembros e invitaciones ·
//  lugares con límites de temperatura/humedad · categorías.
//  Todo se guarda en el servidor (/api/ajustes); lo que solo puede
//  cambiar el administrador se oculta a los miembros (y el servidor
//  lo vuelve a revisar).
// ============================================================

const { $, esc, toast, iniciales } = UI;
let datos = null;

const ROL = { administrador: "Administrador", miembro: "Miembro" };
const TIPO = { despensa: "Despensa", refrigerador: "Refrigerador", congelador: "Congelador", otro: "Otro" };
const valor = (v) => (v === null || v === undefined ? "" : v);
const numeroO = (v) => (String(v).trim() === "" ? null : Number(v));

// Ejecuta una acción con el botón en "trabajando…" y avisa el resultado
async function accion(boton, trabajo, exito) {
  const antes = boton ? boton.innerHTML : "";
  if (boton) { boton.disabled = true; boton.innerHTML = '<i class="fa-solid fa-rotate"></i> Guardando…'; }
  try {
    const r = await trabajo();
    if (exito) { Sonido.exito(); toast(exito, { icono: "fa-check" }); }
    return r;
  } catch (e) {
    Sonido.alerta();
    toast(e.message, { icono: "fa-triangle-exclamation" });
    return null;
  } finally {
    if (boton && boton.isConnected) { boton.disabled = false; boton.innerHTML = antes; }
  }
}

async function cargar() {
  datos = await QHDC.ajustes("GET");
  document.body.classList.toggle("sin-permiso", !datos.esAdministrador);
  $("#soloAdmin").classList.toggle("oculto", datos.esAdministrador);
  dibujarPerfil();
  dibujarHogar();
  dibujarMiembros();
  dibujarInvitaciones();
  dibujarLugares();
  dibujarCategorias();
}

// ---------- Perfil ----------
function dibujarPerfil() {
  $("#pNombre").value = datos.perfil.nombre;
  $("#pCorreo").value = datos.perfil.correo;
  $("#pGoogle").classList.toggle("oculto", !datos.perfil.google);
  // Quien entró con Google puede poner una contraseña sin conocer la anterior
  $("#cActual").placeholder = datos.perfil.google ? "Déjala vacía si entras con Google" : "";
}
$("#formPerfil").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await accion(e.submitter, () => QHDC.ajustes("PUT", "/perfil", { nombre: $("#pNombre").value, correo: $("#pCorreo").value }), "Perfil guardado");
  if (r) setTimeout(() => location.reload(), 700); // el nombre aparece en el menú y el saludo
});
$("#formContrasena").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.nueva.value.length < 8) { toast("La contraseña nueva debe tener al menos 8 caracteres.", { icono: "fa-key" }); return; }
  if (f.nueva.value !== f.repetir.value) { toast("Las dos contraseñas nuevas no coinciden.", { icono: "fa-key" }); return; }
  const r = await accion(e.submitter, () => QHDC.ajustes("PUT", "/contrasena", { actual: f.actual.value, nueva: f.nueva.value }), "Contraseña cambiada");
  if (r) f.reset();
});

// ---------- Hogar ----------
function dibujarHogar() {
  const f = $("#formHogar");
  f.nombre.value = datos.hogar.nombre;
  f.personas.value = datos.hogar.personas;
  f.diasAviso.value = [1, 2, 3, 5, 7].includes(datos.hogar.diasAviso) ? datos.hogar.diasAviso : 3;
  [...f.elements].forEach((el) => { if (el.tagName !== "BUTTON") el.disabled = !datos.esAdministrador; });
}
$("#formHogar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  await accion(e.submitter, () => QHDC.ajustes("PUT", "/hogar", { nombre: f.nombre.value, personas: f.personas.value, diasAviso: Number(f.diasAviso.value) }), "Hogar guardado");
});

function dibujarMiembros() {
  $("#miembros").innerHTML = datos.miembros.map((m) => `
    <li data-usuario="${m.id}">
      <span class="avatar" aria-hidden="true">${esc(iniciales(m.nombre))}</span>
      <div class="info"><strong>${esc(m.nombre)}${m.yo ? " (tú)" : ""}</strong><small>${esc(m.correo)}</small></div>
      ${datos.esAdministrador && !m.yo
        ? `<select class="control" data-rol aria-label="Rol de ${esc(m.nombre)}">
             <option value="miembro" ${m.rol === "miembro" ? "selected" : ""}>Miembro</option>
             <option value="administrador" ${m.rol === "administrador" ? "selected" : ""}>Administrador</option>
           </select>
           <button class="btn-icono con-borde" type="button" data-quitar aria-label="Quitar a ${esc(m.nombre)} del hogar" title="Quitar del hogar"><i class="fa-solid fa-user-minus"></i></button>`
        : `<span class="badge ${m.rol === "administrador" ? "badge-tinta" : "badge-info"}">${ROL[m.rol]}</span>`}
    </li>`).join("");
}
$("#miembros").addEventListener("change", async (e) => {
  if (!e.target.matches("[data-rol]")) return;
  const li = e.target.closest("li");
  const ok = await accion(null, () => QHDC.ajustes("PUT", `/miembros/${li.dataset.usuario}`, { rol: e.target.value }), "Rol actualizado");
  if (!ok) cargar();
});
$("#miembros").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-quitar]");
  if (!b) return;
  const li = b.closest("li");
  const nombre = $(".info strong", li).textContent;
  if (!confirm(`¿Quitar a ${nombre} del hogar? Ya no podrá ver ni cambiar la alacena.`)) return;
  if (await accion(b, () => QHDC.ajustes("DELETE", `/miembros/${li.dataset.usuario}`), `${nombre} ya no está en tu hogar`)) cargar();
});

// ---------- Invitaciones ----------
function dibujarInvitaciones() {
  $("#invitaciones").innerHTML = datos.invitaciones.length
    ? datos.invitaciones.map((i) => `
      <li data-invitacion="${i.id}">
        <span class="prod-icono ico-mostaza"><i class="fa-solid fa-envelope"></i></span>
        <div class="info"><strong>${esc(i.correo)}</strong><small>${ROL[i.rol]} · pendiente, vence el ${esc(UI.fecha(i.expira_en.replace(" ", "T"), { day: "numeric", month: "short" }))}</small></div>
        <button class="btn btn-sm" type="button" data-cancelar><i class="fa-solid fa-xmark"></i> Cancelar</button>
      </li>`).join("")
    : "";
}
$("#formInvitar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const r = await accion(e.submitter, () => QHDC.ajustes("POST", "/invitaciones", { correo: f.correo.value, rol: f.rol.value }), "Invitación creada");
  if (!r) return;
  $("#enlace").textContent = r.enlace;
  $("#btnWhatsapp").href = `https://wa.me/?text=${encodeURIComponent(`Te invito a nuestra despensa en QHDC!: ${r.enlace}`)}`;
  $("#enlaceCaja").classList.remove("oculto");
  $("#btnCopiarEnlace").innerHTML = '<i class="fa-solid fa-copy"></i> Copiar';
  f.reset();
  cargar();
});
$("#btnCopiarEnlace").addEventListener("click", () => {
  navigator.clipboard?.writeText($("#enlace").textContent).catch(() => {});
  Sonido.marcar();
  $("#btnCopiarEnlace").innerHTML = '<i class="fa-solid fa-check"></i> Copiado';
});
$("#invitaciones").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cancelar]");
  if (!b) return;
  if (await accion(b, () => QHDC.ajustes("DELETE", `/invitaciones/${b.closest("li").dataset.invitacion}`), "Invitación cancelada")) cargar();
});

// ---------- Lugares y límites ----------
function dibujarLugares() {
  const ed = datos.esAdministrador ? "" : "disabled";
  $("#lugares").innerHTML = datos.lugares.map((l) => `
    <li data-lugar="${l.id}">
      <div class="nombre-lugar">
        <label for="lug${l.id}">${TIPO[l.tipo] || "Lugar"} · ${l.alimentos} alimento${l.alimentos === 1 ? "" : "s"}${l.dispositivos ? ` · <i class="fa-solid fa-microchip"></i> ${l.dispositivos}` : ""}</label>
        <input class="control" id="lug${l.id}" data-campo="nombre" value="${esc(l.nombre)}" maxlength="80" ${ed}>
      </div>
      <div class="limites">
        <div><label for="tmin${l.id}">Mín. °C</label><input class="control" id="tmin${l.id}" data-campo="tempMin" type="number" step="0.5" min="-40" max="80" value="${valor(l.tempMin)}" ${ed}></div>
        <div><label for="tmax${l.id}">Máx. °C</label><input class="control" id="tmax${l.id}" data-campo="tempMax" type="number" step="0.5" min="-40" max="80" value="${valor(l.tempMax)}" ${ed}></div>
        <div><label for="hmin${l.id}">Mín. % hum.</label><input class="control" id="hmin${l.id}" data-campo="humMin" type="number" step="1" min="0" max="100" value="${valor(l.humMin)}" ${ed}></div>
        <div><label for="hmax${l.id}">Máx. % hum.</label><input class="control" id="hmax${l.id}" data-campo="humMax" type="number" step="1" min="0" max="100" value="${valor(l.humMax)}" ${ed}></div>
      </div>
      <div class="acciones solo-admin">
        <button class="btn btn-sm btn-principal" type="button" data-guardar-lugar><i class="fa-solid fa-floppy-disk"></i> Guardar</button>
        ${l.alimentos || l.dispositivos ? "" : `<button class="btn-icono con-borde" type="button" data-borrar-lugar aria-label="Borrar ${esc(l.nombre)}" title="Borrar lugar"><i class="fa-solid fa-trash"></i></button>`}
      </div>
    </li>`).join("");
}
$("#lugares").addEventListener("click", async (e) => {
  const li = e.target.closest("li");
  const guardar = e.target.closest("[data-guardar-lugar]");
  const borrar = e.target.closest("[data-borrar-lugar]");
  if (guardar) {
    const v = (campo) => $(`[data-campo="${campo}"]`, li).value;
    await accion(guardar, () => QHDC.ajustes("PUT", `/lugares/${li.dataset.lugar}`, {
      nombre: v("nombre"), tempMin: numeroO(v("tempMin")), tempMax: numeroO(v("tempMax")), humMin: numeroO(v("humMin")), humMax: numeroO(v("humMax")),
    }), "Lugar guardado");
  } else if (borrar) {
    if (!confirm("¿Borrar este lugar?")) return;
    if (await accion(borrar, () => QHDC.ajustes("DELETE", `/lugares/${li.dataset.lugar}`), "Lugar borrado")) cargar();
  }
});
$("#formLugar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (await accion(e.submitter, () => QHDC.ajustes("POST", "/lugares", { nombre: f.nombre.value, tipo: f.tipo.value }), "Lugar agregado")) { f.reset(); cargar(); }
});

// ---------- Categorías ----------
function dibujarCategorias() {
  $("#categorias").innerHTML = datos.categorias.map((c) => `
    <span class="chip" data-categoria="${c.id}">
      <i class="fa-solid ${c.propia ? esc(c.icono || "fa-tag") : "fa-lock"}"></i> ${esc(c.nombre)}
      <small class="texto-suave">${c.alimentos}</small>
      ${c.propia && datos.esAdministrador ? `
        <button type="button" data-renombrar aria-label="Renombrar ${esc(c.nombre)}" title="Renombrar"><i class="fa-solid fa-pen"></i></button>
        <button type="button" data-borrar aria-label="Borrar ${esc(c.nombre)}" title="Borrar"><i class="fa-solid fa-xmark"></i></button>` : ""}
    </span>`).join("");
}
$("#categorias").addEventListener("click", async (e) => {
  const chip = e.target.closest("[data-categoria]");
  if (!chip) return;
  const cat = datos.categorias.find((c) => c.id === Number(chip.dataset.categoria));
  if (e.target.closest("[data-renombrar]")) {
    const nombre = prompt("Nuevo nombre de la categoría:", cat.nombre);
    if (!nombre || nombre.trim() === cat.nombre) return;
    if (await accion(null, () => QHDC.ajustes("PUT", `/categorias/${cat.id}`, { nombre }), "Categoría renombrada")) cargar();
  } else if (e.target.closest("[data-borrar]")) {
    if (!confirm(`¿Borrar "${cat.nombre}"?${cat.alimentos ? ` Sus ${cat.alimentos} alimento(s) pasarán a "Otros".` : ""}`)) return;
    if (await accion(null, () => QHDC.ajustes("DELETE", `/categorias/${cat.id}`), "Categoría borrada")) cargar();
  }
});
$("#formCategoria").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (await accion(e.submitter, () => QHDC.ajustes("POST", "/categorias", { nombre: f.nombre.value }), "Categoría agregada")) { f.reset(); cargar(); }
});

// ---------- Avisos que quiero ver ----------
function dibujarAvisos() {
  const p = QHDC.preferenciasAvisos();
  document.querySelectorAll("[data-aviso]").forEach((i) => { i.checked = p[i.dataset.aviso] !== false; });
}
$("#avisos").addEventListener("change", async (e) => {
  const i = e.target.closest("[data-aviso]");
  if (!i) return;
  const ok = await accion(null, () => QHDC.guardarPreferenciasAvisos({ [i.dataset.aviso]: i.checked }),
    i.checked ? "Verás estos avisos" : "Ya no verás estos avisos");
  if (!ok) i.checked = !i.checked;
  UI.actualizarContadores(); // el número de avisos del menú
});
dibujarAvisos();

// ---------- Arranque ----------
cargar().catch((e) => toast(e.message, { icono: "fa-triangle-exclamation" }));
