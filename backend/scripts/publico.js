// ============================================================
//  Publicar la app con un enlace HTTPS temporal (Cloudflare Tunnel)
//
//  Uso (desde backend/):   npm run publico
//
//  1. Revisa que ninguna cuenta use una contraseña conocida (las de
//     ejemplo vienen en el README): si alguna la usa, no publica.
//  2. Arranca el servidor si no está corriendo.
//  3. Abre un túnel rápido de Cloudflare (gratis, sin cuenta) y muestra
//     el enlace https://….trycloudflare.com. Con HTTPS el celular puede
//     usar la cámara en vivo desde cualquier lugar.
//  Ctrl + C cierra el túnel (y el servidor, si lo arrancó este comando).
//
//  Requiere cloudflared: %LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe,
//  en el PATH, o en la variable CLOUDFLARED_RUTA.
//  Mientras el túnel esté abierto, la página de entrar es pública en
//  internet: cualquiera con el enlace la ve (pero necesita usuario y
//  contraseña). El enlace cambia cada vez.
// ============================================================
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const bcrypt = require("bcryptjs");
const { config } = require("../src/nucleo/config");
const { pool } = require("../src/nucleo/db");

const DEBILES = ["admin123", "miembro123", "123456", "12345678", "123456789", "password", "qwerty123"];
// Claves de dispositivo que estuvieron en la documentación (cualquiera las conoce)
const CLAVES_PUBLICAS = ["clave-esp32-despensa-001"];
const LOCAL = `http://localhost:${config.puerto}`;

function rutaCloudflared() {
  const candidatos = [
    process.env.CLOUDFLARED_RUTA,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "cloudflared", "cloudflared.exe"),
  ].filter(Boolean);
  return candidatos.find((r) => fs.existsSync(r)) || "cloudflared";
}

function rutaTailscale() {
  const candidatos = [
    process.env.TAILSCALE_RUTA,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Tailscale", "tailscale.exe"),
  ].filter(Boolean);
  return candidatos.find((r) => fs.existsSync(r)) || "tailscale";
}

async function cuentasConContrasenaConocida() {
  // Solo las cuentas que pueden entrar: activas y con un hogar activo. Una
  // cuenta que se quitó del hogar ya no puede iniciar sesión.
  const [usuarios] = await pool.query(
    `SELECT u.correo, u.contrasena_hash FROM usuarios u
      WHERE u.activo AND EXISTS (SELECT 1 FROM hogar_miembros hm WHERE hm.usuario_id = u.id AND hm.activo)`
  );
  const debiles = [];
  for (const u of usuarios) {
    for (const p of DEBILES) {
      if (await bcrypt.compare(p, u.contrasena_hash)) { debiles.push(u.correo); break; }
    }
  }
  return debiles;
}

async function dispositivosConClaveConocida() {
  const hashes = CLAVES_PUBLICAS.map((c) => require("crypto").createHash("sha256").update(c).digest("hex"));
  const [filas] = await pool.query(
    "SELECT identificador FROM dispositivos_iot WHERE estado <> 'baja' AND clave_hash IN (?)", [hashes]);
  return filas.map((f) => f.identificador);
}

async function servidorActivo() {
  try {
    const r = await fetch(`${LOCAL}/api/salud`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch (e) {
    return false;
  }
}

(async () => {
  // 1. Contraseñas y claves de dispositivos
  const debiles = await cuentasConContrasenaConocida();
  const dispositivos = await dispositivosConClaveConocida();
  await pool.end();
  if (dispositivos.length) {
    console.error("\n✖ No se publicó: estos dispositivos usan una clave que aparece en la documentación:");
    dispositivos.forEach((d) => console.error(`   • ${d}`));
    console.error("\n  Cualquiera podría mandar lecturas falsas. Cámbiala (ver README → Seguridad de los dispositivos).\n");
    process.exit(1);
  }
  if (debiles.length) {
    console.error("\n✖ No se publicó: estas cuentas usan una contraseña conocida (cualquiera podría entrar):");
    debiles.forEach((c) => console.error(`   • ${c}`));
    console.error("\n  Entra a la app → avatar → Ajustes → Contraseña y cámbiala (8 caracteres o más).");
    console.error("  Si alguna cuenta de ejemplo no la usas, quítala del hogar desde Ajustes.\n");
    process.exit(1);
  }

  // 2. Servidor
  let servidor = null;
  if (!(await servidorActivo())) {
    console.log("Arrancando el servidor…");
    servidor = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { stdio: "inherit" });
    for (let i = 0; i < 30 && !(await servidorActivo()); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await servidorActivo())) { console.error("✖ El servidor no respondió."); servidor.kill(); process.exit(1); }
  } else {
    console.log(`✔ El servidor ya está corriendo en ${LOCAL}`);
  }

  // 3. Túnel: Tailscale Funnel (dirección fija) o Cloudflare (dirección temporal)
  const fijo = process.argv.includes("--fijo");
  const exe = fijo ? rutaTailscale() : rutaCloudflared();
  let direccionFija = null;
  if (fijo) {
    try {
      const estado = JSON.parse(execFileSync(exe, ["status", "--json"], { encoding: "utf8" }));
      if (estado.BackendState !== "Running") throw new Error("Tailscale no está conectado: ábrelo e inicia sesión.");
      direccionFija = `https://${String(estado.Self.DNSName).replace(/\.$/, "")}`;
    } catch (e) {
      console.error(`✖ ${e.code === "ENOENT" ? "No se encontró Tailscale. Instálalo desde https://tailscale.com/download" : e.message}`);
      if (servidor) servidor.kill();
      process.exit(1);
    }
  }
  const args = fijo ? ["funnel", String(config.puerto)] : ["tunnel", "--no-autoupdate", "--url", LOCAL];
  const tunel = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
  let mostrado = false;
  const anunciar = (url) => {
    mostrado = true;
    console.log("\n==============================================================");
    console.log("  QHDC! está publicado con HTTPS en:");
    console.log(`\n     ${url}\n`);
    console.log(fijo
      ? "  Esta dirección es FIJA: es la misma cada vez que lo inicias."
      : "  Ábrelo en el celular o compártelo. Cambia cada vez que lo inicias.");
    console.log("  El ESP32 sigue conectándose a esta PC por tu WiFi (no cambia nada).");
    console.log("  Ctrl + C (o cerrar esta ventana) apaga el enlace.");
    console.log("==============================================================\n");
  };
  let acumulado = "";
  const leer = (datos) => {
    const texto = datos.toString();
    if (fijo) {
      // La primera vez Tailscale pide activar HTTPS/Funnel con un enlace: se muestra tal cual
      acumulado = (acumulado + texto).slice(-2000);
      if (!mostrado && /available on the internet/i.test(acumulado) && /ts\.net/.test(acumulado)) anunciar(direccionFija);
      else if (!mostrado || /error|enable|visit/i.test(texto)) process.stdout.write(texto);
      return;
    }
    const m = texto.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !mostrado) anunciar(m[0]);
    if (/ERR|error/i.test(texto) && !/Retrying|retry/i.test(texto) && mostrado) process.stderr.write(texto);
  };
  tunel.stdout.on("data", leer);
  tunel.stderr.on("data", leer);
  tunel.on("error", (e) => {
    console.error(`✖ No se pudo ejecutar ${exe}: ${e.message}`);
    if (fijo) console.error("  Instala Tailscale desde https://tailscale.com/download e inicia sesión.");
    else {
      console.error("  Descárgalo de https://github.com/cloudflare/cloudflared/releases (cloudflared-windows-amd64.exe)");
      console.error("  y guárdalo en %LOCALAPPDATA%\\Programs\\cloudflared\\cloudflared.exe");
    }
    if (servidor) servidor.kill();
    process.exit(1);
  });
  tunel.on("exit", (codigo) => {
    console.log(`Túnel cerrado (código ${codigo}).`);
    if (servidor) servidor.kill();
    process.exit(codigo || 0);
  });
  const cerrar = () => { tunel.kill(); if (servidor) servidor.kill(); };
  process.on("SIGINT", cerrar);
  process.on("SIGTERM", cerrar);
})().catch((e) => {
  console.error("✖", e.message);
  process.exit(1);
});
