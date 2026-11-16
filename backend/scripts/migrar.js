// ============================================================
//  Migraciones de la base de datos
//
//  Uso (desde backend/):   npm run db:migrar
//
//  Aplica, en orden, los archivos database/migraciones/NNN_nombre.sql
//  que todavía no estén registrados en la tabla `migraciones`. Así una
//  base que ya existe se actualiza sin borrar datos. Una base nueva se
//  crea con database/qhdc_base_de_datos.sql, que ya trae todo y marca
//  estas migraciones como aplicadas.
//
//  Reglas para escribir una migración:
//   * Sin DELIMITER (no se pueden crear procedimientos desde aquí; si
//     hace falta uno, va en el script completo y se aplica con Workbench).
//   * Cada archivo se aplica una sola vez; si falla, se detiene y se
//     muestra el error (corrígelo y vuelve a correr el comando).
// ============================================================
const fs = require("fs");
const path = require("path");
const { config } = require("../src/nucleo/config");
const mysql = require("mysql2/promise");

const CARPETA = path.join(__dirname, "..", "..", "database", "migraciones");

(async () => {
  const c = await mysql.createConnection({
    host: config.db.host, port: config.db.puerto, user: config.db.usuario, password: config.db.contrasena,
    database: config.db.nombre, charset: "UTF8MB4_0900_AI_CI", multipleStatements: true,
  });
  await c.query(`CREATE TABLE IF NOT EXISTS migraciones (
      nombre     VARCHAR(150) NOT NULL PRIMARY KEY,
      aplicada_en DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
  const [hechas] = await c.query("SELECT nombre FROM migraciones");
  const yaAplicadas = new Set(hechas.map((m) => m.nombre));
  const archivos = fs.existsSync(CARPETA) ? fs.readdirSync(CARPETA).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort() : [];
  const pendientes = archivos.filter((f) => !yaAplicadas.has(f));

  if (!pendientes.length) {
    console.log("✔ La base está al día (no hay migraciones pendientes).");
    await c.end();
    return;
  }
  for (const archivo of pendientes) {
    const sql = fs.readFileSync(path.join(CARPETA, archivo), "utf8");
    if (/^\s*DELIMITER/im.test(sql)) throw new Error(`${archivo} usa DELIMITER: eso va en el script completo (Workbench).`);
    process.stdout.write(`→ ${archivo} … `);
    try {
      await c.query(sql);
      await c.query("INSERT INTO migraciones (nombre) VALUES (?)", [archivo]);
      console.log("listo");
    } catch (e) {
      console.log("ERROR");
      console.error(`✖ ${e.message}`);
      console.error("  Corrige el problema y vuelve a correr: npm run db:migrar");
      await c.end();
      process.exit(1);
    }
  }
  console.log(`✔ ${pendientes.length} migración(es) aplicada(s).`);
  await c.end();
})().catch((e) => {
  console.error("✖ No se pudo migrar:", e.message);
  process.exit(1);
});
