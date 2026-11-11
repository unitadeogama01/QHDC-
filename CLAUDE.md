# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

QHDC! ("¿Qué Hay de Comer?") — a school project (team ARK SYSTEMS): a smart-pantry web app with ESP32 scales, expiry alerts, shopping list, recipe suggestions and a rule-based "assistant". All code, identifiers, comments, UI text, API error messages and the README are in **Spanish** — keep new code consistent with that (e.g. `consulta`, `transaccion`, `hogarId`, `ErrorApp`).

## Work in progress — read first
The project is being evolved in phases following `docs/PLAN-IMPLEMENTACION.md` (approved plan). Current progress, user decisions and pending notes are in `docs/CONTEXTO-SESION.md` — read it at the start of every session, and update it when a phase ends. Finish one phase, verify it, then wait for the user's approval before starting the next.

## Commands

All run from `backend/` (Node ≥ 18, MySQL ≥ 8.0.16):

```bash
npm install
npm start            # node server.js → http://localhost:3000 (serves frontend + API)
npm run dev          # node --watch server.js
npm run simulador    # run the ESP32 simulator standalone
npm test             # all tests (node:test): unit + frontend + API on a temp DB
npm run test:unitarias   # no MySQL needed · npm run test:cobertura  # coverage
npm run rendimiento  # load test on a temp DB (docs/rendimiento.md); `-- --usuarios 5 --segundos 4 --lecturas 2000` for a quick run
```

- Database: run `database/qhdc_base_de_datos.sql` in full via MySQL Workbench / `mysql -u root -p < database/qhdc_base_de_datos.sql`. It uses `DELIMITER` for procedures, so it cannot be executed from Node. To reset, uncomment the `DROP DATABASE IF EXISTS qhdc;` line near the top. It installs an **empty** database (schema + catalogs: units, categories, known foods); there is no sample household, account, device or recipe — the first user registers in `registro.html`.
- Config: copy `backend/.env.example` to `backend/.env` (`NODE_ENV`, `PUERTO`, `DB_*`, `ZONA_HORARIA`, `SIMULADOR*`, `COOKIE_SEGURA`, `MQTT_*`, `ANTHROPIC_API_KEY`, …). All variables are read and validated once in `backend/src/nucleo/config.js`; other modules import `config` instead of reading `process.env`. The same code runs locally and on Hostinger — only `.env` changes.
- Health check: `GET /api/salud`.
- Tests live in `backend/pruebas/` (Node's built-in `node:test`, no extra dependencies): `unitarias/` (pure rules), `frontend/` (loads `frontend/js/datos.js` in a `vm` with a fake browser), `api/` (each file calls `pruebas/ayuda/entorno.js` → creates a temp DB `qhdc_prueba_*` from the full SQL script using `pruebas/ayuda/script-sql.js` (handles DELIMITER), runs `crearApp()` on port 0 with MQTT, simulator and AI disabled, and drops the DB afterwards). Respect real limits in API tests (≤10 registrations per file, login brake 8/min per IP). Add or update tests with every change and keep `npm test` green. No linter and no build step. Frontend is plain HTML/CSS/JS served statically; pages must be opened through the server, not as files.
- No sample logins ship anymore. The user's existing database still has their own `admin@qhdc.mx` account (password changed by the user, private). `scripts/publico.js` refuses to publish if any account uses a known weak password.

## Architecture

```
Browser ──fetch──▶ Express /api/... ──mysql2──▶ MySQL (tables, views, stored procedures)
ESP32 / simulator ──MQTT──▶ broker (internal Aedes or external) ──▶ src/modulos/iot/cliente.js
                                                         └─▶ procesar.js ──▶ lecturas_sensor → sp_aplicar_lectura_peso
(fallback) ESP32 ──HTTP──▶ /api/iot/lecturas ──▶ same procesar.js rules
```

### IoT (`backend/src/modulos/iot/`, docs in `docs/mqtt.md` and `docs/hardware.md`)
- Real hardware only: 1 ESP32 + load cell/HX711 (weight, channel 1) + DHT22 (temp/humidity), USB powered. Firmware in `firmware/esp32-despensa/` (copy `config.example.h` → `config.h`, gitignored); wiring test sketch in `firmware/prueba-sensores/`.
- `temas.js` defines topics `despensa/<id>/{bascula/peso, ambiente/temperatura, ambiente/humedad, estado, respuestas, comandos}` — keep identical in firmware and simulator.
- `broker.js`: optional embedded Aedes broker (`MQTT_BROKER_INTERNO=true`), auth = device identificador + clave (SHA-256 in DB), per-device topic ACL. `cliente.js`: server subscriber, LWT → `estado_conexion`, `enviarComando()` awaits device response (used by calibration).
- `procesar.js` rules: dedupe by `msg_id`; out-of-range/unstable/unassigned readings stored with `valido=FALSE` + `motivo_invalidez` and never touch inventory; weight applied only after `lecturas_estables` similar readings. Grams → food unit only for g/kg/pz (with `peso_unitario_g`).
- Sensors never claim food is spoiled; ambient alerts (`amb-t-<id>`, `amb-h-<id>`) only report measurement vs `vista_umbrales_ambiente`.
- Session routes for the Dispositivos screen are in `src/modulos/iot/rutas-sensores.js` (`GET /vivo` polled every 3 s, link device, assign food, calibrate, reconnect). The simulator is `src/modulos/iot/simulador.js`; it connects as `SIMULADOR_IDENTIFICADOR` / `SIMULADOR_CLAVE` from `.env` (no default: without them the server warns and skips the simulator). Never hardcode a device key in code/docs (use placeholders); the old public key `clave-esp32-despensa-001` was rotated on 2026-11-09 and is denylisted in `scripts/publico.js`.

### Backend (`backend/`)
- Layout (modular monolith): **shared core** `src/nucleo/` — `config`, `db`, `errores`, `seguridad`, `ia` (Claude client `pedirJson`/`disponible`), `imagenes` (photo validation + private storage) — and **one folder per feature** in `src/modulos/`: `auth`, `hogar` (`GET /api/estado`), `inventario` (incl. `nombres.js`), `compras`, `recetas` (CRUD, AI draft `generar.js`, `POST /:id/preparar`), `avisos`, `escaneos` (photo → foods, `vision.js`), `asistente`, `iot`, `ajustes` (settings + `rutas-preferencias.js` for `/preferencias` and `/recorridos`). Route files are `rutas*.js`. Modules depend on `nucleo`; `nucleo` never requires a module. Code used by several features goes in `nucleo`; otherwise in its feature module.
- Security (`src/nucleo/seguridad.js`, wired first in `src/app.js`): helmet + CSP (only self, cdnjs, Google Fonts and `accounts.google.com/gsi/`; inline styles allowed, **no inline scripts or `on*=` attributes** in HTML), Permissions-Policy, same-origin check for non-GET `/api` requests that send `Origin`, and express-rate-limit (general 300/min, login, registro, fotos, IA, IoT). `trust proxy` comes from `TRUST_PROXY` (default `loopback` locally so the Cloudflare tunnel reports real IPs, 1 behind Hostinger's proxy; `true` is rejected). The same-origin check prefers the browser's `Sec-Fetch-Site` header (works through tunnels that rewrite Host), falling back to Origin vs Host. Passwords: minimum 8 characters.
- `src/app.js` (`crearApp()`) builds Express: core middleware → `/api/salud`, `/api/auth`, `/api/iot` (device key auth) → `requiereSesion` → every feature module (the list of mounts lives there; add new routes there) → static `frontend/` with `extensions: ["html"]` → error handler. `server.js` only boots: checks MySQL, starts MQTT, `app.listen`, optional simulator, hourly cleanup (reading summaries, expired photos). Central error handler maps `ErrorApp` → its status, MySQL `SIGNAL SQLSTATE '45000'` from procedures → 400 with the SQL message, `ER_DUP_ENTRY` → 409. Only if `SIMULADOR=true` the simulator starts in-process and publishes readings every `SIMULADOR_INTERVALO` ms.
- `src/nucleo/db.js`: pool with `dateStrings: true` and `decimalNumbers: true`, every connection sets `time_zone` from `ZONA_HORARIA`. Helpers: `consulta` (rows), `una` (first row), `transaccion(fn)` (retries on deadlock), `iso()`.
- `src/nucleo/errores.js`: `ErrorApp(status, msg)`, `async_()` wrapper for async routes, and validators (`texto`, `numero`, `fecha`, `id`, `color`, `icono`) — use these for all input.
- `src/modulos/auth/sesiones.js`: random token in httpOnly cookie `qhdc_sesion`; only its SHA-256 is stored (`sesiones_autenticacion`). A second long-lived "profile" token (`recordar = TRUE`, 30 days) enables one-tap login. `req.usuario` carries `id`, `hogarId`, role.
- `src/modulos/inventario/servicio.js` (pantry rules, catalog-name → id mapping), `src/modulos/hogar/estado.js` (`sincronizar` + `estadoCompleto` builds the full household payload).

### Database invariants (`database/qhdc_base_de_datos.sql`)
- **Everything is scoped by `hogar_id`**; child tables use composite FKs `(hogar_id, id)`. Every query must filter by the session's `hogarId`.
- **An item's quantity is never written directly** — it is the sum of `lotes_alimento`. Changes go through procedures (`sp_consumir_interno`, `sp_consumir`, `sp_reabastecer`, `sp_preparar_receta`, `sp_aplicar_lectura_peso`) so `movimientos_inventario` keeps history (used for consumption charts and predictions).
- Soft deletes (`activo` / `estado`) instead of deleting history.
- Read models are views (`vista_inventario`, `vista_lista_sugerida`, `vista_prediccion_consumo`, `vista_frescura_hogar`, …). `GET /api/estado` first runs `hogar.sincronizar` (`sp_generar_lista`, `sp_generar_avisos`) inside a transaction.
- Schema changes: see the migrations note below (migration file + full script).

### Frontend (`frontend/`)
- **Rule: each screen has `<pagina>.html`, `css/<pagina>.css`, `js/<pagina>.js` with the same name.** Shared code lives in `js/interaccion.js` (`Tema`, `Sonido`, `Efectos`; loaded in `<head>`), `js/datos.js` (`QHDC` object — data layer), `js/app.js` (`UI` object — sidebar, topbar, bottom bar, + button, Ctrl+K search, toasts with undo, modals, side panel, guided tours), `css/base.css` (design system) and `css/app.css` (app shell).
- **Boot sequence:** `datos.js` loads normally and immediately requests `GET /api/estado`; the page's other scripts are declared as `<script data-qhdc-src="js/...">` and are injected only after the state arrives (a 401 is expected on login/registro). New pages must follow this pattern, with `<body data-pagina="...">` and the shell skeleton shown in README §7.
- **Data flow:** screens read synchronously from the in-memory cache in `QHDC`. Mutations update the cache optimistically and are sent via `enviar()` through a **serial promise queue**; temporary client ids are mapped to real ids via `asignarId`. On server rejection the app toasts and reloads; on 401 it redirects to `login.html`. After the queue drains it re-syncs state. The field names in `/api/estado` are the contract the frontend expects (`productos`, `sensores`, `lecturas`, `listaExtra`, `comprados`, …) — keep them stable.
- The README §9 table maps each `QHDC` function to its API route.
- Each screen registers its guided tour at the end of its JS with `UI.registrarRecorrido([...steps], { base, estados })`; shown once per page (`qhdc_tour_<pagina>`), forced with `?tour=1`.
- Sounds are generated with Web Audio; buttons play a click automatically, override with `data-sonido="nombre"` or `data-sonido="ninguno"`.
- Photo recognition is real (`src/modulos/escaneos/rutas.js`, `src/nucleo/imagenes.js`, `src/modulos/escaneos/vision.js`): upload (multer) → sharp validates real type, rotates, resizes to 1600 px, strips EXIF → private `backend/almacen/imagenes/` (gitignored, served only via `GET /api/imagenes/:id` scoped by hogar, retention `IMAGENES_RETENCION_DIAS`) → Claude (`claude-opus-5-5`, structured JSON output, `fallbacks: "default"`) only proposes → inventory changes only on `POST /api/escaneos/:id/confirmar`. Without `ANTHROPIC_API_KEY` it runs in a flagged demo mode. Deterministic rules (catalog/household match, units, suggested qty only when pieces are countable) live in the route, not in the model.
- Assistant is real (`src/modulos/asistente/rutas.js` → `src/modulos/asistente/asistente.js`): the server computes exact facts from MySQL (quantities, days to expiry, days left, shopping list, recipes with missing ingredients) and sends them as text; Claude (effort `low`) only writes the answer and picks references; the server validates them (only real alimento ids / recipe ids; for a new recipe it computes each ingredient's availability itself) and stores both messages. Shared Claude client: `src/nucleo/ia.js` (`pedirJson`). If the API returns 503 the page falls back to the rule-based `responder()` in `asistente.js`.
- Recipes are per household: `recetas.hogar_id` = the household (global recipes with NULL are no longer shown anywhere). `src/modulos/recetas/rutas.js`: `POST /api/recetas/generar` (multipart: `elegidos` JSON ids, optional `foto` validated with `imagenes.procesar` and NOT stored, `indicaciones`) returns an AI draft via `src/modulos/recetas/generar.js` with server-computed availability; nothing is saved until `POST /api/recetas`; `POST /api/recetas/:id/preparar` is cooking mode "¡Terminé!"; `DELETE /api/recetas/:id` hard-deletes, or soft-deletes (renamed, `activa=FALSE`) if it was ever prepared. Frontend must handle zero recipes (dashboard roulette, assistant fallback, Sorpréndeme).
- Food-name matching lives in `backend/src/modulos/inventario/nombres.js` (word-based, accent/case/plural-insensitive: `coincideNombre`, `mismoNombre`, `esBasico`); `frontend/js/datos.js` (`buscarIngrediente`) mirrors the same rule — change both together. `POST /api/lista/finalizar` puts every bought item into the pantry: linked items are refilled, free-text items (`nombre_libre`) refill a same-named food or create one (catalog data if known, quantity parsed from `cantidad_texto`).
- DB connection collation is `UTF8MB4_0900_AI_CI` (same as the schema); don't change it back to plain `utf8mb4` or comparisons against view columns fail with "Illegal mix of collations". IoT is real (MQTT); `SIMULADOR=true` only emulates the ESP32 and must be `false` when the real device with the same identificador is connected.

### IoT data lifecycle
Readings older than 7 days are purged hourly by the server after `sp_resumir_lecturas` summarizes them into `lecturas_resumen_hora`. `gas`/`bateria` types are kept for compatibility but the real hardware doesn't produce them (UI shows them only if present; USB power shows as "USB").
- **The database now exists on the user's machine**: schema changes ship as `database/migraciones/NNN_nombre.sql` (no `DELIMITER`), applied with `npm run db:migrar` (`backend/scripts/migrar.js`, tracked in table `migraciones`). Also reflect each change in the full script and add its name to the `INSERT INTO migraciones` there, so fresh installs don't re-apply it.
- Categories: `categorias_alimento.hogar_id` NULL = global, otherwise household-owned (unique by generated `ambito`). Every query must filter `hogar_id IS NULL OR hogar_id = ?`.
- Settings screen `ajustes.html` (opened from the avatar menu, no guided tour) → `src/modulos/ajustes/rutas.js`: profile/password (changing it revokes other sessions), household, members/roles (never zero admins), invitation links (token hashed, 7 days, must register with the invited email), places with temp/humidity limits (`umbrales_ambiente`), household categories. Product form has `minimo` (`alimentos.porcentaje_minimo`).
- Google sign-in is optional (`GOOGLE_CLIENT_ID`): `GET /api/auth/config`, `POST /api/auth/google` verifies the ID token with `google-auth-library` and links by `usuarios.google_sub` or email.

## Design conventions
"Kitchen sticker" style: thick ink borders and solid offset shadows; palette tokens crema `#FBF6EE`, tomate `#E8562A`, oliva `#6B8E3D`, mostaza `#F2B33D`, petróleo `#03656F`, café `#2B1D14`, with a dark theme using the same roles. Fonts Fredoka (headings) and Nunito (body); icons Font Awesome 6 (CDN). Accessibility expectations: states always icon + text, icon-only buttons need `aria-label`, keyboard support (`Esc` closes, arrows navigate), respect `prefers-reduced-motion`.
