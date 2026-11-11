// ============================================================
//  Fotos de alimentos: validación y almacenamiento privado
//  (núcleo compartido: lo usan escaneos y recetas)
//
//  Seguridad:
//   * Se revisa el tipo REAL del archivo leyendo su contenido (sharp),
//     no su extensión ni el tipo que dice el navegador.
//   * Solo JPEG, PNG y WebP. Tamaño máximo IMAGEN_MAX_MB.
//   * Se gira según el EXIF, se reduce a 1600 px y se guarda como JPEG
//     SIN metadatos (se borra la ubicación GPS y los datos del teléfono).
//   * Nombre aleatorio (nunca el del usuario) en una carpeta privada,
//     fuera de frontend/. Solo se sirve por GET /api/imagenes/:id,
//     revisando que la foto sea del hogar de la sesión.
//   * Retención: después de IMAGENES_RETENCION_DIAS se borra el archivo
//     (el registro del escaneo se conserva).
// ============================================================
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const { config } = require("./config");
const { consulta, una } = require("./db");
const { ErrorApp } = require("./errores");

const PERMITIDOS = new Set(["jpeg", "png", "webp"]);
const LADO_MAXIMO = 1600;

/** Revisa y limpia la imagen. Devuelve { buffer (JPEG), ancho, alto }. */
async function procesar(buffer) {
  let info;
  try {
    info = await sharp(buffer, { failOn: "error" }).metadata();
  } catch (e) {
    throw new ErrorApp(415, "El archivo no es una imagen válida.");
  }
  if (!PERMITIDOS.has(info.format)) {
    throw new ErrorApp(415, "Formato no permitido. Usa una foto JPG, PNG o WebP.");
  }
  if (!info.width || !info.height || info.width * info.height > 60e6) {
    throw new ErrorApp(415, "La imagen es demasiado grande en píxeles.");
  }
  const { data, info: salida } = await sharp(buffer)
    .rotate() // aplica la orientación del EXIF (fotos de celular)
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true }) // sin withMetadata(): se descartan EXIF/GPS
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, ancho: salida.width, alto: salida.height };
}

/** Guarda la foto en la carpeta privada y en la tabla imagenes. Devuelve su id. */
async function guardar(buffer, { hogarId, usuarioId, nombreOriginal = null }) {
  const limpia = await procesar(buffer);
  const ahora = new Date();
  const carpetaRel = path.posix.join(String(ahora.getFullYear()), String(ahora.getMonth() + 1).padStart(2, "0"));
  const nombre = `${crypto.randomUUID()}.jpg`;
  const rutaRel = `${carpetaRel}/${nombre}`;
  const destino = path.join(config.imagenes.carpeta, carpetaRel);
  await fs.mkdir(destino, { recursive: true });
  await fs.writeFile(path.join(destino, nombre), limpia.buffer, { flag: "wx" });

  const sha = crypto.createHash("sha256").update(limpia.buffer).digest("hex");
  try {
    const r = await consulta(
      `INSERT INTO imagenes (hogar_id, usuario_id, ruta_relativa, nombre_original, tipo_mime, tamano_bytes, ancho_px, alto_px, sha256, expira_en)
       VALUES (?, ?, ?, ?, 'image/jpeg', ?, ?, ?, ?, NOW() + INTERVAL ? DAY)`,
      [hogarId, usuarioId, rutaRel, nombreOriginal ? String(nombreOriginal).slice(0, 255) : null,
       limpia.buffer.length, limpia.ancho, limpia.alto, sha, config.imagenes.retencionDias]
    );
    return { id: r.insertId, rutaRelativa: rutaRel, buffer: limpia.buffer };
  } catch (e) {
    await fs.unlink(path.join(destino, nombre)).catch(() => {});
    throw e;
  }
}

/** Ruta absoluta segura de una foto del hogar, o error 404. */
function rutaSegura(rutaRelativa) {
  const absoluta = path.resolve(config.imagenes.carpeta, rutaRelativa);
  if (!absoluta.startsWith(path.resolve(config.imagenes.carpeta) + path.sep)) throw new ErrorApp(404, "Esa foto no existe.");
  return absoluta;
}

async function buscar(hogarId, imagenId) {
  const img = await una(
    "SELECT id, ruta_relativa, tipo_mime FROM imagenes WHERE hogar_id = ? AND id = ? AND eliminada_en IS NULL",
    [hogarId, imagenId]
  );
  if (!img) throw new ErrorApp(404, "Esa foto no existe o ya se borró.");
  return { ...img, absoluta: rutaSegura(img.ruta_relativa) };
}

async function leer(hogarId, imagenId) {
  const img = await buscar(hogarId, imagenId);
  try {
    return { ...img, buffer: await fs.readFile(img.absoluta) };
  } catch (e) {
    throw new ErrorApp(404, "El archivo de esa foto ya no está.");
  }
}

/** Borra los archivos vencidos (política de retención). Devuelve cuántos. */
async function limpiarVencidas() {
  const vencidas = await consulta(
    "SELECT id, ruta_relativa FROM imagenes WHERE eliminada_en IS NULL AND expira_en IS NOT NULL AND expira_en < NOW() LIMIT 500"
  );
  for (const img of vencidas) {
    await fs.unlink(rutaSegura(img.ruta_relativa)).catch((e) => { if (e.code !== "ENOENT") throw e; });
    await consulta("UPDATE imagenes SET eliminada_en = NOW() WHERE id = ?", [img.id]);
  }
  return vencidas.length;
}

/** Borra una foto del hogar (el usuario la quita de "Fotos recientes"). */
async function eliminar(hogarId, imagenId) {
  const img = await buscar(hogarId, imagenId);
  await fs.unlink(img.absoluta).catch(() => {});
  await consulta("UPDATE imagenes SET eliminada_en = NOW() WHERE id = ?", [img.id]);
}

module.exports = { guardar, leer, eliminar, limpiarVencidas, procesar };
