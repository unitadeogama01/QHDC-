// ============================================================
//  QHDC! — INTERACCIÓN (se carga en el <head> de TODAS las páginas)
//
//  1. Tema claro/oscuro (se aplica antes de pintar para que no parpadee)
//  2. Sonidos: generados con Web Audio API, no hay archivos de audio
//  3. Efectos: onda al presionar, aparición escalonada, contador
//     animado y confeti
//
//  Todo respeta las preferencias del usuario: se puede silenciar y
//  si el sistema pide "reducir movimiento" se desactivan animaciones.
// ============================================================

// ---------- Lectura segura de preferencias ----------
const Pref = {
  leer(clave, porDefecto) {
    try { const v = localStorage.getItem(clave); return v === null ? porDefecto : v; } catch (e) { return porDefecto; }
  },
  guardar(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch (e) { /* almacenamiento bloqueado */ }
  },
};

// ---------- 1. TEMA ----------
const Tema = {
  actual() { return document.documentElement.dataset.tema; },
  aplicar(tema) {
    document.documentElement.dataset.tema = tema;
    Pref.guardar("qhdc_tema", tema);
    document.dispatchEvent(new CustomEvent("tema", { detail: tema }));
  },
  alternar() { Tema.aplicar(Tema.actual() === "oscuro" ? "claro" : "oscuro"); },
};
(() => {
  const sistemaOscuro = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.tema = Pref.leer("qhdc_tema", sistemaOscuro ? "oscuro" : "claro");
})();

const menosMovimiento = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- 2. SONIDOS ----------
const Sonido = (() => {
  let ctx = null;
  let activo = Pref.leer("qhdc_sonido", "1") === "1";

  function contexto() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Un tono con forma, frecuencia inicial/final, duración y volumen
  function tono({ tipo = "sine", de = 440, a = de, dur = 0.08, vol = 0.07, retraso = 0 }) {
    if (!activo) return;
    const c = contexto();
    if (!c) return;
    const t = c.currentTime + retraso;
    const osc = c.createOscillator();
    const gan = c.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(de, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(a, 1), t + dur);
    gan.gain.setValueAtTime(0.0001, t);
    gan.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gan.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gan).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const sonidos = {
    clic: () => tono({ tipo: "sine", de: 620, a: 420, dur: 0.06, vol: 0.06 }),
    suave: () => tono({ tipo: "sine", de: 500, a: 560, dur: 0.05, vol: 0.04 }),
    pop: () => { tono({ tipo: "triangle", de: 520, a: 980, dur: 0.09, vol: 0.08 }); },
    marcar: () => { tono({ tipo: "triangle", de: 700, a: 1200, dur: 0.07, vol: 0.07 }); tono({ tipo: "sine", de: 1400, dur: 0.06, vol: 0.04, retraso: 0.06 }); },
    exito: () => [523, 659, 784, 1047].forEach((f, i) => tono({ tipo: "sine", de: f, dur: 0.16, vol: 0.07, retraso: i * 0.08 })),
    borrar: () => tono({ tipo: "square", de: 320, a: 90, dur: 0.16, vol: 0.035 }),
    alerta: () => { tono({ tipo: "sine", de: 880, dur: 0.12, vol: 0.07 }); tono({ tipo: "sine", de: 660, dur: 0.16, vol: 0.07, retraso: 0.13 }); },
    abrir: () => tono({ tipo: "sine", de: 300, a: 620, dur: 0.12, vol: 0.05 }),
    cerrar: () => tono({ tipo: "sine", de: 600, a: 300, dur: 0.1, vol: 0.04 }),
    tic: () => tono({ tipo: "square", de: 1500, a: 1300, dur: 0.02, vol: 0.025 }),
    escaneo: () => tono({ tipo: "sawtooth", de: 180, a: 1100, dur: 1.4, vol: 0.025 }),
    foto: () => { tono({ tipo: "square", de: 2000, a: 400, dur: 0.05, vol: 0.05 }); tono({ tipo: "triangle", de: 900, a: 300, dur: 0.12, vol: 0.05, retraso: 0.05 }); },
    subir: () => tono({ tipo: "triangle", de: 400, a: 800, dur: 0.08, vol: 0.05 }),
    bajar: () => tono({ tipo: "triangle", de: 700, a: 350, dur: 0.08, vol: 0.05 }),
  };

  return {
    ...sonidos,
    tocar(nombre) { (sonidos[nombre] || sonidos.clic)(); },
    activo: () => activo,
    alternar() {
      activo = !activo;
      Pref.guardar("qhdc_sonido", activo ? "1" : "0");
      if (activo) sonidos.pop();
      document.dispatchEvent(new CustomEvent("sonido", { detail: activo }));
      return activo;
    },
  };
})();

// ---------- 3. EFECTOS ----------
const Efectos = {
  // Aparición escalonada de los hijos de un contenedor
  escalonar(raiz = document) {
    raiz.querySelectorAll("[data-escalonar]").forEach((cont) => {
      [...cont.children].forEach((hijo, i) => {
        hijo.style.setProperty("--i", i);
        hijo.classList.add("aparecer");
      });
    });
  },

  // Cuenta de 0 al valor (o del valor anterior al nuevo)
  contar(el, valor, { duracion = 900, sufijo = "", prefijo = "" } = {}) {
    if (!el) return;
    const desde = Number(el.dataset.valor || 0);
    el.dataset.valor = valor;
    const pintar = (n) => { el.textContent = prefijo + Math.round(n).toLocaleString("es-MX") + sufijo; };
    if (menosMovimiento() || desde === valor) { pintar(valor); return; }
    const inicio = performance.now();
    const paso = (t) => {
      const p = Math.min(1, (t - inicio) / duracion);
      const suave = 1 - Math.pow(1 - p, 3);
      pintar(desde + (valor - desde) * suave);
      if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  },

  // Lluvia de confeti desde un punto (o desde el centro)
  confeti(x = innerWidth / 2, y = innerHeight / 2) {
    if (menosMovimiento()) return;
    const lienzo = document.createElement("canvas");
    lienzo.className = "lienzo-confeti";
    lienzo.width = innerWidth;
    lienzo.height = innerHeight;
    lienzo.setAttribute("aria-hidden", "true");
    Object.assign(lienzo.style, { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 999 });
    document.body.appendChild(lienzo);
    const g = lienzo.getContext("2d");
    const colores = ["#e8562a", "#6b8e3d", "#f2b33d", "#03656f", "#fbf6ee", "#2b1d14"];
    const piezas = Array.from({ length: 90 }, () => ({
      x, y,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 13 - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 7,
      h: 4 + Math.random() * 5,
      c: colores[Math.floor(Math.random() * colores.length)],
    }));
    let cuadros = 0;
    const animar = () => {
      g.clearRect(0, 0, lienzo.width, lienzo.height);
      piezas.forEach((p) => {
        p.vy += 0.38; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r);
        g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      });
      if (++cuadros < 110) requestAnimationFrame(animar); else lienzo.remove();
    };
    requestAnimationFrame(animar);
  },
};

// ---------- Comportamiento global (delegación) ----------
// Onda visual al presionar botones
document.addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".btn");
  if (!b || b.disabled || menosMovimiento()) return;
  const r = b.getBoundingClientRect();
  const tam = Math.max(r.width, r.height);
  const onda = document.createElement("span");
  onda.className = "onda";
  Object.assign(onda.style, { width: tam + "px", height: tam + "px", left: e.clientX - r.left - tam / 2 + "px", top: e.clientY - r.top - tam / 2 + "px" });
  b.appendChild(onda);
  setTimeout(() => onda.remove(), 600);
});

// Sonido de clic en todo lo que se puede presionar.
// data-sonido="nombre" cambia el sonido; data-sonido="ninguno" lo quita.
document.addEventListener("click", (e) => {
  const el = e.target.closest("button, a, .chip, label.interruptor, [data-sonido]");
  if (!el || el.disabled) return;
  const nombre = el.dataset.sonido;
  if (nombre === "ninguno") return;
  if (el.matches("label.interruptor") && e.target.tagName !== "INPUT") return; // el input dispara su propio clic
  Sonido.tocar(nombre || (el.matches(".chip, .segmentos button") ? "suave" : "clic"));
});

document.addEventListener("DOMContentLoaded", () => Efectos.escalonar());
