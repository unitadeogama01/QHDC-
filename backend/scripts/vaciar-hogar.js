// ============================================================
//  Vaciar la alacena de un hogar (datos de ejemplo / simulados)
//
//  Uso (desde backend/):   npm run datos:vaciar -- --hogar 1 --si
//
//  BORRA: alimentos, lotes, movimientos, lista del súper, avisos,
//  escaneos y sus fotos, conversaciones del asistente, recetas
//  preparadas, lecturas de sensores, calibraciones y la bitácora de
//  dispositivos.
//  CONSERVA: usuarios, el hogar, sus lugares y límites de ambiente,
//  categorías, recetas, invitaciones y los dispositivos vinculados
//  (quedan como "sin conectar" hasta que manden datos).
//
//  Haz un respaldo antes (mysqldump o Workbench → Data Export).
// ============================================================
const fs = require("fs/promises");
const path = require("path");
const { config } = require("../src/nucleo/config");
const { pool, transaccion } = require("../src/nucleo/db");

const args = process.argv.slice(2);
const hogarId = Number(args[args.indexOf("--hogar") + 1]);

(async () => {
  if (!args.includes("--hogar") || !Number.isInteger(hogarId) || hogarId <= 0) {
    console.error("Indica el hogar: npm run datos:vaciar -- --hogar 1 --si");
    process.exit(1);
  }
  const [[hogar]] = await pool.query("SELECT nombre FROM hogares WHERE id = ?", [hogarId]);
  if (!hogar) { console.error(`No existe el hogar ${hogarId}.`); process.exit(1); }
  if (!args.includes("--si")) {
    console.log(`Esto vaciará la alacena de "${hogar.nombre}" (hogar ${hogarId}). Para confirmar agrega --si`);
    process.exit(0);
  }

  const fotos = (await pool.query("SELECT ruta_relativa FROM imagenes WHERE hogar_id = ? AND eliminada_en IS NULL", [hogarId]))[0];
  const conteo = {};
  await transaccion(async (c) => {
    const borrar = async (tabla, where = "hogar_id = ?", params = [hogarId]) => {
      const [r] = await c.query(`DELETE FROM ${tabla} WHERE ${where}`, params);
      conteo[tabla] = r.affectedRows;
    };
    // En orden, por las llaves foráneas
    await borrar("notificaciones");
    await borrar("recomendaciones_consumo");
    await borrar("predicciones_consumo");
    await borrar("identificaciones_ia");
    await borrar("escaneos");
    await borrar("imagenes");
    await borrar("lista_compras_items");
    await borrar("listas_compras");
    await borrar("mensajes_asistente");
    await borrar("conversaciones_asistente");
    await borrar("movimientos_inventario");
    await borrar("recetas_preparadas");
    await borrar("lecturas_sensor");
    await borrar("lecturas_resumen_hora");
    await borrar("dispositivo_alimentos");
    await borrar("lotes_alimento");
    await borrar("alimentos");
    await borrar("calibraciones_bascula");
    await borrar("eventos_dispositivo", "hogar_id = ? AND tipo <> 'vinculado'");
    // Los dispositivos se quedan, pero sin datos de conexión ni calibración
    const [d] = await c.query(
      `UPDATE dispositivos_iot SET ultima_conexion = NULL, ultima_calibracion = NULL, estado_conexion = 'desconocido',
              estado_conexion_en = NULL, bateria_pct = NULL, senal_dbm = NULL, ip = NULL, firmware = NULL
        WHERE hogar_id = ?`, [hogarId]);
    conteo["dispositivos_iot (reiniciados)"] = d.affectedRows;
  });

  let archivos = 0;
  for (const f of fotos) {
    const ruta = path.resolve(config.imagenes.carpeta, f.ruta_relativa);
    if (ruta.startsWith(path.resolve(config.imagenes.carpeta) + path.sep)) {
      await fs.unlink(ruta).then(() => archivos++, () => {});
    }
  }
  console.table(conteo);
  console.log(`✔ Alacena de "${hogar.nombre}" vacía. Fotos borradas del disco: ${archivos}.`);
  await pool.end();
})().catch(async (e) => {
  console.error("✖ No se pudo vaciar:", e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
