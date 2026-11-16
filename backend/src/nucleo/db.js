// ============================================================
//  Conexión a MySQL (pool de conexiones con mysql2)
// ============================================================
const mysql = require("mysql2/promise");
const { config } = require("./config");

const ZONA = config.zonaHoraria;

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.puerto,
  user: config.db.usuario,
  password: config.db.contrasena,
  database: config.db.nombre,
  // Misma intercalación que la base (qhdc_base_de_datos.sql): evita el error
  // "Illegal mix of collations" al comparar textos de la app con vistas.
  charset: "UTF8MB4_0900_AI_CI",
  connectionLimit: config.db.conexiones, // DB_CONEXIONES en .env (10 por defecto)
  decimalNumbers: true, // DECIMAL llega como número, no como texto
  dateStrings: true,    // DATE llega como "2026-10-11" (sin líos de zona horaria)
});

// Todas las conexiones usan la misma zona horaria, así CURDATE() y NOW()
// coinciden con el reloj de la familia.
pool.pool.on("connection", (conexion) => {
  conexion.query("SET time_zone = ?", [ZONA]);
});

/** Consulta simple: devuelve las filas. */
async function consulta(sql, params = []) {
  const [filas] = await pool.query(sql, params);
  return filas;
}

/** Primera fila o null. */
async function una(sql, params = []) {
  const filas = await consulta(sql, params);
  return filas[0] || null;
}

/**
 * Ejecuta varias operaciones en una transacción.
 * Si algo falla, se deshace todo (ROLLBACK).
 * opciones.aislamiento = "READ COMMITTED" para tareas que solo recalculan
 * datos del hogar (sin bloqueos de huecos que choquen con otros hogares).
 */
const INTENTOS = 5;
const AISLAMIENTOS = new Set(["READ COMMITTED", "REPEATABLE READ"]);
async function transaccion(trabajo, opciones = {}, intento = 1) {
  const conexion = await pool.getConnection();
  try {
    if (opciones.aislamiento) {
      if (!AISLAMIENTOS.has(opciones.aislamiento)) throw new Error(`Aislamiento no permitido: ${opciones.aislamiento}`);
      // Solo vale para la siguiente transacción de esta conexión
      await conexion.query(`SET TRANSACTION ISOLATION LEVEL ${opciones.aislamiento}`);
    }
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (e) {
    await conexion.rollback().catch(() => {});
    // Si dos peticiones chocaron (deadlock), MySQL cancela una: se reintenta
    if ((e.code === "ER_LOCK_DEADLOCK" || e.code === "ER_LOCK_WAIT_TIMEOUT") && intento < INTENTOS) { /* sigue abajo */ }
    else throw e;
  } finally {
    conexion.release();
  }
  // Espera corta y al azar (crece con cada intento) para que no vuelvan a chocar a la vez
  await new Promise((r) => setTimeout(r, Math.random() * 25 * 2 ** intento));
  return transaccion(trabajo, opciones, intento + 1); // solo llega aquí si hay que reintentar
}

/** Convierte un DATETIME de MySQL a ISO con zona: 2026-10-11T10:00:00-06:00 */
function iso(fechaHora) {
  if (!fechaHora) return null;
  return String(fechaHora).replace(" ", "T").slice(0, 19) + ZONA;
}

async function probarConexion() {
  const fila = await una("SELECT DATABASE() AS base, VERSION() AS version, NOW() AS ahora");
  return fila;
}

module.exports = { pool, consulta, una, transaccion, iso, probarConexion };
