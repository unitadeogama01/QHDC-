// ============================================================
//  Divide database/qhdc_base_de_datos.sql en sentencias para
//  ejecutarlas desde Node (mysql2 no entiende DELIMITER).
//  Respeta textos entre comillas, comentarios y los cambios de
//  delimitador de los procedimientos (DELIMITER $$ … DELIMITER ;).
// ============================================================

function dividirScript(sql) {
  const sentencias = [];
  let delimitador = ";";
  let actual = "";
  let inicioDeLinea = true;
  const n = sql.length;
  let i = 0;
  while (i < n) {
    // DELIMITER x (al inicio de una línea, entre sentencias)
    if (inicioDeLinea && actual.trim() === "") {
      const m = /^[ \t]*DELIMITER[ \t]+(\S+)[ \t]*(?:\r?\n|$)/i.exec(sql.slice(i, i + 100));
      if (m) { delimitador = m[1]; i += m[0].length; continue; }
    }
    const c = sql[i];
    // Comentarios: "-- " y "#" hasta el fin de línea; /* … */ (se conservan los /*! … */ de MySQL)
    if ((c === "-" && sql[i + 1] === "-" && /\s/.test(sql[i + 2] || "\n")) || c === "#") {
      const fin = sql.indexOf("\n", i);
      i = fin < 0 ? n : fin;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const fin = sql.indexOf("*/", i + 2);
      const bloque = sql.slice(i, fin < 0 ? n : fin + 2);
      if (bloque.startsWith("/*!")) actual += bloque;
      i = fin < 0 ? n : fin + 2;
      continue;
    }
    // Textos e identificadores entre comillas ('…', "…", `…`)
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "\\" && c !== "`") { j += 2; continue; }
        if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; }
        j++;
      }
      actual += sql.slice(i, j + 1);
      i = j + 1;
      inicioDeLinea = false;
      continue;
    }
    // Fin de sentencia
    if (sql.startsWith(delimitador, i)) {
      if (actual.trim()) sentencias.push(actual.trim());
      actual = "";
      i += delimitador.length;
      inicioDeLinea = false;
      continue;
    }
    actual += c;
    inicioDeLinea = c === "\n";
    i++;
  }
  if (actual.trim()) sentencias.push(actual.trim());
  return sentencias;
}

/** Cambia el nombre de la base (CREATE DATABASE / USE qhdc) por otro. */
function conOtraBase(sentencias, nombre) {
  return sentencias
    .filter((s) => !/^DROP\s+DATABASE/i.test(s))
    .map((s) => {
      if (/^CREATE\s+DATABASE/i.test(s)) return s.replace(/\bqhdc\b/, nombre);
      if (/^USE\s+/i.test(s)) return `USE \`${nombre}\``;
      return s;
    });
}

module.exports = { dividirScript, conOtraBase };
