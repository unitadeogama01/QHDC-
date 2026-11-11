// ============================================================
//  QHDC! — DATOS Y LÓGICA (conectado al servidor Express + MySQL)
//
//  Cómo funciona:
//  1. Al abrir una página se pide todo el estado del hogar a la API
//     (GET /api/estado). Mientras llega, las páginas esperan: sus scripts
//     se declaran con data-qhdc-src y este archivo los carga después.
//  2. Las pantallas leen los datos de una copia en memoria (caché), así
//     todo responde al instante y el código de cada página no cambia.
//  3. Cada cambio (usar, rellenar, comprar...) se aplica en la caché y se
//     manda al servidor en una COLA, en orden. Si el servidor rechaza un
//     cambio, se avisa y la página se recarga con los datos reales.
//  4. Los cálculos (frescura, caducidad, lista sugerida) son los mismos de
//     siempre; la base de datos tiene vistas equivalentes.
// ============================================================

const QHDC = (() => {
  const API = "/api";
  const CLAVE_PERFILES = "qhdc_perfiles";

  // ---------------- FECHAS ----------------
  function hoy() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  // Fecha dentro de N días en formato AAAA-MM-DD (hora local)
  function enDias(n) {
    const d = hoy();
    d.setDate(d.getDate() + n);
    const dos = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  }
  function diasHasta(fechaTexto) {
    return Math.round((new Date(fechaTexto + "T00:00:00") - hoy()) / 86400000);
  }

  // ---------------- CATÁLOGOS (llegan del servidor) ----------------
  const CATEGORIAS = [];
  const UBICACIONES = [];
  const UNIDADES = [];
  const RECETAS = [];
  const CATALOGO_CAMARA = [];

  // Iconos de Font Awesome disponibles para los productos
  const ICONOS = [
    { clase: "fa-bowl-rice", nombre: "Arroz / granos" },
    { clase: "fa-wheat-awn", nombre: "Pasta / trigo" },
    { clase: "fa-jar", nombre: "Frasco / legumbres" },
    { clase: "fa-bread-slice", nombre: "Pan / tortilla" },
    { clase: "fa-glass-water", nombre: "Leche / bebida" },
    { clase: "fa-cheese", nombre: "Queso" },
    { clase: "fa-egg", nombre: "Huevo" },
    { clase: "fa-drumstick-bite", nombre: "Pollo / carne" },
    { clase: "fa-fish", nombre: "Pescado" },
    { clase: "fa-carrot", nombre: "Verdura" },
    { clase: "fa-leaf", nombre: "Hoja verde" },
    { clase: "fa-pepper-hot", nombre: "Chile" },
    { clase: "fa-apple-whole", nombre: "Fruta" },
    { clase: "fa-lemon", nombre: "Cítrico" },
    { clase: "fa-mug-hot", nombre: "Café / té" },
    { clase: "fa-bottle-water", nombre: "Botella" },
    { clase: "fa-cookie", nombre: "Galletas / snack" },
    { clase: "fa-box-open", nombre: "Otro" },
  ];

  // ---------------- CACHÉ ----------------
  let sesion = null;
  let datos = { productos: [], sensores: [], lecturas: [], listaExtra: [], comprados: [], alertasLeidas: [], escaneos: [] };
  let ultimaLecturaId = 0;
  let lecturasNuevas = [];

  function reemplazar(lista, nuevos) { lista.splice(0, lista.length, ...(nuevos || [])); }

  function aplicarEstado(e) {
    sesion = e.sesion || null;
    datos = {
      productos: e.productos || [],
      sensores: e.sensores || [],
      lecturas: e.lecturas || [],
      listaExtra: e.listaExtra || [],
      comprados: e.comprados || [],
      alertasLeidas: e.alertasLeidas || [],
      escaneos: e.escaneos || [],
    };
    reemplazar(CATEGORIAS, e.categorias);
    reemplazar(UBICACIONES, e.ubicaciones);
    reemplazar(UNIDADES, e.unidades);
    reemplazar(RECETAS, e.recetas);
    reemplazar(CATALOGO_CAMARA, e.catalogo);
    ultimaLecturaId = datos.lecturas.reduce((m, l) => Math.max(m, l.id || 0), ultimaLecturaId);
  }

  // ---------------- COMUNICACIÓN CON EL SERVIDOR ----------------
  const conKeepalive = (() => { try { return "keepalive" in new Request("/"); } catch (e) { return false; } })();

  async function pedir(metodo, ruta, cuerpo) {
    let r;
    try {
      r = await fetch(API + ruta, {
        method: metodo,
        credentials: "same-origin",
        headers: cuerpo !== undefined ? { "Content-Type": "application/json" } : {},
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
        // keepalive: el cambio se termina de enviar aunque cambies de página
        keepalive: conKeepalive && metodo !== "GET",
      });
    } catch (e) {
      const err = new Error("No hay conexión con el servidor.");
      err.estado = 0;
      throw err;
    }
    let json = null;
    try { json = await r.json(); } catch (e) { /* respuesta sin cuerpo */ }
    if (!r.ok) {
      const err = new Error((json && json.error) || `Error ${r.status}`);
      err.estado = r.status;
      throw err;
    }
    return json;
  }

  // Ids temporales: un alimento nuevo existe en pantalla antes de que el
  // servidor le dé su id real. Se usan negativos y luego se traducen.
  let idTemporal = 0;
  const mapaIds = new Map();
  const real = (id) => (mapaIds.has(Number(id)) ? mapaIds.get(Number(id)) : Number(id));
  const claveReal = (clave) => clave.replace(/^([px])-(-?\d+)$/, (_, t, n) => `${t}-${real(n)}`);

  function asignarId(temporal, idReal) {
    mapaIds.set(temporal, idReal);
    [datos.productos, datos.listaExtra].forEach((lista) => lista.forEach((x) => { if (x.id === temporal) x.id = idReal; }));
    datos.comprados = datos.comprados.map(claveReal);
  }

  // Cola: los cambios se mandan uno por uno y en orden
  let cola = Promise.resolve();
  let pendientes = 0;
  let temporizadorSync = null;

  function avisar(texto) {
    if (typeof UI !== "undefined" && typeof UI.toast === "function") UI.toast(texto, { icono: "fa-triangle-exclamation" });
    else console.warn(texto);
    if (typeof Sonido !== "undefined") Sonido.alerta();
  }

  function enviar(metodo, ruta, cuerpo, { alTerminar, silencioso = false } = {}) {
    pendientes++;
    const tarea = cola
      .then(() => pedir(metodo, typeof ruta === "function" ? ruta() : ruta, typeof cuerpo === "function" ? cuerpo() : cuerpo))
      .then((r) => { if (alTerminar) alTerminar(r); return r; })
      .catch((e) => {
        if (silencioso) return null;
        if (e.estado === 401) { location.replace("login.html"); return null; }
        avisar(e.estado === 0 ? "Sin conexión con el servidor. No se guardó el cambio." : e.message);
        setTimeout(() => location.reload(), 2200); // vuelve a mostrar lo que hay en la base
        return null;
      })
      .finally(() => {
        pendientes--;
        if (!pendientes) programarSincronizacion();
      });
    cola = tarea;
    return tarea;
  }

  // Después de guardar, se trae el estado real (por si otro miembro del
  // hogar o un sensor cambió algo)
  function programarSincronizacion(ms = 1500) {
    clearTimeout(temporizadorSync);
    temporizadorSync = setTimeout(sincronizar, ms);
  }
  async function sincronizar() {
    if (!sesion) return;
    try {
      const e = await pedir("GET", "/estado");
      if (pendientes) return; // llegaron cambios nuevos mientras tanto
      aplicarEstado(e);
      document.dispatchEvent(new CustomEvent("qhdc:datos"));
      if (typeof UI !== "undefined" && typeof UI.actualizarContadores === "function") UI.actualizarContadores();
    } catch (e) {
      if (e.estado === 401) location.replace("login.html");
    }
  }

  // ---------------- CÁLCULOS DE UN PRODUCTO ----------------
  function estado(p) {
    const pct = p.capacidad > 0 ? Math.min(100, Math.round((p.cantidad / p.capacidad) * 100)) : 0;
    const dias = diasHasta(p.caducidad);
    const nivel = pct <= 25 ? "bajo" : pct <= 50 ? "medio" : "ok";
    let cad = "ok";
    if (dias < 0) cad = "caducado";
    else if (dias <= 1) cad = "urgente";
    else if (dias <= Math.max(3, p.aviso || 3)) cad = "pronto";
    const diasAgotar = p.consumoDiario > 0 ? Math.floor(p.cantidad / p.consumoDiario) : null;
    return { pct, dias, nivel, cad, diasAgotar };
  }

  // Texto amigable de caducidad
  function textoCaducidad(dias) {
    if (dias < 0) return `Caducó hace ${-dias} ${-dias === 1 ? "día" : "días"}`;
    if (dias === 0) return "Caduca hoy";
    if (dias === 1) return "Caduca mañana";
    return `Caduca en ${dias} días`;
  }

  function formatoCantidad(n, unidad) {
    const num = Number.isInteger(n) ? n : +(+n).toFixed(2);
    return `${num} ${unidad}`;
  }

  // ---------------- PRODUCTOS (HU-01, HU-02, HU-04) ----------------
  const productos = () => datos.productos.map((p) => ({ ...p, estado: estado(p) }));
  const producto = (id) => productos().find((p) => p.id === real(id));
  const buscar = (id) => datos.productos.find((x) => x.id === real(id));

  function fichaLimpia(info) {
    return {
      nombre: String(info.nombre).trim(),
      categoria: info.categoria,
      ubicacion: info.ubicacion,
      cantidad: Number(info.cantidad),
      capacidad: Number(info.capacidad) || Number(info.cantidad),
      unidad: info.unidad,
      caducidad: info.caducidad,
      precio: Number(info.precio) || 0,
      icono: info.icono || "fa-box-open",
      color: info.color || "cafe",
      aviso: Number(info.aviso) || 3,
    };
  }

  // Solo en la caché (lo usan el formulario y la cámara)
  function crearLocal(limpio, origen) {
    const consumo = +(limpio.capacidad / 30).toFixed(2);
    const nuevo = {
      id: --idTemporal, ...limpio, origen: origen || "manual", sensorId: null,
      consumoDiario: consumo, vida: Math.max(1, diasHasta(limpio.caducidad)), historial: Array(7).fill(0),
    };
    datos.productos.push(nuevo);
    return nuevo;
  }

  function guardarProducto(info) {
    const limpio = fichaLimpia(info);
    if (info.id) {
      const p = buscar(info.id);
      Object.assign(p, limpio);
      enviar("PUT", () => `/alimentos/${real(p.id)}`, limpio);
      return p;
    }
    const nuevo = crearLocal(limpio, info.origen);
    const temporal = nuevo.id;
    enviar("POST", "/alimentos", { ...limpio, origen: nuevo.origen }, { alTerminar: (r) => asignarId(temporal, r.id) });
    return nuevo;
  }

  // Devuelve el producto borrado para poder "deshacer"
  function eliminarProducto(id) {
    const borrado = buscar(id);
    datos.productos = datos.productos.filter((p) => p !== borrado);
    datos.comprados = datos.comprados.filter((k) => k !== `p-${borrado.id}`);
    enviar("DELETE", () => `/alimentos/${real(borrado.id)}`);
    return borrado;
  }
  function restaurarProducto(producto) {
    if (!producto || datos.productos.some((p) => p.id === real(producto.id))) return;
    datos.productos.push(producto);
    enviar("POST", () => `/alimentos/${real(producto.id)}/restaurar`, {});
  }

  /** Manda al servidor la cantidad que quedó (él calcula consumo o entrada) */
  function guardarExistencia(p, extra = {}) {
    const cuerpo = { cantidad: p.cantidad, capacidad: p.capacidad, caducidad: p.caducidad, ...extra };
    enviar("PUT", () => `/alimentos/${real(p.id)}/existencia`, cuerpo);
  }

  // Tamaño de paso "natural" para los botones + / − de cada unidad
  function paso(p) {
    if (["pz", "manojo"].includes(p.unidad)) return 1;
    if (p.unidad === "L" || p.unidad === "kg") return p.capacidad <= 1 ? 0.1 : 0.25;
    const bruto = p.capacidad / 10;
    return [10, 25, 50, 100, 250].find((n) => n >= bruto) || 250;
  }
  // Suma o resta una cantidad (no baja de 0; si pasa del máximo, el máximo crece)
  function ajustar(id, delta) {
    const p = buscar(id);
    p.cantidad = Math.max(0, +(p.cantidad + delta).toFixed(2));
    if (p.cantidad > p.capacidad) p.capacidad = p.cantidad;
    guardarExistencia(p);
    return { ...p, estado: estado(p) };
  }

  // Índice de frescura de la cocina (0 a 100): qué tan bien está todo
  function frescura() {
    const lista = productos();
    if (!lista.length) return { valor: 100, caducados: 0, urgentes: 0, pronto: 0, bajos: 0 };
    const caducados = lista.filter((p) => p.estado.cad === "caducado").length;
    const urgentes = lista.filter((p) => p.estado.cad === "urgente").length;
    const pronto = lista.filter((p) => p.estado.cad === "pronto").length;
    const bajos = lista.filter((p) => p.estado.nivel === "bajo").length;
    const valor = Math.max(0, Math.min(100, Math.round(100 - caducados * 12 - urgentes * 7 - pronto * 3 - bajos * 2)));
    return { valor, caducados, urgentes, pronto, bajos };
  }

  function consumirLocal(id, cantidad) {
    const p = buscar(id);
    p.cantidad = Math.max(0, +(p.cantidad - Number(cantidad)).toFixed(2));
    return p;
  }
  function consumir(id, cantidad) {
    const p = consumirLocal(id, cantidad);
    guardarExistencia(p);
    return p;
  }

  function rellenarLocal(p) {
    p.cantidad = p.capacidad;
    if (diasHasta(p.caducidad) < 2) p.caducidad = enDias(p.vida || 7);
  }
  function rellenar(id) {
    const p = buscar(id);
    rellenarLocal(p);
    enviar("POST", () => `/alimentos/${real(p.id)}/rellenar`, {});
    return p;
  }

  // ---------------- SENSORES IoT (HU-03) ----------------
  const sensores = () => datos.sensores.map((s) => ({ ...s }));
  const lecturas = (limite = 20) => datos.lecturas.slice(-limite).reverse();

  // Trae lo que mandaron los ESP32 desde la última vez
  let pidiendoVivo = false;
  async function traerEnVivo() {
    if (pidiendoVivo || !sesion) return;
    pidiendoVivo = true;
    try {
      const r = await pedir("GET", `/sensores/vivo?desde=${ultimaLecturaId}`);
      // Se conserva lo que el usuario cambió (p. ej. "Conectar") mientras hay cambios pendientes
      if (!pendientes) datos.sensores = r.sensores;
      if (!pendientes) {
        r.productos.forEach((n) => { const p = datos.productos.find((x) => x.id === n.id); if (p) Object.assign(p, n); });
      }
      r.lecturas.forEach((l) => { ultimaLecturaId = Math.max(ultimaLecturaId, l.id); });
      datos.lecturas = datos.lecturas.concat(r.lecturas).slice(-300);
      lecturasNuevas = lecturasNuevas.concat(r.lecturas);
    } catch (e) {
      if (e.estado === 401) location.replace("login.html");
    } finally {
      pidiendoVivo = false;
    }
  }

  // La pantalla de dispositivos llama esto cada pocos segundos: devuelve las
  // lecturas que llegaron y pide las siguientes.
  function simularCiclo() {
    const nuevas = lecturasNuevas;
    lecturasNuevas = [];
    traerEnVivo();
    return nuevas;
  }

  function alternarSensor(id) {
    const s = datos.sensores.find((x) => x.id === Number(id));
    s.enLinea = !s.enLinea;
    if (s.enLinea) enviar("POST", `/sensores/${s.id}/conectar`, {});
    return s;
  }

  // ---------------- ALERTAS (HU-04) ----------------
  // Las claves (cad-7, stock-1, disp-4, gas-3) son las mismas de la tabla notificaciones
  function alertas() {
    const lista = [];
    productos().forEach((p) => {
      const e = p.estado;
      if (e.cad === "caducado") {
        lista.push({ id: `cad-${p.id}`, tipo: "caducidad", nivel: "peligro", icono: "fa-calendar-xmark", productoId: p.id,
          titulo: `${p.nombre} ya caducó`, detalle: `${textoCaducidad(e.dias)}. Revísalo y deséchalo si no está en buen estado.` });
      } else if (e.cad === "urgente") {
        lista.push({ id: `cad-${p.id}`, tipo: "caducidad", nivel: "peligro", icono: "fa-hourglass-half", productoId: p.id,
          titulo: `${p.nombre}: ${textoCaducidad(e.dias).toLowerCase()}`, detalle: "Consúmelo hoy. Mira las recetas sugeridas para aprovecharlo." });
      } else if (e.cad === "pronto") {
        lista.push({ id: `cad-${p.id}`, tipo: "caducidad", nivel: "aviso", icono: "fa-calendar-days", productoId: p.id,
          titulo: `${p.nombre}: ${textoCaducidad(e.dias).toLowerCase()}`, detalle: "Planea usarlo en los próximos días." });
      }
      if (e.nivel === "bajo" && e.cad !== "caducado") {
        lista.push({ id: `stock-${p.id}`, tipo: "stock", nivel: "aviso", icono: "fa-arrow-trend-down", productoId: p.id,
          titulo: `Queda poco ${p.nombre.toLowerCase()}`, detalle: `Quedan ${formatoCantidad(p.cantidad, p.unidad)} (${e.pct}%). Ya está en tu lista de compras.` });
      }
    });
    datos.sensores.forEach((s) => {
      if (!s.enLinea) {
        lista.push({ id: `disp-${s.id}`, tipo: "sensor", nivel: "info", icono: "fa-plug-circle-xmark", sensorId: s.id,
          titulo: `${s.nombre} desconectado`, detalle: `No recibimos datos del ${s.modelo} en ${s.ubicacion.toLowerCase()}. Revisa la batería (${s.bateria}%) o el WiFi.` });
      }
      if (s.tipo === "gas" && s.enLinea && s.gas > 400) {
        lista.push({ id: `gas-${s.id}`, tipo: "sensor", nivel: "peligro", icono: "fa-wind", sensorId: s.id,
          titulo: "Posible alimento en mal estado", detalle: `El sensor de frescura detecta ${s.gas} ppm de gases en el refrigerador. Revisa carnes y frutas.` });
      }
    });
    const orden = { peligro: 0, aviso: 1, info: 2 };
    return lista
      .map((a) => ({ ...a, leida: datos.alertasLeidas.includes(a.id) }))
      .sort((a, b) => a.leida - b.leida || orden[a.nivel] - orden[b.nivel]);
  }
  const alertasPendientes = () => alertas().filter((a) => !a.leida).length;
  function marcarLeida(id, leida = true) {
    datos.alertasLeidas = datos.alertasLeidas.filter((x) => x !== id);
    if (leida) datos.alertasLeidas.push(id);
    enviar("PUT", "/avisos/leida", () => ({ clave: claveAviso(id), leida }));
  }
  const claveAviso = (id) => String(id).replace(/^(cad|stock)-(-?\d+)$/, (_, t, n) => `${t}-${real(n)}`);

  // ---------------- IA: CONSUMIR PRIMERO Y PREDICCIÓN (HU-05, HU-06) ----------------
  function consumirPrimero() {
    return productos()
      .filter((p) => p.cantidad > 0 && p.estado.dias <= 7)
      .sort((a, b) => a.estado.dias - b.estado.dias)
      .map((p) => {
        const e = p.estado;
        let razon;
        if (e.cad === "caducado") razon = "Ya caducó: revisa si aún está en buen estado antes de usarlo.";
        else if (e.dias <= 1) razon = "Es lo más urgente de tu refrigerador.";
        else if (p.categoria === "Carnes y pescados" || p.categoria === "Lácteos") razon = "Los perecederos de origen animal se echan a perder rápido.";
        else razon = "Úsalo esta semana para no desperdiciarlo.";
        const receta = recetasSugeridas().find((r) => r.ingredientes.some((i) => i.producto && i.producto.id === p.id));
        return { ...p, razon, receta };
      });
  }

  function predicciones() {
    return productos()
      .filter((p) => p.consumoDiario > 0)
      .map((p) => {
        const dias = p.estado.diasAgotar;
        const fecha = enDias(dias);
        const promedio = p.historial.reduce((s, x) => s + x, 0) / p.historial.length;
        return { ...p, diasAgotar: dias, fechaAgotar: fecha, promedio: +promedio.toFixed(2) };
      })
      .sort((a, b) => a.diasAgotar - b.diasAgotar);
  }

  function resumenIA() {
    const primero = consumirPrimero().filter((p) => p.estado.cad !== "caducado").slice(0, 3);
    const comprar = predicciones().filter((p) => p.diasAgotar <= 5).slice(0, 3);
    const receta = recetasSugeridas()[0];
    const nombres = (l) => l.map((p) => p.nombre.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " y $1");
    let texto = "";
    if (primero.length) texto += `Consume primero ${nombres(primero)}. `;
    if (receta) texto += `Una buena opción para hoy es ${receta.nombre.toLowerCase()}. `;
    if (comprar.length) texto += `Según tu ritmo de consumo, pronto se te acabará ${nombres(comprar)}.`;
    return texto || "Todo en orden: no hay nada urgente en tu cocina.";
  }

  function registrarConversacion(pregunta, respuesta) {
    enviar("POST", "/asistente/mensajes", { pregunta, respuesta }, { silencioso: true });
  }

  // ---------------- LISTA DE COMPRAS (HU-07) ----------------
  function listaCompras() {
    const auto = productos()
      .filter((p) => p.estado.cad === "caducado" || p.estado.pct <= 30 || (p.estado.diasAgotar !== null && p.estado.diasAgotar <= 5))
      .map((p) => {
        const e = p.estado;
        let motivo, icono, prioridad;
        if (e.cad === "caducado") { motivo = "Caducó, hay que reponerlo"; icono = "fa-calendar-xmark"; prioridad = "alta"; }
        else if (e.pct <= 30) { motivo = `Quedan ${formatoCantidad(p.cantidad, p.unidad)} (${e.pct}%)`; icono = "fa-arrow-trend-down"; prioridad = e.pct <= 15 ? "alta" : "media"; }
        else { motivo = `Se acaba en ~${e.diasAgotar} días según tu consumo`; icono = "fa-brain"; prioridad = "media"; }
        const falta = +(p.capacidad - p.cantidad).toFixed(2);
        const sugerida = e.cad === "caducado" || falta <= 0 ? p.capacidad : falta;
        return { clave: `p-${p.id}`, producto: p, nombre: p.nombre, motivo, icono, prioridad,
          cantidad: formatoCantidad(sugerida, p.unidad), precio: p.precio, comprado: datos.comprados.includes(`p-${p.id}`) };
      })
      .sort((a, b) => (a.prioridad === "alta" ? 0 : 1) - (b.prioridad === "alta" ? 0 : 1));

    const extras = datos.listaExtra.map((x) => ({
      clave: `x-${x.id}`, extra: true, nombre: x.nombre, motivo: "Agregado por ti", icono: "fa-user-pen", prioridad: "baja",
      cantidad: x.cantidad, precio: Number(x.precio) || 0, comprado: datos.comprados.includes(`x-${x.id}`),
    }));

    const enLista = new Set(auto.map((i) => i.producto.id));
    const suficiente = productos().filter((p) => !enLista.has(p.id) && p.estado.pct >= 60);
    return { items: [...auto, ...extras], suficiente };
  }

  function marcarComprado(clave, comprado) {
    datos.comprados = datos.comprados.filter((k) => k !== clave);
    if (comprado) datos.comprados.push(clave);
    enviar("PUT", "/lista/comprado", () => ({ clave: claveReal(clave), comprado: Boolean(comprado) }));
  }
  function agregarExtra(nombre, cantidad, precio, recetaId) {
    const extra = { id: --idTemporal, nombre: String(nombre).trim(), cantidad: cantidad || "1", precio: Number(precio) || 0 };
    datos.listaExtra.push(extra);
    const temporal = extra.id;
    enviar("POST", "/lista/extras", { nombre: extra.nombre, cantidad: extra.cantidad, precio: extra.precio, recetaId: recetaId || null },
      { alTerminar: (r) => asignarId(temporal, r.id) });
  }
  function eliminarExtra(clave) {
    const id = Number(clave.replace("x-", ""));
    datos.listaExtra = datos.listaExtra.filter((x) => x.id !== id && x.id !== real(id));
    datos.comprados = datos.comprados.filter((k) => k !== clave);
    enviar("DELETE", () => `/lista/extras/${real(id)}`);
  }
  // Al terminar de comprar: se rellenan los productos marcados
  function finalizarCompra() {
    let total = 0;
    datos.comprados.forEach((clave) => {
      if (clave.startsWith("p-")) {
        const p = buscar(clave.slice(2));
        if (p) { total++; rellenarLocal(p); }
      } else {
        total++;
        datos.listaExtra = datos.listaExtra.filter((x) => `x-${x.id}` !== clave);
      }
    });
    datos.comprados = [];
    enviar("POST", "/lista/finalizar", {});
    return total;
  }

  // ---------------- RECETAS (HU-08) ----------------
  const normalizar = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  function recetasSugeridas() {
    const inv = productos();
    return RECETAS.map((r) => {
      const ingredientes = r.ingredientes.map((ing) => {
        const producto = inv.find((p) => normalizar(p.nombre).includes(normalizar(ing.nombre)));
        const disponible = !!producto && producto.cantidad > 0 && producto.estado.cad !== "caducado";
        const urgente = disponible && ["urgente", "pronto"].includes(producto.estado.cad);
        return { ...ing, producto, disponible, urgente };
      });
      const faltan = ingredientes.filter((i) => !i.disponible).length;
      const urgentes = ingredientes.filter((i) => i.urgente).length;
      const coincidencia = Math.round(((ingredientes.length - faltan) / ingredientes.length) * 100);
      return { ...r, ingredientes, faltan, urgentes, coincidencia, puntos: urgentes * 3 - faltan * 2 };
    }).sort((a, b) => b.puntos - a.puntos || b.coincidencia - a.coincidencia);
  }

  // "¡Terminé!" del modo cocina: descuenta lo usado y queda en el historial
  function terminarReceta(recetaId, consumos) {
    consumos.forEach((c) => consumirLocal(c.productoId, c.cantidad));
    enviar("POST", `/recetas/${recetaId}/preparar`, () => ({
      consumos: consumos.map((c) => ({ alimentoId: real(c.productoId), cantidad: c.cantidad })),
    }));
  }

  // ---------------- CÁMARA (HU-10) ----------------
  // Simula lo que devolvería un modelo de visión (el catálogo viene de la base)
  function detectarAlimentos() {
    const mezclados = [...CATALOGO_CAMARA].sort(() => Math.random() - 0.5);
    const cuantos = 3 + Math.floor(Math.random() * 2);
    return mezclados.slice(0, cuantos).map((a) => ({
      ...a,
      confianza: Math.round(82 + Math.random() * 17),
      caja: { x: 5 + Math.random() * 60, y: 5 + Math.random() * 55, w: 20 + Math.random() * 12, h: 22 + Math.random() * 12 },
    }));
  }

  detectarAlimentos.catalogo = () => CATALOGO_CAMARA.map((a) => ({ ...a }));

  // alimentos = los que se guardan · todos = también los que se descartaron (para el historial)
  function agregarDesdeCamara(alimentos, todos = alimentos) {
    alimentos.forEach((a) => {
      const existente = datos.productos.find((p) => normalizar(p.nombre) === normalizar(a.nombre));
      if (existente) {
        existente.cantidad = +(existente.cantidad + Number(a.cantidad)).toFixed(2);
        existente.capacidad = Math.max(existente.capacidad, existente.cantidad);
        existente.caducidad = a.caducidad;
      } else {
        crearLocal(fichaLimpia({
          nombre: a.nombre, categoria: a.categoria, ubicacion: a.categoria === "Granos y cereales" ? "Despensa" : "Refrigerador",
          cantidad: a.cantidad, capacidad: a.cantidad, unidad: a.unidad, caducidad: a.caducidad,
          precio: a.precio, icono: a.icono, color: a.color,
        }), "camara");
      }
    });
    datos.escaneos.unshift({ fecha: new Date().toISOString(), alimentos: alimentos.map((a) => a.nombre) });
    datos.escaneos = datos.escaneos.slice(0, 5);
    const elegidos = new Set(alimentos);
    enviar("POST", "/escaneos", {
      alimentos: todos.map((a) => ({
        nombre: a.nombre, categoria: a.categoria, unidad: a.unidad, cantidad: a.cantidad, caducidad: a.caducidad,
        precio: a.precio, icono: a.icono, color: a.color, confianza: a.confianza, caja: a.caja, elegido: elegidos.has(a),
      })),
    }, { alTerminar: () => programarSincronizacion(0) });
  }
  const escaneos = () => datos.escaneos;

  // ---------------- SESIÓN (HU-09) ----------------
  // Perfiles guardados en este dispositivo: nombre + token para entrar con un toque
  function leerPerfiles() {
    try { return JSON.parse(localStorage.getItem(CLAVE_PERFILES)) || []; } catch (e) { return []; }
  }
  function guardarPerfil(perfil) {
    if (!perfil || !perfil.token) return;
    const lista = leerPerfiles().filter((p) => p.email !== perfil.email);
    lista.unshift(perfil);
    try { localStorage.setItem(CLAVE_PERFILES, JSON.stringify(lista.slice(0, 5))); } catch (e) { /* sin almacenamiento */ }
  }
  function olvidarPerfil(email) {
    try { localStorage.setItem(CLAVE_PERFILES, JSON.stringify(leerPerfiles().filter((p) => p.email !== email))); } catch (e) { /* nada */ }
  }
  const perfiles = () => leerPerfiles().map(({ nombre, email, rol }) => ({ nombre, email, rol }));

  async function iniciarSesion(email, password) {
    try {
      const r = await pedir("POST", "/auth/entrar", { email: String(email).trim().toLowerCase(), password });
      guardarPerfil(r.perfil);
      sesion = r.sesion;
      return sesion;
    } catch (e) {
      if (e.estado === 401) return null;
      throw e;
    }
  }
  async function entrarComoPerfil(email) {
    const p = leerPerfiles().find((x) => x.email === email);
    if (!p) return null;
    try {
      const r = await pedir("POST", "/auth/perfil", { email: p.email, token: p.token });
      sesion = r.sesion;
      return sesion;
    } catch (e) {
      if (e.estado === 401) { olvidarPerfil(email); return null; }
      throw e;
    }
  }
  async function registrar({ nombre, email, password, hogar, personas, lugares }) {
    try {
      const r = await pedir("POST", "/auth/registro", { nombre: nombre.trim(), email: String(email).trim().toLowerCase(), password, hogar: hogar.trim() || "Mi casa", personas, lugares });
      guardarPerfil(r.perfil);
      sesion = r.sesion;
      return { sesion };
    } catch (e) {
      return { error: e.message };
    }
  }
  const sesionActual = () => sesion;
  async function cerrarSesion() {
    try { await pedir("POST", "/auth/salir", {}); } catch (e) { /* igual se sale */ }
    sesion = null;
  }

  // Borra la alacena y carga la cocina de ejemplo (solo administrador)
  async function reiniciar() {
    await cola; // primero se terminan de guardar los cambios pendientes
    await pedir("POST", "/hogar/restablecer", {});
  }

  // ---------------- PREFERENCIAS SINCRONIZADAS ----------------
  // Tema, sonidos, menú, vista y recorridos se guardan también en la base,
  // así te siguen a cualquier dispositivo.
  const PANTALLAS = ["dashboard", "inventario", "alertas", "lista-compras", "asistente", "recetas", "escanear", "sensores"];
  function aplicarPreferencias(p) {
    if (!p || typeof Pref === "undefined") return;
    if (p.tema === "claro" || p.tema === "oscuro") {
      document.documentElement.dataset.tema = p.tema;
      Pref.guardar("qhdc_tema", p.tema);
    }
    if (typeof Sonido !== "undefined" && Sonido.activo() !== p.sonidos) Sonido.alternar();
    Pref.guardar("qhdc_menu_compacto", p.menuCompacto ? "1" : "0");
    Pref.guardar("qhdc_vista_alacena", p.vistaAlacena || "frascos");
    PANTALLAS.forEach((pantalla) => {
      try {
        if (p.recorridos.includes(pantalla)) localStorage.setItem(`qhdc_tour_${pantalla}`, "1");
        else localStorage.removeItem(`qhdc_tour_${pantalla}`);
      } catch (e) { /* sin almacenamiento */ }
    });
  }
  function escucharPreferencias() {
    if (typeof Pref === "undefined") return;
    const original = Pref.guardar;
    Pref.guardar = (clave, valor) => {
      original(clave, valor);
      if (!sesion) return;
      const op = { silencioso: true };
      if (clave === "qhdc_tema") enviar("PUT", "/preferencias", { tema: valor }, op);
      else if (clave === "qhdc_sonido") enviar("PUT", "/preferencias", { sonidos: valor === "1" }, op);
      else if (clave === "qhdc_menu_compacto") enviar("PUT", "/preferencias", { menuCompacto: valor === "1" }, op);
      else if (clave === "qhdc_vista_alacena") enviar("PUT", "/preferencias", { vistaAlacena: valor }, op);
      else if (clave.startsWith("qhdc_tour_")) enviar("PUT", `/recorridos/${clave.slice(10)}`, { completado: true }, op);
    };
  }

  // ---------------- ARRANQUE DE LA PÁGINA ----------------
  function mostrarSinServidor() {
    const archivo = location.protocol === "file:";
    document.body.insertAdjacentHTML("beforeend", `
      <div role="alert" style="position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:16px;background:rgba(43,29,20,.55)">
        <div style="max-width:440px;background:#fbf6ee;color:#2b1d14;border:3px solid #2b1d14;border-radius:18px;box-shadow:6px 6px 0 #2b1d14;padding:24px;font-family:inherit">
          <h2 style="margin:0 0 8px">No encontramos el servidor</h2>
          <p style="margin:0 0 12px">${archivo
            ? "Abriste el archivo directo. La app ahora necesita el servidor de QHDC!"
            : "El servidor de QHDC! no responde o no puede conectarse a MySQL."}</p>
          <ol style="margin:0 0 12px;padding-left:20px;line-height:1.6;list-style:decimal">
            <li>Abre una terminal en la carpeta <b>backend</b></li>
            <li>Ejecuta <code>npm install</code> (solo la primera vez)</li>
            <li>Ejecuta <code>npm start</code></li>
            <li>Entra a <a href="http://localhost:3000">http://localhost:3000</a></li>
          </ol>
          <button type="button" onclick="location.reload()" style="font:inherit;font-weight:700;padding:10px 16px;border:3px solid #2b1d14;border-radius:12px;background:#e8562a;color:#fff;cursor:pointer">Reintentar</button>
        </div>
      </div>`);
  }

  // Carga, en orden, los scripts de la página (app.js, inventario.js...)
  function cargarScriptsDePagina() {
    const etiquetas = [...document.querySelectorAll("script[data-qhdc-src]")];
    let restantes = etiquetas.length;
    const terminar = () => { if (typeof Efectos !== "undefined") Efectos.escalonar(); };
    if (!restantes) return terminar();
    etiquetas.forEach((et) => {
      const s = document.createElement("script");
      s.src = et.dataset.qhdcSrc;
      s.async = false; // respeta el orden
      s.onload = s.onerror = () => { if (--restantes === 0) terminar(); };
      document.body.appendChild(s);
    });
  }

  const domListo = new Promise((ok) => {
    if (document.readyState !== "loading") ok();
    else document.addEventListener("DOMContentLoaded", ok, { once: true });
  });

  const listo = (async () => {
    try {
      const e = await pedir("GET", "/estado");
      aplicarEstado(e);
      aplicarPreferencias(e.preferencias);
    } catch (e) {
      if (e.estado !== 401) throw e; // 401 = no hay sesión (login y registro lo esperan)
    }
    escucharPreferencias();
  })();

  Promise.all([listo, domListo]).then(cargarScriptsDePagina, async () => { await domListo; mostrarSinServidor(); });

  return {
    // catálogos
    CATEGORIAS, UBICACIONES, UNIDADES, ICONOS, RECETAS,
    // utilidades
    enDias, diasHasta, textoCaducidad, formatoCantidad, estado,
    // productos
    productos, producto, guardarProducto, eliminarProducto, restaurarProducto, consumir, rellenar, paso, ajustar, frescura,
    // sensores
    sensores, lecturas, simularCiclo, alternarSensor,
    // alertas
    alertas, alertasPendientes, marcarLeida,
    // IA
    consumirPrimero, predicciones, resumenIA, registrarConversacion,
    // compras
    listaCompras, marcarComprado, agregarExtra, eliminarExtra, finalizarCompra,
    // recetas y cámara
    recetasSugeridas, terminarReceta, detectarAlimentos, agregarDesdeCamara, escaneos,
    // sesión
    iniciarSesion, registrar, sesionActual, cerrarSesion, reiniciar, perfiles, entrarComoPerfil,
    // servidor
    listo, sincronizar,
  };
})();
