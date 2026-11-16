// ============================================================
//  QHDC! — La aplicación Express
//
//  Se arma en este orden:
//    1. Núcleo compartido (src/nucleo): seguridad, límites, JSON y cookies
//    2. Módulos de cada funcionalidad (src/modulos/<funcionalidad>/rutas*.js)
//    3. Las páginas de frontend/
//    4. El manejo de errores
//  Los módulos usan el núcleo; el núcleo no conoce a los módulos.
// ============================================================
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { config } = require("./nucleo/config");
const { probarConexion } = require("./nucleo/db");
const { ErrorApp } = require("./nucleo/errores");
const seguridad = require("./nucleo/seguridad");
const { requiereSesion } = require("./modulos/auth/sesiones");
const iot = require("./modulos/iot");

const FRONTEND = path.join(__dirname, "..", "..", "frontend");

function crearApp() {
  const app = express();
  app.disable("x-powered-by");
  // Solo detrás del proxy del hosting se confía en X-Forwarded-For para saber
  // la IP real (en local permitiría falsearla y saltarse los límites).
  app.set("trust proxy", config.trustProxy);

  // ---------- 1. Núcleo: seguridad, límites, JSON y cookies ----------
  app.use(seguridad.cabeceras());
  app.use(seguridad.permisos);
  app.use("/api", seguridad.mismoOrigen);
  app.use("/api/iot", seguridad.limites.iot);
  app.use("/api", (req, res, next) => (req.path.startsWith("/iot/") ? next() : seguridad.limites.api(req, res, next)));
  app.use(["/api/auth/entrar", "/api/auth/perfil", "/api/auth/google"], seguridad.limites.acceso);
  app.use("/api/auth/registro", seguridad.limites.registro);
  app.use("/api/escaneos/foto", seguridad.limites.fotos);
  app.use(["/api/escaneos/:id/analizar", "/api/asistente/preguntar", "/api/recetas/generar"], seguridad.limites.ia);
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());

  // ---------- 2. Módulos ----------
  app.get("/api/salud", async (req, res) => {
    try {
      const db = await probarConexion();
      res.json({ ok: true, base: db.base, mysql: db.version, mqtt: config.mqtt.habilitado ? (iot.estaConectado() ? "conectado" : "sin conexión") : "apagado" });
    } catch (e) {
      res.status(503).json({ ok: false, error: "Sin conexión con MySQL" });
    }
  });

  // Sin sesión
  app.use("/api/auth", require("./modulos/auth/rutas"));                 // entrar, registro, perfiles, Google
  app.use("/api/iot", require("./modulos/iot/rutas-http"));              // los ESP32 usan su propia clave

  // Con sesión (de aquí en adelante)
  app.use("/api", requiereSesion);
  app.use("/api", require("./modulos/hogar/rutas"));                     // GET /estado: todo el hogar
  app.use("/api/alimentos", require("./modulos/inventario/rutas"));      // alacena
  app.use("/api/lista", require("./modulos/compras/rutas"));             // lista del súper
  app.use("/api/recetas", require("./modulos/recetas/rutas"));           // recetas propias, con IA y modo cocina
  app.use("/api/avisos", require("./modulos/avisos/rutas"));             // avisos leídos e historial
  app.use("/api", require("./modulos/escaneos/rutas"));                  // fotos → alimentos (/escaneos, /imagenes)
  app.use("/api/asistente", require("./modulos/asistente/rutas"));       // Chef QHDC
  app.use("/api/sensores", require("./modulos/iot/rutas-sensores"));     // pantalla Dispositivos
  app.use("/api/ajustes", require("./modulos/ajustes/rutas"));           // perfil, hogar, miembros, lugares, categorías
  app.use("/api", require("./modulos/ajustes/rutas-preferencias"));      // /preferencias y /recorridos

  app.use("/api", (req, res) => res.status(404).json({ error: "Esa ruta de la API no existe." }));

  // ---------- 3. Páginas ----------
  app.use(express.static(FRONTEND, { extensions: ["html"] }));
  app.use((req, res) => res.status(404).sendFile(path.join(FRONTEND, "index.html")));

  // ---------- 4. Errores ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ErrorApp) return res.status(err.estado).json({ error: err.message });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Los datos enviados no son válidos." });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Los datos enviados son demasiado grandes." });
    // Otros errores al leer el cuerpo de la petición (codificación, tipo…): son del cliente, no del servidor
    if (err.type && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: "Los datos enviados no son válidos." });
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Ya existe un registro con ese nombre." });
    if (err.sqlState === "45000") return res.status(400).json({ error: err.sqlMessage }); // SIGNAL de los procedimientos
    if (err.code === "ER_CHECK_CONSTRAINT_VIOLATED") return res.status(400).json({ error: "Algún dato no es válido." });
    console.error(err);
    res.status(500).json({ error: "Algo salió mal en el servidor. Intenta de nuevo." });
  });

  return app;
}

module.exports = { crearApp };
