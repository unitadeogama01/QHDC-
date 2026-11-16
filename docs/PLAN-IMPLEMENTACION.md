# Despensa Inteligente (QHDC!) — Diagnóstico y plan por fases

> Plan aprobado por el usuario el 2026-11-08. Estado de avance en `docs/CONTEXTO-SESION.md`.

## Contexto
El proyecto ya no es "una interfaz parcial": es una app funcional **Express + MySQL** con 11 pantallas HTML/CSS/JS, sesiones seguras, 32 tablas, 8 vistas, 6 procedimientos y un simulador de ESP32. Lo que falta es alinearla al hardware real (1 ESP32 + celda de carga/HX711 + DHT22 por USB), sustituir lo simulado (visión IA y asistente) por integraciones reales, mover IoT de HTTP a MQTT, y prepararla para Hostinger. Decisiones tomadas por el usuario:
- **Hostinger:** aún no definido → diseño portable (broker MQTT configurable por `.env`; Docker Compose opcional para VPS).
- **IA:** Claude API (`@anthropic-ai/sdk`, modelo `claude-opus-5-5`) desde el backend.
- **Gas / batería / dispositivos extra:** ocultarlos sin borrar código (se muestran solo si un dispositivo reporta ese tipo).

## 1. Diagnóstico del estado actual

### Lo que ya funciona y se conserva
| Área | Estado | Archivos |
|---|---|---|
| Servidor Express (API + estáticos, errores centralizados, headers básicos) | Bien | `backend/server.js` |
| Pool MySQL, `consulta/una/transaccion` con reintento por deadlock | Bien | `backend/src/db.js` |
| Validadores `texto/numero/fecha/id`, `ErrorApp`, `async_` | Bien, reutilizar | `backend/src/errores.js` |
| Sesión: token aleatorio en cookie httpOnly, solo hash SHA-256 en BD, bcrypt(12), freno de intentos, roles admin/miembro | Bien | `backend/src/auth.js`, `src/rutas/auth.js` |
| Multi-hogar con FKs compuestas `(hogar_id, id)` | Muy bien | SQL §1–9 |
| Inventario por lotes + `movimientos_inventario` (historial), bajas lógicas | Muy bien | SQL §3, §6, §11 |
| Lista de compras automática (`vista_lista_sugerida`, `sp_generar_lista`), extras manuales, "terminé de comprar" | Bien | `rutas/lista.js` |
| Avisos idempotentes por `clave` (`sp_generar_avisos`) y lecturas por usuario | Bien | SQL §9 |
| Recetas, disponibilidad (`vista_recetas_disponibilidad`), modo cocina | Bien | `rutas/cocina.js`, `js/recetas.js` |
| Frontend: diseño "sticker de cocina", tema oscuro, accesibilidad, recorridos, cola de mutaciones optimista | Bien — **no se rediseña** | `frontend/` |
| Cámara: `getUserMedia`, vista previa, "otra foto", confirmación antes de guardar | Parcial | `escanear.html/js` |

### Problemas encontrados
**Alineación con el hardware (crítico)**
1. El modelo asume hardware que no existe: sensor de gas (ppm) con aviso "posible alimento en mal estado" (`sp_generar_avisos` §gas, `datos.js:396`, `sensores.js` medidor), batería, 4 dispositivos (2 básculas, refri, congelador). Contradice "no inferir descomposición por sensores".
2. No hay umbrales configurables de temperatura/humedad ni avisos por DHT22.
3. `sp_aplicar_lectura_peso` aplica **cada lectura** directamente al inventario (solo filtra ruido 0.5 %): sin estabilidad (N lecturas consecutivas), sin detección de "plataforma vacía/retirada", sin rango válido de la celda. Un producto levantado un momento genera consumo + reabastecimiento falsos.
4. Conversión peso→unidades: existe `dispositivo_alimentos.factor_conversion` + `tara`, pero no hay "peso por unidad" por producto ni calibración real (botón "Calibrar" del frontend es decorativo).
5. Sin deduplicación: la lectura no trae id de mensaje ni marca de tiempo del dispositivo (`leido_en = NOW(3)`).

**IoT / comunicación**
6. IoT es HTTP con `identificador + clave` en el cuerpo de cada petición; no hay MQTT, LWT, ni detección de desconexión por evento (solo por tiempo en vista).
7. El simulador corre **dentro** del servidor por defecto (`SIMULADOR !== "false"`), riesgo en producción.

**Fotografías e IA**
8. La foto **nunca llega al backend**: `POST /api/escaneos` recibe solo lo "detectado" en el navegador; `referencia_imagen` es un texto inventado (`navegador/foto-<ts>.jpg`). Reconocimiento simulado en `datos.js:550` (`detectarAlimentos`), cajas aleatorias.
9. `<input id="archivo" capture="environment">` en móvil **fuerza la cámara e impide elegir de la galería** → se necesitan dos inputs (cámara / galería).
10. Sin validación de tipo real, tamaño, ni almacenamiento privado; no hay `multer`.
11. El escaneo crea alimentos nuevos sin pedir categoría/ubicación (las adivina) y no distingue baja confianza.
12. Asistente: respuesta generada en el **frontend** (`asistente.js responder()`) y el backend solo guarda texto que el cliente le manda (el cliente puede guardar cualquier cosa como "respuesta del asistente").

**Seguridad / operación**
13. `backend/.env` es en realidad la plantilla (`.env.example` no existe; README dice copiarla). Contraseña mínima 6 caracteres. Sin CSRF explícito (mitigado por `SameSite=Lax` + JSON), sin rate-limit general, sin CSP.
14. Sin Google OAuth, sin edición de perfil/contraseña, sin administración de categorías por hogar (categorías son globales).
15. Sin pruebas, linter, migraciones (un solo `.sql` de 108 KB con `DELIMITER`, no ejecutable desde Node), sin Docker, sin repositorio git.
16. Node.js no está en el PATH de esta máquina (no se pudo ejecutar `node -v`); `node_modules` sí existe.
17. Purga de lecturas a 7 días borra el historial que el requisito pide consultar.

## 2. Arquitectura propuesta (Monolito Modular)

```
Navegador (HTML/CSS/JS actual) ──HTTPS/JSON + multipart──▶ Express (monolito modular)
ESP32 (HX711 + DHT22) ──MQTT (TLS en prod)──▶ Broker (Mosquitto en VPS | HiveMQ/EMQX Cloud)
                                                   ▲ suscripción
Express ── módulo iot (cliente mqtt.js) ───────────┘
Express ── módulo ia ──HTTPS──▶ Claude API (claude-opus-5-5)
Express ── mysql2 ──▶ MySQL 8   ·   uploads privados en disco (fuera de frontend/)
```

Reorganización del backend (mantiene los archivos actuales, se mueven a módulos):
```
backend/src/
  nucleo/       db.js, errores.js, config.js (lee .env y valida), registro (logs)
  modulos/
    auth/       sesiones (actual) + Google OAuth + perfil
    inventario/ alimentos, lotes, categorías, ubicaciones, unidades  (servicios/inventario.js)
    compras/    lista.js
    recetas/    recetas + comparación determinista de ingredientes
    avisos/     generación y lectura de notificaciones + umbrales ambientales
    iot/        mqtt-cliente.js, validacion-mensajes.js, reglas-peso.js, estado-dispositivos.js,
                http-legacy.js (POST /api/iot/lecturas se conserva para pruebas/simulador)
    imagenes/   subida (multer), validación por firma, almacenamiento privado, política de retención
    ia/         proveedor-claude.js (visión + recetas/asistente), esquemas JSON de salida
    hogar/      estadoCompleto (contrato /api/estado sin cambios)
```
Reglas: frontend y ESP32 nunca tocan MySQL; toda mutación de inventario pasa por los procedimientos existentes (`sp_consumir_interno`, `sp_reabastecer`); la IA **nunca** escribe inventario — solo propone, el usuario confirma.

### Topics MQTT (documentados en `docs/mqtt.md`, iguales en firmware y backend)
| Topic | Dirección | Payload (JSON) |
|---|---|---|
| `despensa/{deviceId}/bascula/peso` | ESP32→broker | `{msgId, ts, valor, unidad:"g", estable:true, crudo}` |
| `despensa/{deviceId}/ambiente/temperatura` | ESP32→broker | `{msgId, ts, valor, unidad:"°C"}` |
| `despensa/{deviceId}/ambiente/humedad` | ESP32→broker | `{msgId, ts, valor, unidad:"%"}` |
| `despensa/{deviceId}/estado` | ESP32→broker (retained + LWT `offline`) | `{estado:"online", ip, rssi, firmware}` |
| `despensa/{deviceId}/comandos` | backend→ESP32 | `{cmd:"tara"|"calibrar", pesoReferencia}` |

Se incluye `{deviceId}` en el topic (requerido para identificar dispositivo y ACL por dispositivo). Autenticación: usuario/clave MQTT por dispositivo + ACL al prefijo propio; QoS 1; deduplicación por `(dispositivo_id, msg_id)` único en BD.

### Reglas de negocio clave
- **Peso:** el firmware publica solo lecturas estables (ventana de N muestras con desviación < umbral). El backend aplica al inventario solo si: valor dentro de rango de la celda (0–capacidad), cambio sostenido ≥ 2 lecturas, y no es "plataforma vacía" transitoria. `peso_neto = (valor − tara)`; unidades solo si el producto tiene `peso_unitario_g` configurado; si no, se registra en g/kg. Lecturas inválidas se guardan con motivo y no tocan inventario.
- **Ambiente:** umbrales min/max por ubicación (tabla nueva); avisos de tipo `ambiente` con texto neutro ("La temperatura de la despensa superó 30 °C"), nunca "alimento en mal estado".
- **Imágenes:** JPEG/PNG/WebP/HEIC, máx. 8 MB, validación por firma (magic bytes), nombre UUID, carpeta `backend/almacen/imagenes/` (ya ignorada estilo `uploads/`), servidas solo por `GET /api/imagenes/:id` con verificación de hogar; redimensionado a ≤1600 px; borrado automático a los 30 días (configurable).
- **IA visión:** salida estructurada (`output_config.format` con JSON Schema: nombre, categoría sugerida, confianza 0–1, caja opcional, cantidad visible opcional). Confianza < 0.6 → elemento desmarcado por defecto y marcado "revisar". Nunca infiere peso ni caducidad: el usuario los completa.
- **Recetas/recomendaciones:** faltantes y cantidades por lógica determinista (SQL/JS); a Claude se le envía solo el inventario real y se le pide elegir/explicar, validando que todo ingrediente "disponible" exista en el inventario antes de mostrarlo.

## 2.1 Mismo código en local y en Hostinger
No cambia la arquitectura: todo lo que difiere entre entornos vive en `.env` (`.env.example` documenta ambos perfiles). Ningún archivo de código tiene rutas, URLs ni credenciales fijas.

| Pieza | Local (tu PC, Windows) | Hostinger |
|---|---|---|
| Arranque | `npm run dev` (igual que hoy) | `npm start` o `docker compose up` (VPS) |
| MySQL | MySQL local / XAMPP / Workbench (como hoy) | MySQL de Hostinger o contenedor |
| Broker MQTT | Mosquitto para Windows o `docker compose up mosquitto` (`MQTT_URL=mqtt://localhost:1883`); el ESP32 apunta a la IP de tu PC en la misma Wi-Fi | Mosquitto en VPS o HiveMQ/EMQX Cloud (`mqtts://...`) |
| Sin hardware | `SIMULADOR=true` publica por MQTT igual que el ESP32 | `SIMULADOR=false` |
| Imágenes | `backend/almacen/imagenes/` | misma ruta (volumen persistente) |
| IA | `ANTHROPIC_API_KEY` en `.env`; sin clave → reconocimiento simulado | misma variable |
| HTTPS / cámara | `localhost` cuenta como contexto seguro (la cámara funciona en la PC). Desde el celular por la red local: los botones "Tomar foto"/"Galería" (`input file`) funcionan por HTTP; para "Abrir cámara" en vivo se usa un certificado local (`mkcert`, opcional) | HTTPS con Nginx/Caddy o el SSL de Hostinger; `COOKIE_SEGURA=true` |
| Google Sign-In | Client ID con origen `http://localhost:3000` | Client ID con el dominio real |

Docker es **opcional** en local: el flujo actual sin Docker sigue funcionando. Se agregan scripts `npm run db:migrar` y `npm run simulador` para ambos entornos.

## 3. Plan de implementación por fases
Cada fase termina con verificación y espera tu visto bueno antes de la siguiente.

**Fase 0 — Base del repositorio (sin cambios funcionales)**
`git init` + commit inicial; crear `.env.example` (y avisar que `.env` actual es plantilla); `config.js` que valide variables; `SIMULADOR=false` por defecto en producción; comprobar instalación de Node ≥18.

**Fase 1 — Esquema de BD alineado al hardware (migraciones)**
Introducir migraciones incrementales en `database/migraciones/NNN_*.sql` conservando el script completo. Cambios: `lecturas_sensor` + `msg_id`, `leido_dispositivo_en`, `valido`, `motivo_invalidez`, único `(dispositivo_id, msg_id)`; `alimentos.peso_unitario_g`; tabla `umbrales_ambiente (hogar_id, ubicacion_id, temp_min/max, hum_min/max)`; tabla `calibraciones_bascula`; tabla `imagenes` (ruta, mime, tamaño, sha256, usuario, expira_en) referenciada por `escaneos`; tipo de notificación `ambiente`; categorías por hogar (`categorias_alimento.hogar_id NULL`=global); `usuarios.google_sub`. Datos de ejemplo → 1 ESP32 con báscula + DHT22. Purga de lecturas: agregación horaria en vez de borrado.

**Fase 2 — Reorganización modular del backend**
Mover rutas/servicios a `src/modulos/*` sin cambiar el contrato de `/api/estado` ni las rutas usadas por `datos.js`. Añadir `helmet` (CSP compatible con Font Awesome/Google Fonts), `express-rate-limit` en auth/subidas, contraseña mínima 8.

**Fase 3 — IoT con MQTT + firmware ESP32**
- Backend: `mqtt` (mqtt.js), suscripción, validación de payload, dedupe, reglas de peso, estado online/offline por LWT, comandos tara/calibrar desde "Calibrar" en `sensores.js`.
- Simulador reescrito para publicar por MQTT (mismo hardware real).
- `firmware/esp32-despensa/` (Arduino/PlatformIO): librerías `HX711` (bogde), `DHT sensor library` (Adafruit), `PubSubClient`, `ArduinoJson`; NTP para `ts`; reconexión Wi-Fi/MQTT con backoff; calibración guardada en `Preferences`.
- Conexiones (`docs/hardware.md`): HX711 VCC→3V3, GND→GND, DT→GPIO 19, SCK→GPIO 18; celda E+/E−/A+/A− (rojo/negro/blanco/verde, verificar por colores del modelo); DHT22 VCC→3V3, DATA→GPIO 27 con pull-up 10 kΩ (si el módulo no la trae), GND→GND. Evitar GPIO 0/2/5/12/15 (arranque), 6–11 (flash), 34–39 (solo entrada), 16–17 (PSRAM en WROVER). Lectura DHT22 cada ≥2 s. Pruebas por sensor (sketch de diagnóstico, tara, peso de referencia conocido).
- Broker: Mosquitto en Docker (VPS) o HiveMQ Cloud/EMQX Cloud (compartido), solo cambia `.env`.

**Fase 4 — Fotos e identificación con Claude**
- Frontend (`escanear.html/js`, mismos estilos): dos botones — "Tomar foto" (`capture="environment"`) y "Elegir de galería" (sin `capture`); se conserva "Abrir cámara" (`getUserMedia`) para PC; validación previa de tamaño/tipo y compresión en canvas; vista previa, cancelar, otra foto.
- Backend: `POST /api/imagenes` (multer en memoria → validación por firma → `sharp` para redimensionar/quitar EXIF → disco privado) → `POST /api/escaneos/:id/analizar` (Claude visión, imagen base64, salida estructurada, `fallbacks: "default"` con beta `server-side-fallback-2026-07-01`, manejo de `stop_reason: "refusal"`) → `POST /api/escaneos/:id/confirmar` (lo actual de `rutas/cocina.js /escaneos`, ahora con categoría/ubicación/cantidad/caducidad del usuario).
- `QHDC.detectarAlimentos` pasa a llamar al backend; el simulador queda como respaldo si falta `ANTHROPIC_API_KEY`.

**Fase 5 — Asistente, recomendaciones y recetas con IA**
`POST /api/asistente/preguntar`: el backend arma el contexto desde MySQL (inventario, caducidades, predicciones), Claude responde; el backend guarda pregunta y respuesta (ya no las manda el cliente). `responder()` de `asistente.js` queda como respaldo sin conexión. Recetas sugeridas: candidatos y faltantes por SQL; Claude ordena/explica y puede proponer receta nueva solo con ingredientes existentes (validado). "Agregar faltantes a la lista" reutiliza `lista_compras_items` motivo `receta`.

**Fase 6 — Usuarios, perfil, categorías y Google**
Edición de perfil y contraseña, invitaciones (tabla `invitaciones_hogar` ya existe), administración de categorías/ubicaciones/unidades/mínimos, umbrales ambientales en "Dispositivos". Google Sign-In con `google-auth-library` (verificación del ID token en backend; requiere HTTPS y Client ID).

**Fase 7 — Notificaciones**
Avisos ambientales, de dispositivo offline (LWT) y de reabastecimiento con historial consultable; ocultar gas/batería en UI cuando no hay datos. Opcional posterior: Web Push.

**Fase 8 — Despliegue Hostinger**
`Dockerfile` + `docker-compose.yml` (app, mysql, mosquitto, nginx/caddy con HTTPS) para VPS; guía alternativa para Node administrado + MySQL de Hostinger + broker en la nube. `COOKIE_SEGURA=true`, HTTPS obligatorio (cámara).

### Dependencias nuevas (y por qué)
`mqtt` (cliente MQTT), `multer` (multipart), `sharp` (redimensionar/EXIF), `file-type` (tipo real del archivo), `@anthropic-ai/sdk` (Claude), `helmet` y `express-rate-limit` (seguridad), `google-auth-library` (fase 6). Vite: **no** se propone por ahora — el frontend no tiene build y su patrón `data-qhdc-src` funciona; se reevaluará si se requiere empaquetado.

## Verificación (por fase)
- Instalar Node ≥18, `npm install`, ejecutar script SQL + migraciones, `npm start`, `GET /api/salud`.
- Recorrer las 11 pantallas comparando visualmente con el estado actual (capturas antes/después).
- IoT: `mosquitto_pub` con payloads válidos/ inválidos/ duplicados → revisar `lecturas_sensor`, `movimientos_inventario` y avisos; desconectar el ESP32 → aviso offline por LWT.
- Hardware: sketch de diagnóstico por sensor, tara y calibración con un peso conocido (p. ej. 500 g), DHT22 contra termómetro de referencia.
- Fotos: subir JPEG/PNG válidos, archivo renombrado `.jpg` falso (debe rechazarse), >8 MB (rechazar), acceso a imagen de otro hogar (403); confirmar que el inventario solo cambia tras "Guardar".
- IA: respuestas sin ingredientes inventados (validación servidor), comportamiento sin `ANTHROPIC_API_KEY` (respaldo).
- Pruebas automáticas mínimas con `node --test` para validadores, reglas de peso y dedupe.
