# QHDC! — ¿Qué Hay de Comer?

**Despensa inteligente con IoT e Inteligencia Artificial** · Proyecto escolar del equipo **ARK SYSTEMS**

QHDC! ayuda a una familia a **no desperdiciar comida y no gastar de más**. Unas básculas con ESP32 pesan los alimentos, la aplicación web lleva la alacena, avisa antes de que algo caduque, arma la lista del súper y un asistente sugiere qué usar primero y qué cocinar.

Este repositorio contiene la aplicación completa, basada en las 10 historias de usuario del backlog:

- **frontend/**: las pantallas, en HTML, CSS y JavaScript puro
- **backend/**: el servidor en Node.js + Express, que entrega las páginas y responde la API
- **database/**: el script de MySQL que crea la base completa (vacía, solo con catálogos) y sus migraciones
- **firmware/**: el programa del ESP32 y un sketch para probar el cableado

---

## Contenido

1. [Cómo abrirlo](#1-cómo-abrirlo)
2. [Estructura de carpetas](#2-estructura-de-carpetas)
3. [Historias de usuario y pantallas](#3-historias-de-usuario-y-pantallas)
4. [Concepto de diseño](#4-concepto-de-diseño)
5. [Experiencia: qué hace a la app intuitiva](#5-experiencia-qué-hace-a-la-app-intuitiva)
6. [Explicación de cada pantalla](#6-explicación-de-cada-pantalla)
7. [Archivos compartidos](#7-archivos-compartidos)
8. [Accesibilidad](#8-accesibilidad)
9. [Backend: servidor, API y base de datos](#9-backend-servidor-api-y-base-de-datos)
10. [Equipo](#10-equipo)

---

## 1. Cómo abrirlo

**Necesitas:** [Node.js 18 o más nuevo](https://nodejs.org) y MySQL 8 (MySQL Workbench, XAMPP con MySQL 8 o MySQL Server).

1. **Crea la base de datos.** Abre `database/qhdc_base_de_datos.sql` en MySQL Workbench y ejecútalo completo (el rayo). También puedes usar la terminal con `mysql -u root -p < database/qhdc_base_de_datos.sql`.
2. **Configura el servidor.** En la carpeta `backend`, copia `.env.example` como `.env` y escribe tu usuario y contraseña de MySQL (`DB_USUARIO`, `DB_CONTRASENA`). Para presentar sin hardware pon `SIMULADOR=true` (viene apagado por defecto).
3. **Instala y arranca.** Abre una terminal en la carpeta `backend` y ejecuta:

   ```bash
   npm install
   npm start
   ```

4. **Entra a** <http://localhost:3000>.

> Ya no se abre con doble clic ni con Live Server: las páginas necesitan el servidor para leer y guardar en MySQL. Si abres un HTML suelto, la app te muestra cómo arrancarlo.
>
> En Windows, si PowerShell bloquea `npm`, usa la terminal **cmd** o ejecuta una vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Se necesita internet para los iconos (Font Awesome 6) y las tipografías (Google Fonts).

**Primera cuenta.** La base se instala vacía: solo trae los catálogos (unidades, categorías y alimentos conocidos). Entra a **Crear cuenta**: se crea tu hogar y quedas como administrador. Para sumar a tu familia: avatar → **Ajustes** → Miembros → Invitar.

La primera vez en un navegador se entra con correo y contraseña; después aparece tu **perfil** y basta con tocarlo.

---

## 2. Estructura de carpetas

La app es un **monolito modular**: un solo servidor con un **núcleo compartido** y **un módulo por funcionalidad**. Cada módulo tiene sus rutas y usa el núcleo; el núcleo no depende de ningún módulo.

```text
QHDC/
├── README.md · CLAUDE.md
├── iniciar.cmd               Doble clic: arranca la app
├── publicar.cmd              Doble clic: enlace HTTPS temporal (Cloudflare)
├── publicar-fijo.cmd         Doble clic: dirección fija (Tailscale Funnel)
├── docs/                     Plan, contexto del proyecto, hardware y MQTT
├── database/
│   ├── qhdc_base_de_datos.sql   Tablas, vistas, procedimientos y catálogos (sin datos de ejemplo)
│   └── migraciones/             Cambios para una base que ya existe (npm run db:migrar)
├── firmware/
│   ├── esp32-despensa/       Programa del ESP32 (HX711 + DHT22 por MQTT)
│   └── prueba-sensores/      Sketch para revisar el cableado antes de usar el programa
├── backend/
│   ├── server.js             Arranque: revisa MySQL, enciende MQTT, abre la app y tareas de cada hora
│   ├── .env.example          Configuración (copiar como .env)
│   ├── scripts/              migrar.js · publico.js · vaciar-hogar.js
│   ├── pruebas/              npm test: unitarias, frontend y API (base temporal)
│   └── src/
│       ├── app.js            Arma Express: núcleo → módulos → páginas → errores
│       ├── nucleo/           COMPARTIDO por todos los módulos
│       │   ├── config.js     Lee y valida .env
│       │   ├── db.js         Conexión a MySQL y transacciones
│       │   ├── errores.js    Errores y validación de datos
│       │   ├── seguridad.js  Cabeceras, CSP, mismo origen y límites
│       │   ├── ia.js         Conexión con Claude
│       │   └── imagenes.js   Fotos: validación y almacén privado
│       └── modulos/          UNO POR FUNCIONALIDAD (cada uno con su rutas.js)
│           ├── auth/         Entrar, crear cuenta, perfiles, Google, sesiones
│           ├── hogar/        GET /api/estado: todo el hogar en una respuesta
│           ├── inventario/   Alacena: alimentos, existencias, nombres
│           ├── compras/      Lista del súper y "Terminé de comprar"
│           ├── recetas/      Recetas propias, creadas con IA y modo cocina
│           ├── avisos/       Avisos leídos e historial
│           ├── escaneos/     Fotos → alimentos con IA
│           ├── asistente/    Chef QHDC
│           ├── iot/          ESP32: MQTT, lecturas, calibración, simulador
│           └── ajustes/      Perfil, hogar, miembros, lugares, categorías, preferencias
└── frontend/
    ├── index.html            Bienvenida
    ├── login.html            Entrar (selector de perfiles)
    ├── registro.html         Crear cuenta en 3 pasos
    ├── dashboard.html        Inicio
    ├── inventario.html       Mi alacena          (HU-01, 02, 04)
    ├── alertas.html          Avisos              (HU-04)
    ├── sensores.html         Dispositivos        (HU-03)
    ├── asistente.html        Asistente           (HU-05, 06)
    ├── lista-compras.html    Lista del súper     (HU-07)
    ├── recetas.html          Recetas             (HU-08)
    ├── escanear.html         Escanear            (HU-10)
    ├── ajustes.html          Ajustes: perfil, hogar, lugares, categorías
    ├── css/
    │   ├── base.css          Sistema de diseño: colores, temas, botones, frascos, anillos
    │   ├── app.css           Estructura de la app: menú, barra, buscador, avisos, ventanas
    │   ├── auth.css          Entrar y crear cuenta
    │   └── <pagina>.css      Un archivo por pantalla
    ├── js/
    │   ├── interaccion.js    Tema, sonidos y efectos (todas las páginas)
    │   ├── datos.js          Datos y lógica de la cocina (objeto QHDC)
    │   ├── app.js            Estructura compartida de la app (objeto UI)
    │   └── <pagina>.js       Un archivo por pantalla
    └── img/LOGO.png
```

**Dónde va cada cosa nueva:** si la usan varias funcionalidades, va en `backend/src/nucleo/`; si es de una sola, va en su módulo de `backend/src/modulos/`. Una ruta nueva se registra en `backend/src/app.js`.

**Regla del proyecto:** cada pantalla tiene su HTML, su CSS y su JS con el mismo nombre. Lo que se repite vive en los archivos compartidos.

---

## 3. Historias de usuario y pantallas

Puntos según el *Planning Poker* del equipo (promedio de 6 votos, escala Fibonacci).

| HU | Historia | Pts | Pantalla | Cómo se resolvió |
|---|---|:---:|---|---|
| HU-01 | Registro de alimentos | 4.3 | Mi alacena | Botón **+** con alimentos frecuentes de un toque (rellenan nombre, tipo, unidad, caducidad e icono) |
| HU-02 | Consulta de cantidades | 8 | Mi alacena | Cada alimento es un **frasco que se llena** según lo que queda; vista de lista opcional |
| HU-03 | Actualización con sensores IoT | 11.3 | Dispositivos | Lecturas en vivo cada 3 s: el peso cambia en su lugar, LED que parpadea y registro de actividad |
| HU-04 | Fechas de caducidad y avisos | 7.8 | Mi alacena + Avisos | Fecha obligatoria y "avísame X días antes"; avisos como **notas pegadas al refri** y calendario semanal |
| HU-05 | Recomendaciones con IA | 6.5 | Asistente | Conversación: "¿qué uso primero?" responde con la lista ordenada y una receta |
| HU-06 | Predicción de consumo | 6.7 | Asistente | "¿Cuánto me dura la leche?", panel **Te alcanza para** y gráfica de consumo |
| HU-07 | Lista de compras automática | 5.5 | Lista del súper | Lista con prioridades, carrito con progreso y "Terminé de comprar" (todo lo marcado, también lo anotado a mano, pasa a la alacena) |
| HU-08 | Recomendación de recetas | 5.5 | Recetas + Inicio | Ruleta **"¿Qué hay de comer?"**, recetas que "salvan" alimentos y **modo cocina** paso a paso |
| HU-09 | Consulta desde cualquier dispositivo | 6.5 | Todas | Diseño adaptable con barra inferior tipo app en celular |
| HU-10 | Identificación con cámara | 9.7 | Escanear | Visor tipo cámara con láser, recuadros sobre cada alimento y ajustes antes de guardar |

---

## 4. Concepto de diseño

### Estilo "sticker de cocina"
La interfaz toma el estilo del logo: **bordes de tinta gruesos y sombras sólidas desplazadas**, como calcomanías. Los botones se "hunden" al presionarlos. Es un estilo poco común en apps de inventario y, al mismo tiempo, muy legible por su alto contraste.

### Metáforas de cocina
| Elemento | Metáfora | Por qué ayuda |
|---|---|---|
| Cantidad de un alimento | **Frasco** con líquido y olas | Se entiende cuánto queda sin leer números |
| Salud de la cocina | **Anillo de frescura** 0–100 | Un solo número que resume todo |
| Avisos | **Notas con imán** en el refri | Se "despegan" al marcarlas como vistas |
| Lista de compras | **Ticket** de súper con código de barras | Familiar; al terminar se "imprime" |
| Recetas | Tarjetas con **plato** | Se reconocen de un vistazo |
| Cámara | **Visor** con esquinas, láser y flash | Se siente como una cámara real |

### Paleta "cálido de cocina"

| Nombre | Color | Uso |
|---|---|---|
| Crema | `#FBF6EE` | Fondo |
| Tomate | `#E8562A` | Acción principal |
| Oliva | `#6B8E3D` | Estado bueno, asistente |
| Mostaza | `#F2B33D` | Selección y acentos |
| Petróleo | `#03656F` | Dispositivos (color del logo) |
| Café | `#2B1D14` | Tinta: texto, bordes y sombras |

Hay **tema oscuro** con los mismos roles de color. Se elige solo según el sistema y se puede cambiar con el botón de luna/sol.

### Tipografía
**Fredoka** para títulos (redonda y amigable) y **Nunito** para el texto.

### Movimiento y sonido
- Animaciones con rebote suave: aparición escalonada, frascos que se llenan, números que cuentan, confeti al terminar tareas importantes.
- **Sonidos generados con Web Audio API** (no hay archivos de audio): clic, marcar, éxito, borrar, alerta, ruleta, foto y escaneo. Se silencian con el botón de bocina o desde el menú del avatar.

---

## 5. Experiencia: qué hace a la app intuitiva

| Recurso | Dónde | Qué hace |
|---|---|---|
| **Recorrido en cada pantalla** | Todas las pantallas internas | La primera vez que entras a una pantalla, un recorrido resalta cada tarjeta, botón y control (hasta abre paneles y ventanas para explicarlos). Se avanza con **Siguiente** o las flechas, se puede regresar y **saltar** en cualquier momento |
| **Botón ?** | Barra superior | Repite el recorrido de la pantalla actual cuando quieras |
| **Menú que se encoge** | Menú lateral (computadora) | El botón « deja solo los iconos (con su nombre al pasar el mouse) para dar más espacio; se recuerda tu preferencia. Atajo: tecla `[` |
| **Botón +** | Siempre visible | Agregar alimento, escanear, anotar en la lista o "¿qué cocino hoy?" |
| **Buscador Ctrl + K** (o `/`) | Toda la app | Encuentra alimentos, recetas, secciones y acciones; se navega con flechas |
| **Deshacer** | Al quitar un alimento o un aviso | Evita errores sin pedir confirmaciones |
| **Botones + / −** | Detalle de cada alimento | Registrar lo que usas sin escribir; el paso se adapta a la unidad |
| **Alimentos frecuentes** | Formulario | Un toque llena casi todo el formulario |
| **Perfiles** | Entrar | Entrar con un toque, como en las apps de streaming |
| **Registro en 3 pasos** | Crear cuenta | Preguntas cortas en lugar de un formulario largo |
| **Barra inferior** | Celular | Navegación al alcance del pulgar, con el + al centro |
| **Estados vacíos amables** | Todas las listas | Siempre dicen qué hacer después |

---

## 6. Explicación de cada pantalla

**Bienvenida (`index.html`)** — Refri ilustrado cuyos frascos suben y bajan, un plato "¿Qué hay de comer?" que se puede tocar, cinta animada, problema, cómo funciona, funciones (con su HU), tecnologías y equipo.

**Entrar (`login.html`)** — "¿Quién va a cocinar?" con los perfiles del hogar. "Otra cuenta" despliega correo y contraseña.

**Crear cuenta (`registro.html`)** — Tres pasos: tú, tu hogar y tu contraseña (con medidor de seguridad).

**Inicio (`dashboard.html`)** — Saludo según la hora, ruleta "¿Qué hay de comer?", anillo de frescura, accesos con números, estante "Úsalo pronto", lo que dice el asistente, ticket rápido del súper y dispositivos.

**Mi alacena (`inventario.html`)** — Repisas por lugar (refri, despensa, congelador) con frascos. Al tocar uno se abre un panel con + / −, datos de caducidad y existencia, "Lo volví a comprar", editar y quitar.

**Avisos (`alertas.html`)** — Calendario de la semana y tablero de notas por urgencia. Las notas vistas se guardan abajo y se pueden recuperar.

**Dispositivos (`sensores.html`)** — Tarjetas con forma de aparato: básculas con frascos en vivo, medidor de gases tipo aguja, termómetro, señal WiFi y batería. Pausar/reanudar, reintentar conexión, calibrar y vincular uno nuevo.

**Asistente (`asistente.html`)** — Chat con preguntas sugeridas y escritura libre, más el panel "Te alcanza para" y la gráfica de consumo de 7 días (con tabla accesible).

**Lista del súper (`lista-compras.html`)** — Ticket con grupos Urgente / Pronto / Tú lo anotaste, casillas que tachan, anillo de carrito, "No lo compres, ya tienes" e impresión.

**Recetas (`recetas.html`)** — Filtros, búsqueda por ingrediente, "Sorpréndeme" y modo cocina a pantalla completa con temporizador cuando un paso menciona minutos.

**Escanear (`escanear.html`)** — Abrir cámara, subir foto o usar una reciente; reconocimiento con recuadros y ajuste de cantidad y caducidad antes de guardar.

---

## 7. Archivos compartidos

### `js/interaccion.js` (todas las páginas, en el `<head>`)
- `Tema` — aplica claro/oscuro antes de pintar (sin parpadeo).
- `Sonido` — `Sonido.clic()`, `.marcar()`, `.exito()`, `.borrar()`, `.alerta()`, etc. Todo botón suena solo; `data-sonido="nombre"` cambia el sonido y `data-sonido="ninguno"` lo quita.
- `Efectos` — `escalonar()`, `contar()` y `confeti()`.

### `js/datos.js` → objeto `QHDC`
La lógica de la cocina: alimentos, caducidades, frescura, sensores, avisos, predicciones, lista del súper, recetas, cámara y sesión. Se conecta con la API del servidor (ver sección 9).

### `js/app.js` → objeto `UI`
Dibuja el menú, la barra superior, la barra inferior y el botón +; controla el buscador, el menú de usuario, los avisos con "Deshacer", las ventanas, el panel lateral y el recorrido. También ofrece piezas como `UI.frasco(producto)` y `UI.badgeCaducidad(estado)`.

**Recorridos.** Cada pantalla registra el suyo al final de su JS:

```js
UI.registrarRecorrido([
  { sel: "#buscar", titulo: "Buscar", texto: "Escribe el nombre…" },
  { sel: ".contador-cant", estado: "panel", titulo: "Usa + y −", texto: "…" },
], {
  base: () => UI.cerrarPanel(),                       // vuelve a la normalidad
  estados: { panel: () => abrirDetalle(primerId) },   // prepara lo que el paso necesita
});
```

- `sel` puede ser un selector o una función que devuelve el elemento; si no existe en ese tamaño de pantalla, el paso se omite.
- Se muestra solo la primera vez por pantalla (se guarda `qhdc_tour_<pagina>`); `?tour=1` en la dirección lo fuerza. Crear una cuenta nueva reinicia todos.

### Esqueleto de una pantalla interna

```html
<head>
  ...
  <script src="js/interaccion.js"></script>      <!-- tema antes de pintar -->
</head>
<body data-pagina="inventario">                   <!-- ilumina la sección en el menú -->
  <div class="app">
    <aside class="sidebar" id="sidebar"></aside>  <!-- lo dibuja app.js -->
    <div class="app-main">
      <header class="topbar">
        <div class="topbar-titulo"><h1>Mi alacena</h1><p>…</p></div>
        <div class="topbar-acciones" id="topbarAcciones"></div>
      </header>
      <main class="contenido"> … </main>
    </div>
  </div>
  <script src="js/datos.js"></script>
  <script src="js/app.js"></script>
  <script src="js/inventario.js"></script>
</body>
```

---

## 8. Accesibilidad

- Contraste revisado: en los botones principales el texto es color tinta sobre tomate (4.5 : 1).
- Los estados siempre llevan **icono + texto**, nunca solo color.
- Todo se usa con teclado: contorno mostaza visible, `Esc` cierra ventanas, flechas en el buscador, el recorrido y el modo cocina.
- Botones de solo icono con `aria-label`; avisos anunciados con `aria-live`.
- Si el sistema pide **reducir movimiento**, se desactivan animaciones y confeti.
- La gráfica incluye su tabla de datos.

---

## 9. Backend: servidor, API y base de datos

### Cómo viaja la información

```text
Navegador ──fetch──▶ Express (/api/...) ──mysql2──▶ MySQL (tablas, vistas, procedimientos)
ESP32 ─────MQTT────▶ broker ──▶ módulo iot ────────▶ lecturas_sensor → sp_aplicar_lectura_peso
```

1. Al abrir una página, `datos.js` pide **todo el estado del hogar** (`GET /api/estado`). Los scripts de la página (marcados con `data-qhdc-src`) se cargan cuando ya llegaron los datos.
2. Las pantallas leen esos datos de memoria, por eso todo responde al instante. Su código no cambió.
3. Cada cambio se aplica en pantalla y se manda al servidor **en una cola, en orden**. Si el servidor lo rechaza, la app avisa y recarga con los datos reales.
4. El servidor no guarda cantidades "a mano": registra **consumos y entradas** con los procedimientos de la base, así siempre queda historial para la gráfica y la predicción.

### Sesiones y seguridad
- Contraseñas con **bcrypt**; nunca en texto plano.
- La sesión es una **cookie httpOnly** con un token aleatorio. En la base solo se guarda su hash SHA-256 (`sesiones_autenticacion`).
- **Perfiles guardados:** al entrar se genera un segundo token (30 días) que el navegador guarda para entrar con un toque. Si expira, se pide la contraseña.
- Cada consulta filtra por el **hogar** de la sesión: nadie ve datos de otra casa.
- Los ESP32 se identifican con su **identificador + clave**; en la base solo está el hash de la clave.
- Freno a intentos de contraseña (8 por minuto) y validación de todo lo que llega.
- Contraseñas de al menos 8 caracteres.
- Cabeceras de seguridad (helmet) con una **política de contenido (CSP)**: el navegador solo ejecuta código de la propia app (y del botón de Google, si se usa). Por eso el HTML no debe tener scripts ni `onclick` en línea.
- Las peticiones que cambian datos y vienen de **otro sitio web** se rechazan (protección CSRF, además de la cookie SameSite).
- **Límites por IP**: 300 peticiones por minuto en la API, y límites aparte para entrar, crear cuentas, subir fotos, usar la IA y para los ESP32.

### Rutas de la API

| Pantalla / función de `datos.js` | Ruta |
|---|---|
| `iniciarSesion` · `entrarComoPerfil` · `registrar` · `cerrarSesion` | `POST /api/auth/entrar` · `/perfil` · `/registro` · `/salir` |
| Carga de cualquier pantalla | `GET /api/estado` |
| `guardarProducto` (nuevo / editar) | `POST /api/alimentos` · `PUT /api/alimentos/:id` |
| `eliminarProducto` · `restaurarProducto` | `DELETE /api/alimentos/:id` · `POST /api/alimentos/:id/restaurar` |
| `ajustar` · `consumir` | `PUT /api/alimentos/:id/existencia` |
| `rellenar` | `POST /api/alimentos/:id/rellenar` |
| `simularCiclo` (Dispositivos, cada 3 s) | `GET /api/sensores/vivo?desde=ID` |
| `reconectarSensor` ("Reintentar conexión" / "Probar") | `POST /api/sensores/:id/conectar` |
| `calibrarBascula` (tara / peso conocido, ejecutado por el ESP32 vía MQTT) | `POST /api/sensores/:id/calibrar` |
| `asignarAlimentoBascula` (qué alimento está sobre la báscula) | `PUT /api/sensores/:id/alimento` |
| `vincularDispositivo` (crea identificador y clave) | `POST /api/sensores` |
| `marcarLeida` · `historialAvisos` | `PUT /api/avisos/leida` · `GET /api/avisos/historial` |
| `marcarComprado` · `agregarExtra` · `eliminarExtra` · `finalizarCompra` | `PUT /api/lista/comprado` · `POST/DELETE /api/lista/extras` · `POST /api/lista/finalizar` |
| `generarReceta` · `guardarReceta` · `borrarReceta` | `POST /api/recetas/generar` · `POST /api/recetas` · `DELETE /api/recetas/:id` |
| `terminarReceta` (modo cocina) | `POST /api/recetas/:id/preparar` |
| `subirFoto` · `analizarFoto` · `confirmarEscaneo` · `borrarFoto` | `POST /api/escaneos/foto` · `POST /api/escaneos/:id/analizar` · `POST /api/escaneos/:id/confirmar` · `GET/DELETE /api/imagenes/:id` |
| `preguntarAsistente` (con IA) · respaldo con reglas | `POST /api/asistente/preguntar` · `POST /api/asistente/mensajes` |
| Tema, sonidos, menú, vista y recorridos | `PUT /api/preferencias` · `PUT /api/recorridos/:pantalla` |
| Ajustes: perfil, hogar, miembros, invitaciones, lugares, categorías | `/api/ajustes/...` |
| **ESP32** | **MQTT** (ver `docs/mqtt.md`) · alternativa HTTP: `POST /api/iot/configuracion` · `POST /api/iot/lecturas` |
| Revisar que todo esté conectado | `GET /api/salud` |

### Los ESP32 y el simulador
El hardware es **un ESP32 con celda de carga + HX711 (peso) y un DHT22 (temperatura y humedad)**, alimentado por USB. Se comunica por **MQTT**: el servidor trae su propio broker, así que en tu computadora no hay que instalar nada.

- **Conexiones, pines, voltajes y pruebas paso a paso:** `docs/hardware.md`
- **Topics, mensajes, reglas y cómo usar un broker externo en Hostinger:** `docs/mqtt.md`
- **Firmware:** `firmware/esp32-despensa/` (copia `config.example.h` como `config.h`). Prueba de cableado: `firmware/prueba-sensores/`.

Con `SIMULADOR=true` (en `.env`) el servidor simula ese mismo ESP32 (el que indiquen `SIMULADOR_IDENTIFICADOR` y `SIMULADOR_CLAVE`; en una base nueva primero vincúlalo en Dispositivos): se conecta por MQTT con su clave, manda peso, temperatura y humedad, y responde a la tara y a la calibración, **igual que el hardware**. Cuando conecten el ESP32 real, pongan `SIMULADOR=false`. También pueden correr el simulador aparte con `npm run simulador`.

Desde **Dispositivos** se puede vincular un ESP32 nuevo (genera su identificador y su clave), elegir qué alimento está sobre la báscula y calibrarla de verdad.

### Seguridad de los dispositivos
- Cada ESP32 entra con su **identificador + clave**. La clave la genera la app al vincularlo (Dispositivos → *Vincular dispositivo*), se muestra **una sola vez** y en la base solo queda su hash SHA-256.
- **Nunca escribas una clave real en el código ni en la documentación**: los ejemplos usan marcadores como `PEGA-AQUI-LA-CLAVE`. La clave va solo en `firmware/esp32-despensa/config.h` (ignorado por Git) y, si usas el simulador, en `backend/.env` (`SIMULADOR_IDENTIFICADOR` y `SIMULADOR_CLAVE`, también ignorado por Git).
- El simulador no tiene clave predeterminada: si `SIMULADOR=true` y faltan esos datos, el servidor avisa y no lo arranca.
- `npm run publico` no publica si algún dispositivo usa una clave que haya aparecido en la documentación (como la del antiguo ESP32 de ejemplo).
- Si una clave se filtra: vincula el dispositivo otra vez (clave nueva), cópiala en `config.h` y en `.env`, y da de baja el anterior.

### Fotos e inteligencia artificial
La foto se toma con la cámara del celular o de la computadora, o se elige de la galería. La app la reduce a 1600 px y la sube al servidor por HTTP(S), nunca por MQTT. El servidor:
1. Revisa que sea una imagen **real** (JPG, PNG o WebP, máx. `IMAGEN_MAX_MB`), la gira, le **borra los metadatos** (ubicación GPS) y la guarda con un nombre aleatorio en `backend/almacen/imagenes/`. Es una carpeta privada: solo se ve con sesión del hogar, por `GET /api/imagenes/:id`. Se borra después de `IMAGENES_RETENCION_DIAS`.
2. Pide a **Claude** (`ANTHROPIC_API_KEY` en `.env`, modelo `IA_MODELO`) que **proponga** los alimentos, con su confianza y su recuadro.
3. La persona corrige el nombre, el tipo, la cantidad y la caducidad. Lo dudoso llega desmarcado con **Revisar**. Solo al tocar **Guardar** cambia la alacena (`POST /api/escaneos/:id/confirmar`).

La IA no estima peso ni caducidad: la cantidad solo se sugiere cuando se pueden contar piezas, y la caducidad sugerida sale de la vida útil del alimento. Sin `ANTHROPIC_API_KEY`, el reconocimiento funciona en **modo de demostración** y la app lo avisa.

Desde el celular por la red local (`http://IP-de-tu-PC:3000`), "Abrir cámara" usa la cámara del teléfono, porque la cámara en vivo del navegador necesita HTTPS. En producción (HTTPS) funcionan ambas.

### Asistente "Chef QHDC" con IA
`POST /api/asistente/preguntar`. Las cuentas exactas las hace el **servidor** desde MySQL: cantidades, días para caducar, cuánto te alcanza cada alimento, lista del súper y recetas con sus ingredientes faltantes. Claude solo **redacta** la respuesta con esos datos. Después el servidor **valida** lo que propone: solo deja tarjetas de alimentos y recetas que existen, y para una receta nueva marca él mismo qué ingredientes tienes y cuáles faltan (con botón "Anotar lo que falta"). La conversación se guarda en `conversaciones_asistente` / `mensajes_asistente`. Si la IA no está configurada, la pantalla responde con las reglas de siempre.

### Ajustes (avatar → Ajustes)
- **Mi perfil:** nombre, correo y contraseña. Debe tener al menos 8 caracteres, y al cambiarla se cierran las sesiones abiertas en otros dispositivos.
- **Mi hogar:** nombre, personas y días de aviso. Muestra quiénes viven ahí, permite cambiar su rol o quitarlos (el hogar siempre conserva un administrador) e **invitar** con un enlace que vale 7 días y se comparte por WhatsApp. No se envían correos: la persona invitada se registra con ese mismo correo y entra directo a tu hogar.
- **Lugares y ambiente:** agregar lugares y fijar el rango de temperatura y humedad que vigila el DHT22.
- **Categorías:** las generales son de todos; cada hogar puede crear las suyas.
- En cada alimento se puede elegir **cuándo anotarlo en la lista del súper** (10 % a 50 %, o solo si se acaba).
- **Avisos:** cada persona elige qué avisos ver (caducidad, se acaba, dispositivos).

### Lista del súper
Lo que marcas va al **carrito**; al tocar **Terminé de comprar**, todo lo marcado pasa a tu alacena:
- Si ya tenías ese alimento, se rellena.
- Lo anotado a mano (o lo que faltaba de una receta) se crea con la cantidad que escribiste ("2 piezas", "1 kg"). Si el alimento está en el catálogo, se usan su categoría, lugar y vida útil; si no, queda en Despensa con 7 días de caducidad, que puedes cambiar en la Alacena.

Los nombres se comparan sin acentos, mayúsculas ni plurales, así que "huevos" rellena tu "Huevo". Las recetas usan la misma regla para saber qué tienes. La sal, la pimienta, el agua, el aceite y el azúcar cuentan como "en casa" aunque no estén registrados.

### Recetas propias
Cada hogar tiene **sus propias recetas**: ya no se cargan recetas de ejemplo para todos. En **Recetas → Crear receta** hay tres formas:
- **Con mis ingredientes:** eliges alimentos de tu alacena y la IA propone una receta.
- **Con una foto:** tomas o eliges una foto de tus ingredientes y la IA propone una receta. La foto no se guarda.
- **Escribirla yo:** ingredientes con cantidad y pasos.

Lo que propone la IA es un **borrador**: el servidor marca qué ingredientes tienes y cuáles faltan, puedes cambiar todo, y solo se guarda al tocar **Guardar receta**. Las recetas se pueden borrar desde su detalle.

### Avisos
Los avisos dependen de una condición: desaparecen solos cuando el problema se resuelve (repones algo, quitas lo caducado, el sensor vuelve a estar en rango o se conecta). Al marcarlos como vistos pasan a **Ya vistos**. Si un aviso se resuelve y vuelve a aparecer en menos de 12 horas (por ejemplo, la temperatura sube y baja cerca del límite), conserva el "visto". En **Historial de 30 días** se ven todos, también los resueltos (`GET /api/avisos/historial`).

### Entrar con Google (opcional)
1. En https://console.cloud.google.com crea un proyecto → *APIs y servicios* → *Credenciales* → *Crear credenciales* → **ID de cliente de OAuth** → tipo **Aplicación web**.
2. En *Orígenes autorizados de JavaScript* agrega `http://localhost:3000` y, en Hostinger, `https://tu-dominio`.
3. Copia el ID de cliente en `backend/.env` como `GOOGLE_CLIENT_ID=...` y reinicia el servidor. El botón aparece en *Entrar*.

El servidor verifica el token de Google y vincula la cuenta por su correo. Si el correo no existe, crea una cuenta con un hogar nuevo.

### Cambios en la base de datos (migraciones)
Una base que ya existe se actualiza **sin perder datos** con:
```bash
cd backend
npm run db:migrar
```
Aplica los archivos de `database/migraciones/` que falten. Una base nueva se crea con `database/qhdc_base_de_datos.sql`, que ya los incluye.

### Pruebas automatizadas
En la carpeta `backend`:

```bash
npm test                # todas (141 pruebas, ~1 minuto)
npm run test:unitarias  # reglas y frontend; no necesita MySQL (~2 s)
npm run test:api        # la API contra una base temporal
npm run test:cobertura  # todas + cobertura por archivo
```

- **Unitarias** (`backend/pruebas/unitarias/`): reglas puras. Nombres de alimentos, validación de datos, cantidades escritas a mano ("2 piezas"), lecturas de sensores y topics MQTT, revisión de lo que propone la IA y protección contra peticiones de otros sitios.
- **Frontend** (`backend/pruebas/frontend/`): carga `frontend/js/datos.js` con un navegador simulado. Incluye el fallo real de las recetas con sal y aceite, y comprueba que la app y el servidor comparen los nombres igual.
- **API** (`backend/pruebas/api/`): cada archivo crea una base temporal `qhdc_prueba_…` con `database/qhdc_base_de_datos.sql`, arranca la app en un puerto libre y al terminar borra todo. Corre sin MQTT, sin simulador y **sin IA**: se prueba el modo sin clave y no se gasta dinero. Cubre cuentas, roles, aislamiento entre hogares, seguridad, alacena, lista del súper, recetas, avisos, ajustes, ESP32 por HTTP y fotos.
- Necesitan MySQL 8 encendido y un usuario que pueda crear y borrar bases (los datos de `backend/.env`). Tu base `qhdc` no se toca.
- Cobertura: ~78 % de las líneas. Lo menos cubierto depende de servicios externos: la conexión MQTT en vivo (`iot/cliente.js`) y las llamadas reales a Claude (`nucleo/ia.js`, `asistente.js`, `vision.js`).

### Arrancar con doble clic
- **`iniciar.cmd`** (en la carpeta del proyecto): arranca la app (http://localhost:3000).
- **`publicar.cmd`**: la publica con un enlace HTTPS temporal (ver abajo).
- **`publicar-fijo.cmd`**: la publica con una **dirección fija** usando Tailscale Funnel (gratis): `https://<tu-pc>.<tu-red>.ts.net`. Necesita Tailscale instalado y con sesión iniciada. La primera vez, Tailscale da un enlace para activar HTTPS y Funnel en tu cuenta.

No dependen de que la terminal reconozca `npm`: cada uno busca Node.js por su cuenta.

### Publicarlo gratis desde tu computadora (Cloudflare Tunnel)
Sirve para mostrar la app desde cualquier lugar, con **HTTPS**, mientras no haya hosting. Con HTTPS, el celular también puede usar la cámara en vivo.
1. **Usa contraseñas seguras.** Con el enlace público cualquiera puede intentar entrar. El comando no publica mientras alguna cuenta use una contraseña conocida (como `admin123` o `miembro123`, de las antiguas cuentas de ejemplo). Se cambian en avatar → Ajustes → Contraseña.
2. Ten `cloudflared.exe` en `%LOCALAPPDATA%\Programs\cloudflared\`. Se descarga de https://github.com/cloudflare/cloudflared/releases (`cloudflared-windows-amd64.exe`).
3. En `backend`:
   ```bash
   npm run publico
   ```
   Arranca el servidor si hace falta y muestra un enlace `https://….trycloudflare.com`. **Ctrl + C** lo cierra.

Limitaciones:
- La PC debe estar encendida.
- El enlace cambia cada vez que lo inicias.
- "Entrar con Google" no funciona con este enlace, porque Google necesita una dirección fija.
- El ESP32 sigue conectándose a la PC por tu WiFi.

### Subirlo a un hosting
Funciona en cualquier servicio con Node.js (Render, Railway, un VPS…) y una base MySQL 8 en la nube:
1. Ejecuta el script SQL en la base de la nube (se crea vacía, solo con catálogos).
2. En el hosting configura las mismas variables del `.env` (`DB_HOST`, `DB_USUARIO`, etc.), `COOKIE_SEGURA=true` y, si no hay ESP32 todavía, `SIMULADOR=true`.
3. Comando de arranque: `npm start` (carpeta `backend`).
4. Entra y crea la primera cuenta: será la administradora del hogar.

---

## 10. Equipo

**ARK SYSTEMS** — Diego Rafael Ávila Peralta · Tadeo Habith Contreras Gama · Axel González Rivera · Rodrigo Ortega Maldonado · Marilú Ramírez López · Héctor Jesús Tabarez López
