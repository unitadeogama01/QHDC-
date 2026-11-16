// ============================================================
//  Seguridad HTTP
//
//  * Cabeceras (helmet) con una CSP que solo permite código de la
//    propia app y, opcionalmente, el botón de Google. Los estilos en
//    línea se permiten porque la interfaz los usa en muchos elementos.
//  * Permisos del navegador: cámara solo para la app; sin micrófono
//    ni ubicación.
//  * Mismo origen: una petición que cambia datos y trae la cabecera
//    Origin debe venir de esta misma app (protección contra CSRF,
//    además de la cookie SameSite=Lax).
//  * Límites de peticiones por IP (express-rate-limit).
// ============================================================
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { config } = require("./config");

const GOOGLE = "https://accounts.google.com/gsi/";

function cabeceras() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", `${GOOGLE}client`],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", `${GOOGLE}style`],
        fontSrc: ["'self'", "data:", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],           // vista previa de fotos (canvas y blob)
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", GOOGLE],
        frameSrc: [GOOGLE],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        // En producción (HTTPS) se piden todos los recursos por HTTPS. En local
        // no: el celular entra por http://IP-de-la-PC:3000.
        ...(config.produccion ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }, // ventana de Google
    strictTransportSecurity: config.produccion ? { maxAge: 180 * 24 * 3600 } : false,
    referrerPolicy: { policy: "same-origin" },
  });
}

function permisos(req, res, next) {
  res.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
  next();
}

/** Rechaza cambios (POST, PUT, DELETE) que vienen de otra página web. */
function mismoOrigen(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const rechazar = () => res.status(403).json({ error: "Esta petición viene de otro sitio y fue bloqueada." });
  // Navegadores actuales: Sec-Fetch-Site lo calcula el navegador y no depende
  // de proxies o túneles (que pueden cambiar la cabecera Host).
  const sitio = req.get("sec-fetch-site");
  if (sitio) return sitio === "same-origin" || sitio === "none" ? next() : rechazar();
  // Navegadores viejos: se compara Origin con Host
  const origen = req.get("origin");
  // Sin Origin: ESP32, simulador o herramientas; la cookie SameSite=Lax
  // ya impide que otro sitio la use en un POST.
  if (!origen) return next();
  try {
    if (new URL(origen).host === req.get("host")) return next();
  } catch (e) { /* Origin inválido */ }
  rechazar();
}

const limite = (ventanaMin, maximo, mensaje, opciones = {}) => rateLimit({
  windowMs: ventanaMin * 60 * 1000,
  limit: maximo,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: mensaje },
  ...opciones,
});

// Valores en config.limites (LIMITE_* en .env); los predeterminados son los recomendados
const L = config.limites;
const limites = {
  // Toda la API (la pantalla Dispositivos consulta cada 3 s: ~20 por minuto)
  api: limite(1, L.apiPorMinuto, "Demasiadas peticiones. Espera un momento."),
  // Entrar y crear cuenta (además del freno por intentos fallidos)
  acceso: limite(15, L.accesoCada15Min, "Demasiados intentos. Espera unos minutos."),
  registro: limite(60, L.registroPorHora, "Se crearon muchas cuentas desde esta red. Intenta más tarde."),
  // Fotos e IA: cuestan almacenamiento y dinero
  fotos: limite(10, L.fotosCada10Min, "Subiste muchas fotos seguidas. Espera unos minutos."),
  ia: limite(10, L.iaCada10Min, "Muchas consultas a la IA seguidas. Espera unos minutos."),
  // ESP32 por HTTP (MQTT no pasa por aquí)
  iot: limite(1, L.iotPorMinuto, "El dispositivo manda datos demasiado seguido."),
};

module.exports = { cabeceras, permisos, mismoOrigen, limites };
