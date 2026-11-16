// ============================================================
//  Dispositivos IoT: autenticación y estado de conexión
//
//  Un ESP32 se identifica con su identificador + clave. En la base solo
//  se guarda el hash SHA-256 de la clave (igual que antes con HTTP).
// ============================================================
const { consulta, una } = require("../../nucleo/db");
const { hash } = require("../auth/sesiones");

const CAMPOS = `id, hogar_id, identificador, nombre, tipo, modelo, estado, ubicacion_id, capacidad_g,
                umbral_cambio_g, lecturas_estables, estado_conexion`;

/** Dispositivo por identificador y clave, o null si no coincide o está dado de baja. */
async function autenticar(identificador, clave) {
  if (!identificador || !clave) return null;
  const d = await una(
    `SELECT ${CAMPOS} FROM dispositivos_iot WHERE identificador = ? AND clave_hash = ?`,
    [String(identificador).slice(0, 100), hash(String(clave))]
  );
  return d && d.estado !== "baja" ? d : null;
}

/** Dispositivo por identificador (cuando el broker ya lo autenticó). */
async function porIdentificador(identificador) {
  const d = await una(`SELECT ${CAMPOS} FROM dispositivos_iot WHERE identificador = ?`, [String(identificador).slice(0, 100)]);
  return d && d.estado !== "baja" ? d : null;
}

/** Qué alimento está sobre cada canal de la báscula. */
async function canales(dispositivoId) {
  return consulta(
    `SELECT da.canal, da.alimento_id, da.tara, da.factor_conversion
       FROM dispositivo_alimentos da
       JOIN alimentos a ON a.hogar_id = da.hogar_id AND a.id = da.alimento_id AND a.activo
      WHERE da.dispositivo_id = ? AND da.activo ORDER BY da.canal`,
    [dispositivoId]
  );
}

/**
 * Guarda el estado que reporta el broker: en_linea / fuera_de_linea.
 * Si cambió, deja constancia en la bitácora del dispositivo.
 */
async function marcarConexion(d, estado, { ip = null, rssi = null, firmware = null } = {}) {
  const anterior = d.estado_conexion;
  await consulta(
    `UPDATE dispositivos_iot
        SET estado_conexion = ?, estado_conexion_en = NOW(3),
            ip = COALESCE(?, ip), firmware = COALESCE(?, firmware),
            senal_dbm = COALESCE(?, senal_dbm)
      WHERE id = ?`,
    [estado, ip, firmware, Number.isFinite(rssi) ? Math.max(-120, Math.min(0, Math.round(rssi))) : null, d.id]
  );
  if (anterior !== estado) {
    await consulta(
      "INSERT INTO eventos_dispositivo (hogar_id, dispositivo_id, tipo, detalle) VALUES (?, ?, ?, ?)",
      [d.hogar_id, d.id, estado === "en_linea" ? "conectado" : "desconectado", estado === "en_linea" ? "MQTT" : "MQTT: sin conexión"]
    );
  }
  d.estado_conexion = estado;
}

module.exports = { autenticar, porIdentificador, canales, marcarConexion };
