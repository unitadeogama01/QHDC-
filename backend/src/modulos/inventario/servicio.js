// ============================================================
//  Reglas de la alacena (compartidas por varias rutas)
//
//  La cantidad de un alimento es la SUMA de sus lotes. Para cambiarla
//  nunca se escribe un número directo: se registra un consumo o una
//  entrada con los procedimientos de la base (sp_consumir_interno y
//  sp_reabastecer), así siempre queda historial en movimientos_inventario.
// ============================================================
const { ErrorApp, texto, numero, fecha, color, icono } = require("../../nucleo/errores");

const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

const TIPO_UBICACION = { refrigerador: "refrigerador", despensa: "despensa", congelador: "congelador" };

/** Convierte nombres (los que usa la app) en ids de la base. */
async function idsDeCatalogos(c, hogarId, { categoria, ubicacion, unidad }) {
  const [[uni]] = await c.query("SELECT id FROM unidades_medida WHERE codigo = ?", [unidad]);
  if (!uni) throw new ErrorApp(400, "La unidad no es válida.");
  // Propia del hogar o general (si existen las dos, gana la del hogar)
  const [[cat]] = await c.query(
    "SELECT id FROM categorias_alimento WHERE nombre = ? AND (hogar_id IS NULL OR hogar_id = ?) ORDER BY hogar_id IS NULL LIMIT 1",
    [categoria || "Otros", hogarId]
  );
  let ubicacionId = null;
  if (ubicacion) {
    const [[ubi]] = await c.query("SELECT id FROM ubicaciones_almacenamiento WHERE hogar_id = ? AND nombre = ?", [hogarId, ubicacion]);
    if (ubi) ubicacionId = ubi.id;
    else {
      // Si la repisa no existe (p. ej. la cámara sugiere "Despensa"), se crea
      const tipo = TIPO_UBICACION[String(ubicacion).toLowerCase()] || "otro";
      const [r] = await c.query(
        `INSERT INTO ubicaciones_almacenamiento (hogar_id, nombre, tipo, orden)
         SELECT ?, ?, ?, COALESCE(MAX(orden), 0) + 1 FROM ubicaciones_almacenamiento WHERE hogar_id = ?`,
        [hogarId, texto(ubicacion, "La ubicación", { max: 80 }), tipo, hogarId]
      );
      ubicacionId = r.insertId;
    }
  }
  return { unidadId: uni.id, categoriaId: cat ? cat.id : null, ubicacionId };
}

/** Limpia lo que manda el formulario de la app */
function limpiarFicha(info) {
  return {
    nombre: texto(info.nombre, "El nombre"),
    categoria: info.categoria ? String(info.categoria) : "Otros",
    ubicacion: info.ubicacion ? String(info.ubicacion) : null,
    unidad: String(info.unidad || ""),
    cantidad: numero(info.cantidad ?? 0, "La cantidad"),
    capacidad: numero(info.capacidad || info.cantidad, "La cantidad de lleno", { min: 0.001 }),
    caducidad: fecha(info.caducidad, "La fecha de caducidad", { opcional: true }),
    precio: numero(info.precio || 0, "El precio", { max: 1e6 }),
    icono: icono(info.icono),
    color: color(info.color),
    aviso: info.aviso ? numero(info.aviso, "Los días de aviso", { min: 0, max: 365 }) : null,
    // % de "Lleno es" debajo del cual va a la lista del súper (0 = solo si se acaba)
    minimo: info.minimo === undefined || info.minimo === null || info.minimo === "" ? 30 : Math.round(numero(info.minimo, "El mínimo", { min: 0, max: 100 })),
    vida: info.vida ? numero(info.vida, "La vida útil", { min: 1, max: 3650 }) : null,
    origen: ["manual", "sensor", "camara"].includes(info.origen) ? info.origen : "manual",
  };
}

/**
 * Crea un alimento nuevo (o revive uno que se había eliminado con el
 * mismo nombre) y registra su primera entrada. Devuelve el id.
 */
async function crearAlimento(c, { hogarId, usuarioId, info }) {
  const f = limpiarFicha(info);
  const ids = await idsDeCatalogos(c, hogarId, f);
  const [[cat]] = await c.query("SELECT id FROM catalogo_alimentos WHERE nombre = ?", [f.nombre]);
  const vida = f.vida || (f.caducidad ? null : 7);

  const [[existe]] = await c.query("SELECT id, activo FROM alimentos WHERE hogar_id = ? AND nombre = ? FOR UPDATE", [hogarId, f.nombre]);
  if (existe && existe.activo) throw new ErrorApp(409, `Ya tienes "${f.nombre}" en tu alacena.`);

  let alimentoId;
  const valores = [ids.categoriaId, ids.ubicacionId, ids.unidadId, cat ? cat.id : null, f.icono, f.color, f.capacidad, f.precio, f.aviso, f.minimo];
  if (existe) {
    // Se había eliminado: se reutiliza la ficha y se descartan los lotes viejos
    alimentoId = existe.id;
    await c.query(
      `UPDATE alimentos SET categoria_id = ?, ubicacion_id = ?, unidad_id = ?, catalogo_id = ?, icono = ?, color = ?,
              cantidad_llena = ?, precio_estimado = ?, dias_aviso_caducidad = ?, porcentaje_minimo = ?, activo = TRUE, origen = ?,
              vida_util_dias = COALESCE(?, GREATEST(1, DATEDIFF(?, CURDATE())), vida_util_dias)
        WHERE id = ?`,
      [...valores, f.origen, vida, f.caducidad, alimentoId]
    );
    await c.query("UPDATE lotes_alimento SET estado = 'descartado' WHERE hogar_id = ? AND alimento_id = ? AND estado = 'disponible'", [hogarId, alimentoId]);
  } else {
    const [r] = await c.query(
      `INSERT INTO alimentos (hogar_id, categoria_id, ubicacion_id, unidad_id, catalogo_id, icono, color, cantidad_llena,
                              precio_estimado, dias_aviso_caducidad, porcentaje_minimo, nombre, origen, creado_por, vida_util_dias)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, GREATEST(1, DATEDIFF(?, CURDATE()))))`,
      [hogarId, ...valores, f.nombre, f.origen, usuarioId, vida, f.caducidad]
    );
    alimentoId = r.insertId;
  }

  if (f.cantidad > 0) {
    await fijarExistencia(c, { hogarId, alimentoId, usuarioId, cantidad: f.cantidad, caducidad: f.caducidad, origen: f.origen === "camara" ? "camara" : "manual" });
  }
  return alimentoId;
}

/** Edita la ficha (formulario "Editar") y ajusta cantidad y caducidad. */
async function editarAlimento(c, { hogarId, alimentoId, usuarioId, info }) {
  const f = limpiarFicha(info);
  const ids = await idsDeCatalogos(c, hogarId, f);
  const [r] = await c.query(
    `UPDATE alimentos SET nombre = ?, categoria_id = ?, ubicacion_id = ?, unidad_id = ?, icono = ?, color = ?,
            cantidad_llena = ?, precio_estimado = ?, dias_aviso_caducidad = ?, porcentaje_minimo = ?
      WHERE hogar_id = ? AND id = ? AND activo`,
    [f.nombre, ids.categoriaId, ids.ubicacionId, ids.unidadId, f.icono, f.color, f.capacidad, f.precio, f.aviso, f.minimo, hogarId, alimentoId]
  );
  if (!r.affectedRows) throw new ErrorApp(404, "Ese alimento ya no existe.");
  await fijarExistencia(c, { hogarId, alimentoId, usuarioId, cantidad: f.cantidad, caducidad: f.caducidad });
}

async function totalActual(c, hogarId, alimentoId) {
  const [[t]] = await c.query(
    "SELECT COALESCE(SUM(cantidad_actual), 0) AS total FROM lotes_alimento WHERE hogar_id = ? AND alimento_id = ? AND estado = 'disponible'",
    [hogarId, alimentoId]
  );
  return Number(t.total);
}

async function ultimaEntrada(c, hogarId, alimentoId) {
  const [[m]] = await c.query(
    "SELECT MAX(id) AS id FROM movimientos_inventario WHERE hogar_id = ? AND alimento_id = ? AND tipo = 'entrada'",
    [hogarId, alimentoId]
  );
  return m.id || null;
}

/**
 * Deja un alimento con la cantidad indicada:
 *   - si hay menos que antes → consumo (de los lotes que caducan primero)
 *   - si hay más → entrada (lote nuevo)
 * Opcional: nueva caducidad para los lotes disponibles y nuevo "Lleno es".
 */
async function fijarExistencia(c, { hogarId, alimentoId, usuarioId = null, cantidad, caducidad = null, capacidad = null, origen = "manual", recetaPreparadaId = null }) {
  const [[a]] = await c.query(
    "SELECT cantidad_llena, CURDATE() AS hoy FROM alimentos WHERE hogar_id = ? AND id = ? AND activo FOR UPDATE",
    [hogarId, alimentoId]
  );
  if (!a) throw new ErrorApp(404, "Ese alimento ya no existe.");

  const total = await totalActual(c, hogarId, alimentoId);
  const delta = r3(Number(cantidad) - total);

  if (delta < 0) {
    const origenConsumo = ["receta", "sensor", "camara"].includes(origen) ? origen : "manual";
    await c.query("CALL sp_consumir_interno(?, ?, ?, ?, ?, NULL, ?, @descontado)",
      [hogarId, alimentoId, -delta, usuarioId, origenConsumo, recetaPreparadaId]);
  } else if (delta > 0) {
    const origenEntrada = ["compra", "camara", "sensor"].includes(origen) ? origen : "manual";
    // Un lote no puede caducar antes de entrar: si la fecha ya pasó, se ajusta abajo
    const cadLote = caducidad && caducidad >= a.hoy ? caducidad : null;
    await c.query("CALL sp_reabastecer(?, ?, ?, ?, ?, ?, NULL, @lote)",
      [hogarId, alimentoId, delta, cadLote, origenEntrada, usuarioId]);
  }

  if (caducidad) {
    // La app maneja una sola fecha por alimento: se aplica a los lotes disponibles
    await c.query(
      `UPDATE lotes_alimento
          SET fecha_ingreso = LEAST(fecha_ingreso, ?), fecha_caducidad = ?
        WHERE hogar_id = ? AND alimento_id = ? AND estado = 'disponible' AND cantidad_actual > 0
          AND NOT (fecha_caducidad <=> ?)`,
      [caducidad, caducidad, hogarId, alimentoId, caducidad]
    );
  }

  if (capacidad && r3(capacidad) !== Number(a.cantidad_llena)) {
    await c.query("UPDATE alimentos SET cantidad_llena = ? WHERE hogar_id = ? AND id = ?", [r3(capacidad), hogarId, alimentoId]);
  }
}

/**
 * Rellenar / comprar: lo caducado se desecha y el frasco queda lleno.
 * Si la caducidad está a menos de 2 días, se calcula una nueva con la vida útil.
 */
async function rellenar(c, { hogarId, alimentoId, usuarioId = null, origen = "compra" }) {
  const [vencidos] = await c.query(
    `SELECT id, cantidad_actual FROM lotes_alimento
      WHERE hogar_id = ? AND alimento_id = ? AND estado = 'disponible' AND cantidad_actual > 0 AND fecha_caducidad < CURDATE()
      FOR UPDATE`,
    [hogarId, alimentoId]
  );
  for (const l of vencidos) {
    await c.query("UPDATE lotes_alimento SET cantidad_actual = 0, estado = 'descartado' WHERE id = ?", [l.id]);
    await c.query(
      `INSERT INTO movimientos_inventario (hogar_id, alimento_id, lote_id, tipo, cantidad_delta, origen, usuario_id, notas)
       VALUES (?, ?, ?, 'desecho', ?, 'manual', ?, 'Caducado al rellenar')`,
      [hogarId, alimentoId, l.id, -l.cantidad_actual, usuarioId]
    );
  }

  const [[a]] = await c.query(
    `SELECT a.cantidad_llena,
            CASE WHEN l.proxima IS NULL OR DATEDIFF(l.proxima, CURDATE()) < 2
                 THEN CURDATE() + INTERVAL COALESCE(a.vida_util_dias, 7) DAY
                 ELSE l.proxima END AS caducidad
       FROM alimentos a
       LEFT JOIN (SELECT MIN(fecha_caducidad) AS proxima FROM lotes_alimento
                   WHERE hogar_id = ? AND alimento_id = ? AND estado = 'disponible' AND cantidad_actual > 0) l ON TRUE
      WHERE a.hogar_id = ? AND a.id = ? AND a.activo`,
    [hogarId, alimentoId, hogarId, alimentoId]
  );
  if (!a) throw new ErrorApp(404, "Ese alimento ya no existe.");

  await fijarExistencia(c, { hogarId, alimentoId, usuarioId, cantidad: a.cantidad_llena, caducidad: a.caducidad, origen });
  return ultimaEntrada(c, hogarId, alimentoId);
}

module.exports = { crearAlimento, editarAlimento, fijarExistencia, rellenar, totalActual, ultimaEntrada, idsDeCatalogos, r3 };
