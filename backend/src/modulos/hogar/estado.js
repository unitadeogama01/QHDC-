// ============================================================
//  Estado completo del hogar
//
//  La app pide todo de una vez (GET /api/estado) y con eso dibuja
//  cualquier pantalla. Los nombres de los campos son los mismos que
//  ya usaba el frontend (productos, sensores, lecturas...).
// ============================================================
const { consulta, iso } = require("../../nucleo/db");

const TIPO_SENSOR = { bascula: "peso", sensor_frescura: "gas", sensor_temperatura: "temperatura", camara: "camara", otro: "otro" };
const DIFICULTAD = { muy_facil: "Muy fácil", facil: "Fácil", media: "Media", dificil: "Difícil" };

/** Mantiene al día los avisos y la lista del súper del hogar. */
async function sincronizar(c, hogarId, usuarioId) {
  await c.query("CALL sp_generar_lista(?, ?, @lista)", [hogarId, usuarioId]); // primero: bloquea el hogar
  await c.query("CALL sp_generar_avisos(?)", [hogarId]);
  // Un aviso que se resolvió y volvió a aparecer en menos de 12 h (p. ej. la
  // temperatura sube y baja alrededor del límite) conserva el "visto" de
  // quien ya lo había visto, para que no reaparezca como nuevo a cada rato.
  await c.query(
    `INSERT IGNORE INTO notificaciones_lecturas (notificacion_id, usuario_id)
     SELECT n.id, nl.usuario_id
       FROM notificaciones n
       JOIN notificaciones v ON v.hogar_id = n.hogar_id AND v.clave = n.clave AND v.tipo = n.tipo
                            AND v.id < n.id AND v.resuelta_en > NOW() - INTERVAL 12 HOUR
       JOIN notificaciones_lecturas nl ON nl.notificacion_id = v.id
      WHERE n.hogar_id = ? AND n.activa AND n.creada_en > NOW() - INTERVAL 10 MINUTE`,
    [hogarId]
  );
  // Quita de la lista lo que ya no hace falta (y nadie ha marcado).
  // En dos pasos: primero se buscan los renglones con una lectura sin
  // bloqueos y luego se borran por id. Un DELETE con JOIN y subconsulta
  // bloqueaba filas de otras tablas y chocaba con otras familias (deadlock).
  const [sobran] = await c.query(
    `SELECT it.id FROM lista_compras_items it
       JOIN listas_compras l ON l.hogar_id = it.hogar_id AND l.id = it.lista_id AND l.estado = 'activa'
      WHERE it.hogar_id = ? AND it.alimento_id IS NOT NULL AND it.comprado = FALSE AND it.motivo <> 'manual'
        AND NOT EXISTS (SELECT 1 FROM vista_lista_sugerida s WHERE s.hogar_id = it.hogar_id AND s.alimento_id = it.alimento_id)`,
    [hogarId]
  );
  if (sobran.length) {
    await c.query(
      `DELETE FROM lista_compras_items
        WHERE hogar_id = ? AND id IN (?) AND comprado = FALSE AND motivo <> 'manual'`,
      [hogarId, sobran.map((f) => f.id)]
    );
  }
}

async function productos(hogarId) {
  const filas = await consulta(
    `SELECT i.alimento_id AS id, i.nombre, COALESCE(i.categoria, 'Otros') AS categoria, i.ubicacion,
            i.cantidad_total AS cantidad, i.cantidad_llena AS capacidad, i.unidad,
            COALESCE(i.proxima_caducidad,
                     (SELECT l.fecha_caducidad FROM lotes_alimento l
                       WHERE l.hogar_id = i.hogar_id AND l.alimento_id = i.alimento_id AND l.fecha_caducidad IS NOT NULL
                       ORDER BY l.id DESC LIMIT 1),
                     CURDATE() + INTERVAL COALESCE(a.vida_util_dias, 7) DAY) AS caducidad,
            COALESCE(i.precio_estimado, 0) AS precio, i.icono, i.color, a.vida_util_dias AS vida, i.origen,
            i.dias_aviso AS aviso, i.porcentaje_minimo AS minimo, p.promedio_diario,
            (SELECT da.dispositivo_id FROM dispositivo_alimentos da
              WHERE da.hogar_id = i.hogar_id AND da.alimento_id = i.alimento_id AND da.activo LIMIT 1) AS sensorId
       FROM vista_inventario i
       JOIN alimentos a ON a.hogar_id = i.hogar_id AND a.id = i.alimento_id
       LEFT JOIN vista_prediccion_consumo p ON p.hogar_id = i.hogar_id AND p.alimento_id = i.alimento_id
      WHERE i.hogar_id = ?
      ORDER BY i.alimento_id`,
    [hogarId]
  );

  // Consumo de los últimos 7 días (la gráfica termina en "Hoy")
  const consumos = await consulta(
    `SELECT alimento_id, DATEDIFF(CURDATE(), dia) AS hace, cantidad_consumida
       FROM vista_consumo_diario
      WHERE hogar_id = ? AND dia BETWEEN CURDATE() - INTERVAL 6 DAY AND CURDATE()`,
    [hogarId]
  );
  const historial = {};
  consumos.forEach((c) => {
    (historial[c.alimento_id] ||= Array(7).fill(0))[6 - c.hace] = +Number(c.cantidad_consumida).toFixed(2);
  });

  return filas.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    categoria: p.categoria,
    ubicacion: p.ubicacion,
    cantidad: Number(p.cantidad),
    capacidad: Number(p.capacidad),
    unidad: p.unidad,
    caducidad: p.caducidad,
    precio: Number(p.precio),
    icono: p.icono,
    color: p.color,
    // Sin historial todavía: se estima que un frasco dura un mes
    consumoDiario: p.promedio_diario > 0 ? +Number(p.promedio_diario).toFixed(3) : +(p.capacidad / 30).toFixed(2),
    vida: p.vida || 7,
    origen: p.origen,
    sensorId: p.sensorId,
    aviso: p.aviso,
    minimo: p.minimo,
    historial: historial[p.id] || Array(7).fill(0),
  }));
}

async function sensores(hogarId) {
  const filas = await consulta(
    `SELECT v.*, d.ultima_calibracion,
            v.ultimo_peso_en AS ultimo_peso, -- lo mantiene el trigger de lecturas (migración 002)
            u.activo AS limites_activos, u.temp_min_c, u.temp_max_c, u.humedad_min, u.humedad_max
       FROM vista_dispositivos v
       JOIN dispositivos_iot d ON d.id = v.dispositivo_id
       LEFT JOIN vista_umbrales_ambiente u ON u.hogar_id = v.hogar_id AND u.ubicacion_id = v.ubicacion_id
      WHERE v.hogar_id = ? ORDER BY v.dispositivo_id`,
    [hogarId]
  );
  const canales = await consulta(
    `SELECT dispositivo_id, alimento_id FROM dispositivo_alimentos da
       JOIN alimentos a ON a.hogar_id = da.hogar_id AND a.id = da.alimento_id AND a.activo
      WHERE da.hogar_id = ? AND da.activo ORDER BY canal`,
    [hogarId]
  );
  return filas.map((d) => {
    const s = {
      id: d.dispositivo_id,
      nombre: d.nombre,
      tipo: TIPO_SENSOR[d.tipo] || d.tipo,
      modelo: d.modelo || "",
      ubicacion: d.ubicacion || "Cocina",
      productos: canales.filter((x) => x.dispositivo_id === d.dispositivo_id).map((x) => x.alimento_id),
      enLinea: Boolean(d.en_linea),
      bateria: d.bateria_pct ?? null, // null = alimentado por USB (sin batería)
      senal: d.senal_dbm ?? -90,
      estado: d.estado,
      ultimaConexion: iso(d.ultima_conexion),
      ultimaCalibracion: iso(d.ultima_calibracion),
      ultimoPeso: iso(d.ultimo_peso), // null = la báscula (HX711) nunca ha mandado datos
      capacidad: d.capacidad_g !== null ? Number(d.capacidad_g) : null,
      // Rango configurado del lugar donde está (DHT22). null = sin límite
      limites: d.limites_activos ? {
        tempMin: d.temp_min_c !== null ? Number(d.temp_min_c) : null,
        tempMax: d.temp_max_c !== null ? Number(d.temp_max_c) : null,
        humMin: d.humedad_min !== null ? Number(d.humedad_min) : null,
        humMax: d.humedad_max !== null ? Number(d.humedad_max) : null,
      } : null,
    };
    if (d.ultimo_gas_ppm !== null) s.gas = Math.round(d.ultimo_gas_ppm);
    if (d.ultima_temperatura !== null) s.temperatura = +Number(d.ultima_temperatura).toFixed(1);
    if (d.ultima_humedad !== null) s.humedad = Math.round(d.ultima_humedad);
    return s;
  });
}

/** Lecturas recientes (actividad en vivo). desde = último id que ya tiene la app */
async function lecturas(hogarId, { desde = 0, limite = 60 } = {}) {
  const filas = await consulta(
    `SELECT * FROM (
        SELECT id, leido_en, dispositivo_id, alimento_id, tipo_lectura, valor, unidad
          FROM lecturas_sensor
         WHERE hogar_id = ? AND id > ? AND valido AND tipo_lectura IN ('peso', 'gas', 'temperatura', 'humedad')
         ORDER BY id DESC LIMIT ?) x
      ORDER BY id`,
    [hogarId, Number(desde) || 0, limite]
  );
  return filas.map((l) => ({
    id: l.id,
    fecha: iso(l.leido_en),
    sensorId: l.dispositivo_id,
    productoId: l.alimento_id,
    valor: +Number(l.valor).toFixed(1),
    unidad: l.unidad,
    tipo: l.tipo_lectura,
  }));
}

async function lista(hogarId) {
  const items = await consulta(
    `SELECT it.id, it.alimento_id, it.nombre_libre, it.cantidad_texto, it.precio_estimado, it.comprado
       FROM lista_compras_items it
       JOIN listas_compras l ON l.hogar_id = it.hogar_id AND l.id = it.lista_id AND l.estado = 'activa'
      WHERE it.hogar_id = ?
      ORDER BY it.id`,
    [hogarId]
  );
  return {
    listaExtra: items.filter((i) => i.alimento_id === null)
      .map((i) => ({ id: i.id, nombre: i.nombre_libre, cantidad: i.cantidad_texto || "1", precio: Number(i.precio_estimado) || 0 })),
    comprados: items.filter((i) => i.comprado).map((i) => (i.alimento_id === null ? `x-${i.id}` : `p-${i.alimento_id}`)),
  };
}

async function avisosLeidos(hogarId, usuarioId) {
  const filas = await consulta(
    "SELECT clave FROM vista_avisos_usuario WHERE hogar_id = ? AND usuario_id = ? AND leida",
    [hogarId, usuarioId]
  );
  return filas.map((f) => f.clave);
}

async function escaneos(hogarId) {
  const filas = await consulta(
    `SELECT e.id, e.creado_en, e.estado,
            IF(img.id IS NOT NULL AND img.eliminada_en IS NULL, img.id, NULL) AS imagen_id,
            -- Lo que la persona confirmó (o lo que propuso la IA si aún no se confirma)
            GROUP_CONCAT(COALESCE(ac.nombre, i.resultado_texto) ORDER BY i.id SEPARATOR '|') AS alimentos
       FROM escaneos e
       LEFT JOIN imagenes img ON img.hogar_id = e.hogar_id AND img.id = e.imagen_id
       LEFT JOIN identificaciones_ia i ON i.hogar_id = e.hogar_id AND i.escaneo_id = e.id AND i.estado <> 'rechazada'
       LEFT JOIN alimentos ac ON ac.hogar_id = i.hogar_id AND ac.id = i.alimento_confirmado_id
      WHERE e.hogar_id = ?
      GROUP BY e.id, e.creado_en, e.estado, img.id, img.eliminada_en ORDER BY e.creado_en DESC LIMIT 6`,
    [hogarId]
  );
  return filas.map((e) => ({
    id: e.id,
    fecha: iso(e.creado_en),
    estado: e.estado,
    imagen: e.imagen_id ? `/api/imagenes/${e.imagen_id}` : null, // foto privada (solo con sesión del hogar)
    alimentos: e.alimentos ? e.alimentos.split("|") : [],
  }));
}

async function recetas(hogarId) {
  const rs = await consulta(
    `SELECT id, nombre, icono, color, tiempo_minutos, porciones, dificultad FROM recetas
      WHERE activa AND hogar_id = ? ORDER BY id`, // solo las recetas de este hogar (no las generales)
    [hogarId]
  );
  if (!rs.length) return [];
  const ids = rs.map((r) => r.id);
  const ing = await consulta("SELECT receta_id, nombre, cantidad_texto FROM receta_ingredientes WHERE receta_id IN (?) ORDER BY receta_id, orden", [ids]);
  const pasos = await consulta("SELECT receta_id, texto FROM receta_pasos WHERE receta_id IN (?) ORDER BY receta_id, orden", [ids]);
  return rs.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    icono: r.icono,
    color: r.color,
    tiempo: r.tiempo_minutos,
    porciones: r.porciones,
    dificultad: DIFICULTAD[r.dificultad] || r.dificultad,
    ingredientes: ing.filter((i) => i.receta_id === r.id).map((i) => ({ nombre: i.nombre, cantidad: i.cantidad_texto })),
    pasos: pasos.filter((p) => p.receta_id === r.id).map((p) => p.texto),
  }));
}

async function catalogos(hogarId) {
  const [categorias, ubicaciones, unidades, catalogo] = await Promise.all([
    consulta("SELECT nombre FROM categorias_alimento WHERE hogar_id IS NULL OR hogar_id = ? ORDER BY hogar_id IS NOT NULL, id", [hogarId]),
    consulta("SELECT nombre FROM ubicaciones_almacenamiento WHERE hogar_id = ? ORDER BY orden, id", [hogarId]),
    consulta("SELECT codigo FROM unidades_medida ORDER BY id"),
    consulta(
      `SELECT c.nombre, cat.nombre AS categoria, c.icono, c.color, u.codigo AS unidad, c.cantidad_tipica AS cantidad,
              c.vida_util_dias AS vida, COALESCE(c.precio_estimado, 0) AS precio
         FROM catalogo_alimentos c
         JOIN categorias_alimento cat ON cat.id = c.categoria_id
         JOIN unidades_medida u ON u.id = c.unidad_id
        WHERE c.reconocible_camara ORDER BY c.id`
    ),
  ]);
  return {
    categorias: categorias.map((x) => x.nombre),
    ubicaciones: ubicaciones.map((x) => x.nombre),
    unidades: unidades.map((x) => x.codigo),
    catalogo: catalogo.map((x) => ({ ...x, cantidad: Number(x.cantidad), precio: Number(x.precio) })),
  };
}

async function preferencias(usuarioId) {
  const [p] = await consulta(
    `SELECT tema, sonidos, menu_compacto, vista_alacena, notificar_caducidad, notificar_existencias_bajas, notificar_dispositivos
       FROM preferencias_usuario WHERE usuario_id = ?`, [usuarioId]);
  const tours = await consulta("SELECT pantalla FROM recorridos_vistos WHERE usuario_id = ?", [usuarioId]);
  return {
    tema: p ? p.tema : "sistema",
    sonidos: p ? Boolean(p.sonidos) : true,
    menuCompacto: p ? Boolean(p.menu_compacto) : false,
    vistaAlacena: p ? p.vista_alacena : "frascos",
    // Qué avisos quiere ver esta persona (Ajustes → Avisos)
    avisos: {
      caducidad: p ? Boolean(p.notificar_caducidad) : true,
      existencias: p ? Boolean(p.notificar_existencias_bajas) : true,
      dispositivos: p ? Boolean(p.notificar_dispositivos) : true,
    },
    recorridos: tours.map((t) => t.pantalla),
  };
}

/** Todo lo que necesita la app para dibujar cualquier pantalla. */
async function estadoCompleto(usuario) {
  const h = usuario.hogarId;
  const [prods, sens, lects, lst, leidas, escs, recs, cats, prefs] = await Promise.all([
    productos(h), sensores(h), lecturas(h), lista(h), avisosLeidos(h, usuario.id), escaneos(h), recetas(h), catalogos(h), preferencias(usuario.id),
  ]);
  return {
    productos: prods,
    sensores: sens,
    lecturas: lects,
    listaExtra: lst.listaExtra,
    comprados: lst.comprados,
    alertasLeidas: leidas,
    escaneos: escs,
    recetas: recs,
    ...cats,
    preferencias: prefs,
  };
}

module.exports = { sincronizar, estadoCompleto, productos, sensores, lecturas, recetas, TIPO_SENSOR };
