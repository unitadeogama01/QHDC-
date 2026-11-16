-- =====================================================================
--  002 · Rendimiento: últimos valores de cada dispositivo sin recorrer
--        el historial de lecturas
--  Se aplica con:  npm run db:migrar   (desde backend/)
--  Las bases nuevas ya lo traen en qhdc_base_de_datos.sql.
--
--  Problema medido (npm run rendimiento): vista_dispositivos calculaba la
--  última temperatura, humedad y gas con subconsultas que MySQL resolvía
--  recorriendo y ordenando el historial de lecturas_sensor. Con una
--  semana de lecturas (~400 mil, un DHT22 cada 3 s) cada pantalla tardaba
--  ~3.6 s y la pantalla Dispositivos ~1.4 s cada 3 s (la vista se usa en
--  /api/estado, /api/sensores/vivo y en los avisos). Ahora el trigger que
--  ya se ejecutaba con cada lectura guarda esos valores en el dispositivo.
-- =====================================================================

ALTER TABLE dispositivos_iot
  ADD COLUMN ultima_temperatura DECIMAL(14,4) NULL AFTER firmware,
  ADD COLUMN ultima_temperatura_en DATETIME(3) NULL AFTER ultima_temperatura,
  ADD COLUMN ultima_humedad DECIMAL(14,4) NULL AFTER ultima_temperatura_en,
  ADD COLUMN ultima_humedad_en DATETIME(3) NULL AFTER ultima_humedad,
  ADD COLUMN ultimo_gas_ppm DECIMAL(14,4) NULL AFTER ultima_humedad_en,
  ADD COLUMN ultimo_gas_en DATETIME(3) NULL AFTER ultimo_gas_ppm,
  ADD COLUMN ultimo_peso_en DATETIME(3) NULL AFTER ultimo_gas_en;

-- Rellenar con las lecturas que ya existen
UPDATE dispositivos_iot d
   SET ultima_temperatura    = (SELECT s.valor FROM lecturas_sensor s FORCE INDEX (idx_lecturas_tipo)
                 WHERE s.dispositivo_id = d.id AND s.tipo_lectura = 'temperatura' AND s.valido
                 ORDER BY s.leido_en DESC, s.id DESC LIMIT 1),
       ultima_temperatura_en = (SELECT s.leido_en FROM lecturas_sensor s FORCE INDEX (idx_lecturas_tipo)
                 WHERE s.dispositivo_id = d.id AND s.tipo_lectura = 'temperatura' AND s.valido
                 ORDER BY s.leido_en DESC, s.id DESC LIMIT 1),
       ultima_humedad        = (SELECT s.valor FROM lecturas_sensor s FORCE INDEX (idx_lecturas_tipo)
                 WHERE s.dispositivo_id = d.id AND s.tipo_lectura = 'humedad' AND s.valido
                 ORDER BY s.leido_en DESC, s.id DESC LIMIT 1),
       ultima_humedad_en     = (SELECT s.leido_en FROM lecturas_sensor s FORCE INDEX (idx_lecturas_tipo)
                 WHERE s.dispositivo_id = d.id AND s.tipo_lectura = 'humedad' AND s.valido
                 ORDER BY s.leido_en DESC, s.id DESC LIMIT 1),
       ultimo_gas_ppm        = (SELECT s.valor FROM lecturas_sensor s FORCE INDEX (idx_lecturas_tipo)
                 WHERE s.dispositivo_id = d.id AND s.tipo_lectura = 'gas' AND s.valido
                 ORDER BY s.leido_en DESC, s.id DESC LIMIT 1),
       ultimo_gas_en         = (SELECT s.leido_en FROM lecturas_sensor s FORCE INDEX (idx_lecturas_tipo)
                 WHERE s.dispositivo_id = d.id AND s.tipo_lectura = 'gas' AND s.valido
                 ORDER BY s.leido_en DESC, s.id DESC LIMIT 1),
       ultimo_peso_en        = (SELECT s.leido_en FROM lecturas_sensor s FORCE INDEX (idx_lecturas_tipo)
                 WHERE s.dispositivo_id = d.id AND s.tipo_lectura = 'peso' AND s.valido
                 ORDER BY s.leido_en DESC, s.id DESC LIMIT 1);

-- El trigger ahora también guarda los últimos valores (cuerpo de una sola
-- instrucción: así no hace falta DELIMITER)
DROP TRIGGER IF EXISTS trg_lecturas_actualizan_dispositivo;
CREATE TRIGGER trg_lecturas_actualizan_dispositivo
AFTER INSERT ON lecturas_sensor
FOR EACH ROW
  UPDATE dispositivos_iot
     SET ultima_conexion = IF(ultima_conexion IS NULL OR NEW.leido_en > ultima_conexion,
                              NEW.leido_en, ultima_conexion),
         -- Si llegó una lectura, el dispositivo está conectado
         estado_conexion    = IF(estado_conexion_en IS NULL OR NEW.recibido_en >= estado_conexion_en,
                                 'en_linea', estado_conexion),
         estado_conexion_en = IF(estado_conexion_en IS NULL OR NEW.recibido_en >= estado_conexion_en,
                                 NEW.recibido_en, estado_conexion_en),
         bateria_pct = IF(NEW.tipo_lectura = 'bateria' AND NEW.valido,
                          LEAST(100, GREATEST(0, ROUND(NEW.valor))), bateria_pct),
         -- Últimos valores válidos (cada valor ANTES que su fecha: MySQL asigna en orden)
         ultima_temperatura = IF(NEW.tipo_lectura = 'temperatura' AND NEW.valido AND (ultima_temperatura_en IS NULL OR NEW.leido_en >= ultima_temperatura_en),
                         NEW.valor, ultima_temperatura),
         ultima_temperatura_en = IF(NEW.tipo_lectura = 'temperatura' AND NEW.valido AND (ultima_temperatura_en IS NULL OR NEW.leido_en >= ultima_temperatura_en),
                         NEW.leido_en, ultima_temperatura_en),
         ultima_humedad = IF(NEW.tipo_lectura = 'humedad' AND NEW.valido AND (ultima_humedad_en IS NULL OR NEW.leido_en >= ultima_humedad_en),
                         NEW.valor, ultima_humedad),
         ultima_humedad_en = IF(NEW.tipo_lectura = 'humedad' AND NEW.valido AND (ultima_humedad_en IS NULL OR NEW.leido_en >= ultima_humedad_en),
                         NEW.leido_en, ultima_humedad_en),
         ultimo_gas_ppm = IF(NEW.tipo_lectura = 'gas' AND NEW.valido AND (ultimo_gas_en IS NULL OR NEW.leido_en >= ultimo_gas_en),
                         NEW.valor, ultimo_gas_ppm),
         ultimo_gas_en = IF(NEW.tipo_lectura = 'gas' AND NEW.valido AND (ultimo_gas_en IS NULL OR NEW.leido_en >= ultimo_gas_en),
                         NEW.leido_en, ultimo_gas_en),
         ultimo_peso_en = IF(NEW.tipo_lectura = 'peso' AND NEW.valido AND (ultimo_peso_en IS NULL OR NEW.leido_en >= ultimo_peso_en),
                             NEW.leido_en, ultimo_peso_en)
   WHERE id = NEW.dispositivo_id;

-- La vista lee las columnas
CREATE OR REPLACE VIEW vista_dispositivos AS
SELECT d.hogar_id,
       d.id AS dispositivo_id,
       d.identificador,
       d.nombre,
       d.tipo,
       d.modelo,
       u.nombre AS ubicacion,
       d.estado,
       d.bateria_pct,
       d.senal_dbm,
       d.ultima_conexion,
       d.ubicacion_id,
       d.capacidad_g,
       d.estado_conexion,
       d.ip,
       d.firmware,
       TIMESTAMPDIFF(SECOND, d.ultima_conexion, NOW(3)) AS segundos_sin_datos,
       -- En línea: mandó datos hace poco y el broker no avisó que se desconectó
       (d.estado = 'activo' AND d.ultima_conexion IS NOT NULL
        AND d.ultima_conexion >= NOW(3) - INTERVAL d.umbral_desconexion_seg SECOND
        AND d.estado_conexion <> 'fuera_de_linea') AS en_linea,
       (SELECT GROUP_CONCAT(a.nombre ORDER BY da.canal SEPARATOR ', ')
          FROM dispositivo_alimentos da
          JOIN alimentos a ON a.hogar_id = da.hogar_id AND a.id = da.alimento_id
         WHERE da.dispositivo_id = d.id AND da.activo) AS alimentos,
       -- Últimos valores válidos: columnas que mantiene el trigger de lecturas
       -- (antes eran subconsultas que, con una semana de lecturas, tardaban
       -- segundos; ver migración 002). 'gas' se conserva por compatibilidad.
       d.ultimo_gas_ppm,
       d.ultima_temperatura,
       d.ultima_humedad,
       d.ultimo_peso_en
FROM dispositivos_iot d
LEFT JOIN ubicaciones_almacenamiento u ON u.hogar_id = d.hogar_id AND u.id = d.ubicacion_id
WHERE d.estado <> 'baja';
