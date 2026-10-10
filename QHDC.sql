

CREATE DATABASE IF NOT EXISTS QHDC
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE QHDC;

-- =====================================================================
-- 1. USUARIOS Y AUTENTICACIÓN (HU-09)
-- =====================================================================

-- Usuarios del sistema. La contraseña NUNCA se guarda en texto plano:
-- el backend genera el hash (p. ej. bcrypt o argon2) y aquí solo se almacena.
CREATE TABLE usuarios (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre           VARCHAR(100)    NOT NULL,
  correo           VARCHAR(255)    NOT NULL,
  contrasena_hash  VARCHAR(255)    NOT NULL,
  activo           BOOLEAN         NOT NULL DEFAULT TRUE,
  ultimo_acceso    DATETIME        NULL,
  creado_en        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_correo (correo),
  CONSTRAINT chk_usuarios_correo CHECK (correo LIKE '%_@_%._%'),
  CONSTRAINT chk_usuarios_hash   CHECK (CHAR_LENGTH(contrasena_hash) >= 20)
) ENGINE=InnoDB;

-- Sesiones/tokens para consultar desde cualquier dispositivo.
-- Se guarda el HASH del token, no el token.
CREATE TABLE sesiones_autenticacion (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id          BIGINT UNSIGNED NOT NULL,
  token_hash          CHAR(64)        NOT NULL,
  descripcion_cliente VARCHAR(255)    NULL,           -- p. ej. "Chrome en celular"
  creado_en           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en           DATETIME        NOT NULL,
  revocado_en         DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sesiones_token (token_hash),
  KEY idx_sesiones_usuario (usuario_id, expira_en),
  CONSTRAINT fk_sesiones_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT chk_sesiones_expira CHECK (expira_en > creado_en)
) ENGINE=InnoDB;

-- Preferencias de cada usuario (1 fila por usuario). HU-04.
CREATE TABLE preferencias_usuario (
  usuario_id                  BIGINT UNSIGNED   NOT NULL,
  dias_anticipacion_caducidad SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  notificar_caducidad         BOOLEAN           NOT NULL DEFAULT TRUE,
  notificar_existencias_bajas BOOLEAN           NOT NULL DEFAULT TRUE,
  zona_horaria                VARCHAR(64)       NOT NULL DEFAULT 'America/Mexico_City',
  actualizado_en              DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id),
  CONSTRAINT fk_pref_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT chk_pref_dias CHECK (dias_anticipacion_caducidad BETWEEN 0 AND 365)
) ENGINE=InnoDB;

-- Configuración del tablero de resumen: qué bloques ve cada usuario y en qué orden.
CREATE TABLE tablero_widgets (
  id          BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  usuario_id  BIGINT UNSIGNED   NOT NULL,
  tipo_widget ENUM('resumen_inventario','proximos_caducar','existencias_bajas',
                   'recomendaciones','predicciones','lista_compras','recetas')
                                NOT NULL,
  visible     BOOLEAN           NOT NULL DEFAULT TRUE,
  orden       SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_widget_usuario_tipo (usuario_id, tipo_widget),
  CONSTRAINT fk_widget_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT chk_widget_orden CHECK (orden >= 1)
) ENGINE=InnoDB;

-- =====================================================================
-- 2. CATÁLOGOS Y ALIMENTOS (HU-01, HU-02)
-- =====================================================================

-- Unidades de medida: catálogo GLOBAL (no pertenece a ningún usuario).
CREATE TABLE unidades_medida (
  id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(10)       NOT NULL,
  nombre VARCHAR(50)       NOT NULL,
  tipo   ENUM('masa','volumen','conteo') NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_unidades_codigo (codigo)
) ENGINE=InnoDB;

-- Categorías de alimentos por usuario. La perecibilidad y los días de aviso
-- por categoría sirven a HU-04 y HU-05 (recomendaciones).
CREATE TABLE categorias_alimento (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id           BIGINT UNSIGNED NOT NULL,
  nombre               VARCHAR(80)     NOT NULL,
  perecibilidad        ENUM('alta','media','baja') NOT NULL DEFAULT 'media',
  dias_aviso_caducidad SMALLINT UNSIGNED NULL,   -- NULL = usar preferencia del usuario
  PRIMARY KEY (id),
  UNIQUE KEY uq_categorias_usuario_id (usuario_id, id),       -- destino de FK compuestas
  UNIQUE KEY uq_categorias_usuario_nombre (usuario_id, nombre),
  CONSTRAINT fk_categorias_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE RESTRICT,
  CONSTRAINT chk_categorias_aviso CHECK (dias_aviso_caducidad IS NULL
                                         OR dias_aviso_caducidad <= 365)
) ENGINE=InnoDB;

-- Lugares donde se guardan los alimentos (refrigerador, despensa, etc.).
CREATE TABLE ubicaciones_almacenamiento (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id BIGINT UNSIGNED NOT NULL,
  nombre     VARCHAR(80)     NOT NULL,
  tipo       ENUM('refrigerador','congelador','despensa','otro') NOT NULL DEFAULT 'otro',
  PRIMARY KEY (id),
  UNIQUE KEY uq_ubicaciones_usuario_id (usuario_id, id),
  UNIQUE KEY uq_ubicaciones_usuario_nombre (usuario_id, nombre),
  CONSTRAINT fk_ubicaciones_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Alimentos/productos del inventario (la "ficha" del producto).
-- La CANTIDAD no se guarda aquí: es la suma de sus lotes (ver vista).
-- "Eliminar" un alimento = activo = FALSE (baja lógica) para conservar historial.
CREATE TABLE alimentos (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  usuario_id     BIGINT UNSIGNED   NOT NULL,
  categoria_id   BIGINT UNSIGNED   NULL,
  ubicacion_id   BIGINT UNSIGNED   NULL,
  unidad_id      SMALLINT UNSIGNED NOT NULL,
  nombre         VARCHAR(120)      NOT NULL,
  stock_minimo   DECIMAL(12,3)     NOT NULL DEFAULT 0.000,  -- umbral de existencia baja
  activo         BOOLEAN           NOT NULL DEFAULT TRUE,
  creado_en      DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_alimentos_usuario_id (usuario_id, id),
  UNIQUE KEY uq_alimentos_usuario_nombre (usuario_id, nombre),
  KEY idx_alimentos_categoria (usuario_id, categoria_id),
  KEY idx_alimentos_ubicacion (usuario_id, ubicacion_id),
  KEY idx_alimentos_activo (usuario_id, activo),
  KEY idx_alimentos_unidad (unidad_id),
  CONSTRAINT fk_alimentos_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE RESTRICT,
  CONSTRAINT fk_alimentos_categoria FOREIGN KEY (usuario_id, categoria_id)
    REFERENCES categorias_alimento (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_alimentos_ubicacion FOREIGN KEY (usuario_id, ubicacion_id)
    REFERENCES ubicaciones_almacenamiento (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_alimentos_unidad FOREIGN KEY (unidad_id)
    REFERENCES unidades_medida (id) ON DELETE RESTRICT,
  CONSTRAINT chk_alimentos_stock_minimo CHECK (stock_minimo >= 0)
) ENGINE=InnoDB;

-- Lotes: un mismo alimento puede tener varios lotes con distinta caducidad.
-- cantidad_actual es la existencia real del lote. fecha_caducidad NULL = no caduca.
CREATE TABLE lotes_alimento (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id           BIGINT UNSIGNED NOT NULL,
  alimento_id          BIGINT UNSIGNED NOT NULL,
  cantidad_inicial     DECIMAL(12,3)   NOT NULL,
  cantidad_actual      DECIMAL(12,3)   NOT NULL,
  fecha_ingreso        DATE            NOT NULL,
  fecha_caducidad      DATE            NULL,
  dias_aviso_caducidad SMALLINT UNSIGNED NULL,  -- NULL = usar categoría o preferencia
  estado               ENUM('disponible','agotado','descartado') NOT NULL DEFAULT 'disponible',
  origen               ENUM('manual','compra','sensor','identificacion_ia') NOT NULL DEFAULT 'manual',
  notas                VARCHAR(255)    NULL,
  creado_en            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lotes_usuario_id (usuario_id, id),
  KEY idx_lotes_alimento (usuario_id, alimento_id, estado),
  KEY idx_lotes_caducidad (usuario_id, fecha_caducidad),
  KEY idx_lotes_estado_caducidad (estado, fecha_caducidad),
  CONSTRAINT fk_lotes_alimento FOREIGN KEY (usuario_id, alimento_id)
    REFERENCES alimentos (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_lotes_cant_inicial CHECK (cantidad_inicial > 0),
  CONSTRAINT chk_lotes_cant_actual  CHECK (cantidad_actual >= 0),
  CONSTRAINT chk_lotes_fechas CHECK (fecha_caducidad IS NULL
                                     OR fecha_caducidad >= fecha_ingreso),
  CONSTRAINT chk_lotes_aviso CHECK (dias_aviso_caducidad IS NULL
                                    OR dias_aviso_caducidad <= 365)
) ENGINE=InnoDB;

-- =====================================================================
-- 3. IoT Y MOVIMIENTOS (HU-03, HU-06)
-- =====================================================================

-- Dispositivos IoT registrados. Si es una báscula/sensor de un alimento,
-- alimento_id indica qué producto vigila. Se guarda el HASH del token del
-- dispositivo (la forma de autenticarse aún no está definida).
CREATE TABLE dispositivos_iot (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id               BIGINT UNSIGNED NOT NULL,
  identificador_dispositivo VARCHAR(100)   NOT NULL,   -- ID físico/único del hardware
  nombre                   VARCHAR(100)    NOT NULL,
  tipo                     ENUM('bascula','sensor_temperatura','sensor_humedad',
                                'camara','otro') NOT NULL,
  ubicacion_id             BIGINT UNSIGNED NULL,
  alimento_id              BIGINT UNSIGNED NULL,
  token_hash               VARCHAR(255)    NULL,
  factor_conversion        DECIMAL(14,6)   NOT NULL DEFAULT 1.000000,  -- lectura -> unidad del alimento
  estado                   ENUM('activo','inactivo','mantenimiento') NOT NULL DEFAULT 'activo',
  ultima_conexion          DATETIME        NULL,
  creado_en                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dispositivos_identificador (identificador_dispositivo),
  UNIQUE KEY uq_dispositivos_usuario_id (usuario_id, id),
  KEY idx_dispositivos_ubicacion (usuario_id, ubicacion_id),
  KEY idx_dispositivos_alimento (usuario_id, alimento_id),
  KEY idx_dispositivos_estado (usuario_id, estado),
  CONSTRAINT fk_dispositivos_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE RESTRICT,
  CONSTRAINT fk_dispositivos_ubicacion FOREIGN KEY (usuario_id, ubicacion_id)
    REFERENCES ubicaciones_almacenamiento (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_dispositivos_alimento FOREIGN KEY (usuario_id, alimento_id)
    REFERENCES alimentos (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_dispositivos_factor CHECK (factor_conversion > 0)
) ENGINE=InnoDB;

-- Historial de lecturas de sensores (puede crecer mucho: se conserva para predicciones).
-- aplicada_inventario = TRUE cuando el backend ya la usó para actualizar existencias.
CREATE TABLE lecturas_sensor (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id          BIGINT UNSIGNED NOT NULL,
  dispositivo_id      BIGINT UNSIGNED NOT NULL,
  tipo_lectura        ENUM('peso','temperatura','humedad','nivel','otro') NOT NULL,
  valor               DECIMAL(14,4)   NOT NULL,
  unidad              VARCHAR(20)     NOT NULL,       -- g, kg, C, %, etc.
  leido_en            DATETIME(3)     NOT NULL,       -- momento de la medición
  recibido_en         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  aplicada_inventario BOOLEAN         NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lecturas_usuario_id (usuario_id, id),
  KEY idx_lecturas_dispositivo_fecha (usuario_id, dispositivo_id, leido_en),
  KEY idx_lecturas_pendientes (aplicada_inventario, recibido_en),
  CONSTRAINT fk_lecturas_dispositivo FOREIGN KEY (usuario_id, dispositivo_id)
    REFERENCES dispositivos_iot (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_lecturas_peso CHECK (tipo_lectura <> 'peso' OR valor >= 0)
) ENGINE=InnoDB;

-- Historial de movimientos de inventario (entradas, consumos, ajustes, desechos).
-- cantidad_delta con signo: entrada > 0, consumo/desecho < 0, ajuste <> 0.
-- Es la base del historial de consumo para predicciones (HU-06).
CREATE TABLE movimientos_inventario (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id     BIGINT UNSIGNED NOT NULL,
  alimento_id    BIGINT UNSIGNED NOT NULL,
  lote_id        BIGINT UNSIGNED NULL,
  tipo           ENUM('entrada','consumo','ajuste','desecho') NOT NULL,
  cantidad_delta DECIMAL(12,3)   NOT NULL,
  origen         ENUM('manual','sensor','compra','identificacion_ia') NOT NULL DEFAULT 'manual',
  lectura_id     BIGINT UNSIGNED NULL,   -- lectura IoT que originó el movimiento
  registrado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notas          VARCHAR(255)    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_movimientos_usuario_id (usuario_id, id),
  KEY idx_mov_alimento_fecha (usuario_id, alimento_id, registrado_en),
  KEY idx_mov_lote (usuario_id, lote_id),
  KEY idx_mov_usuario_fecha (usuario_id, registrado_en),
  KEY idx_mov_lectura (lectura_id),
  CONSTRAINT fk_mov_alimento FOREIGN KEY (usuario_id, alimento_id)
    REFERENCES alimentos (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_mov_lote FOREIGN KEY (usuario_id, lote_id)
    REFERENCES lotes_alimento (usuario_id, id) ON DELETE RESTRICT,
  -- Si una lectura antigua se purga, el movimiento se conserva.
  CONSTRAINT fk_mov_lectura FOREIGN KEY (lectura_id)
    REFERENCES lecturas_sensor (id) ON DELETE SET NULL,
  CONSTRAINT chk_mov_delta CHECK (
       (tipo = 'entrada' AND cantidad_delta > 0)
    OR (tipo IN ('consumo','desecho') AND cantidad_delta < 0)
    OR (tipo = 'ajuste' AND cantidad_delta <> 0)
  )
) ENGINE=InnoDB;

-- =====================================================================
-- 4. IA (PROVISIONAL): PREDICCIONES, RECOMENDACIONES, IDENTIFICACIÓN
--    (HU-05, HU-06, HU-10). Los campos del modelo son OPCIONALES porque
--    todavía no se ha elegido ningún modelo.
-- =====================================================================

-- Predicciones de consumo/agotamiento (HU-06).
CREATE TABLE predicciones_consumo (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id                BIGINT UNSIGNED NOT NULL,
  alimento_id               BIGINT UNSIGNED NOT NULL,
  calculada_en              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumo_promedio_diario   DECIMAL(12,4)   NULL,
  fecha_agotamiento_estimada DATE           NULL,
  confianza                 DECIMAL(5,4)    NULL,   -- 0 a 1
  ventana_dias              SMALLINT UNSIGNED NULL, -- días de historial usados
  metodo                    VARCHAR(100)    NULL,   -- nombre libre del método/modelo
  detalle                   JSON            NULL,   -- datos extra opcionales del modelo
  PRIMARY KEY (id),
  KEY idx_pred_alimento (usuario_id, alimento_id, calculada_en),
  CONSTRAINT fk_pred_alimento FOREIGN KEY (usuario_id, alimento_id)
    REFERENCES alimentos (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_pred_consumo CHECK (consumo_promedio_diario IS NULL
                                     OR consumo_promedio_diario >= 0),
  CONSTRAINT chk_pred_confianza CHECK (confianza IS NULL OR confianza BETWEEN 0 AND 1)
) ENGINE=InnoDB;

-- Recomendaciones de "qué consumir primero" (HU-05). prioridad 1 = más urgente.
CREATE TABLE recomendaciones_consumo (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id    BIGINT UNSIGNED NOT NULL,
  alimento_id   BIGINT UNSIGNED NOT NULL,
  lote_id       BIGINT UNSIGNED NULL,
  prioridad     TINYINT UNSIGNED NOT NULL DEFAULT 3,
  motivo        VARCHAR(255)    NULL,
  estado        ENUM('pendiente','vista','aceptada','descartada') NOT NULL DEFAULT 'pendiente',
  generada_en   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vigente_hasta DATETIME        NULL,
  metodo        VARCHAR(100)    NULL,
  detalle       JSON            NULL,
  PRIMARY KEY (id),
  KEY idx_reco_usuario_estado (usuario_id, estado, prioridad),
  KEY idx_reco_alimento (usuario_id, alimento_id),
  KEY idx_reco_lote (usuario_id, lote_id),
  CONSTRAINT fk_reco_alimento FOREIGN KEY (usuario_id, alimento_id)
    REFERENCES alimentos (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_reco_lote FOREIGN KEY (usuario_id, lote_id)
    REFERENCES lotes_alimento (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_reco_prioridad CHECK (prioridad BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- Identificación de alimentos por cámara (HU-10).
-- El inventario solo se modifica cuando el usuario confirma o corrige:
-- hasta entonces estado = 'pendiente' y movimiento_id = NULL.
CREATE TABLE identificaciones_ia (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id              BIGINT UNSIGNED NOT NULL,
  dispositivo_id          BIGINT UNSIGNED NULL,      -- cámara, si aplica
  referencia_imagen       VARCHAR(255)    NULL,      -- almacenamiento aún no definido
  resultado_texto         VARCHAR(255)    NULL,      -- lo que "vio" la IA (texto libre)
  confianza               DECIMAL(5,4)    NULL,
  alimento_sugerido_id    BIGINT UNSIGNED NULL,
  cantidad_sugerida       DECIMAL(12,3)   NULL,
  estado                  ENUM('pendiente','confirmada','corregida','rechazada')
                                          NOT NULL DEFAULT 'pendiente',
  alimento_confirmado_id  BIGINT UNSIGNED NULL,
  cantidad_confirmada     DECIMAL(12,3)   NULL,
  confirmada_en           DATETIME        NULL,
  movimiento_id           BIGINT UNSIGNED NULL,      -- movimiento generado al confirmar
  identificado_en         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detalle                 JSON            NULL,
  PRIMARY KEY (id),
  KEY idx_ident_usuario_estado (usuario_id, estado, identificado_en),
  KEY idx_ident_dispositivo (usuario_id, dispositivo_id),
  KEY idx_ident_sugerido (usuario_id, alimento_sugerido_id),
  KEY idx_ident_confirmado (usuario_id, alimento_confirmado_id),
  KEY idx_ident_movimiento (movimiento_id),
  CONSTRAINT fk_ident_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ident_dispositivo FOREIGN KEY (usuario_id, dispositivo_id)
    REFERENCES dispositivos_iot (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ident_sugerido FOREIGN KEY (usuario_id, alimento_sugerido_id)
    REFERENCES alimentos (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ident_confirmado FOREIGN KEY (usuario_id, alimento_confirmado_id)
    REFERENCES alimentos (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ident_movimiento FOREIGN KEY (movimiento_id)
    REFERENCES movimientos_inventario (id) ON DELETE SET NULL,
  CONSTRAINT chk_ident_confianza CHECK (confianza IS NULL OR confianza BETWEEN 0 AND 1),
  CONSTRAINT chk_ident_cant_sug CHECK (cantidad_sugerida IS NULL OR cantidad_sugerida >= 0),
  CONSTRAINT chk_ident_cant_conf CHECK (cantidad_confirmada IS NULL OR cantidad_confirmada >= 0),
  CONSTRAINT chk_ident_confirmacion CHECK (estado IN ('pendiente','rechazada')
                                           OR confirmada_en IS NOT NULL)
) ENGINE=InnoDB;

-- =====================================================================
-- 5. LISTAS DE COMPRAS (HU-07)
-- =====================================================================

CREATE TABLE listas_compras (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id              BIGINT UNSIGNED NOT NULL,
  nombre                  VARCHAR(120)    NOT NULL,
  estado                  ENUM('borrador','activa','completada','cancelada')
                                          NOT NULL DEFAULT 'activa',
  generada_automaticamente BOOLEAN        NOT NULL DEFAULT FALSE,
  creada_en               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completada_en           DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_listas_usuario_id (usuario_id, id),
  KEY idx_listas_estado (usuario_id, estado),
  CONSTRAINT fk_listas_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Partidas de la lista. Siempre apuntan a un alimento (si es un producto nuevo,
-- primero se da de alta en alimentos, aunque no tenga lotes). Al marcar
-- "comprado", el backend crea un lote + movimiento de entrada y guarda su id.
CREATE TABLE lista_compras_items (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id        BIGINT UNSIGNED NOT NULL,
  lista_id          BIGINT UNSIGNED NOT NULL,
  alimento_id       BIGINT UNSIGNED NOT NULL,
  cantidad_sugerida DECIMAL(12,3)   NOT NULL,
  motivo            ENUM('agotado','existencia_baja','proximo_caducar','caducado','manual')
                                    NOT NULL DEFAULT 'manual',
  comprado          BOOLEAN         NOT NULL DEFAULT FALSE,
  comprado_en       DATETIME        NULL,
  movimiento_id     BIGINT UNSIGNED NULL,
  notas             VARCHAR(255)    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_items_lista_alimento (lista_id, alimento_id),
  KEY idx_items_lista (usuario_id, lista_id),
  KEY idx_items_alimento (usuario_id, alimento_id),
  KEY idx_items_movimiento (movimiento_id),
  CONSTRAINT fk_items_lista FOREIGN KEY (usuario_id, lista_id)
    REFERENCES listas_compras (usuario_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_items_alimento FOREIGN KEY (usuario_id, alimento_id)
    REFERENCES alimentos (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_items_movimiento FOREIGN KEY (movimiento_id)
    REFERENCES movimientos_inventario (id) ON DELETE SET NULL,
  CONSTRAINT chk_items_cantidad CHECK (cantidad_sugerida > 0),
  CONSTRAINT chk_items_comprado CHECK (comprado = FALSE OR comprado_en IS NOT NULL)
) ENGINE=InnoDB;

-- =====================================================================
-- 6. RECETAS (HU-08)
-- =====================================================================

CREATE TABLE recetas (
  id                  BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  usuario_id          BIGINT UNSIGNED   NOT NULL,
  nombre              VARCHAR(150)      NOT NULL,
  descripcion         VARCHAR(500)      NULL,
  instrucciones       TEXT              NULL,
  porciones           SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  tiempo_preparacion_min SMALLINT UNSIGNED NULL,
  creada_en           DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recetas_usuario_id (usuario_id, id),
  UNIQUE KEY uq_recetas_usuario_nombre (usuario_id, nombre),
  CONSTRAINT fk_recetas_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE RESTRICT,
  CONSTRAINT chk_recetas_porciones CHECK (porciones > 0)
) ENGINE=InnoDB;

-- Ingredientes: cada uno referencia un alimento del usuario; la cantidad se
-- expresa en la unidad de ese alimento (sin conversiones en esta versión).
CREATE TABLE receta_ingredientes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id  BIGINT UNSIGNED NOT NULL,
  receta_id   BIGINT UNSIGNED NOT NULL,
  alimento_id BIGINT UNSIGNED NOT NULL,
  cantidad    DECIMAL(12,3)   NOT NULL,
  opcional    BOOLEAN         NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ingredientes_receta_alimento (receta_id, alimento_id),
  KEY idx_ingredientes_receta (usuario_id, receta_id),
  KEY idx_ingredientes_alimento (usuario_id, alimento_id),
  CONSTRAINT fk_ingredientes_receta FOREIGN KEY (usuario_id, receta_id)
    REFERENCES recetas (usuario_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_ingredientes_alimento FOREIGN KEY (usuario_id, alimento_id)
    REFERENCES alimentos (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ingredientes_cantidad CHECK (cantidad > 0)
) ENGINE=InnoDB;

-- =====================================================================
-- 7. NOTIFICACIONES (HU-04, HU-02, HU-09)
-- =====================================================================

CREATE TABLE notificaciones (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id  BIGINT UNSIGNED NOT NULL,
  tipo        ENUM('caducidad_proxima','caducado','existencia_baja',
                   'agotamiento_predicho','recomendacion','sistema') NOT NULL,
  titulo      VARCHAR(150)    NOT NULL,
  mensaje     VARCHAR(500)    NULL,
  alimento_id BIGINT UNSIGNED NULL,
  lote_id     BIGINT UNSIGNED NULL,
  leida       BOOLEAN         NOT NULL DEFAULT FALSE,
  creada_en   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  leida_en    DATETIME        NULL,
  PRIMARY KEY (id),
  KEY idx_notif_usuario (usuario_id, leida, creada_en),
  KEY idx_notif_alimento (usuario_id, alimento_id),
  KEY idx_notif_lote (usuario_id, lote_id),
  CONSTRAINT fk_notif_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE RESTRICT,
  CONSTRAINT fk_notif_alimento FOREIGN KEY (usuario_id, alimento_id)
    REFERENCES alimentos (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_notif_lote FOREIGN KEY (usuario_id, lote_id)
    REFERENCES lotes_alimento (usuario_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_notif_leida CHECK (leida = FALSE OR leida_en IS NOT NULL)
) ENGINE=InnoDB;

-- =====================================================================
-- 8. VISTAS (siempre se consultan filtrando por usuario_id)
-- =====================================================================

-- Inventario consolidado por alimento: cantidad total = suma de lotes disponibles.
-- Los lotes caducados siguen contando hasta que se descartan (estado = 'descartado').
CREATE OR REPLACE VIEW vista_inventario_alimentos AS
SELECT
  a.usuario_id,
  a.id                              AS alimento_id,
  a.nombre,
  c.nombre                          AS categoria,
  u.nombre                          AS ubicacion,
  um.codigo                         AS unidad,
  COALESCE(SUM(l.cantidad_actual), 0) AS cantidad_total,
  a.stock_minimo,
  CASE
    WHEN COALESCE(SUM(l.cantidad_actual), 0) = 0              THEN 'agotado'
    WHEN COALESCE(SUM(l.cantidad_actual), 0) <= a.stock_minimo THEN 'bajo'
    ELSE 'suficiente'
  END                               AS estado_stock,
  MIN(l.fecha_caducidad)            AS proxima_caducidad
FROM alimentos a
JOIN unidades_medida um ON um.id = a.unidad_id
LEFT JOIN categorias_alimento c
       ON c.usuario_id = a.usuario_id AND c.id = a.categoria_id
LEFT JOIN ubicaciones_almacenamiento u
       ON u.usuario_id = a.usuario_id AND u.id = a.ubicacion_id
LEFT JOIN lotes_alimento l
       ON l.usuario_id = a.usuario_id AND l.alimento_id = a.id
      AND l.estado = 'disponible'
WHERE a.activo = TRUE
GROUP BY a.usuario_id, a.id, a.nombre, c.nombre, u.nombre, um.codigo, a.stock_minimo;

-- Estado de caducidad de cada lote con existencias. Días de aviso efectivos:
-- lote -> categoría -> preferencia del usuario -> 3 días por defecto.
CREATE OR REPLACE VIEW vista_lotes_caducidad AS
SELECT
  l.usuario_id,
  l.id                      AS lote_id,
  a.id                      AS alimento_id,
  a.nombre                  AS alimento,
  c.perecibilidad,
  l.cantidad_actual,
  um.codigo                 AS unidad,
  l.fecha_caducidad,
  DATEDIFF(l.fecha_caducidad, CURDATE()) AS dias_restantes,
  COALESCE(l.dias_aviso_caducidad, c.dias_aviso_caducidad,
           p.dias_anticipacion_caducidad, 3) AS dias_aviso,
  CASE
    WHEN l.fecha_caducidad < CURDATE() THEN 'caducado'
    WHEN DATEDIFF(l.fecha_caducidad, CURDATE()) <=
         COALESCE(l.dias_aviso_caducidad, c.dias_aviso_caducidad,
                  p.dias_anticipacion_caducidad, 3) THEN 'proximo'
    ELSE 'vigente'
  END                       AS estado_caducidad
FROM lotes_alimento l
JOIN alimentos a ON a.usuario_id = l.usuario_id AND a.id = l.alimento_id
JOIN unidades_medida um ON um.id = a.unidad_id
LEFT JOIN categorias_alimento c
       ON c.usuario_id = a.usuario_id AND c.id = a.categoria_id
LEFT JOIN preferencias_usuario p ON p.usuario_id = l.usuario_id
WHERE l.estado = 'disponible'
  AND l.cantidad_actual > 0
  AND l.fecha_caducidad IS NOT NULL;

-- =====================================================================
-- 9. DATOS DE PRUEBA (fechas relativas a CURDATE() para que siempre sirvan)
-- =====================================================================
-- Los hashes son marcadores de ejemplo, NO son hashes reales.

INSERT INTO usuarios (id, nombre, correo, contrasena_hash) VALUES
 (1, 'Ana Torres',   'ana.torres@example.com',   '$2b$12$EJEMPLO_DE_HASH_SOLO_PARA_PRUEBAS_ana_0000000000000000'),
 (2, 'Luis Ramírez', 'luis.ramirez@example.com', '$2b$12$EJEMPLO_DE_HASH_SOLO_PARA_PRUEBAS_luis_000000000000000');

INSERT INTO sesiones_autenticacion (usuario_id, token_hash, descripcion_cliente, expira_en) VALUES
 (1, SHA2('token_demo_ana', 256),  'Navegador de escritorio', NOW() + INTERVAL 7 DAY),
 (2, SHA2('token_demo_luis', 256), 'Celular',                 NOW() + INTERVAL 7 DAY);

INSERT INTO preferencias_usuario (usuario_id, dias_anticipacion_caducidad) VALUES
 (1, 3),
 (2, 5);

INSERT INTO tablero_widgets (usuario_id, tipo_widget, visible, orden) VALUES
 (1, 'resumen_inventario', TRUE, 1),
 (1, 'proximos_caducar',   TRUE, 2),
 (1, 'existencias_bajas',  TRUE, 3),
 (1, 'recomendaciones',    TRUE, 4),
 (1, 'lista_compras',      TRUE, 5),
 (2, 'resumen_inventario', TRUE, 1),
 (2, 'proximos_caducar',   TRUE, 2),
 (2, 'existencias_bajas',  TRUE, 3),
 (2, 'predicciones',       FALSE, 4);

INSERT INTO unidades_medida (id, codigo, nombre, tipo) VALUES
 (1, 'kg',  'Kilogramo', 'masa'),
 (2, 'g',   'Gramo',     'masa'),
 (3, 'l',   'Litro',     'volumen'),
 (4, 'ml',  'Mililitro', 'volumen'),
 (5, 'pza', 'Pieza',     'conteo'),
 (6, 'paq', 'Paquete',   'conteo');

INSERT INTO categorias_alimento (id, usuario_id, nombre, perecibilidad, dias_aviso_caducidad) VALUES
 (1, 1, 'Lácteos y huevos',   'alta',  3),
 (2, 1, 'Frutas y verduras',  'alta',  4),
 (3, 1, 'Carnes',             'alta',  2),
 (4, 1, 'Granos y despensa',  'baja',  15),
 (5, 2, 'Lácteos',            'alta',  NULL),
 (6, 2, 'Bebidas',            'baja',  NULL),
 (7, 2, 'Frutas y verduras',  'alta',  NULL),
 (8, 2, 'Granos y cereales',  'baja',  30);

INSERT INTO ubicaciones_almacenamiento (id, usuario_id, nombre, tipo) VALUES
 (1, 1, 'Refrigerador', 'refrigerador'),
 (2, 1, 'Congelador',   'congelador'),
 (3, 1, 'Despensa',     'despensa'),
 (4, 2, 'Refrigerador', 'refrigerador'),
 (5, 2, 'Despensa',     'despensa');

INSERT INTO alimentos (id, usuario_id, categoria_id, ubicacion_id, unidad_id, nombre, stock_minimo) VALUES
 -- Ana
 (1,  1, 1, 1, 3, 'Leche entera',       1.000),
 (2,  1, 1, 1, 5, 'Huevos',             6.000),
 (3,  1, 2, 1, 1, 'Jitomate',           0.500),
 (4,  1, 3, 2, 1, 'Pechuga de pollo',   0.500),
 (5,  1, 4, 3, 1, 'Arroz',              1.000),
 (6,  1, 4, 3, 1, 'Frijol negro',       1.000),
 (7,  1, 2, 3, 1, 'Cebolla',            0.500),
 -- Luis
 (8,  2, 5, 4, 3, 'Leche deslactosada', 2.000),
 (9,  2, 7, 4, 1, 'Manzana',            1.000),
 (10, 2, 6, 5, 3, 'Agua embotellada',   4.000),
 (11, 2, 8, 5, 1, 'Avena',              0.500),
 (12, 2, 5, 4, 5, 'Yogur natural',      4.000);

INSERT INTO lotes_alimento
 (id, usuario_id, alimento_id, cantidad_inicial, cantidad_actual, fecha_ingreso, fecha_caducidad, estado, origen) VALUES
 -- Ana
 (1,  1, 1, 2.000,  1.500, CURDATE() - INTERVAL 3 DAY,  CURDATE() + INTERVAL 2 DAY,   'disponible', 'manual'),
 (2,  1, 1, 1.000,  1.000, CURDATE() - INTERVAL 1 DAY,  CURDATE() + INTERVAL 9 DAY,   'disponible', 'compra'),
 (3,  1, 2, 12.000, 4.000, CURDATE() - INTERVAL 10 DAY, CURDATE() + INTERVAL 11 DAY,  'disponible', 'manual'),
 (4,  1, 3, 1.000,  0.300, CURDATE() - INTERVAL 5 DAY,  CURDATE() + INTERVAL 1 DAY,   'disponible', 'identificacion_ia'),
 (5,  1, 4, 1.000,  0.400, CURDATE() - INTERVAL 9 DAY,  CURDATE() - INTERVAL 1 DAY,   'disponible', 'manual'),   -- caducado
 (6,  1, 4, 1.000,  1.000, CURDATE() - INTERVAL 1 DAY,  CURDATE() + INTERVAL 20 DAY,  'disponible', 'compra'),
 (7,  1, 5, 1.000,  0.800, CURDATE() - INTERVAL 30 DAY, CURDATE() + INTERVAL 180 DAY, 'disponible', 'compra'),
 (8,  1, 6, 2.000,  2.000, CURDATE() - INTERVAL 20 DAY, CURDATE() + INTERVAL 300 DAY, 'disponible', 'compra'),
 (9,  1, 7, 1.000,  0.800, CURDATE() - INTERVAL 6 DAY,  CURDATE() + INTERVAL 14 DAY,  'disponible', 'manual'),
 -- Luis
 (10, 2, 8, 3.000,  2.500, CURDATE() - INTERVAL 2 DAY,  CURDATE() + INTERVAL 5 DAY,   'disponible', 'compra'),
 (11, 2, 9, 2.000,  0.800, CURDATE() - INTERVAL 8 DAY,  CURDATE() + INTERVAL 4 DAY,   'disponible', 'identificacion_ia'),
 (12, 2, 10, 12.000, 3.000, CURDATE() - INTERVAL 20 DAY, NULL,                         'disponible', 'compra'),   -- no caduca
 (13, 2, 11, 1.000, 0.900, CURDATE() - INTERVAL 15 DAY, CURDATE() + INTERVAL 150 DAY, 'disponible', 'compra'),
 (14, 2, 12, 6.000, 2.000, CURDATE() - INTERVAL 5 DAY,  CURDATE() + INTERVAL 3 DAY,   'disponible', 'compra'),
 (15, 2, 10, 12.000, 12.000, CURDATE(),                  NULL,                         'disponible', 'compra');   -- compra desde lista

INSERT INTO dispositivos_iot
 (id, usuario_id, identificador_dispositivo, nombre, tipo, ubicacion_id, alimento_id, token_hash, factor_conversion, ultima_conexion) VALUES
 (1, 1, 'ARK-SCALE-0001', 'Báscula de leche',        'bascula',            1, 1,    SHA2('disp_token_1', 256), 0.001000, NOW() - INTERVAL 5 MINUTE),
 (2, 1, 'ARK-TEMP-0001',  'Sensor temp. refri',      'sensor_temperatura', 1, NULL, SHA2('disp_token_2', 256), 1.000000, NOW() - INTERVAL 1 HOUR),
 (3, 2, 'ARK-SCALE-0002', 'Báscula de manzanas',     'bascula',            4, 9,    SHA2('disp_token_3', 256), 0.001000, NOW() - INTERVAL 1 DAY),
 (4, 1, 'ARK-CAM-0001',   'Cámara del refrigerador', 'camara',             1, NULL, SHA2('disp_token_4', 256), 1.000000, NOW() - INTERVAL 1 DAY);

INSERT INTO lecturas_sensor
 (id, usuario_id, dispositivo_id, tipo_lectura, valor, unidad, leido_en, aplicada_inventario) VALUES
 (1, 1, 1, 'peso',        2000.0000, 'g', NOW() - INTERVAL 3 DAY,    TRUE),
 (2, 1, 1, 'peso',        1800.0000, 'g', NOW() - INTERVAL 2 DAY,    TRUE),
 (3, 1, 1, 'peso',        1500.0000, 'g', NOW() - INTERVAL 1 DAY,    TRUE),
 (4, 1, 2, 'temperatura', 4.2000,    'C', NOW() - INTERVAL 2 HOUR,   FALSE),
 (5, 1, 2, 'temperatura', 4.5000,    'C', NOW() - INTERVAL 1 HOUR,   FALSE),
 (6, 2, 3, 'peso',        2000.0000, 'g', NOW() - INTERVAL 8 DAY,    TRUE),
 (7, 2, 3, 'peso',        1400.0000, 'g', NOW() - INTERVAL 4 DAY,    TRUE),
 (8, 2, 3, 'peso',        800.0000,  'g', NOW() - INTERVAL 1 DAY,    TRUE),
 (9, 1, 1, 'peso',        1480.0000, 'g', NOW() - INTERVAL 5 MINUTE, FALSE);  -- pendiente de aplicar

INSERT INTO movimientos_inventario
 (id, usuario_id, alimento_id, lote_id, tipo, cantidad_delta, origen, lectura_id, registrado_en) VALUES
 -- Ana
 (1,  1, 1, 1, 'entrada',  2.000, 'manual',            NULL, NOW() - INTERVAL 3 DAY),
 (2,  1, 1, 1, 'consumo', -0.200, 'sensor',            2,    NOW() - INTERVAL 2 DAY),
 (3,  1, 1, 1, 'consumo', -0.300, 'sensor',            3,    NOW() - INTERVAL 1 DAY),
 (4,  1, 2, 3, 'entrada', 12.000, 'manual',            NULL, NOW() - INTERVAL 10 DAY),
 (5,  1, 2, 3, 'consumo', -3.000, 'manual',            NULL, NOW() - INTERVAL 7 DAY),
 (6,  1, 2, 3, 'consumo', -3.000, 'manual',            NULL, NOW() - INTERVAL 4 DAY),
 (7,  1, 2, 3, 'consumo', -2.000, 'manual',            NULL, NOW() - INTERVAL 1 DAY),
 (8,  1, 3, 4, 'entrada',  1.000, 'identificacion_ia', NULL, NOW() - INTERVAL 5 DAY),
 (9,  1, 3, 4, 'consumo', -0.700, 'manual',            NULL, NOW() - INTERVAL 2 DAY),
 (10, 1, 4, 5, 'entrada',  1.000, 'manual',            NULL, NOW() - INTERVAL 9 DAY),
 (11, 1, 4, 5, 'consumo', -0.600, 'manual',            NULL, NOW() - INTERVAL 3 DAY),
 (12, 1, 5, 7, 'entrada',  1.000, 'compra',            NULL, NOW() - INTERVAL 30 DAY),
 (13, 1, 5, 7, 'consumo', -0.200, 'manual',            NULL, NOW() - INTERVAL 10 DAY),
 -- Luis
 (14, 2, 9,  11, 'entrada',  2.000, 'identificacion_ia', NULL, NOW() - INTERVAL 8 DAY),
 (15, 2, 9,  11, 'consumo', -0.600, 'sensor',            7,    NOW() - INTERVAL 4 DAY),
 (16, 2, 9,  11, 'consumo', -0.600, 'sensor',            8,    NOW() - INTERVAL 1 DAY),
 (17, 2, 12, 14, 'entrada',  6.000, 'manual',            NULL, NOW() - INTERVAL 5 DAY),
 (18, 2, 12, 14, 'consumo', -2.000, 'manual',            NULL, NOW() - INTERVAL 3 DAY),
 (19, 2, 12, 14, 'consumo', -2.000, 'manual',            NULL, NOW() - INTERVAL 1 DAY),
 (20, 2, 10, 12, 'entrada', 12.000, 'compra',            NULL, NOW() - INTERVAL 20 DAY),
 (21, 2, 10, 12, 'consumo', -9.000, 'manual',            NULL, NOW() - INTERVAL 2 DAY),
 (22, 2, 8,  10, 'entrada',  3.000, 'compra',            NULL, NOW() - INTERVAL 2 DAY),
 (23, 2, 8,  10, 'consumo', -0.500, 'manual',            NULL, NOW() - INTERVAL 1 DAY),
 (24, 2, 10, 15, 'entrada', 12.000, 'compra',            NULL, NOW());

INSERT INTO predicciones_consumo
 (id, usuario_id, alimento_id, consumo_promedio_diario, fecha_agotamiento_estimada, confianza, ventana_dias, metodo, detalle) VALUES
 (1, 1, 1, 0.2500, CURDATE() + INTERVAL 10 DAY, 0.6500, 7, 'promedio_simple_provisional', NULL),
 (2, 1, 2, 0.8000, CURDATE() + INTERVAL 5 DAY,  0.7000, 10, 'promedio_simple_provisional', JSON_OBJECT('nota', 'ejemplo de prueba')),
 (3, 2, 9, 0.1500, CURDATE() + INTERVAL 5 DAY,  0.6000, 8, 'promedio_simple_provisional', NULL);

INSERT INTO recomendaciones_consumo
 (id, usuario_id, alimento_id, lote_id, prioridad, motivo, metodo) VALUES
 (1, 1, 3,  4,  1, 'Caduca mañana y quedan 0.3 kg',               'reglas_caducidad_provisional'),
 (2, 1, 1,  1,  2, 'Caduca en 2 días',                            'reglas_caducidad_provisional'),
 (3, 2, 12, 14, 1, 'Caduca en 3 días y quedan pocas unidades',    'reglas_caducidad_provisional'),
 (4, 2, 9,  11, 2, 'Caduca en 4 días',                            'reglas_caducidad_provisional');

INSERT INTO listas_compras (id, usuario_id, nombre, estado, generada_automaticamente) VALUES
 (1, 1, 'Compras de la semana', 'activa', TRUE),
 (2, 2, 'Súper del fin de semana', 'activa', FALSE);

INSERT INTO lista_compras_items
 (id, usuario_id, lista_id, alimento_id, cantidad_sugerida, motivo, comprado, comprado_en, movimiento_id) VALUES
 (1, 1, 1, 2,  12.000, 'existencia_baja', FALSE, NULL,  NULL),
 (2, 1, 1, 5,  1.000,  'existencia_baja', FALSE, NULL,  NULL),
 (3, 2, 2, 12, 6.000,  'existencia_baja', FALSE, NULL,  NULL),
 (4, 2, 2, 9,  2.000,  'existencia_baja', FALSE, NULL,  NULL),
 (5, 2, 2, 10, 12.000, 'existencia_baja', TRUE,  NOW(), 24);   -- ya comprado: generó lote 15 y movimiento 24

INSERT INTO recetas (id, usuario_id, nombre, descripcion, porciones, tiempo_preparacion_min) VALUES
 (1, 1, 'Huevos a la mexicana', 'Huevos revueltos con jitomate y cebolla', 2, 15),
 (2, 1, 'Arroz con pollo',      'Arroz con pollo y verduras',               4, 45),
 (3, 2, 'Avena con manzana',    'Desayuno rápido con avena y leche',        1, 10);

INSERT INTO receta_ingredientes (id, usuario_id, receta_id, alimento_id, cantidad, opcional) VALUES
 (1, 1, 1, 2, 6.000, FALSE),
 (2, 1, 1, 3, 0.400, FALSE),
 (3, 1, 1, 7, 0.100, FALSE),
 (4, 1, 2, 5, 0.500, FALSE),
 (5, 1, 2, 4, 0.600, FALSE),
 (6, 1, 2, 3, 0.200, FALSE),
 (7, 1, 2, 7, 0.150, TRUE),
 (8, 2, 3, 11, 0.050, FALSE),
 (9, 2, 3, 9,  0.150, FALSE),
 (10, 2, 3, 8, 0.250, FALSE);

INSERT INTO identificaciones_ia
 (id, usuario_id, dispositivo_id, referencia_imagen, resultado_texto, confianza,
  alimento_sugerido_id, cantidad_sugerida, estado,
  alimento_confirmado_id, cantidad_confirmada, confirmada_en, movimiento_id, identificado_en) VALUES
 (1, 1, 4,    'demo_captura_001', 'jitomate',       0.8700, 3, 1.000, 'confirmada', 3,    1.000, NOW() - INTERVAL 5 DAY, 8,    NOW() - INTERVAL 5 DAY),
 (2, 1, 4,    'demo_captura_002', 'cebolla morada', 0.5500, 7, 0.500, 'pendiente',  NULL, NULL,  NULL,                   NULL, NOW()),
 (3, 2, NULL, 'demo_captura_003', 'manzana verde',  0.7200, 9, 3.000, 'corregida',  9,    2.000, NOW() - INTERVAL 8 DAY, 14,   NOW() - INTERVAL 8 DAY);

INSERT INTO notificaciones
 (id, usuario_id, tipo, titulo, mensaje, alimento_id, lote_id, leida, leida_en) VALUES
 (1, 1, 'caducidad_proxima', 'Jitomate por caducar', 'El lote de jitomate caduca mañana.', 3, 4,    FALSE, NULL),
 (2, 1, 'caducado',          'Pollo caducado',       'Un lote de pollo ya caducó.',        4, 5,    FALSE, NULL),
 (3, 1, 'existencia_baja',   'Huevos bajos',         'Quedan 4 piezas.',                   2, NULL, TRUE,  NOW()),
 (4, 2, 'existencia_baja',   'Yogur bajo',           'Quedan 2 piezas.',                   12, NULL, FALSE, NULL);

-- =====================================================================
-- 10. CONSULTAS DE EJEMPLO
-- Cambia estas variables para probar con otro usuario/receta/dispositivo.
-- =====================================================================
SET @usuario_id = 1;
SET @busqueda   = NULL;               -- p. ej. 'leche' para buscar por nombre
SET @receta_id  = 1;
SET @dispositivo = 'ARK-SCALE-0001';

-- 10.1 Inventario del usuario (búsqueda opcional, orden por nombre) - HU-01/HU-02
SELECT alimento_id, nombre, categoria, ubicacion, cantidad_total, unidad,
       estado_stock, proxima_caducidad
FROM vista_inventario_alimentos
WHERE usuario_id = @usuario_id
  AND (@busqueda IS NULL OR nombre LIKE CONCAT('%', @busqueda, '%'))
ORDER BY nombre;

-- 10.2 Alimentos próximos a caducar o ya caducados - HU-04
SELECT alimento, lote_id, cantidad_actual, unidad, fecha_caducidad,
       dias_restantes, estado_caducidad
FROM vista_lotes_caducidad
WHERE usuario_id = @usuario_id
  AND estado_caducidad IN ('proximo', 'caducado')
ORDER BY fecha_caducidad;

-- 10.3 Existencias bajas o agotadas - HU-02
SELECT nombre, cantidad_total, unidad, stock_minimo, estado_stock
FROM vista_inventario_alimentos
WHERE usuario_id = @usuario_id
  AND estado_stock IN ('bajo', 'agotado')
ORDER BY nombre;

-- 10.4 Historial de lecturas de un sensor (últimos 7 días) - HU-03
SELECT d.nombre AS dispositivo, l.tipo_lectura, l.valor, l.unidad,
       l.leido_en, l.aplicada_inventario
FROM lecturas_sensor l
JOIN dispositivos_iot d
  ON d.usuario_id = l.usuario_id AND d.id = l.dispositivo_id
WHERE l.usuario_id = @usuario_id
  AND d.identificador_dispositivo = @dispositivo
  AND l.leido_en >= NOW() - INTERVAL 7 DAY
ORDER BY l.leido_en DESC
LIMIT 100;

-- 10.5a Productos de las listas de compras activas del usuario - HU-07
SELECT lc.nombre AS lista, a.nombre AS producto, i.cantidad_sugerida,
       um.codigo AS unidad, i.motivo, i.comprado
FROM listas_compras lc
JOIN lista_compras_items i ON i.usuario_id = lc.usuario_id AND i.lista_id = lc.id
JOIN alimentos a           ON a.usuario_id = i.usuario_id AND a.id = i.alimento_id
JOIN unidades_medida um    ON um.id = a.unidad_id
WHERE lc.usuario_id = @usuario_id AND lc.estado = 'activa'
ORDER BY lc.id, a.nombre;

-- 10.5b Candidatos a agregar a una lista (agotados, bajos o con lote caducado)
--       que todavía no están pendientes en una lista activa - HU-07
SELECT v.alimento_id, v.nombre, v.cantidad_total, v.unidad, v.stock_minimo,
       CASE
         WHEN v.cantidad_total = 0                 THEN 'agotado'
         WHEN v.cantidad_total <= v.stock_minimo   THEN 'existencia_baja'
         ELSE 'caducado'
       END AS motivo
FROM vista_inventario_alimentos v
WHERE v.usuario_id = @usuario_id
  AND (v.cantidad_total <= v.stock_minimo OR v.proxima_caducidad < CURDATE())
  AND NOT EXISTS (
        SELECT 1
        FROM lista_compras_items i
        JOIN listas_compras lc ON lc.usuario_id = i.usuario_id AND lc.id = i.lista_id
        WHERE i.usuario_id = v.usuario_id
          AND i.alimento_id = v.alimento_id
          AND i.comprado = FALSE
          AND lc.estado = 'activa')
ORDER BY v.nombre;

-- 10.6 Ingredientes faltantes de una receta - HU-08
SELECT a.nombre AS ingrediente,
       ri.cantidad                              AS cantidad_requerida,
       COALESCE(i.cantidad_total, 0)            AS cantidad_disponible,
       ri.cantidad - COALESCE(i.cantidad_total, 0) AS cantidad_faltante,
       um.codigo                                AS unidad
FROM receta_ingredientes ri
JOIN alimentos a        ON a.usuario_id = ri.usuario_id AND a.id = ri.alimento_id
JOIN unidades_medida um ON um.id = a.unidad_id
LEFT JOIN vista_inventario_alimentos i
       ON i.usuario_id = ri.usuario_id AND i.alimento_id = ri.alimento_id
WHERE ri.usuario_id = @usuario_id
  AND ri.receta_id = @receta_id
  AND ri.cantidad > COALESCE(i.cantidad_total, 0)
ORDER BY a.nombre;

-- 10.7 Qué consumir primero: caducidad más cercana y mayor perecibilidad - HU-05
SELECT alimento, cantidad_actual, unidad, fecha_caducidad, dias_restantes, perecibilidad
FROM vista_lotes_caducidad
WHERE usuario_id = @usuario_id
ORDER BY fecha_caducidad, FIELD(perecibilidad, 'alta', 'media', 'baja')
LIMIT 5;

-- 10.8 Resumen para el tablero - HU-09
SELECT
  (SELECT COUNT(*) FROM vista_inventario_alimentos
    WHERE usuario_id = @usuario_id AND cantidad_total > 0)             AS alimentos_con_existencia,
  (SELECT COUNT(*) FROM vista_lotes_caducidad
    WHERE usuario_id = @usuario_id AND estado_caducidad = 'proximo')   AS lotes_proximos_a_caducar,
  (SELECT COUNT(*) FROM vista_lotes_caducidad
    WHERE usuario_id = @usuario_id AND estado_caducidad = 'caducado')  AS lotes_caducados,
  (SELECT COUNT(*) FROM vista_inventario_alimentos
    WHERE usuario_id = @usuario_id AND estado_stock IN ('bajo','agotado')) AS existencias_bajas,
  (SELECT COUNT(*) FROM notificaciones
    WHERE usuario_id = @usuario_id AND leida = FALSE)                  AS notificaciones_sin_leer;