// ============================================================
//  QHDC! — DATOS Y LÓGICA (simulación del backend)
//
//  Mientras no conectemos el servidor, todo se guarda en el
//  navegador con localStorage. Así, si agregas un alimento en
//  "Inventario", también aparece en "Panel", "Alertas", etc.
//
//  Cuando exista el backend, solo hay que cambiar las funciones
//  de este archivo por llamadas fetch() a la API.
// ============================================================

const QHDC = (() => {
  const CLAVE_DATOS = "qhdc_datos_v1";
  const CLAVE_SESION = "qhdc_sesion";

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

  // Número pseudoaleatorio repetible (para que los datos de ejemplo siempre sean iguales)
  let semillaAzar = 7;
  function azar() {
    semillaAzar = (semillaAzar * 9301 + 49297) % 233280;
    return semillaAzar / 233280;
  }
  function historialConsumo(diario) {
    return Array.from({ length: 7 }, () => +(diario * (0.55 + azar() * 0.9)).toFixed(2));
  }

  // ---------------- CATÁLOGOS ----------------
  const CATEGORIAS = ["Granos y cereales", "Lácteos", "Carnes y pescados", "Verduras", "Frutas", "Bebidas", "Otros"];
  const UBICACIONES = ["Refrigerador", "Despensa", "Congelador"];
  const UNIDADES = ["g", "kg", "L", "ml", "pz", "manojo"];

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

  // Recetas de ejemplo (en el futuro las generará la IA)
  const RECETAS = [
    {
      id: 1, nombre: "Arroz con pollo y espinaca", icono: "fa-bowl-food", color: "tomate",
      tiempo: 40, porciones: 4, dificultad: "Fácil",
      ingredientes: [
        { nombre: "Arroz", cantidad: "1 ½ tazas" }, { nombre: "Pollo", cantidad: "500 g" },
        { nombre: "Espinaca", cantidad: "1 manojo" }, { nombre: "Jitomate", cantidad: "2 piezas" },
      ],
      pasos: [
        "Corta el pollo en cubos y dóralo con un poco de aceite.",
        "Licúa el jitomate con ajo y cebolla, y agrégalo al pollo.",
        "Añade el arroz lavado y 3 tazas de agua. Cocina tapado 20 minutos.",
        "Al final incorpora la espinaca picada y deja reposar 5 minutos.",
      ],
    },
    {
      id: 2, nombre: "Tinga de pollo", icono: "fa-fire-burner", color: "mostaza",
      tiempo: 35, porciones: 4, dificultad: "Fácil",
      ingredientes: [
        { nombre: "Pollo", cantidad: "500 g" }, { nombre: "Jitomate", cantidad: "3 piezas" },
        { nombre: "Chile", cantidad: "2 piezas" }, { nombre: "Tortilla", cantidad: "12 piezas" },
      ],
      pasos: [
        "Cuece el pollo y deshébralo.",
        "Sofríe cebolla en rodajas y agrega el jitomate licuado con el chile.",
        "Incorpora el pollo y cocina 10 minutos.",
        "Sirve sobre tostadas o tortillas calientes.",
      ],
    },
    {
      id: 3, nombre: "Omelette de espinaca y queso", icono: "fa-egg", color: "oliva",
      tiempo: 10, porciones: 1, dificultad: "Muy fácil",
      ingredientes: [
        { nombre: "Huevo", cantidad: "2 piezas" }, { nombre: "Espinaca", cantidad: "1 puño" },
        { nombre: "Queso", cantidad: "50 g" },
      ],
      pasos: [
        "Bate los huevos con una pizca de sal.",
        "Vierte en un sartén caliente y agrega espinaca y queso.",
        "Dobla a la mitad y cocina 1 minuto más.",
      ],
    },
    {
      id: 4, nombre: "Chilaquiles verdes con huevo", icono: "fa-utensils", color: "oliva",
      tiempo: 25, porciones: 2, dificultad: "Fácil",
      ingredientes: [
        { nombre: "Tortilla", cantidad: "8 piezas" }, { nombre: "Huevo", cantidad: "2 piezas" },
        { nombre: "Chile", cantidad: "3 piezas" }, { nombre: "Queso", cantidad: "80 g" },
      ],
      pasos: [
        "Corta las tortillas en triángulos y dóralas.",
        "Prepara una salsa verde con los chiles y báñalas.",
        "Sirve con huevo estrellado y queso encima.",
      ],
    },
    {
      id: 5, nombre: "Pasta al pomodoro", icono: "fa-wheat-awn", color: "tomate",
      tiempo: 20, porciones: 3, dificultad: "Fácil",
      ingredientes: [
        { nombre: "Pasta", cantidad: "250 g" }, { nombre: "Jitomate", cantidad: "4 piezas" },
        { nombre: "Queso", cantidad: "60 g" },
      ],
      pasos: [
        "Cuece la pasta en agua con sal.",
        "Cocina el jitomate picado con ajo y aceite hasta que espese.",
        "Mezcla con la pasta y termina con queso rallado.",
      ],
    },
    {
      id: 6, nombre: "Frijoles de la olla con pico de gallo", icono: "fa-jar", color: "cafe",
      tiempo: 90, porciones: 6, dificultad: "Media",
      ingredientes: [
        { nombre: "Frijol", cantidad: "500 g" }, { nombre: "Jitomate", cantidad: "2 piezas" },
        { nombre: "Chile", cantidad: "1 pieza" }, { nombre: "Limón", cantidad: "1 pieza" },
      ],
      pasos: [
        "Remoja los frijoles desde la noche anterior.",
        "Cuécelos con cebolla y sal hasta que estén suaves.",
        "Pica jitomate, chile y cebolla; agrega limón para el pico de gallo.",
      ],
    },
    {
      id: 7, nombre: "Pescado al limón con arroz", icono: "fa-fish", color: "mostaza",
      tiempo: 30, porciones: 2, dificultad: "Media",
      ingredientes: [
        { nombre: "Pescado", cantidad: "2 filetes" }, { nombre: "Limón", cantidad: "2 piezas" },
        { nombre: "Arroz", cantidad: "1 taza" }, { nombre: "Zanahoria", cantidad: "1 pieza" },
      ],
      pasos: [
        "Marina el pescado con limón, sal y pimienta 10 minutos.",
        "Prepara el arroz con la zanahoria en cubitos.",
        "Cocina el pescado a la plancha 4 minutos por lado.",
      ],
    },
    {
      id: 8, nombre: "Arroz con leche", icono: "fa-mug-hot", color: "cafe",
      tiempo: 45, porciones: 6, dificultad: "Fácil",
      ingredientes: [
        { nombre: "Arroz", cantidad: "1 taza" }, { nombre: "Leche", cantidad: "1 L" },
      ],
      pasos: [
        "Cuece el arroz en agua con canela hasta que abra.",
        "Agrega la leche y azúcar al gusto.",
        "Cocina a fuego bajo moviendo hasta que espese.",
      ],
    },
  ];

  // Alimentos que la "IA de la cámara" puede reconocer (HU-10)
  const CATALOGO_CAMARA = [
    { nombre: "Manzana", categoria: "Frutas", icono: "fa-apple-whole", color: "tomate", unidad: "pz", cantidad: 6, vida: 14, precio: 30 },
    { nombre: "Plátano", categoria: "Frutas", icono: "fa-lemon", color: "mostaza", unidad: "pz", cantidad: 6, vida: 5, precio: 20 },
    { nombre: "Jitomate", categoria: "Verduras", icono: "fa-apple-whole", color: "tomate", unidad: "pz", cantidad: 5, vida: 6, precio: 25 },
    { nombre: "Leche", categoria: "Lácteos", icono: "fa-glass-water", color: "cafe", unidad: "L", cantidad: 1, vida: 7, precio: 28 },
    { nombre: "Huevo", categoria: "Lácteos", icono: "fa-egg", color: "mostaza", unidad: "pz", cantidad: 12, vida: 20, precio: 45 },
    { nombre: "Queso Oaxaca", categoria: "Lácteos", icono: "fa-cheese", color: "mostaza", unidad: "g", cantidad: 400, vida: 12, precio: 70 },
    { nombre: "Zanahoria", categoria: "Verduras", icono: "fa-carrot", color: "tomate", unidad: "pz", cantidad: 6, vida: 14, precio: 12 },
    { nombre: "Brócoli", categoria: "Verduras", icono: "fa-leaf", color: "oliva", unidad: "pz", cantidad: 1, vida: 5, precio: 22 },
    { nombre: "Limón", categoria: "Frutas", icono: "fa-lemon", color: "oliva", unidad: "pz", cantidad: 10, vida: 14, precio: 20 },
    { nombre: "Yogur natural", categoria: "Lácteos", icono: "fa-bottle-water", color: "cafe", unidad: "L", cantidad: 1, vida: 10, precio: 35 },
  ];

  // ---------------- DATOS INICIALES ----------------
  function semilla() {
    semillaAzar = 7;
    const P = (id, nombre, categoria, ubicacion, cantidad, capacidad, unidad, cad, precio, icono, color, consumoDiario, vida, extra = {}) => ({
      id, nombre, categoria, ubicacion, cantidad, capacidad, unidad,
      caducidad: enDias(cad), precio, icono, color, consumoDiario, vida,
      origen: "manual", sensorId: null, aviso: 3, historial: historialConsumo(consumoDiario), ...extra,
    });

    const productos = [
      P(1, "Arroz", "Granos y cereales", "Despensa", 200, 1000, "g", 180, 32, "fa-bowl-rice", "cafe", 45, 365, { origen: "sensor", sensorId: 1 }),
      P(2, "Frijol negro", "Granos y cereales", "Despensa", 650, 1000, "g", 240, 38, "fa-jar", "cafe", 40, 365, { origen: "sensor", sensorId: 1 }),
      P(3, "Pasta", "Granos y cereales", "Despensa", 300, 500, "g", 200, 18, "fa-wheat-awn", "mostaza", 35, 365, { origen: "sensor", sensorId: 2 }),
      P(4, "Café molido", "Bebidas", "Despensa", 280, 400, "g", 90, 95, "fa-mug-hot", "cafe", 14, 180, { origen: "sensor", sensorId: 2 }),
      P(5, "Leche", "Lácteos", "Refrigerador", 0.4, 2, "L", 3, 28, "fa-glass-water", "cafe", 0.35, 7),
      P(6, "Huevo", "Lácteos", "Refrigerador", 4, 30, "pz", 12, 75, "fa-egg", "mostaza", 2, 21),
      P(7, "Pechuga de pollo", "Carnes y pescados", "Refrigerador", 800, 1000, "g", 1, 95, "fa-drumstick-bite", "tomate", 150, 3),
      P(8, "Espinaca", "Verduras", "Refrigerador", 1, 1, "manojo", 2, 15, "fa-leaf", "oliva", 0.3, 5, { origen: "camara" }),
      P(9, "Jitomate", "Verduras", "Refrigerador", 5, 8, "pz", 5, 25, "fa-apple-whole", "tomate", 1, 7, { origen: "camara" }),
      P(10, "Queso Oaxaca", "Lácteos", "Refrigerador", 250, 400, "g", 8, 70, "fa-cheese", "mostaza", 30, 12),
      P(11, "Zanahoria", "Verduras", "Refrigerador", 6, 8, "pz", 10, 12, "fa-carrot", "tomate", 0.6, 14),
      P(12, "Tortilla de maíz", "Granos y cereales", "Refrigerador", 0.3, 1, "kg", 4, 22, "fa-bread-slice", "mostaza", 0.2, 5),
      P(13, "Yogur natural", "Lácteos", "Refrigerador", 0.5, 1, "L", -1, 35, "fa-bottle-water", "cafe", 0.15, 10),
      P(14, "Limón", "Frutas", "Refrigerador", 8, 12, "pz", 7, 20, "fa-lemon", "oliva", 1, 14),
      P(15, "Filete de pescado", "Carnes y pescados", "Congelador", 500, 1000, "g", 30, 110, "fa-fish", "mostaza", 40, 60),
      P(16, "Chile serrano", "Verduras", "Refrigerador", 10, 20, "pz", 6, 10, "fa-pepper-hot", "oliva", 1, 10),
    ];

    const sensores = [
      { id: 1, nombre: "Báscula de despensa A", tipo: "peso", modelo: "ESP32 + HX711", ubicacion: "Despensa", productos: [1, 2], enLinea: true, bateria: 86, senal: -58 },
      { id: 2, nombre: "Báscula de despensa B", tipo: "peso", modelo: "ESP32 + HX711", ubicacion: "Despensa", productos: [3, 4], enLinea: true, bateria: 72, senal: -63 },
      { id: 3, nombre: "Sensor de frescura", tipo: "gas", modelo: "ESP32 + MQ-135 + DHT22", ubicacion: "Refrigerador", productos: [], enLinea: true, bateria: 64, senal: -70, gas: 190, temperatura: 4.2, humedad: 61 },
      { id: 4, nombre: "Termómetro de congelador", tipo: "temperatura", modelo: "ESP32 + DS18B20", ubicacion: "Congelador", productos: [], enLinea: false, bateria: 12, senal: -88, temperatura: -17.5 },
    ];

    // Lecturas de la última hora
    const lecturas = [];
    const ahora = Date.now();
    for (let i = 12; i >= 1; i--) {
      [1, 2, 3, 4].forEach((pid) => {
        const p = productos.find((x) => x.id === pid);
        lecturas.push({
          fecha: new Date(ahora - i * 5 * 60000).toISOString(),
          sensorId: p.sensorId, productoId: pid,
          valor: Math.round(p.cantidad + i * p.consumoDiario * 0.05), unidad: p.unidad,
        });
      });
    }

    return {
      productos, sensores, lecturas,
      hogar: "Casa Contreras",
      usuarios: [
        { nombre: "Tadeo Contreras", email: "admin@qhdc.mx", password: "admin123", rol: "Administrador", hogar: "Casa Contreras" },
        { nombre: "Marilú Ramírez", email: "miembro@qhdc.mx", password: "miembro123", rol: "Miembro", hogar: "Casa Contreras" },
      ],
      listaExtra: [{ id: 1, nombre: "Aceite de oliva", cantidad: "1 botella", precio: 120 }],
      comprados: [],
      alertasLeidas: [],
      escaneos: [],
      siguienteId: 100,
    };
  }

  // ---------------- GUARDAR / CARGAR ----------------
  let datos;
  function cargar() {
    try {
      datos = JSON.parse(localStorage.getItem(CLAVE_DATOS));
    } catch (e) {
      datos = null;
    }
    if (!datos || !Array.isArray(datos.productos)) {
      datos = semilla();
      guardar();
    }
  }
  function guardar() {
    try {
      localStorage.setItem(CLAVE_DATOS, JSON.stringify(datos));
    } catch (e) {
      console.warn("No se pudo guardar en localStorage", e);
    }
  }
  function nuevoId() {
    datos.siguienteId += 1;
    guardar();
    return datos.siguienteId;
  }
  cargar();

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
  const producto = (id) => productos().find((p) => p.id === Number(id));

  function guardarProducto(info) {
    const limpio = {
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
    if (info.id) {
      const p = datos.productos.find((x) => x.id === Number(info.id));
      Object.assign(p, limpio);
      guardar();
      return p;
    }
    const consumo = +(limpio.capacidad / 30).toFixed(2);
    const nuevo = {
      id: nuevoId(), ...limpio, origen: info.origen || "manual", sensorId: null,
      consumoDiario: consumo, vida: Math.max(1, diasHasta(limpio.caducidad)), historial: historialConsumo(consumo),
    };
    datos.productos.push(nuevo);
    guardar();
    return nuevo;
  }

  // Devuelve el producto borrado para poder "deshacer"
  function eliminarProducto(id) {
    const borrado = datos.productos.find((p) => p.id === Number(id));
    datos.productos = datos.productos.filter((p) => p.id !== Number(id));
    datos.comprados = datos.comprados.filter((k) => k !== `p-${id}`);
    guardar();
    return borrado;
  }
  function restaurarProducto(producto) {
    if (!producto || datos.productos.some((p) => p.id === producto.id)) return;
    datos.productos.push(producto);
    guardar();
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
    const p = datos.productos.find((x) => x.id === Number(id));
    p.cantidad = Math.max(0, +(p.cantidad + delta).toFixed(2));
    if (p.cantidad > p.capacidad) p.capacidad = p.cantidad;
    guardar();
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

  function consumir(id, cantidad) {
    const p = datos.productos.find((x) => x.id === Number(id));
    p.cantidad = Math.max(0, +(p.cantidad - Number(cantidad)).toFixed(2));
    guardar();
    return p;
  }

  function rellenar(id) {
    const p = datos.productos.find((x) => x.id === Number(id));
    p.cantidad = p.capacidad;
    if (diasHasta(p.caducidad) < 2) p.caducidad = enDias(p.vida || 7);
    guardar();
    return p;
  }

  // ---------------- SENSORES IoT (HU-03) ----------------
  const sensores = () => datos.sensores.map((s) => ({ ...s }));
  const lecturas = (limite = 20) => datos.lecturas.slice(-limite).reverse();

  // Un "ciclo" del simulador: hace lo mismo que harían los ESP32 reales
  function simularCiclo() {
    const nuevas = [];
    datos.sensores.forEach((s) => {
      if (!s.enLinea) return;
      if (s.tipo === "peso") {
        s.productos.forEach((pid) => {
          const p = datos.productos.find((x) => x.id === pid);
          if (!p) return;
          if (Math.random() < 0.35) p.cantidad -= p.consumoDiario * (0.1 + Math.random() * 0.4);
          p.cantidad = Math.max(0, Math.round(p.cantidad + (Math.random() * 4 - 2)));
          if (p.cantidad < p.capacidad * 0.05) p.cantidad = p.capacidad; // alguien compró y rellenó
          const lectura = { fecha: new Date().toISOString(), sensorId: s.id, productoId: pid, valor: p.cantidad, unidad: p.unidad };
          datos.lecturas.push(lectura);
          nuevas.push(lectura);
        });
      }
      if (s.tipo === "gas") {
        // De vez en cuando algo empieza a echarse a perder
        if (Math.random() < 0.06) s.gas += 220;
        s.gas = Math.round(Math.max(150, s.gas + (Math.random() * 30 - 18)));
        s.temperatura = +(4 + Math.random() * 0.8 - 0.4).toFixed(1);
        s.humedad = Math.round(58 + Math.random() * 8);
        const lectura = { fecha: new Date().toISOString(), sensorId: s.id, productoId: null, valor: s.gas, unidad: "ppm" };
        datos.lecturas.push(lectura);
        nuevas.push(lectura);
      }
      s.bateria = Math.max(5, s.bateria - (Math.random() < 0.05 ? 1 : 0));
    });
    datos.lecturas = datos.lecturas.slice(-300);
    guardar();
    return nuevas;
  }

  function alternarSensor(id) {
    const s = datos.sensores.find((x) => x.id === Number(id));
    s.enLinea = !s.enLinea;
    guardar();
    return s;
  }

  // ---------------- ALERTAS (HU-04) ----------------
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
        lista.push({ id: `sensor-${s.id}`, tipo: "sensor", nivel: "info", icono: "fa-plug-circle-xmark", sensorId: s.id,
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
    guardar();
  }

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
    guardar();
  }
  function agregarExtra(nombre, cantidad, precio) {
    datos.listaExtra.push({ id: nuevoId(), nombre: String(nombre).trim(), cantidad: cantidad || "1", precio: Number(precio) || 0 });
    guardar();
  }
  function eliminarExtra(clave) {
    const id = Number(clave.replace("x-", ""));
    datos.listaExtra = datos.listaExtra.filter((x) => x.id !== id);
    datos.comprados = datos.comprados.filter((k) => k !== clave);
    guardar();
  }
  // Al terminar de comprar: se rellenan los productos marcados
  function finalizarCompra() {
    let total = 0;
    datos.comprados.forEach((clave) => {
      if (clave.startsWith("p-")) {
        const p = datos.productos.find((x) => x.id === Number(clave.slice(2)));
        if (p) { total++; p.cantidad = p.capacidad; if (diasHasta(p.caducidad) < 2) p.caducidad = enDias(p.vida || 7); }
      } else {
        total++;
        datos.listaExtra = datos.listaExtra.filter((x) => `x-${x.id}` !== clave);
      }
    });
    datos.comprados = [];
    guardar();
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

  // ---------------- CÁMARA (HU-10) ----------------
  // Simula lo que devolvería un modelo de visión
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

  function agregarDesdeCamara(alimentos) {
    alimentos.forEach((a) => {
      const existente = datos.productos.find((p) => normalizar(p.nombre) === normalizar(a.nombre));
      if (existente) {
        existente.cantidad = +(existente.cantidad + Number(a.cantidad)).toFixed(2);
        existente.capacidad = Math.max(existente.capacidad, existente.cantidad);
        existente.caducidad = a.caducidad;
      } else {
        guardarProducto({
          nombre: a.nombre, categoria: a.categoria, ubicacion: a.categoria === "Granos y cereales" ? "Despensa" : "Refrigerador",
          cantidad: a.cantidad, capacidad: a.cantidad, unidad: a.unidad, caducidad: a.caducidad,
          precio: a.precio, icono: a.icono, color: a.color, origen: "camara",
        });
      }
    });
    datos.escaneos.unshift({ fecha: new Date().toISOString(), alimentos: alimentos.map((a) => a.nombre) });
    datos.escaneos = datos.escaneos.slice(0, 5);
    guardar();
  }
  const escaneos = () => datos.escaneos;

  // ---------------- SESIÓN (HU-09) ----------------
  function iniciarSesion(email, password) {
    const u = datos.usuarios.find((x) => x.email === String(email).trim().toLowerCase());
    if (!u || u.password !== password) return null;
    const sesion = { nombre: u.nombre, email: u.email, rol: u.rol, hogar: u.hogar };
    localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    return sesion;
  }
  function registrar({ nombre, email, password, hogar }) {
    const correo = String(email).trim().toLowerCase();
    if (datos.usuarios.some((u) => u.email === correo)) return { error: "Ese correo ya tiene una cuenta" };
    datos.usuarios.push({ nombre: nombre.trim(), email: correo, password, rol: "Administrador", hogar: hogar.trim() || "Mi casa" });
    guardar();
    return { sesion: iniciarSesion(correo, password) };
  }
  // Perfiles guardados en este dispositivo (para entrar con un toque)
  const perfiles = () => datos.usuarios.map(({ nombre, email, rol }) => ({ nombre, email, rol }));
  function entrarComoPerfil(email) {
    const u = datos.usuarios.find((x) => x.email === email);
    return u ? iniciarSesion(u.email, u.password) : null;
  }

  function sesionActual() {
    try { return JSON.parse(localStorage.getItem(CLAVE_SESION)); } catch (e) { return null; }
  }
  function cerrarSesion() { localStorage.removeItem(CLAVE_SESION); }

  // Borra todo y vuelve a los datos de ejemplo (útil antes de presentar)
  function reiniciar() {
    datos = semilla();
    guardar();
  }

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
    consumirPrimero, predicciones, resumenIA,
    // compras
    listaCompras, marcarComprado, agregarExtra, eliminarExtra, finalizarCompra,
    // recetas y cámara
    recetasSugeridas, detectarAlimentos, agregarDesdeCamara, escaneos,
    // sesión
    iniciarSesion, registrar, sesionActual, cerrarSesion, reiniciar, perfiles, entrarComoPerfil,
  };
})();
