-- =====================================================================
--  QHDC! — ¿Qué Hay de Comer?  ·  ARK SYSTEMS
--  Base de datos completa para la versión actual de la aplicación
--  Motor: MySQL 8.0.16 o superior (usa CHECK, JSON, vistas y procedimientos)
-- =====================================================================
--  CÓMO EJECUTARLO
--   * MySQL Workbench: File > Open SQL Script > ejecutar todo (rayo).
--   * Terminal:  mysql -u root -p < qhdc_base_de_datos.sql
--   * phpMyAdmin: pestaña Importar.
--   El archivo usa DELIMITER para los procedimientos, por eso conviene
--   ejecutarlo con alguna de esas herramientas y no desde Node/Python.
--
--  CONVENCIONES
--   * Todo pertenece a un HOGAR (hogar_id). Varios usuarios comparten la
--     misma alacena con rol 'administrador' o 'miembro'.
--   * Las tablas hijas usan llaves foráneas COMPUESTAS (hogar_id, id) para
--     que un registro nunca se enlace con datos de otro hogar.
--   * La cantidad de un alimento NO se guarda en la tabla alimentos: es la
--     suma de sus lotes. Cada cambio queda en movimientos_inventario.
--   * Baja lógica (activo / estado) en lugar de borrar historial.
--   * Contraseñas y tokens se guardan como HASH, nunca en texto plano.
--   * Preferencias puramente visuales (tema, sonidos) también viven en el
--     navegador; aquí se guardan para sincronizarlas entre dispositivos.
--
--  CONTENIDO
--    1-9  Tablas (32): catálogos, usuarios y hogares, alacena, IoT,
--         recetas, movimientos, IA, lista del súper y avisos
--    10   Vistas (8): inventario, consumo, predicción, lista sugerida,
--         frescura, dispositivos, avisos por usuario y recetas
--    11   Procedimientos (6) y un trigger
--    12   Datos de ejemplo (idénticos a los de la app)
--    13   Consultas de ejemplo para el backend (comentadas)
-- =====================================================================

CREATE DATABASE IF NOT EXISTS qhdc
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;   -- _ai_ci: "limon" encuentra "Limón"

USE qhdc;

-- =====================================================================
-- 1. CATÁLOGOS GENERALES (compartidos por todos los hogares)
-- =====================================================================

-- Unidades que usa la app: g, kg, L, ml, pz, manojo
CREATE TABLE unidades_medida (
  id      SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo  VARCHAR(10)       NOT NULL,
  nombre  VARCHAR(50)       NOT NULL,
  tipo    ENUM('masa','volumen','conteo') NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_unidades_codigo (codigo)
) ENGINE=InnoDB;

-- Tipos de alimento. La perecibilidad ayuda a decidir qué consumir primero (HU-05).
CREATE TABLE categorias_alimento (
  id                   SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre               VARCHAR(80)       NOT NULL,
  perecibilidad        ENUM('alta','media','baja') NOT NULL DEFAULT 'media',
  dias_aviso_caducidad SMALLINT UNSIGNED NULL,          -- NULL = usar el del hogar
  icono                VARCHAR(40)       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categorias_nombre (nombre),
  CONSTRAINT chk_categorias_aviso CHECK (dias_aviso_caducidad IS NULL OR dias_aviso_caducidad <= 365)
) ENGINE=InnoDB;

-- Alimentos "conocidos": los que reconoce la cámara (HU-10) y los
-- alimentos frecuentes del formulario. Sirven de plantilla al registrar.
CREATE TABLE catalogo_alimentos (
  id                SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre            VARCHAR(120)      NOT NULL,
  categoria_id      SMALLINT UNSIGNED NOT NULL,
  unidad_id         SMALLINT UNSIGNED NOT NULL,
  icono             VARCHAR(40)       NOT NULL DEFAULT 'fa-box-open',
  color             ENUM('tomate','oliva','mostaza','cafe','petroleo') NOT NULL DEFAULT 'cafe',
  cantidad_tipica   DECIMAL(12,3)     NOT NULL,
  vida_util_dias    SMALLINT UNSIGNED NOT NULL,
  precio_estimado   DECIMAL(10,2)     NULL,
  ubicacion_sugerida ENUM('refrigerador','congelador','despensa','otro') NOT NULL DEFAULT 'refrigerador',
  reconocible_camara BOOLEAN          NOT NULL DEFAULT TRUE,
  sugerido_formulario BOOLEAN         NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalogo_nombre (nombre),
  CONSTRAINT fk_catalogo_categoria FOREIGN KEY (categoria_id) REFERENCES categorias_alimento (id),
  CONSTRAINT fk_catalogo_unidad    FOREIGN KEY (unidad_id)    REFERENCES unidades_medida (id),
  CONSTRAINT chk_catalogo_cantidad CHECK (cantidad_tipica > 0)
) ENGINE=InnoDB;

-- =====================================================================
-- 2. USUARIOS, HOGARES Y SESIONES (HU-09)
-- =====================================================================

CREATE TABLE usuarios (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre          VARCHAR(100)    NOT NULL,
  correo          VARCHAR(255)    NOT NULL,
  contrasena_hash VARCHAR(255)    NOT NULL,          -- bcrypt / argon2 generado por el backend
  activo          BOOLEAN         NOT NULL DEFAULT TRUE,
  ultimo_acceso   DATETIME        NULL,
  creado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_correo (correo),
  CONSTRAINT chk_usuarios_correo CHECK (correo LIKE '%_@_%._%'),
  CONSTRAINT chk_usuarios_hash   CHECK (CHAR_LENGTH(contrasena_hash) >= 20)
) ENGINE=InnoDB;

-- Un hogar = una cocina compartida ("Casa Contreras")
CREATE TABLE hogares (
  id                        BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  nombre                    VARCHAR(100)      NOT NULL,
  personas                  ENUM('1-2','3-4','5+') NOT NULL DEFAULT '3-4',
  zona_horaria              VARCHAR(64)       NOT NULL DEFAULT 'America/Mexico_City',
  dias_aviso_predeterminado SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  creado_por                BIGINT UNSIGNED   NULL,
  creado_en                 DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hogares_creador (creado_por),
  CONSTRAINT fk_hogares_creador FOREIGN KEY (creado_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT chk_hogares_aviso CHECK (dias_aviso_predeterminado <= 365)
) ENGINE=InnoDB;

-- Quién vive en cada hogar y con qué rol
CREATE TABLE hogar_miembros (
  hogar_id   BIGINT UNSIGNED NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  rol        ENUM('administrador','miembro') NOT NULL DEFAULT 'miembro',
  activo     BOOLEAN         NOT NULL DEFAULT TRUE,
  unido_en   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hogar_id, usuario_id),
  KEY idx_miembros_usuario (usuario_id),
  CONSTRAINT fk_miembros_hogar   FOREIGN KEY (hogar_id)   REFERENCES hogares (id),
  CONSTRAINT fk_miembros_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB;

-- Invitaciones para unir a la familia a un hogar
CREATE TABLE invitaciones_hogar (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id      BIGINT UNSIGNED NOT NULL,
  correo        VARCHAR(255)    NOT NULL,
  rol           ENUM('administrador','miembro') NOT NULL DEFAULT 'miembro',
  token_hash    CHAR(64)        NOT NULL,
  invitado_por  BIGINT UNSIGNED NULL,
  creada_en     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en     DATETIME        NOT NULL,
  aceptada_en   DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invitaciones_token (token_hash),
  KEY idx_invitaciones_hogar (hogar_id, correo),
  CONSTRAINT fk_invitaciones_hogar   FOREIGN KEY (hogar_id)     REFERENCES hogares (id),
  CONSTRAINT fk_invitaciones_usuario FOREIGN KEY (invitado_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT chk_invitaciones_expira CHECK (expira_en > creada_en)
) ENGINE=InnoDB;

-- Sesiones: se guarda el HASH del token. "recordar" = perfil guardado en ese
-- dispositivo (la pantalla de entrar muestra los perfiles para entrar con un toque).
CREATE TABLE sesiones_autenticacion (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id          BIGINT UNSIGNED NOT NULL,
  hogar_id            BIGINT UNSIGNED NOT NULL,      -- hogar activo en esa sesión
  token_hash          CHAR(64)        NOT NULL,
  descripcion_cliente VARCHAR(255)    NULL,           -- "Chrome en celular"
  recordar            BOOLEAN         NOT NULL DEFAULT FALSE,
  creado_en           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en           DATETIME        NOT NULL,
  revocado_en         DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sesiones_token (token_hash),
  KEY idx_sesiones_usuario (usuario_id, expira_en),
  CONSTRAINT fk_sesiones_miembro FOREIGN KEY (hogar_id, usuario_id)
    REFERENCES hogar_miembros (hogar_id, usuario_id) ON DELETE CASCADE,
  CONSTRAINT chk_sesiones_expira CHECK (expira_en > creado_en)
) ENGINE=InnoDB;

-- Preferencias de cada persona (menú de usuario)
CREATE TABLE preferencias_usuario (
  usuario_id                  BIGINT UNSIGNED NOT NULL,
  tema                        ENUM('sistema','claro','oscuro') NOT NULL DEFAULT 'sistema',
  sonidos                     BOOLEAN         NOT NULL DEFAULT TRUE,
  menu_compacto               BOOLEAN         NOT NULL DEFAULT FALSE,
  vista_alacena               ENUM('frascos','lista') NOT NULL DEFAULT 'frascos',
  notificar_caducidad         BOOLEAN         NOT NULL DEFAULT TRUE,
  notificar_existencias_bajas BOOLEAN         NOT NULL DEFAULT TRUE,
  notificar_dispositivos      BOOLEAN         NOT NULL DEFAULT TRUE,
  actualizado_en              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id),
  CONSTRAINT fk_preferencias_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Recorridos guiados que cada persona ya vio (uno por pantalla)
CREATE TABLE recorridos_vistos (
  usuario_id BIGINT UNSIGNED NOT NULL,
  pantalla   ENUM('dashboard','inventario','alertas','lista-compras','asistente',
                  'recetas','escanear','sensores') NOT NULL,
  completado BOOLEAN         NOT NULL DEFAULT FALSE,   -- FALSE = lo saltó
  visto_en   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, pantalla),
  CONSTRAINT fk_recorridos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- 3. ALACENA: UBICACIONES, ALIMENTOS Y LOTES (HU-01, HU-02, HU-04)
-- =====================================================================

-- Repisas de la alacena: refrigerador, despensa, congelador
CREATE TABLE ubicaciones_almacenamiento (
  id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id BIGINT UNSIGNED NOT NULL,
  nombre   VARCHAR(80)     NOT NULL,
  tipo     ENUM('refrigerador','congelador','despensa','otro') NOT NULL DEFAULT 'otro',
  orden    SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ubicaciones_hogar_id (hogar_id, id),
  UNIQUE KEY uq_ubicaciones_hogar_nombre (hogar_id, nombre),
  CONSTRAINT fk_ubicaciones_hogar FOREIGN KEY (hogar_id) REFERENCES hogares (id)
) ENGINE=InnoDB;

-- La "ficha" de cada alimento = un frasco en la app.
-- cantidad_llena = "Lleno es": con ella se calcula el nivel del frasco.
CREATE TABLE alimentos (
  id                   BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  hogar_id             BIGINT UNSIGNED   NOT NULL,
  categoria_id         SMALLINT UNSIGNED NULL,
  ubicacion_id         BIGINT UNSIGNED   NULL,
  unidad_id            SMALLINT UNSIGNED NOT NULL,
  catalogo_id          SMALLINT UNSIGNED NULL,          -- plantilla de la que salió, si aplica
  nombre               VARCHAR(120)      NOT NULL,
  icono                VARCHAR(40)       NOT NULL DEFAULT 'fa-box-open',   -- clase de Font Awesome
  color                ENUM('tomate','oliva','mostaza','cafe','petroleo') NOT NULL DEFAULT 'cafe',
  cantidad_llena       DECIMAL(12,3)     NOT NULL,
  porcentaje_minimo    TINYINT UNSIGNED  NOT NULL DEFAULT 30,  -- debajo de esto va a la lista del súper
  precio_estimado      DECIMAL(10,2)     NULL,
  vida_util_dias       SMALLINT UNSIGNED NULL,          -- para sugerir caducidad al volver a comprar
  dias_aviso_caducidad SMALLINT UNSIGNED NULL,          -- "Avísame X días antes"; NULL = categoría u hogar
  origen               ENUM('manual','sensor','camara') NOT NULL DEFAULT 'manual',
  activo               BOOLEAN           NOT NULL DEFAULT TRUE,
  creado_por           BIGINT UNSIGNED   NULL,
  creado_en            DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en       DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_alimentos_hogar_id (hogar_id, id),
  UNIQUE KEY uq_alimentos_hogar_nombre (hogar_id, nombre),
  KEY idx_alimentos_ubicacion (hogar_id, ubicacion_id),
  KEY idx_alimentos_activo (hogar_id, activo),
  KEY idx_alimentos_categoria (categoria_id),
  KEY idx_alimentos_unidad (unidad_id),
  KEY idx_alimentos_catalogo (catalogo_id),
  KEY idx_alimentos_creador (creado_por),
  CONSTRAINT fk_alimentos_hogar     FOREIGN KEY (hogar_id)     REFERENCES hogares (id),
  CONSTRAINT fk_alimentos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias_alimento (id),
  CONSTRAINT fk_alimentos_ubicacion FOREIGN KEY (hogar_id, ubicacion_id)
    REFERENCES ubicaciones_almacenamiento (hogar_id, id),
  CONSTRAINT fk_alimentos_unidad    FOREIGN KEY (unidad_id)    REFERENCES unidades_medida (id),
  CONSTRAINT fk_alimentos_catalogo  FOREIGN KEY (catalogo_id)  REFERENCES catalogo_alimentos (id),
  CONSTRAINT fk_alimentos_creador   FOREIGN KEY (creado_por)   REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT chk_alimentos_llena    CHECK (cantidad_llena > 0),
  CONSTRAINT chk_alimentos_minimo   CHECK (porcentaje_minimo <= 100),
  CONSTRAINT chk_alimentos_precio   CHECK (precio_estimado IS NULL OR precio_estimado >= 0),
  CONSTRAINT chk_alimentos_aviso    CHECK (dias_aviso_caducidad IS NULL OR dias_aviso_caducidad <= 365)
) ENGINE=InnoDB;

-- Lotes: el mismo alimento puede tener varias compras con distinta caducidad.
CREATE TABLE lotes_alimento (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id         BIGINT UNSIGNED NOT NULL,
  alimento_id      BIGINT UNSIGNED NOT NULL,
  cantidad_inicial DECIMAL(12,3)   NOT NULL,
  cantidad_actual  DECIMAL(12,3)   NOT NULL,
  fecha_ingreso    DATE            NOT NULL,
  fecha_caducidad  DATE            NULL,                 -- NULL = no caduca
  estado           ENUM('disponible','agotado','descartado') NOT NULL DEFAULT 'disponible',
  origen           ENUM('manual','compra','sensor','camara') NOT NULL DEFAULT 'manual',
  notas            VARCHAR(255)    NULL,
  creado_en        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lotes_hogar_id (hogar_id, id),
  KEY idx_lotes_alimento (hogar_id, alimento_id, estado),
  KEY idx_lotes_caducidad (hogar_id, fecha_caducidad),
  CONSTRAINT fk_lotes_alimento FOREIGN KEY (hogar_id, alimento_id) REFERENCES alimentos (hogar_id, id),
  CONSTRAINT chk_lotes_inicial CHECK (cantidad_inicial > 0),
  CONSTRAINT chk_lotes_actual  CHECK (cantidad_actual >= 0),
  CONSTRAINT chk_lotes_fechas  CHECK (fecha_caducidad IS NULL OR fecha_caducidad >= fecha_ingreso)
) ENGINE=InnoDB;

-- =====================================================================
-- 4. DISPOSITIVOS IoT (HU-03)
-- =====================================================================

CREATE TABLE dispositivos_iot (
  id                       BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  hogar_id                 BIGINT UNSIGNED   NOT NULL,
  identificador            VARCHAR(100)      NOT NULL,    -- ID físico del ESP32
  nombre                   VARCHAR(100)      NOT NULL,
  tipo                     ENUM('bascula','sensor_frescura','sensor_temperatura','camara','otro') NOT NULL,
  modelo                   VARCHAR(100)      NULL,        -- "ESP32 + HX711"
  ubicacion_id             BIGINT UNSIGNED   NULL,
  clave_hash               CHAR(64)          NOT NULL,    -- hash de la clave que envía en cada lectura
  estado                   ENUM('activo','pausado','mantenimiento','baja') NOT NULL DEFAULT 'activo',
  bateria_pct              TINYINT UNSIGNED  NULL,
  senal_dbm                SMALLINT          NULL,        -- señal WiFi, p. ej. -58
  umbral_desconexion_seg   SMALLINT UNSIGNED NOT NULL DEFAULT 30,  -- sin datos más tiempo = desconectado
  ultima_conexion          DATETIME(3)       NULL,
  ultima_calibracion       DATETIME          NULL,
  creado_en                DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dispositivos_identificador (identificador),
  UNIQUE KEY uq_dispositivos_clave (clave_hash),
  UNIQUE KEY uq_dispositivos_hogar_id (hogar_id, id),
  KEY idx_dispositivos_ubicacion (hogar_id, ubicacion_id),
  CONSTRAINT fk_dispositivos_hogar     FOREIGN KEY (hogar_id) REFERENCES hogares (id),
  CONSTRAINT fk_dispositivos_ubicacion FOREIGN KEY (hogar_id, ubicacion_id)
    REFERENCES ubicaciones_almacenamiento (hogar_id, id),
  CONSTRAINT chk_dispositivos_bateria CHECK (bateria_pct IS NULL OR bateria_pct <= 100),
  CONSTRAINT chk_dispositivos_senal   CHECK (senal_dbm IS NULL OR senal_dbm BETWEEN -120 AND 0)
) ENGINE=InnoDB;

-- Qué alimentos pesa cada báscula (una báscula puede tener varios canales)
CREATE TABLE dispositivo_alimentos (
  hogar_id          BIGINT UNSIGNED NOT NULL,
  dispositivo_id    BIGINT UNSIGNED NOT NULL,
  canal             TINYINT UNSIGNED NOT NULL DEFAULT 1,
  alimento_id       BIGINT UNSIGNED NOT NULL,
  factor_conversion DECIMAL(14,6)   NOT NULL DEFAULT 1.000000,  -- lectura -> unidad del alimento
  tara              DECIMAL(12,3)   NOT NULL DEFAULT 0.000,     -- peso del recipiente
  activo            BOOLEAN         NOT NULL DEFAULT TRUE,
  PRIMARY KEY (dispositivo_id, canal),
  UNIQUE KEY uq_disp_alimento (dispositivo_id, alimento_id),
  KEY idx_disp_alim_alimento (hogar_id, alimento_id),
  KEY idx_disp_alim_dispositivo (hogar_id, dispositivo_id),
  CONSTRAINT fk_disp_alim_dispositivo FOREIGN KEY (hogar_id, dispositivo_id)
    REFERENCES dispositivos_iot (hogar_id, id),
  CONSTRAINT fk_disp_alim_alimento FOREIGN KEY (hogar_id, alimento_id)
    REFERENCES alimentos (hogar_id, id),
  CONSTRAINT chk_disp_alim_factor CHECK (factor_conversion > 0),
  CONSTRAINT chk_disp_alim_tara   CHECK (tara >= 0)
) ENGINE=InnoDB;

-- Historial de lecturas (actividad en vivo). Crece mucho: se puede purgar lo viejo.
CREATE TABLE lecturas_sensor (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id            BIGINT UNSIGNED NOT NULL,
  dispositivo_id      BIGINT UNSIGNED NOT NULL,
  alimento_id         BIGINT UNSIGNED NULL,           -- en básculas: qué producto se pesó
  tipo_lectura        ENUM('peso','gas','temperatura','humedad','bateria','otro') NOT NULL,
  valor               DECIMAL(14,4)   NOT NULL,
  unidad              VARCHAR(20)     NOT NULL,       -- g, ppm, °C, %
  leido_en            DATETIME(3)     NOT NULL,
  recibido_en         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  aplicada_inventario BOOLEAN         NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lecturas_hogar_id (hogar_id, id),
  KEY idx_lecturas_dispositivo (hogar_id, dispositivo_id, leido_en),
  KEY idx_lecturas_alimento (hogar_id, alimento_id, leido_en),
  KEY idx_lecturas_pendientes (aplicada_inventario, recibido_en),
  CONSTRAINT fk_lecturas_dispositivo FOREIGN KEY (hogar_id, dispositivo_id)
    REFERENCES dispositivos_iot (hogar_id, id),
  CONSTRAINT fk_lecturas_alimento FOREIGN KEY (hogar_id, alimento_id)
    REFERENCES alimentos (hogar_id, id),
  CONSTRAINT chk_lecturas_peso CHECK (tipo_lectura <> 'peso' OR valor >= 0),
  CONSTRAINT chk_lecturas_peso_alimento CHECK (tipo_lectura <> 'peso' OR alimento_id IS NOT NULL)
) ENGINE=InnoDB;

-- Bitácora: vinculado, conectado, desconectado, calibrado, pausado
CREATE TABLE eventos_dispositivo (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id       BIGINT UNSIGNED NOT NULL,
  dispositivo_id BIGINT UNSIGNED NOT NULL,
  tipo           ENUM('vinculado','conectado','desconectado','calibrado','pausado','reanudado') NOT NULL,
  usuario_id     BIGINT UNSIGNED NULL,
  creado_en      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detalle        VARCHAR(255)    NULL,
  PRIMARY KEY (id),
  KEY idx_eventos_dispositivo (hogar_id, dispositivo_id, creado_en),
  KEY idx_eventos_usuario (usuario_id),
  CONSTRAINT fk_eventos_dispositivo FOREIGN KEY (hogar_id, dispositivo_id) REFERENCES dispositivos_iot (hogar_id, id),
  CONSTRAINT fk_eventos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =====================================================================
-- 5. RECETAS Y MODO COCINA (HU-08)
-- =====================================================================

-- hogar_id NULL = receta del sistema (catálogo general); con valor = receta propia del hogar
CREATE TABLE recetas (
  id               BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  hogar_id         BIGINT UNSIGNED   NULL,
  nombre           VARCHAR(150)      NOT NULL,
  descripcion      VARCHAR(500)      NULL,
  porciones        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  tiempo_minutos   SMALLINT UNSIGNED NOT NULL,
  dificultad       ENUM('muy_facil','facil','media','dificil') NOT NULL DEFAULT 'facil',
  icono            VARCHAR(40)       NOT NULL DEFAULT 'fa-utensils',
  color            ENUM('tomate','oliva','mostaza','cafe','petroleo') NOT NULL DEFAULT 'tomate',
  activa           BOOLEAN           NOT NULL DEFAULT TRUE,
  creada_por       BIGINT UNSIGNED   NULL,
  creada_en        DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recetas_hogar_nombre (hogar_id, nombre),
  KEY idx_recetas_creador (creada_por),
  CONSTRAINT fk_recetas_hogar   FOREIGN KEY (hogar_id)   REFERENCES hogares (id),
  CONSTRAINT fk_recetas_creador FOREIGN KEY (creada_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT chk_recetas_porciones CHECK (porciones > 0),
  CONSTRAINT chk_recetas_tiempo    CHECK (tiempo_minutos > 0)
) ENGINE=InnoDB;

-- Ingredientes. palabra_clave se busca dentro del nombre de los alimentos
-- del hogar ("Pollo" encuentra "Pechuga de pollo"), así sirven para cualquier casa.
CREATE TABLE receta_ingredientes (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  receta_id      BIGINT UNSIGNED   NOT NULL,
  orden          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  nombre         VARCHAR(100)      NOT NULL,          -- como se muestra: "Pollo"
  palabra_clave  VARCHAR(60)       NOT NULL,          -- para buscar en la alacena
  cantidad_texto VARCHAR(60)       NOT NULL,          -- "1 ½ tazas", "500 g"
  cantidad       DECIMAL(12,3)     NULL,              -- opcional, para descontar exacto
  unidad_id      SMALLINT UNSIGNED NULL,
  opcional       BOOLEAN           NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ingredientes_receta_nombre (receta_id, nombre),
  KEY idx_ingredientes_unidad (unidad_id),
  CONSTRAINT fk_ingredientes_receta FOREIGN KEY (receta_id) REFERENCES recetas (id) ON DELETE CASCADE,
  CONSTRAINT fk_ingredientes_unidad FOREIGN KEY (unidad_id) REFERENCES unidades_medida (id),
  CONSTRAINT chk_ingredientes_cantidad CHECK (cantidad IS NULL OR cantidad > 0)
) ENGINE=InnoDB;

-- Pasos del modo cocina. minutos_temporizador activa el botón de temporizador.
CREATE TABLE receta_pasos (
  id                   BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  receta_id            BIGINT UNSIGNED   NOT NULL,
  orden                SMALLINT UNSIGNED NOT NULL,
  texto                VARCHAR(500)      NOT NULL,
  minutos_temporizador SMALLINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pasos_receta_orden (receta_id, orden),
  CONSTRAINT fk_pasos_receta FOREIGN KEY (receta_id) REFERENCES recetas (id) ON DELETE CASCADE,
  CONSTRAINT chk_pasos_minutos CHECK (minutos_temporizador IS NULL OR minutos_temporizador > 0)
) ENGINE=InnoDB;

-- "¡Terminé!" en el modo cocina: queda registro y sus consumos en movimientos
CREATE TABLE recetas_preparadas (
  id           BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  hogar_id     BIGINT UNSIGNED   NOT NULL,
  receta_id    BIGINT UNSIGNED   NOT NULL,
  usuario_id   BIGINT UNSIGNED   NULL,
  porciones    SMALLINT UNSIGNED NULL,
  preparada_en DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_preparadas_hogar_id (hogar_id, id),
  KEY idx_preparadas_receta (receta_id),
  KEY idx_preparadas_usuario (usuario_id),
  CONSTRAINT fk_preparadas_hogar   FOREIGN KEY (hogar_id)   REFERENCES hogares (id),
  CONSTRAINT fk_preparadas_receta  FOREIGN KEY (receta_id)  REFERENCES recetas (id),
  CONSTRAINT fk_preparadas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =====================================================================
-- 6. MOVIMIENTOS DE INVENTARIO (base de HU-02, HU-03 y HU-06)
-- =====================================================================
-- cantidad_delta con signo: entrada > 0, consumo/desecho < 0, ajuste <> 0.
-- El historial de consumos alimenta la gráfica y la predicción.
CREATE TABLE movimientos_inventario (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id             BIGINT UNSIGNED NOT NULL,
  alimento_id          BIGINT UNSIGNED NOT NULL,
  lote_id              BIGINT UNSIGNED NULL,
  tipo                 ENUM('entrada','consumo','ajuste','desecho') NOT NULL,
  cantidad_delta       DECIMAL(12,3)   NOT NULL,
  origen               ENUM('manual','sensor','compra','camara','receta') NOT NULL DEFAULT 'manual',
  lectura_id           BIGINT UNSIGNED NULL,          -- lectura IoT que lo originó
  receta_preparada_id  BIGINT UNSIGNED NULL,          -- receta que lo originó
  usuario_id           BIGINT UNSIGNED NULL,          -- quién lo hizo (NULL = automático)
  registrado_en        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notas                VARCHAR(255)    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_movimientos_hogar_id (hogar_id, id),
  KEY idx_mov_alimento_fecha (hogar_id, alimento_id, registrado_en),
  KEY idx_mov_lote (hogar_id, lote_id),
  KEY idx_mov_tipo_fecha (hogar_id, tipo, registrado_en),
  KEY idx_mov_lectura (lectura_id),
  KEY idx_mov_receta (receta_preparada_id),
  KEY idx_mov_usuario (usuario_id),
  CONSTRAINT fk_mov_alimento FOREIGN KEY (hogar_id, alimento_id) REFERENCES alimentos (hogar_id, id),
  CONSTRAINT fk_mov_lote     FOREIGN KEY (hogar_id, lote_id)     REFERENCES lotes_alimento (hogar_id, id),
  CONSTRAINT fk_mov_lectura  FOREIGN KEY (lectura_id)  REFERENCES lecturas_sensor (id) ON DELETE SET NULL,
  CONSTRAINT fk_mov_receta   FOREIGN KEY (receta_preparada_id) REFERENCES recetas_preparadas (id) ON DELETE SET NULL,
  CONSTRAINT fk_mov_usuario  FOREIGN KEY (usuario_id)  REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT chk_mov_delta CHECK (
       (tipo = 'entrada' AND cantidad_delta > 0)
    OR (tipo IN ('consumo','desecho') AND cantidad_delta < 0)
    OR (tipo = 'ajuste' AND cantidad_delta <> 0))
) ENGINE=InnoDB;

-- =====================================================================
-- 7. INTELIGENCIA ARTIFICIAL (HU-05, HU-06, HU-10)
-- =====================================================================

-- Cuánto te alcanza cada alimento (HU-06)
CREATE TABLE predicciones_consumo (
  id                         BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  hogar_id                   BIGINT UNSIGNED   NOT NULL,
  alimento_id                BIGINT UNSIGNED   NOT NULL,
  calculada_en               DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumo_promedio_diario    DECIMAL(12,4)     NULL,
  dias_restantes             SMALLINT UNSIGNED NULL,
  fecha_agotamiento_estimada DATE              NULL,
  confianza                  DECIMAL(5,4)      NULL,   -- 0 a 1
  ventana_dias               SMALLINT UNSIGNED NULL,
  metodo                     VARCHAR(100)      NULL,
  detalle                    JSON              NULL,
  PRIMARY KEY (id),
  KEY idx_pred_alimento (hogar_id, alimento_id, calculada_en),
  CONSTRAINT fk_pred_alimento FOREIGN KEY (hogar_id, alimento_id) REFERENCES alimentos (hogar_id, id),
  CONSTRAINT chk_pred_consumo   CHECK (consumo_promedio_diario IS NULL OR consumo_promedio_diario >= 0),
  CONSTRAINT chk_pred_confianza CHECK (confianza IS NULL OR confianza BETWEEN 0 AND 1)
) ENGINE=InnoDB;

-- "Consume primero" (HU-05). prioridad 1 = más urgente.
CREATE TABLE recomendaciones_consumo (
  id                 BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  hogar_id           BIGINT UNSIGNED  NOT NULL,
  alimento_id        BIGINT UNSIGNED  NOT NULL,
  lote_id            BIGINT UNSIGNED  NULL,
  receta_sugerida_id BIGINT UNSIGNED  NULL,
  prioridad          TINYINT UNSIGNED NOT NULL DEFAULT 3,
  motivo             VARCHAR(255)     NULL,
  estado             ENUM('pendiente','vista','aceptada','descartada') NOT NULL DEFAULT 'pendiente',
  generada_en        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vigente_hasta      DATETIME         NULL,
  metodo             VARCHAR(100)     NULL,
  detalle            JSON             NULL,
  PRIMARY KEY (id),
  KEY idx_reco_estado (hogar_id, estado, prioridad),
  KEY idx_reco_alimento (hogar_id, alimento_id),
  KEY idx_reco_lote (hogar_id, lote_id),
  KEY idx_reco_receta (receta_sugerida_id),
  CONSTRAINT fk_reco_alimento FOREIGN KEY (hogar_id, alimento_id) REFERENCES alimentos (hogar_id, id),
  CONSTRAINT fk_reco_lote     FOREIGN KEY (hogar_id, lote_id)     REFERENCES lotes_alimento (hogar_id, id),
  CONSTRAINT fk_reco_receta   FOREIGN KEY (receta_sugerida_id)    REFERENCES recetas (id) ON DELETE SET NULL,
  CONSTRAINT chk_reco_prioridad CHECK (prioridad BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- Una foto tomada o subida (aparece en "Fotos recientes")
CREATE TABLE escaneos (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id          BIGINT UNSIGNED NOT NULL,
  usuario_id        BIGINT UNSIGNED NULL,
  dispositivo_id    BIGINT UNSIGNED NULL,             -- si vino de una cámara fija
  referencia_imagen VARCHAR(500)    NOT NULL,         -- ruta o URL en el almacenamiento
  origen            ENUM('camara','galeria','dispositivo') NOT NULL DEFAULT 'camara',
  estado            ENUM('pendiente','analizado','confirmado','descartado') NOT NULL DEFAULT 'pendiente',
  creado_en         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  analizado_en      DATETIME        NULL,
  modelo            VARCHAR(100)    NULL,             -- modelo de visión usado
  PRIMARY KEY (id),
  UNIQUE KEY uq_escaneos_hogar_id (hogar_id, id),
  KEY idx_escaneos_fecha (hogar_id, creado_en),
  KEY idx_escaneos_usuario (usuario_id),
  KEY idx_escaneos_dispositivo (hogar_id, dispositivo_id),
  CONSTRAINT fk_escaneos_hogar       FOREIGN KEY (hogar_id)   REFERENCES hogares (id),
  CONSTRAINT fk_escaneos_usuario     FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_escaneos_dispositivo FOREIGN KEY (hogar_id, dispositivo_id) REFERENCES dispositivos_iot (hogar_id, id)
) ENGINE=InnoDB;

-- Cada alimento que la IA encontró en una foto. La alacena solo cambia
-- cuando la persona confirma (o corrige) y presiona "Guardar".
CREATE TABLE identificaciones_ia (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id               BIGINT UNSIGNED NOT NULL,
  escaneo_id             BIGINT UNSIGNED NOT NULL,
  resultado_texto        VARCHAR(120)    NOT NULL,     -- lo que "vio" la IA
  confianza              DECIMAL(5,4)    NULL,
  caja_x                 DECIMAL(5,2)    NULL,         -- recuadro en % de la imagen
  caja_y                 DECIMAL(5,2)    NULL,
  caja_ancho             DECIMAL(5,2)    NULL,
  caja_alto              DECIMAL(5,2)    NULL,
  catalogo_id            SMALLINT UNSIGNED NULL,
  alimento_sugerido_id   BIGINT UNSIGNED NULL,
  cantidad_sugerida      DECIMAL(12,3)   NULL,
  caducidad_sugerida     DATE            NULL,
  incluir                BOOLEAN         NOT NULL DEFAULT TRUE,   -- interruptor "¿Lo agregamos?"
  estado                 ENUM('pendiente','confirmada','corregida','rechazada') NOT NULL DEFAULT 'pendiente',
  alimento_confirmado_id BIGINT UNSIGNED NULL,
  cantidad_confirmada    DECIMAL(12,3)   NULL,
  caducidad_confirmada   DATE            NULL,
  confirmada_en          DATETIME        NULL,
  movimiento_id          BIGINT UNSIGNED NULL,          -- entrada generada al guardar
  PRIMARY KEY (id),
  KEY idx_ident_escaneo (hogar_id, escaneo_id),
  KEY idx_ident_sugerido (hogar_id, alimento_sugerido_id),
  KEY idx_ident_confirmado (hogar_id, alimento_confirmado_id),
  KEY idx_ident_catalogo (catalogo_id),
  KEY idx_ident_movimiento (movimiento_id),
  CONSTRAINT fk_ident_escaneo    FOREIGN KEY (hogar_id, escaneo_id) REFERENCES escaneos (hogar_id, id),
  CONSTRAINT fk_ident_catalogo   FOREIGN KEY (catalogo_id) REFERENCES catalogo_alimentos (id),
  CONSTRAINT fk_ident_sugerido   FOREIGN KEY (hogar_id, alimento_sugerido_id)   REFERENCES alimentos (hogar_id, id),
  CONSTRAINT fk_ident_confirmado FOREIGN KEY (hogar_id, alimento_confirmado_id) REFERENCES alimentos (hogar_id, id),
  CONSTRAINT fk_ident_movimiento FOREIGN KEY (movimiento_id) REFERENCES movimientos_inventario (id) ON DELETE SET NULL,
  CONSTRAINT chk_ident_confianza CHECK (confianza IS NULL OR confianza BETWEEN 0 AND 1),
  CONSTRAINT chk_ident_caja CHECK (caja_x IS NULL OR (caja_x BETWEEN 0 AND 100 AND caja_y BETWEEN 0 AND 100
                                   AND caja_ancho BETWEEN 0 AND 100 AND caja_alto BETWEEN 0 AND 100)),
  CONSTRAINT chk_ident_cantidades CHECK ((cantidad_sugerida IS NULL OR cantidad_sugerida >= 0)
                                     AND (cantidad_confirmada IS NULL OR cantidad_confirmada >= 0)),
  CONSTRAINT chk_ident_confirmacion CHECK (estado IN ('pendiente','rechazada') OR confirmada_en IS NOT NULL)
) ENGINE=InnoDB;

-- Conversaciones con el asistente "Chef QHDC"
CREATE TABLE conversaciones_asistente (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id   BIGINT UNSIGNED NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  iniciada_en DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversaciones_hogar_id (hogar_id, id),
  KEY idx_conversaciones_usuario (hogar_id, usuario_id, iniciada_en),
  CONSTRAINT fk_conversaciones_miembro FOREIGN KEY (hogar_id, usuario_id)
    REFERENCES hogar_miembros (hogar_id, usuario_id)
) ENGINE=InnoDB;

CREATE TABLE mensajes_asistente (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id        BIGINT UNSIGNED NOT NULL,
  conversacion_id BIGINT UNSIGNED NOT NULL,
  autor           ENUM('usuario','asistente') NOT NULL,
  contenido       TEXT            NOT NULL,
  intencion       ENUM('usar_primero','comprar','cocinar','duracion','frescura','saludo','otra') NULL,
  alimento_id     BIGINT UNSIGNED NULL,                -- p. ej. "¿cuánto me dura la leche?"
  creado_en       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mensajes_conversacion (hogar_id, conversacion_id, creado_en),
  KEY idx_mensajes_alimento (hogar_id, alimento_id),
  CONSTRAINT fk_mensajes_conversacion FOREIGN KEY (hogar_id, conversacion_id)
    REFERENCES conversaciones_asistente (hogar_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_mensajes_alimento FOREIGN KEY (hogar_id, alimento_id) REFERENCES alimentos (hogar_id, id)
) ENGINE=InnoDB;

-- =====================================================================
-- 8. LISTA DEL SÚPER (HU-07)
-- =====================================================================

CREATE TABLE listas_compras (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id                 BIGINT UNSIGNED NOT NULL,
  nombre                   VARCHAR(120)    NOT NULL DEFAULT 'Lista del súper',
  estado                   ENUM('activa','completada','cancelada') NOT NULL DEFAULT 'activa',
  generada_automaticamente BOOLEAN         NOT NULL DEFAULT TRUE,
  creada_por               BIGINT UNSIGNED NULL,
  creada_en                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completada_en            DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_listas_hogar_id (hogar_id, id),
  KEY idx_listas_estado (hogar_id, estado),
  KEY idx_listas_creador (creada_por),
  CONSTRAINT fk_listas_hogar   FOREIGN KEY (hogar_id)   REFERENCES hogares (id),
  CONSTRAINT fk_listas_creador FOREIGN KEY (creada_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT chk_listas_completada CHECK (estado <> 'completada' OR completada_en IS NOT NULL)
) ENGINE=InnoDB;

-- Renglones del ticket. Puede ser un alimento de la alacena o algo anotado
-- a mano ("Servilletas"): en ese caso alimento_id es NULL y va nombre_libre.
CREATE TABLE lista_compras_items (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id          BIGINT UNSIGNED NOT NULL,
  lista_id          BIGINT UNSIGNED NOT NULL,
  alimento_id       BIGINT UNSIGNED NULL,
  nombre_libre      VARCHAR(120)    NULL,
  cantidad_sugerida DECIMAL(12,3)   NULL,
  cantidad_texto    VARCHAR(60)     NULL,              -- "1 botella"
  precio_estimado   DECIMAL(10,2)   NULL,
  prioridad         ENUM('alta','media','baja') NOT NULL DEFAULT 'media',   -- Urgente / Pronto / Tú lo anotaste
  motivo            ENUM('agotado','existencia_baja','proximo_caducar','caducado','prediccion','receta','manual')
                                    NOT NULL DEFAULT 'manual',
  receta_id         BIGINT UNSIGNED NULL,               -- si vino de "Anotar lo que falta"
  agregado_por      BIGINT UNSIGNED NULL,
  agregado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  comprado          BOOLEAN         NOT NULL DEFAULT FALSE,
  comprado_en       DATETIME        NULL,
  comprado_por      BIGINT UNSIGNED NULL,
  movimiento_id     BIGINT UNSIGNED NULL,               -- entrada creada al "Terminé de comprar"
  PRIMARY KEY (id),
  UNIQUE KEY uq_items_lista_alimento (lista_id, alimento_id),
  KEY idx_items_lista (hogar_id, lista_id, prioridad),
  KEY idx_items_alimento (hogar_id, alimento_id),
  KEY idx_items_receta (receta_id),
  KEY idx_items_agregado (agregado_por),
  KEY idx_items_comprado (comprado_por),
  KEY idx_items_movimiento (movimiento_id),
  CONSTRAINT fk_items_lista      FOREIGN KEY (hogar_id, lista_id)    REFERENCES listas_compras (hogar_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_items_alimento   FOREIGN KEY (hogar_id, alimento_id) REFERENCES alimentos (hogar_id, id),
  CONSTRAINT fk_items_receta     FOREIGN KEY (receta_id)     REFERENCES recetas (id) ON DELETE SET NULL,
  CONSTRAINT fk_items_agregado   FOREIGN KEY (agregado_por)  REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_items_comprado   FOREIGN KEY (comprado_por)  REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_items_movimiento FOREIGN KEY (movimiento_id) REFERENCES movimientos_inventario (id) ON DELETE SET NULL,
  CONSTRAINT chk_items_que   CHECK (alimento_id IS NOT NULL OR nombre_libre IS NOT NULL),
  CONSTRAINT chk_items_cantidad CHECK (cantidad_sugerida IS NULL OR cantidad_sugerida > 0),
  CONSTRAINT chk_items_precio CHECK (precio_estimado IS NULL OR precio_estimado >= 0)
) ENGINE=InnoDB;

-- =====================================================================
-- 9. AVISOS (HU-04)
-- =====================================================================
-- Un aviso es del hogar; cada persona lo marca como visto por su cuenta
-- (tabla notificaciones_lecturas). clave evita duplicados: 'cad-7', 'stock-1', 'disp-4'.
CREATE TABLE notificaciones (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hogar_id       BIGINT UNSIGNED NOT NULL,
  clave          VARCHAR(60)     NOT NULL,
  tipo           ENUM('caducidad_proxima','caducado','existencia_baja','agotamiento_predicho',
                      'dispositivo_desconectado','frescura','recomendacion','sistema') NOT NULL,
  nivel          ENUM('peligro','aviso','info') NOT NULL DEFAULT 'aviso',   -- color del imán
  titulo         VARCHAR(150)    NOT NULL,
  mensaje        VARCHAR(500)    NULL,
  alimento_id    BIGINT UNSIGNED NULL,
  lote_id        BIGINT UNSIGNED NULL,
  dispositivo_id BIGINT UNSIGNED NULL,
  creada_en      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelta_en    DATETIME        NULL,                  -- el problema dejó de existir
  activa         BOOLEAN AS (resuelta_en IS NULL) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notif_hogar_id (hogar_id, id),
  KEY idx_notif_hogar (hogar_id, activa, creada_en),
  KEY idx_notif_clave (hogar_id, clave, activa),
  KEY idx_notif_alimento (hogar_id, alimento_id),
  KEY idx_notif_lote (hogar_id, lote_id),
  KEY idx_notif_dispositivo (hogar_id, dispositivo_id),
  CONSTRAINT fk_notif_hogar       FOREIGN KEY (hogar_id) REFERENCES hogares (id),
  CONSTRAINT fk_notif_alimento    FOREIGN KEY (hogar_id, alimento_id)    REFERENCES alimentos (hogar_id, id),
  CONSTRAINT fk_notif_lote        FOREIGN KEY (hogar_id, lote_id)        REFERENCES lotes_alimento (hogar_id, id),
  CONSTRAINT fk_notif_dispositivo FOREIGN KEY (hogar_id, dispositivo_id) REFERENCES dispositivos_iot (hogar_id, id)
) ENGINE=InnoDB;

CREATE TABLE notificaciones_lecturas (
  notificacion_id BIGINT UNSIGNED NOT NULL,
  usuario_id      BIGINT UNSIGNED NOT NULL,
  leida_en        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notificacion_id, usuario_id),
  KEY idx_notif_lect_usuario (usuario_id),
  CONSTRAINT fk_notif_lect_notif   FOREIGN KEY (notificacion_id) REFERENCES notificaciones (id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_lect_usuario FOREIGN KEY (usuario_id)      REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- 10. VISTAS (lo que muestra cada pantalla, ya calculado)
-- =====================================================================

-- Inventario con nivel del frasco y estado de caducidad (HU-01, HU-02, HU-04)
--   nivel:            bajo (<= 25 %) / medio (<= 50 %) / ok
--   estado_caducidad: caducado (< 0 días) / urgente (<= 1) /
--                     pronto (<= MAX(3, días de aviso)) / ok / sin_caducidad
CREATE OR REPLACE VIEW vista_inventario AS
SELECT b.*,
       CASE WHEN b.porcentaje <= 25 THEN 'bajo'
            WHEN b.porcentaje <= 50 THEN 'medio'
            ELSE 'ok' END                                   AS nivel,
       (b.cantidad_total <= 0)                              AS agotado,
       DATEDIFF(b.proxima_caducidad, CURDATE())             AS dias_para_caducar,
       CASE WHEN b.proxima_caducidad IS NULL THEN 'sin_caducidad'
            WHEN DATEDIFF(b.proxima_caducidad, CURDATE()) < 0  THEN 'caducado'
            WHEN DATEDIFF(b.proxima_caducidad, CURDATE()) <= 1 THEN 'urgente'
            WHEN DATEDIFF(b.proxima_caducidad, CURDATE()) <= GREATEST(3, b.dias_aviso) THEN 'pronto'
            ELSE 'ok' END                                   AS estado_caducidad
FROM (
  SELECT a.hogar_id,
         a.id                       AS alimento_id,
         a.nombre,
         a.icono,
         a.color,
         a.categoria_id,
         c.nombre                   AS categoria,
         a.ubicacion_id,
         u.nombre                   AS ubicacion,
         u.tipo                     AS ubicacion_tipo,
         um.codigo                  AS unidad,
         a.cantidad_llena,
         a.porcentaje_minimo,
         a.precio_estimado,
         a.origen,
         COALESCE(l.total, 0)       AS cantidad_total,
         LEAST(100, ROUND(COALESCE(l.total, 0) / a.cantidad_llena * 100)) AS porcentaje,
         l.proxima_caducidad,
         COALESCE(l.lotes, 0)       AS lotes_disponibles,
         COALESCE(a.dias_aviso_caducidad, c.dias_aviso_caducidad, h.dias_aviso_predeterminado, 3) AS dias_aviso
  FROM alimentos a
  JOIN hogares h               ON h.id = a.hogar_id
  JOIN unidades_medida um      ON um.id = a.unidad_id
  LEFT JOIN categorias_alimento c ON c.id = a.categoria_id
  LEFT JOIN ubicaciones_almacenamiento u ON u.hogar_id = a.hogar_id AND u.id = a.ubicacion_id
  LEFT JOIN (
      SELECT hogar_id, alimento_id,
             SUM(cantidad_actual) AS total,
             MIN(CASE WHEN cantidad_actual > 0 THEN fecha_caducidad END) AS proxima_caducidad,
             COUNT(*) AS lotes
      FROM lotes_alimento
      WHERE estado = 'disponible'
      GROUP BY hogar_id, alimento_id
  ) l ON l.hogar_id = a.hogar_id AND l.alimento_id = a.id
  WHERE a.activo = TRUE
) b;

-- Consumo por día (gráfica de la semana en el detalle del alimento)
CREATE OR REPLACE VIEW vista_consumo_diario AS
SELECT m.hogar_id,
       m.alimento_id,
       DATE(m.registrado_en)      AS dia,
       -SUM(m.cantidad_delta)     AS cantidad_consumida,
       COUNT(*)                   AS movimientos
FROM movimientos_inventario m
WHERE m.tipo = 'consumo'
GROUP BY m.hogar_id, m.alimento_id, DATE(m.registrado_en);

-- Predicción simple: promedio de los últimos 7 días (HU-06).
-- Un modelo de IA más avanzado puede guardar su resultado en predicciones_consumo.
CREATE OR REPLACE VIEW vista_prediccion_consumo AS
SELECT x.*,
       CASE WHEN x.promedio_diario > 0 THEN FLOOR(x.cantidad_total / x.promedio_diario) END AS dias_restantes,
       CASE WHEN x.promedio_diario > 0
            THEN CURDATE() + INTERVAL FLOOR(x.cantidad_total / x.promedio_diario) DAY END    AS fecha_agotamiento
FROM (
  SELECT i.hogar_id, i.alimento_id, i.nombre, i.unidad, i.cantidad_total,
         ROUND(COALESCE((
             SELECT -SUM(m.cantidad_delta)
             FROM movimientos_inventario m
             WHERE m.hogar_id = i.hogar_id AND m.alimento_id = i.alimento_id
               AND m.tipo = 'consumo'
               AND m.registrado_en >= CURDATE() - INTERVAL 7 DAY
         ), 0) / 7, 4) AS promedio_diario
  FROM vista_inventario i
) x;

-- Lo que la app propone comprar (HU-07): caducado, debajo del mínimo
-- o que se acaba en 5 días o menos según el consumo.
CREATE OR REPLACE VIEW vista_lista_sugerida AS
SELECT i.hogar_id,
       i.alimento_id,
       i.nombre,
       i.icono,
       i.unidad,
       i.cantidad_total,
       i.porcentaje,
       p.dias_restantes,
       CASE WHEN i.estado_caducidad = 'caducado'     THEN 'caducado'
            WHEN i.cantidad_total <= 0               THEN 'agotado'
            WHEN i.porcentaje <= i.porcentaje_minimo THEN 'existencia_baja'
            ELSE 'prediccion' END                                AS motivo,
       CASE WHEN i.estado_caducidad = 'caducado' OR i.porcentaje <= 15 THEN 'alta'
            ELSE 'media' END                                     AS prioridad,
       CASE WHEN i.estado_caducidad = 'caducado' OR i.cantidad_llena - i.cantidad_total <= 0
            THEN i.cantidad_llena
            ELSE i.cantidad_llena - i.cantidad_total END         AS cantidad_sugerida,
       i.precio_estimado
FROM vista_inventario i
LEFT JOIN vista_prediccion_consumo p ON p.hogar_id = i.hogar_id AND p.alimento_id = i.alimento_id
WHERE i.estado_caducidad = 'caducado'
   OR i.porcentaje <= i.porcentaje_minimo
   OR p.dias_restantes <= 5;

-- Índice de frescura de la cocina, 0 a 100 (anillo del inicio)
CREATE OR REPLACE VIEW vista_frescura_hogar AS
SELECT h.id AS hogar_id,
       h.nombre AS hogar,
       COALESCE(SUM(i.estado_caducidad = 'caducado'), 0) AS caducados,
       COALESCE(SUM(i.estado_caducidad = 'urgente'), 0)  AS urgentes,
       COALESCE(SUM(i.estado_caducidad = 'pronto'), 0)   AS pronto,
       COALESCE(SUM(i.nivel = 'bajo'), 0)                AS bajos,
       GREATEST(0, LEAST(100, ROUND(100
           - 12 * COALESCE(SUM(i.estado_caducidad = 'caducado'), 0)
           -  7 * COALESCE(SUM(i.estado_caducidad = 'urgente'), 0)
           -  3 * COALESCE(SUM(i.estado_caducidad = 'pronto'), 0)
           -  2 * COALESCE(SUM(i.nivel = 'bajo'), 0)))) AS frescura
FROM hogares h
LEFT JOIN vista_inventario i ON i.hogar_id = h.id
GROUP BY h.id, h.nombre;

-- Sensores con "En línea / Desconectado" y su última lectura (HU-03)
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
       TIMESTAMPDIFF(SECOND, d.ultima_conexion, NOW(3)) AS segundos_sin_datos,
       (d.estado = 'activo' AND d.ultima_conexion IS NOT NULL
        AND d.ultima_conexion >= NOW(3) - INTERVAL d.umbral_desconexion_seg SECOND) AS en_linea,
       (SELECT GROUP_CONCAT(a.nombre ORDER BY da.canal SEPARATOR ', ')
          FROM dispositivo_alimentos da
          JOIN alimentos a ON a.hogar_id = da.hogar_id AND a.id = da.alimento_id
         WHERE da.dispositivo_id = d.id AND da.activo) AS alimentos,
       (SELECT valor FROM lecturas_sensor s WHERE s.hogar_id = d.hogar_id AND s.dispositivo_id = d.id
           AND s.tipo_lectura = 'gas' ORDER BY s.leido_en DESC LIMIT 1)          AS ultimo_gas_ppm,
       (SELECT valor FROM lecturas_sensor s WHERE s.hogar_id = d.hogar_id AND s.dispositivo_id = d.id
           AND s.tipo_lectura = 'temperatura' ORDER BY s.leido_en DESC LIMIT 1)  AS ultima_temperatura,
       (SELECT valor FROM lecturas_sensor s WHERE s.hogar_id = d.hogar_id AND s.dispositivo_id = d.id
           AND s.tipo_lectura = 'humedad' ORDER BY s.leido_en DESC LIMIT 1)      AS ultima_humedad
FROM dispositivos_iot d
LEFT JOIN ubicaciones_almacenamiento u ON u.hogar_id = d.hogar_id AND u.id = d.ubicacion_id
WHERE d.estado <> 'baja';

-- Avisos activos de cada persona, con su "leído / sin leer" (HU-04)
CREATE OR REPLACE VIEW vista_avisos_usuario AS
SELECT n.id AS notificacion_id,
       n.hogar_id,
       hm.usuario_id,
       n.clave, n.tipo, n.nivel, n.titulo, n.mensaje,
       n.alimento_id, n.lote_id, n.dispositivo_id,
       n.creada_en,
       (nl.notificacion_id IS NOT NULL) AS leida
FROM notificaciones n
JOIN hogar_miembros hm ON hm.hogar_id = n.hogar_id AND hm.activo
LEFT JOIN notificaciones_lecturas nl ON nl.notificacion_id = n.id AND nl.usuario_id = hm.usuario_id
WHERE n.activa;

-- Recetas con lo que tienes (HU-08).
-- puntos = urgentes*3 - faltan*2 (igual que la app): primero las que
-- aprovechan lo que está por caducar y a las que les falta menos.
CREATE OR REPLACE VIEW vista_recetas_disponibilidad AS
SELECT x.hogar_id,
       r.id AS receta_id,
       r.nombre, r.icono, r.color, r.tiempo_minutos, r.porciones, r.dificultad,
       (r.hogar_id IS NULL)                                   AS receta_del_sistema,
       COUNT(*)                                               AS total_ingredientes,
       SUM(x.disponible)                                      AS disponibles,
       COUNT(*) - SUM(x.disponible)                           AS faltan,
       SUM(x.urgente)                                         AS urgentes,
       ROUND(SUM(x.disponible) / COUNT(*) * 100)              AS coincidencia,
       SUM(x.urgente) * 3 - (COUNT(*) - SUM(x.disponible)) * 2 AS puntos
FROM (
  SELECT h.id AS hogar_id, ri.receta_id,
         EXISTS (SELECT 1 FROM vista_inventario i
                  WHERE i.hogar_id = h.id
                    AND i.nombre LIKE CONCAT('%', ri.palabra_clave, '%')
                    AND i.cantidad_total > 0
                    AND i.estado_caducidad <> 'caducado')                    AS disponible,
         EXISTS (SELECT 1 FROM vista_inventario i
                  WHERE i.hogar_id = h.id
                    AND i.nombre LIKE CONCAT('%', ri.palabra_clave, '%')
                    AND i.cantidad_total > 0
                    AND i.estado_caducidad IN ('urgente','pronto'))          AS urgente
  FROM hogares h
  JOIN recetas r             ON r.activa AND (r.hogar_id IS NULL OR r.hogar_id = h.id)
  JOIN receta_ingredientes ri ON ri.receta_id = r.id AND ri.opcional = FALSE
) x
JOIN recetas r ON r.id = x.receta_id
GROUP BY x.hogar_id, r.id, r.nombre, r.icono, r.color, r.tiempo_minutos, r.porciones, r.dificultad, r.hogar_id;

-- =====================================================================
-- 11. PROCEDIMIENTOS Y TRIGGER (reglas del inventario)
-- =====================================================================
--  sp_consumir            "Usé un poco": descuenta de los lotes que caducan primero
--  sp_reabastecer         "Rellené": crea un lote nuevo y su entrada
--  sp_aplicar_lectura_peso convierte una lectura de báscula en consumo/entrada
--  sp_preparar_receta     "¡Terminé!" en el modo cocina
--  sp_generar_lista       llena la lista del súper activa con lo sugerido
--  sp_generar_avisos      crea/resuelve los avisos del hogar
-- Los que llevan _interno no abren transacción (los usan los demás).

DELIMITER $$

CREATE PROCEDURE sp_consumir_interno(
  IN  p_hogar_id            BIGINT UNSIGNED,
  IN  p_alimento_id         BIGINT UNSIGNED,
  IN  p_cantidad            DECIMAL(12,3),
  IN  p_usuario_id          BIGINT UNSIGNED,
  IN  p_origen              VARCHAR(10),      -- manual | sensor | receta | camara
  IN  p_lectura_id          BIGINT UNSIGNED,
  IN  p_receta_preparada_id BIGINT UNSIGNED,
  OUT p_descontado          DECIMAL(12,3))
BEGIN
  DECLARE v_restante DECIMAL(12,3) DEFAULT p_cantidad;
  DECLARE v_lote     BIGINT UNSIGNED;
  DECLARE v_disp     DECIMAL(12,3);
  DECLARE v_toma     DECIMAL(12,3);
  DECLARE v_fin      BOOLEAN DEFAULT FALSE;
  -- Primero lo que caduca antes (FIFO por caducidad); lo que no caduca, al final
  DECLARE c_lotes CURSOR FOR
    SELECT id, cantidad_actual
      FROM lotes_alimento
     WHERE hogar_id = p_hogar_id AND alimento_id = p_alimento_id
       AND estado = 'disponible' AND cantidad_actual > 0
     ORDER BY fecha_caducidad IS NULL, fecha_caducidad, fecha_ingreso, id
     FOR UPDATE;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_fin = TRUE;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La cantidad a consumir debe ser mayor a 0';
  END IF;

  OPEN c_lotes;
  ciclo: LOOP
    FETCH c_lotes INTO v_lote, v_disp;
    IF v_fin OR v_restante <= 0 THEN LEAVE ciclo; END IF;
    SET v_toma = LEAST(v_disp, v_restante);
    -- En MySQL las asignaciones de SET se evalúan en orden: estado ya ve la cantidad nueva
    UPDATE lotes_alimento
       SET cantidad_actual = cantidad_actual - v_toma,
           estado = IF(cantidad_actual <= 0, 'agotado', estado)
     WHERE id = v_lote;
    INSERT INTO movimientos_inventario
      (hogar_id, alimento_id, lote_id, tipo, cantidad_delta, origen, lectura_id, receta_preparada_id, usuario_id)
    VALUES
      (p_hogar_id, p_alimento_id, v_lote, 'consumo', -v_toma, COALESCE(p_origen, 'manual'),
       p_lectura_id, p_receta_preparada_id, p_usuario_id);
    SET v_restante = v_restante - v_toma;
  END LOOP;
  CLOSE c_lotes;

  SET p_descontado = p_cantidad - v_restante;
END$$

CREATE PROCEDURE sp_consumir(
  IN  p_hogar_id    BIGINT UNSIGNED,
  IN  p_alimento_id BIGINT UNSIGNED,
  IN  p_cantidad    DECIMAL(12,3),
  IN  p_usuario_id  BIGINT UNSIGNED,
  OUT p_descontado  DECIMAL(12,3))
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  START TRANSACTION;
  CALL sp_consumir_interno(p_hogar_id, p_alimento_id, p_cantidad, p_usuario_id, 'manual', NULL, NULL, p_descontado);
  COMMIT;
END$$

CREATE PROCEDURE sp_reabastecer(
  IN  p_hogar_id    BIGINT UNSIGNED,
  IN  p_alimento_id BIGINT UNSIGNED,
  IN  p_cantidad    DECIMAL(12,3),
  IN  p_caducidad   DATE,             -- NULL = se calcula con la vida útil del alimento
  IN  p_origen      VARCHAR(10),      -- manual | compra | sensor | camara
  IN  p_usuario_id  BIGINT UNSIGNED,
  IN  p_lectura_id  BIGINT UNSIGNED,
  OUT p_lote_id     BIGINT UNSIGNED)
BEGIN
  DECLARE v_vida      SMALLINT UNSIGNED;
  DECLARE v_caducidad DATE;
  DECLARE v_origen    VARCHAR(10) DEFAULT COALESCE(p_origen, 'manual');

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La cantidad a agregar debe ser mayor a 0';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM alimentos WHERE hogar_id = p_hogar_id AND id = p_alimento_id AND activo) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El alimento no existe en este hogar';
  END IF;
  SET v_vida = (SELECT vida_util_dias FROM alimentos WHERE hogar_id = p_hogar_id AND id = p_alimento_id);

  SET v_caducidad = COALESCE(p_caducidad, IF(v_vida IS NULL, NULL, CURDATE() + INTERVAL v_vida DAY));

  INSERT INTO lotes_alimento (hogar_id, alimento_id, cantidad_inicial, cantidad_actual,
                              fecha_ingreso, fecha_caducidad, origen)
  VALUES (p_hogar_id, p_alimento_id, p_cantidad, p_cantidad, CURDATE(), v_caducidad, v_origen);
  SET p_lote_id = LAST_INSERT_ID();

  INSERT INTO movimientos_inventario (hogar_id, alimento_id, lote_id, tipo, cantidad_delta,
                                      origen, lectura_id, usuario_id)
  VALUES (p_hogar_id, p_alimento_id, p_lote_id, 'entrada', p_cantidad, v_origen, p_lectura_id, p_usuario_id);
END$$

-- La báscula manda el peso total; aquí se compara con lo que hay y se
-- registra la diferencia. Se ignoran cambios menores al 0.5 % (ruido).
CREATE PROCEDURE sp_aplicar_lectura_peso(IN p_lectura_id BIGINT UNSIGNED)
BEGIN
  DECLARE v_hogar    BIGINT UNSIGNED;
  DECLARE v_alimento BIGINT UNSIGNED;
  DECLARE v_valor    DECIMAL(14,4);
  DECLARE v_aplicada BOOLEAN;
  DECLARE v_factor   DECIMAL(14,6);
  DECLARE v_tara     DECIMAL(12,3);
  DECLARE v_llena    DECIMAL(12,3);
  DECLARE v_nuevo    DECIMAL(12,3);
  DECLARE v_actual   DECIMAL(12,3);
  DECLARE v_delta    DECIMAL(12,3);
  DECLARE v_out      DECIMAL(12,3);
  DECLARE v_lote     BIGINT UNSIGNED;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;

  SELECT l.hogar_id, l.alimento_id, l.valor, l.aplicada_inventario,
         da.factor_conversion, da.tara, a.cantidad_llena
    INTO v_hogar, v_alimento, v_valor, v_aplicada, v_factor, v_tara, v_llena
    FROM lecturas_sensor l
    JOIN dispositivo_alimentos da ON da.dispositivo_id = l.dispositivo_id
                                 AND da.alimento_id = l.alimento_id AND da.activo
    JOIN alimentos a ON a.hogar_id = l.hogar_id AND a.id = l.alimento_id
   WHERE l.id = p_lectura_id AND l.tipo_lectura = 'peso'
   FOR UPDATE;

  IF v_hogar IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Lectura de peso no encontrada o báscula sin alimento asignado';
  END IF;

  IF NOT v_aplicada THEN
    SET v_nuevo = GREATEST(0, (v_valor - v_tara) * v_factor);
    SELECT COALESCE(SUM(cantidad_actual), 0) INTO v_actual
      FROM lotes_alimento
     WHERE hogar_id = v_hogar AND alimento_id = v_alimento AND estado = 'disponible';
    SET v_delta = v_nuevo - v_actual;

    IF v_delta < 0 AND -v_delta >= v_llena * 0.005 THEN
      CALL sp_consumir_interno(v_hogar, v_alimento, -v_delta, NULL, 'sensor', p_lectura_id, NULL, v_out);
    ELSEIF v_delta > 0 AND v_delta >= v_llena * 0.005 THEN
      CALL sp_reabastecer(v_hogar, v_alimento, v_delta, NULL, 'sensor', NULL, p_lectura_id, v_lote);
    END IF;

    UPDATE lecturas_sensor SET aplicada_inventario = TRUE WHERE id = p_lectura_id;
  END IF;

  COMMIT;
END$$

-- "¡Terminé!": registra la receta y descuenta los ingredientes que tienen
-- cantidad numérica en la misma unidad que el alimento de la alacena.
CREATE PROCEDURE sp_preparar_receta(
  IN  p_hogar_id   BIGINT UNSIGNED,
  IN  p_receta_id  BIGINT UNSIGNED,
  IN  p_usuario_id BIGINT UNSIGNED,
  OUT p_preparada_id BIGINT UNSIGNED)
BEGIN
  DECLARE v_alimento BIGINT UNSIGNED;
  DECLARE v_cantidad DECIMAL(12,3);
  DECLARE v_out      DECIMAL(12,3);
  DECLARE v_fin      BOOLEAN DEFAULT FALSE;
  DECLARE c_ing CURSOR FOR
    SELECT (SELECT i.alimento_id
              FROM vista_inventario i
             WHERE i.hogar_id = p_hogar_id
               AND i.nombre LIKE CONCAT('%', ri.palabra_clave, '%')
               AND i.cantidad_total > 0 AND i.estado_caducidad <> 'caducado'
               AND i.unidad = um.codigo
             ORDER BY i.proxima_caducidad IS NULL, i.proxima_caducidad
             LIMIT 1),
           ri.cantidad
      FROM receta_ingredientes ri
      JOIN unidades_medida um ON um.id = ri.unidad_id
     WHERE ri.receta_id = p_receta_id AND ri.cantidad IS NOT NULL;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_fin = TRUE;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT EXISTS (SELECT 1 FROM recetas WHERE id = p_receta_id AND activa
                   AND (hogar_id IS NULL OR hogar_id = p_hogar_id)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La receta no existe para este hogar';
  END IF;

  START TRANSACTION;
  INSERT INTO recetas_preparadas (hogar_id, receta_id, usuario_id, porciones)
  SELECT p_hogar_id, id, p_usuario_id, porciones FROM recetas WHERE id = p_receta_id;
  SET p_preparada_id = LAST_INSERT_ID();

  OPEN c_ing;
  ciclo: LOOP
    FETCH c_ing INTO v_alimento, v_cantidad;
    IF v_fin THEN LEAVE ciclo; END IF;
    IF v_alimento IS NOT NULL THEN
      CALL sp_consumir_interno(p_hogar_id, v_alimento, v_cantidad, p_usuario_id, 'receta', NULL, p_preparada_id, v_out);
    END IF;
  END LOOP;
  CLOSE c_ing;
  COMMIT;
END$$

-- Toma (o crea) la lista activa del hogar y agrega lo sugerido que aún no esté.
CREATE PROCEDURE sp_generar_lista(
  IN  p_hogar_id   BIGINT UNSIGNED,
  IN  p_usuario_id BIGINT UNSIGNED,
  OUT p_lista_id   BIGINT UNSIGNED)
BEGIN
  SET p_lista_id = (SELECT id FROM listas_compras
                     WHERE hogar_id = p_hogar_id AND estado = 'activa'
                     ORDER BY creada_en DESC LIMIT 1);
  IF p_lista_id IS NULL THEN
    INSERT INTO listas_compras (hogar_id, creada_por) VALUES (p_hogar_id, p_usuario_id);
    SET p_lista_id = LAST_INSERT_ID();
  END IF;

  INSERT INTO lista_compras_items
    (hogar_id, lista_id, alimento_id, cantidad_sugerida, precio_estimado, prioridad, motivo)
  SELECT s.hogar_id, p_lista_id, s.alimento_id, s.cantidad_sugerida, s.precio_estimado, s.prioridad, s.motivo
    FROM vista_lista_sugerida s
   WHERE s.hogar_id = p_hogar_id
     AND NOT EXISTS (SELECT 1 FROM lista_compras_items it
                      WHERE it.lista_id = p_lista_id AND it.alimento_id = s.alimento_id);
END$$

-- Avisos del hogar: crea los nuevos (por clave) y marca como resueltos
-- los que ya no aplican. Se puede llamar cada minuto desde el backend.
CREATE PROCEDURE sp_generar_avisos(IN p_hogar_id BIGINT UNSIGNED)
BEGIN
  DROP TEMPORARY TABLE IF EXISTS tmp_avisos;
  CREATE TEMPORARY TABLE tmp_avisos (
    clave          VARCHAR(60) PRIMARY KEY,
    tipo           VARCHAR(30),
    nivel          VARCHAR(10),
    titulo         VARCHAR(150),
    mensaje        VARCHAR(500),
    alimento_id    BIGINT UNSIGNED NULL,
    dispositivo_id BIGINT UNSIGNED NULL
  );

  -- Caducidad
  INSERT INTO tmp_avisos
  SELECT CONCAT('cad-', i.alimento_id),
         IF(i.estado_caducidad = 'caducado', 'caducado', 'caducidad_proxima'),
         IF(i.estado_caducidad = 'pronto', 'aviso', 'peligro'),
         CASE WHEN i.estado_caducidad = 'caducado' THEN CONCAT(i.nombre, ' ya caducó')
              WHEN i.dias_para_caducar = 0 THEN CONCAT(i.nombre, ': caduca hoy')
              WHEN i.dias_para_caducar = 1 THEN CONCAT(i.nombre, ': caduca mañana')
              ELSE CONCAT(i.nombre, ': caduca en ', i.dias_para_caducar, ' días') END,
         CASE i.estado_caducidad
              WHEN 'caducado' THEN 'Revísalo y deséchalo si no está en buen estado.'
              WHEN 'urgente'  THEN 'Consúmelo hoy. Mira las recetas sugeridas para aprovecharlo.'
              ELSE 'Planea usarlo en los próximos días.' END,
         i.alimento_id, NULL
    FROM vista_inventario i
   WHERE i.hogar_id = p_hogar_id AND i.estado_caducidad IN ('caducado','urgente','pronto');

  -- Existencias bajas
  INSERT INTO tmp_avisos
  SELECT CONCAT('stock-', i.alimento_id), 'existencia_baja', 'aviso',
         CONCAT('Queda poco ', LOWER(i.nombre)),
         CONCAT('Quedan ', TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM i.cantidad_total)), ' ', i.unidad,
                ' (', i.porcentaje, '%). Ya está en tu lista de compras.'),
         i.alimento_id, NULL
    FROM vista_inventario i
   WHERE i.hogar_id = p_hogar_id AND i.nivel = 'bajo' AND i.estado_caducidad <> 'caducado';

  -- Sensores desconectados
  INSERT INTO tmp_avisos
  SELECT CONCAT('disp-', d.dispositivo_id), 'dispositivo_desconectado', 'info',
         CONCAT(d.nombre, ' desconectado'),
         CONCAT('No recibimos datos del ', COALESCE(d.modelo, 'dispositivo'),
                ' en ', LOWER(COALESCE(d.ubicacion, 'tu cocina')),
                '. Revisa la batería (', COALESCE(d.bateria_pct, 0), '%) o el WiFi.'),
         NULL, d.dispositivo_id
    FROM vista_dispositivos d
   WHERE d.hogar_id = p_hogar_id AND d.estado = 'activo' AND NOT d.en_linea;

  -- Sensor de gas: posible alimento en mal estado (> 400 ppm)
  INSERT INTO tmp_avisos
  SELECT CONCAT('gas-', d.dispositivo_id), 'frescura', 'peligro',
         'Posible alimento en mal estado',
         CONCAT('El sensor de frescura detecta ', ROUND(d.ultimo_gas_ppm),
                ' ppm de gases en el refrigerador. Revisa carnes y frutas.'),
         NULL, d.dispositivo_id
    FROM vista_dispositivos d
   WHERE d.hogar_id = p_hogar_id AND d.en_linea AND d.ultimo_gas_ppm > 400;

  -- Resolver los que ya no aplican
  UPDATE notificaciones n
     SET n.resuelta_en = NOW()
   WHERE n.hogar_id = p_hogar_id AND n.activa
     AND n.tipo IN ('caducidad_proxima','caducado','existencia_baja','dispositivo_desconectado','frescura')
     AND NOT EXISTS (SELECT 1 FROM tmp_avisos t WHERE t.clave = n.clave AND t.tipo = n.tipo);

  -- Crear los nuevos
  INSERT INTO notificaciones (hogar_id, clave, tipo, nivel, titulo, mensaje, alimento_id, dispositivo_id)
  SELECT p_hogar_id, t.clave, t.tipo, t.nivel, t.titulo, t.mensaje, t.alimento_id, t.dispositivo_id
    FROM tmp_avisos t
   WHERE NOT EXISTS (SELECT 1 FROM notificaciones n
                      WHERE n.hogar_id = p_hogar_id AND n.activa AND n.clave = t.clave AND n.tipo = t.tipo);

  DROP TEMPORARY TABLE tmp_avisos;
END$$

-- Cada lectura actualiza "Última conexión" y, si es de batería, el porcentaje.
CREATE TRIGGER trg_lecturas_actualizan_dispositivo
AFTER INSERT ON lecturas_sensor
FOR EACH ROW
BEGIN
  UPDATE dispositivos_iot
     SET ultima_conexion = IF(ultima_conexion IS NULL OR NEW.leido_en > ultima_conexion,
                              NEW.leido_en, ultima_conexion),
         bateria_pct = IF(NEW.tipo_lectura = 'bateria',
                          LEAST(100, GREATEST(0, ROUND(NEW.valor))), bateria_pct)
   WHERE id = NEW.dispositivo_id;
END$$

DELIMITER ;

-- =====================================================================
-- 12. DATOS DE EJEMPLO (los mismos que trae la app)
-- =====================================================================
-- Fechas relativas a CURDATE(): al ejecutarlo hoy, la alacena se ve
-- igual que en la app (el yogur caducó ayer, el pollo caduca mañana...).
-- Cuentas de prueba:  admin@qhdc.mx / admin123   ·   miembro@qhdc.mx / miembro123
-- (las contraseñas van con hash bcrypt, costo 12)

-- ---------- Catálogos ----------
INSERT INTO unidades_medida (id, codigo, nombre, tipo) VALUES
  (1, 'g', 'Gramos', 'masa'),
  (2, 'kg', 'Kilogramos', 'masa'),
  (3, 'L', 'Litros', 'volumen'),
  (4, 'ml', 'Mililitros', 'volumen'),
  (5, 'pz', 'Piezas', 'conteo'),
  (6, 'manojo', 'Manojos', 'conteo');

INSERT INTO categorias_alimento (id, nombre, perecibilidad, icono) VALUES
  (1, 'Granos y cereales', 'baja', 'fa-wheat-awn'),
  (2, 'Lácteos', 'alta', 'fa-cheese'),
  (3, 'Carnes y pescados', 'alta', 'fa-drumstick-bite'),
  (4, 'Verduras', 'alta', 'fa-carrot'),
  (5, 'Frutas', 'media', 'fa-apple-whole'),
  (6, 'Bebidas', 'baja', 'fa-mug-hot'),
  (7, 'Otros', 'media', 'fa-box-open');

INSERT INTO catalogo_alimentos (id, nombre, categoria_id, unidad_id, icono, color, cantidad_tipica,
                                vida_util_dias, precio_estimado, ubicacion_sugerida, reconocible_camara) VALUES
  (1, 'Manzana', 5, 5, 'fa-apple-whole', 'tomate', 6, 14, 30, 'refrigerador', TRUE),
  (2, 'Plátano', 5, 5, 'fa-lemon', 'mostaza', 6, 5, 20, 'refrigerador', TRUE),
  (3, 'Jitomate', 4, 5, 'fa-apple-whole', 'tomate', 5, 6, 25, 'refrigerador', TRUE),
  (4, 'Leche', 2, 3, 'fa-glass-water', 'cafe', 1, 7, 28, 'refrigerador', TRUE),
  (5, 'Huevo', 2, 5, 'fa-egg', 'mostaza', 12, 20, 45, 'refrigerador', TRUE),
  (6, 'Queso Oaxaca', 2, 1, 'fa-cheese', 'mostaza', 400, 12, 70, 'refrigerador', TRUE),
  (7, 'Zanahoria', 4, 5, 'fa-carrot', 'tomate', 6, 14, 12, 'refrigerador', TRUE),
  (8, 'Brócoli', 4, 5, 'fa-leaf', 'oliva', 1, 5, 22, 'refrigerador', TRUE),
  (9, 'Limón', 5, 5, 'fa-lemon', 'oliva', 10, 14, 20, 'refrigerador', TRUE),
  (10, 'Yogur natural', 2, 3, 'fa-bottle-water', 'cafe', 1, 10, 35, 'refrigerador', TRUE),
  (11, 'Arroz', 1, 1, 'fa-bowl-rice', 'cafe', 1000, 365, 32, 'despensa', FALSE),
  (12, 'Frijol negro', 1, 1, 'fa-jar', 'cafe', 1000, 365, 38, 'despensa', FALSE),
  (13, 'Pechuga de pollo', 3, 1, 'fa-drumstick-bite', 'tomate', 1000, 3, 95, 'refrigerador', FALSE);

-- ---------- Usuarios y hogar ----------
INSERT INTO usuarios (id, nombre, correo, contrasena_hash, ultimo_acceso) VALUES
  (1, 'Tadeo Contreras', 'admin@qhdc.mx',   '$2b$12$vw6uFchex9kGxGlYbEZRFeFbC2l5pckPmSp.u1lLw09cpUdRjuys6', NOW()),
  (2, 'Marilú Ramírez',  'miembro@qhdc.mx', '$2b$12$JPSb0oN/I.lKH8tJuTkIFOW67.N6U2K7C7MaZMn77HqZVaH9JYHx.', NOW() - INTERVAL 1 DAY);

INSERT INTO hogares (id, nombre, personas, creado_por, creado_en) VALUES
  (1, 'Casa Contreras', '3-4', 1, NOW() - INTERVAL 30 DAY);

INSERT INTO hogar_miembros (hogar_id, usuario_id, rol, unido_en) VALUES
  (1, 1, 'administrador', NOW() - INTERVAL 30 DAY),
  (1, 2, 'miembro',       NOW() - INTERVAL 29 DAY);

INSERT INTO invitaciones_hogar (hogar_id, correo, rol, token_hash, invitado_por, expira_en) VALUES
  (1, 'axel@qhdc.mx', 'miembro', SHA2('invitacion-demo-axel', 256), 1, NOW() + INTERVAL 7 DAY);

INSERT INTO preferencias_usuario (usuario_id, tema, sonidos, menu_compacto, vista_alacena) VALUES
  (1, 'sistema', TRUE, FALSE, 'frascos'),
  (2, 'oscuro',  TRUE, TRUE,  'lista');

INSERT INTO recorridos_vistos (usuario_id, pantalla, completado) VALUES
  (1, 'dashboard', TRUE), (1, 'inventario', TRUE), (2, 'dashboard', FALSE);

INSERT INTO ubicaciones_almacenamiento (id, hogar_id, nombre, tipo, orden) VALUES
  (1, 1, 'Refrigerador', 'refrigerador', 1),
  (2, 1, 'Despensa',     'despensa',     2),
  (3, 1, 'Congelador',   'congelador',   3);

-- ---------- Alacena: 16 alimentos (cantidad_llena = "Lleno es") ----------
INSERT INTO alimentos (id, hogar_id, categoria_id, ubicacion_id, unidad_id, catalogo_id, nombre, icono, color,
                       cantidad_llena, precio_estimado, vida_util_dias, dias_aviso_caducidad, origen, creado_por) VALUES
  (1, 1, 1, 2, 1, 11, 'Arroz', 'fa-bowl-rice', 'cafe', 1000, 32, 365, 3, 'sensor', 1),
  (2, 1, 1, 2, 1, 12, 'Frijol negro', 'fa-jar', 'cafe', 1000, 38, 365, 3, 'sensor', 1),
  (3, 1, 1, 2, 1, NULL, 'Pasta', 'fa-wheat-awn', 'mostaza', 500, 18, 365, 3, 'sensor', 1),
  (4, 1, 6, 2, 1, NULL, 'Café molido', 'fa-mug-hot', 'cafe', 400, 95, 180, 3, 'sensor', 1),
  (5, 1, 2, 1, 3, 4, 'Leche', 'fa-glass-water', 'cafe', 2, 28, 7, 3, 'manual', 1),
  (6, 1, 2, 1, 5, 5, 'Huevo', 'fa-egg', 'mostaza', 30, 75, 21, 3, 'manual', 1),
  (7, 1, 3, 1, 1, 13, 'Pechuga de pollo', 'fa-drumstick-bite', 'tomate', 1000, 95, 3, 3, 'manual', 1),
  (8, 1, 4, 1, 6, NULL, 'Espinaca', 'fa-leaf', 'oliva', 1, 15, 5, 3, 'camara', 1),
  (9, 1, 4, 1, 5, 3, 'Jitomate', 'fa-apple-whole', 'tomate', 8, 25, 7, 3, 'camara', 1),
  (10, 1, 2, 1, 1, 6, 'Queso Oaxaca', 'fa-cheese', 'mostaza', 400, 70, 12, 3, 'manual', 1),
  (11, 1, 4, 1, 5, 7, 'Zanahoria', 'fa-carrot', 'tomate', 8, 12, 14, 3, 'manual', 1),
  (12, 1, 1, 1, 2, NULL, 'Tortilla de maíz', 'fa-bread-slice', 'mostaza', 1, 22, 5, 3, 'manual', 1),
  (13, 1, 2, 1, 3, 10, 'Yogur natural', 'fa-bottle-water', 'cafe', 1, 35, 10, 3, 'manual', 1),
  (14, 1, 5, 1, 5, 9, 'Limón', 'fa-lemon', 'oliva', 12, 20, 14, 3, 'manual', 1),
  (15, 1, 3, 3, 1, NULL, 'Filete de pescado', 'fa-fish', 'mostaza', 1000, 110, 60, 3, 'manual', 1),
  (16, 1, 4, 1, 5, NULL, 'Chile serrano', 'fa-pepper-hot', 'oliva', 20, 10, 10, 3, 'manual', 1);

-- Lotes: el último de cada alimento es el que hay hoy; los anteriores ya se acabaron
INSERT INTO lotes_alimento (id, hogar_id, alimento_id, cantidad_inicial, cantidad_actual, fecha_ingreso,
                            fecha_caducidad, estado, origen) VALUES
  (1, 1, 1, 472.02, 200, CURDATE() - INTERVAL 8 DAY, CURDATE() + INTERVAL 180 DAY, 'disponible', 'sensor'),
  (2, 1, 2, 936.45, 650, CURDATE() - INTERVAL 8 DAY, CURDATE() + INTERVAL 240 DAY, 'disponible', 'sensor'),
  (3, 1, 3, 34.95, 0, CURDATE() - INTERVAL 8 DAY, CURDATE() + INTERVAL 357 DAY, 'agotado', 'sensor'),
  (4, 1, 3, 487.6, 300, CURDATE() - INTERVAL 6 DAY, CURDATE() + INTERVAL 200 DAY, 'disponible', 'sensor'),
  (5, 1, 4, 380.12, 280, CURDATE() - INTERVAL 8 DAY, CURDATE() + INTERVAL 90 DAY, 'disponible', 'sensor'),
  (6, 1, 5, 1.09, 0, CURDATE() - INTERVAL 8 DAY, CURDATE() - INTERVAL 1 DAY, 'agotado', 'compra'),
  (7, 1, 5, 1.76, 0.4, CURDATE() - INTERVAL 4 DAY, CURDATE() + INTERVAL 3 DAY, 'disponible', 'compra'),
  (8, 1, 6, 16.62, 4, CURDATE() - INTERVAL 8 DAY, CURDATE() + INTERVAL 12 DAY, 'disponible', 'compra'),
  (9, 1, 7, 877.79, 0, CURDATE() - INTERVAL 8 DAY, CURDATE() - INTERVAL 2 DAY, 'agotado', 'compra'),
  (10, 1, 7, 963.9, 800, CURDATE() - INTERVAL 1 DAY, CURDATE() + INTERVAL 1 DAY, 'disponible', 'compra'),
  (11, 1, 8, 0.98, 0, CURDATE() - INTERVAL 8 DAY, CURDATE() - INTERVAL 3 DAY, 'agotado', 'camara'),
  (12, 1, 8, 0.91, 0, CURDATE() - INTERVAL 4 DAY, CURDATE() + INTERVAL 1 DAY, 'agotado', 'camara'),
  (13, 1, 8, 1, 1, CURDATE(), CURDATE() + INTERVAL 2 DAY, 'disponible', 'camara'),
  (14, 1, 9, 5.21, 0, CURDATE() - INTERVAL 8 DAY, CURDATE() - INTERVAL 1 DAY, 'agotado', 'camara'),
  (15, 1, 9, 6.78, 5, CURDATE() - INTERVAL 2 DAY, CURDATE() + INTERVAL 5 DAY, 'disponible', 'camara'),
  (16, 1, 10, 58.24, 0, CURDATE() - INTERVAL 8 DAY, CURDATE() + INTERVAL 4 DAY, 'agotado', 'compra'),
  (17, 1, 10, 392.69, 250, CURDATE() - INTERVAL 5 DAY, CURDATE() + INTERVAL 8 DAY, 'disponible', 'compra'),
  (18, 1, 11, 3.14, 0, CURDATE() - INTERVAL 8 DAY, CURDATE() + INTERVAL 6 DAY, 'agotado', 'compra'),
  (19, 1, 11, 7.68, 6, CURDATE() - INTERVAL 2 DAY, CURDATE() + INTERVAL 10 DAY, 'disponible', 'compra'),
  (20, 1, 12, 0.73, 0, CURDATE() - INTERVAL 8 DAY, CURDATE() - INTERVAL 3 DAY, 'agotado', 'compra'),
  (21, 1, 12, 0.96, 0.3, CURDATE() - INTERVAL 4 DAY, CURDATE() + INTERVAL 4 DAY, 'disponible', 'compra'),
  (22, 1, 13, 0.61, 0, CURDATE() - INTERVAL 8 DAY, CURDATE() + INTERVAL 2 DAY, 'agotado', 'compra'),
  (23, 1, 13, 0.91, 0.5, CURDATE() - INTERVAL 3 DAY, CURDATE() - INTERVAL 1 DAY, 'disponible', 'compra'),
  (24, 1, 14, 3.53, 0, CURDATE() - INTERVAL 8 DAY, CURDATE() + INTERVAL 6 DAY, 'agotado', 'compra'),
  (25, 1, 14, 11.74, 8, CURDATE() - INTERVAL 3 DAY, CURDATE() + INTERVAL 7 DAY, 'disponible', 'compra'),
  (26, 1, 15, 767.77, 500, CURDATE() - INTERVAL 8 DAY, CURDATE() + INTERVAL 30 DAY, 'disponible', 'compra'),
  (27, 1, 16, 17.59, 10, CURDATE() - INTERVAL 8 DAY, CURDATE() + INTERVAL 6 DAY, 'disponible', 'compra');

-- Entradas (compras / rellenos)
INSERT INTO movimientos_inventario (hogar_id, alimento_id, lote_id, tipo, cantidad_delta, origen, usuario_id, registrado_en) VALUES
  (1, 1, 1, 'entrada', 472.02, 'sensor', 1, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 2, 2, 'entrada', 936.45, 'sensor', 2, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 3, 3, 'entrada', 34.95, 'sensor', 1, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 3, 4, 'entrada', 487.6, 'sensor', 1, CURDATE() - INTERVAL 6 DAY + INTERVAL 8 HOUR),
  (1, 4, 5, 'entrada', 380.12, 'sensor', 2, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 5, 6, 'entrada', 1.09, 'compra', 1, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 5, 7, 'entrada', 1.76, 'compra', 1, CURDATE() - INTERVAL 4 DAY + INTERVAL 8 HOUR),
  (1, 6, 8, 'entrada', 16.62, 'compra', 2, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 7, 9, 'entrada', 877.79, 'compra', 1, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 7, 10, 'entrada', 963.9, 'compra', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 8 HOUR),
  (1, 8, 11, 'entrada', 0.98, 'camara', 2, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 8, 12, 'entrada', 0.91, 'camara', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 8 HOUR),
  (1, 8, 13, 'entrada', 1, 'camara', 2, CURDATE() + INTERVAL 8 HOUR),
  (1, 9, 14, 'entrada', 5.21, 'camara', 1, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 9, 15, 'entrada', 6.78, 'camara', 1, CURDATE() - INTERVAL 2 DAY + INTERVAL 8 HOUR),
  (1, 10, 16, 'entrada', 58.24, 'compra', 2, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 10, 17, 'entrada', 392.69, 'compra', 2, CURDATE() - INTERVAL 5 DAY + INTERVAL 8 HOUR),
  (1, 11, 18, 'entrada', 3.14, 'compra', 1, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 11, 19, 'entrada', 7.68, 'compra', 1, CURDATE() - INTERVAL 2 DAY + INTERVAL 8 HOUR),
  (1, 12, 20, 'entrada', 0.73, 'compra', 2, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 12, 21, 'entrada', 0.96, 'compra', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 8 HOUR),
  (1, 13, 22, 'entrada', 0.61, 'compra', 1, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 13, 23, 'entrada', 0.91, 'compra', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 8 HOUR),
  (1, 14, 24, 'entrada', 3.53, 'compra', 2, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 14, 25, 'entrada', 11.74, 'compra', 2, CURDATE() - INTERVAL 3 DAY + INTERVAL 8 HOUR),
  (1, 15, 26, 'entrada', 767.77, 'compra', 1, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR),
  (1, 16, 27, 'entrada', 17.59, 'compra', 2, CURDATE() - INTERVAL 8 DAY + INTERVAL 8 HOUR);

-- Consumos de los últimos 7 días (gráfica semanal y predicción)
INSERT INTO movimientos_inventario (hogar_id, alimento_id, lote_id, tipo, cantidad_delta, origen, usuario_id, registrado_en) VALUES
  (1, 1, 1, 'consumo', -27.93, 'sensor', NULL, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 1, 1, 'consumo', -45.26, 'sensor', NULL, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 1, 1, 'consumo', -42.7, 'sensor', NULL, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 1, 1, 'consumo', -34.63, 'sensor', NULL, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 1, 1, 'consumo', -29.43, 'sensor', NULL, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 1, 1, 'consumo', -47.46, 'sensor', NULL, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 1, 1, 'consumo', -44.61, 'sensor', NULL, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 2, 2, 'consumo', -24.76, 'sensor', NULL, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 2, 2, 'consumo', -45.67, 'sensor', NULL, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 2, 2, 'consumo', -50.13, 'sensor', NULL, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 2, 2, 'consumo', -32.24, 'sensor', NULL, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 2, 2, 'consumo', -36.79, 'sensor', NULL, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 2, 2, 'consumo', -43.22, 'sensor', NULL, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 2, 2, 'consumo', -53.64, 'sensor', NULL, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 3, 3, 'consumo', -34.95, 'sensor', NULL, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 3, 4, 'consumo', -24.8, 'sensor', NULL, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 3, 4, 'consumo', -34.6, 'sensor', NULL, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 3, 4, 'consumo', -36.9, 'sensor', NULL, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 3, 4, 'consumo', -24.23, 'sensor', NULL, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 3, 4, 'consumo', -40.42, 'sensor', NULL, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 3, 4, 'consumo', -26.65, 'sensor', NULL, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 4, 5, 'consumo', -10.08, 'sensor', NULL, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 4, 5, 'consumo', -19.74, 'sensor', NULL, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 4, 5, 'consumo', -13.3, 'sensor', NULL, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 4, 5, 'consumo', -9.22, 'sensor', NULL, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 4, 5, 'consumo', -19.92, 'sensor', NULL, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 4, 5, 'consumo', -19.53, 'sensor', NULL, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 4, 5, 'consumo', -8.33, 'sensor', NULL, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 5, 6, 'consumo', -0.4, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 5, 6, 'consumo', -0.37, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 5, 6, 'consumo', -0.32, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 5, 7, 'consumo', -0.33, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 5, 7, 'consumo', -0.5, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 5, 7, 'consumo', -0.25, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 5, 7, 'consumo', -0.28, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 6, 8, 'consumo', -1.73, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 6, 8, 'consumo', -1.73, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 6, 8, 'consumo', -2.49, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 6, 8, 'consumo', -1.38, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 6, 8, 'consumo', -1.69, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 6, 8, 'consumo', -2.08, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 6, 8, 'consumo', -1.52, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 7, 9, 'consumo', -114.37, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 7, 9, 'consumo', -146.05, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 7, 9, 'consumo', -201.86, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 7, 9, 'consumo', -114.72, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 7, 9, 'consumo', -207.54, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 7, 9, 'consumo', -93.25, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 7, 10, 'consumo', -163.9, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 8, 11, 'consumo', -0.34, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 8, 11, 'consumo', -0.37, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 8, 11, 'consumo', -0.27, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 8, 12, 'consumo', -0.19, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 8, 12, 'consumo', -0.29, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 8, 12, 'consumo', -0.23, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 8, 12, 'consumo', -0.2, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 9, 14, 'consumo', -1.41, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 9, 14, 'consumo', -1.13, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 9, 14, 'consumo', -1.16, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 9, 14, 'consumo', -0.92, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 9, 14, 'consumo', -0.59, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 9, 15, 'consumo', -0.94, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 9, 15, 'consumo', -0.84, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 10, 16, 'consumo', -28.35, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 10, 16, 'consumo', -29.89, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 10, 17, 'consumo', -22.89, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 10, 17, 'consumo', -23.63, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 10, 17, 'consumo', -28.36, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 10, 17, 'consumo', -28.67, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 10, 17, 'consumo', -39.14, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 11, 18, 'consumo', -0.79, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 11, 18, 'consumo', -0.74, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 11, 18, 'consumo', -0.48, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 11, 18, 'consumo', -0.4, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 11, 18, 'consumo', -0.73, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 11, 19, 'consumo', -0.83, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 11, 19, 'consumo', -0.85, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 12, 20, 'consumo', -0.23, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 12, 20, 'consumo', -0.24, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 12, 20, 'consumo', -0.26, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 12, 21, 'consumo', -0.17, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 12, 21, 'consumo', -0.17, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 12, 21, 'consumo', -0.11, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 12, 21, 'consumo', -0.21, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 13, 22, 'consumo', -0.18, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 13, 22, 'consumo', -0.18, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 13, 22, 'consumo', -0.14, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 13, 22, 'consumo', -0.11, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 13, 23, 'consumo', -0.08, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 13, 23, 'consumo', -0.21, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 13, 23, 'consumo', -0.12, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 14, 24, 'consumo', -0.63, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 14, 24, 'consumo', -0.95, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 14, 24, 'consumo', -1.08, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 14, 24, 'consumo', -0.87, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 14, 25, 'consumo', -1.34, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 14, 25, 'consumo', -0.96, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 14, 25, 'consumo', -1.44, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 15, 26, 'consumo', -22.88, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 15, 26, 'consumo', -31.52, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 15, 26, 'consumo', -54.27, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 15, 26, 'consumo', -50.56, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 15, 26, 'consumo', -26.5, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 15, 26, 'consumo', -38.89, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 15, 26, 'consumo', -43.15, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR),
  (1, 16, 27, 'consumo', -1.3, 'manual', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 13 HOUR),
  (1, 16, 27, 'consumo', -0.76, 'manual', 2, CURDATE() - INTERVAL 2 DAY + INTERVAL 13 HOUR),
  (1, 16, 27, 'consumo', -1.33, 'manual', 1, CURDATE() - INTERVAL 3 DAY + INTERVAL 13 HOUR),
  (1, 16, 27, 'consumo', -1.14, 'manual', 2, CURDATE() - INTERVAL 4 DAY + INTERVAL 13 HOUR),
  (1, 16, 27, 'consumo', -1.18, 'manual', 1, CURDATE() - INTERVAL 5 DAY + INTERVAL 13 HOUR),
  (1, 16, 27, 'consumo', -1.19, 'manual', 2, CURDATE() - INTERVAL 6 DAY + INTERVAL 13 HOUR),
  (1, 16, 27, 'consumo', -0.69, 'manual', 1, CURDATE() - INTERVAL 7 DAY + INTERVAL 13 HOUR);

-- ---------- Sensores IoT ----------
-- La clave real la guarda el firmware del ESP32; aquí solo su hash SHA-256.
INSERT INTO dispositivos_iot (id, hogar_id, identificador, nombre, tipo, modelo, ubicacion_id, clave_hash,
                              bateria_pct, senal_dbm, ultima_calibracion, creado_en) VALUES
  (1, 1, 'esp32-despensa-001',   'Báscula de despensa A',    'bascula',            'ESP32 + HX711',          2, SHA2('clave-esp32-despensa-001', 256),   86, -58, NOW() - INTERVAL 10 DAY, NOW() - INTERVAL 30 DAY),
  (2, 1, 'esp32-despensa-002',   'Báscula de despensa B',    'bascula',            'ESP32 + HX711',          2, SHA2('clave-esp32-despensa-002', 256),   72, -63, NOW() - INTERVAL 10 DAY, NOW() - INTERVAL 30 DAY),
  (3, 1, 'esp32-refri-001',      'Sensor de frescura',       'sensor_frescura',    'ESP32 + MQ-135 + DHT22', 1, SHA2('clave-esp32-refri-001', 256),      64, -70, NULL,                    NOW() - INTERVAL 30 DAY),
  (4, 1, 'esp32-congelador-001', 'Termómetro de congelador', 'sensor_temperatura', 'ESP32 + DS18B20',        3, SHA2('clave-esp32-congelador-001', 256), 12, -88, NULL,                    NOW() - INTERVAL 30 DAY);

-- Cada báscula pesa dos frascos (canal 1 y 2 del HX711)
INSERT INTO dispositivo_alimentos (hogar_id, dispositivo_id, canal, alimento_id) VALUES
  (1, 1, 1, 1), (1, 1, 2, 2),
  (1, 2, 1, 3), (1, 2, 2, 4);

INSERT INTO eventos_dispositivo (hogar_id, dispositivo_id, tipo, usuario_id, creado_en, detalle) VALUES
  (1, 1, 'vinculado',    1,    NOW() - INTERVAL 30 DAY, 'Arroz y Frijol negro'),
  (1, 2, 'vinculado',    1,    NOW() - INTERVAL 30 DAY, 'Pasta y Café molido'),
  (1, 3, 'vinculado',    1,    NOW() - INTERVAL 30 DAY, NULL),
  (1, 4, 'vinculado',    1,    NOW() - INTERVAL 30 DAY, NULL),
  (1, 1, 'calibrado',    1,    NOW() - INTERVAL 10 DAY, 'Tara en ceros'),
  (1, 2, 'calibrado',    1,    NOW() - INTERVAL 10 DAY, 'Tara en ceros'),
  (1, 4, 'desconectado', NULL, NOW() - INTERVAL 2 HOUR, 'Batería baja');

-- Lecturas de la última hora (el trigger actualiza "Última conexión").
-- Un sensor se ve "En línea" si mandó datos en los últimos 30 s, así que
-- al consultar más tarde aparecerán desconectados hasta que el ESP32 envíe datos.
INSERT INTO lecturas_sensor (hogar_id, dispositivo_id, alimento_id, tipo_lectura, valor, unidad, leido_en, aplicada_inventario) VALUES
  (1, 1, 1, 'peso', 200, 'g', NOW(3) - INTERVAL 45 MINUTE, TRUE),
  (1, 1, 2, 'peso', 650, 'g', NOW(3) - INTERVAL 45 MINUTE, TRUE),
  (1, 1, 1, 'peso', 200, 'g', NOW(3) - INTERVAL 30 MINUTE, TRUE),
  (1, 1, 2, 'peso', 650, 'g', NOW(3) - INTERVAL 30 MINUTE, TRUE),
  (1, 1, 1, 'peso', 200, 'g', NOW(3) - INTERVAL 15 MINUTE, TRUE),
  (1, 1, 2, 'peso', 650, 'g', NOW(3) - INTERVAL 15 MINUTE, TRUE),
  (1, 1, 1, 'peso', 200, 'g', NOW(3) - INTERVAL 5 SECOND, TRUE),
  (1, 1, 2, 'peso', 650, 'g', NOW(3) - INTERVAL 5 SECOND, TRUE),
  (1, 1, NULL, 'bateria', 86, '%', NOW(3) - INTERVAL 5 SECOND, FALSE),
  (1, 2, 3, 'peso', 300, 'g', NOW(3) - INTERVAL 45 MINUTE, TRUE),
  (1, 2, 4, 'peso', 280, 'g', NOW(3) - INTERVAL 45 MINUTE, TRUE),
  (1, 2, 3, 'peso', 300, 'g', NOW(3) - INTERVAL 30 MINUTE, TRUE),
  (1, 2, 4, 'peso', 280, 'g', NOW(3) - INTERVAL 30 MINUTE, TRUE),
  (1, 2, 3, 'peso', 300, 'g', NOW(3) - INTERVAL 15 MINUTE, TRUE),
  (1, 2, 4, 'peso', 280, 'g', NOW(3) - INTERVAL 15 MINUTE, TRUE),
  (1, 2, 3, 'peso', 300, 'g', NOW(3) - INTERVAL 5 SECOND, TRUE),
  (1, 2, 4, 'peso', 280, 'g', NOW(3) - INTERVAL 5 SECOND, TRUE),
  (1, 2, NULL, 'bateria', 72, '%', NOW(3) - INTERVAL 5 SECOND, FALSE),
  (1, 3, NULL, 'gas', 175, 'ppm', NOW(3) - INTERVAL 45 MINUTE, FALSE),
  (1, 3, NULL, 'temperatura', 4.0, '°C', NOW(3) - INTERVAL 45 MINUTE, FALSE),
  (1, 3, NULL, 'humedad', 60, '%', NOW(3) - INTERVAL 45 MINUTE, FALSE),
  (1, 3, NULL, 'gas', 182, 'ppm', NOW(3) - INTERVAL 30 MINUTE, FALSE),
  (1, 3, NULL, 'temperatura', 4.1, '°C', NOW(3) - INTERVAL 30 MINUTE, FALSE),
  (1, 3, NULL, 'humedad', 60, '%', NOW(3) - INTERVAL 30 MINUTE, FALSE),
  (1, 3, NULL, 'gas', 186, 'ppm', NOW(3) - INTERVAL 15 MINUTE, FALSE),
  (1, 3, NULL, 'temperatura', 4.3, '°C', NOW(3) - INTERVAL 15 MINUTE, FALSE),
  (1, 3, NULL, 'humedad', 61, '%', NOW(3) - INTERVAL 15 MINUTE, FALSE),
  (1, 3, NULL, 'gas', 190, 'ppm', NOW(3) - INTERVAL 3 SECOND, FALSE),
  (1, 3, NULL, 'temperatura', 4.2, '°C', NOW(3) - INTERVAL 3 SECOND, FALSE),
  (1, 3, NULL, 'humedad', 61, '%', NOW(3) - INTERVAL 3 SECOND, FALSE),
  (1, 3, NULL, 'bateria', 64, '%', NOW(3) - INTERVAL 3 SECOND, FALSE),
  (1, 4, NULL, 'temperatura', -18.2, '°C', NOW(3) - INTERVAL 165 MINUTE, FALSE),
  (1, 4, NULL, 'temperatura', -17.9, '°C', NOW(3) - INTERVAL 150 MINUTE, FALSE),
  (1, 4, NULL, 'temperatura', -17.6, '°C', NOW(3) - INTERVAL 135 MINUTE, FALSE),
  (1, 4, NULL, 'temperatura', -17.5, '°C', NOW(3) - INTERVAL 120 MINUTE, FALSE),
  (1, 4, NULL, 'bateria', 12, '%', NOW(3) - INTERVAL 120 MINUTE, FALSE);

-- ---------- Recetas del sistema (hogar_id NULL = disponibles para todos) ----------
INSERT INTO recetas (id, hogar_id, nombre, porciones, tiempo_minutos, dificultad, icono, color) VALUES
  (1, NULL, 'Arroz con pollo y espinaca', 4, 40, 'facil', 'fa-bowl-food', 'tomate'),
  (2, NULL, 'Tinga de pollo', 4, 35, 'facil', 'fa-fire-burner', 'mostaza'),
  (3, NULL, 'Omelette de espinaca y queso', 1, 10, 'muy_facil', 'fa-egg', 'oliva'),
  (4, NULL, 'Chilaquiles verdes con huevo', 2, 25, 'facil', 'fa-utensils', 'oliva'),
  (5, NULL, 'Pasta al pomodoro', 3, 20, 'facil', 'fa-wheat-awn', 'tomate'),
  (6, NULL, 'Frijoles de la olla con pico de gallo', 6, 90, 'media', 'fa-jar', 'cafe'),
  (7, NULL, 'Pescado al limón con arroz', 2, 30, 'media', 'fa-fish', 'mostaza'),
  (8, NULL, 'Arroz con leche', 6, 45, 'facil', 'fa-mug-hot', 'cafe');

-- palabra_clave se busca dentro del nombre del alimento: 'Pollo' -> 'Pechuga de pollo'
INSERT INTO receta_ingredientes (receta_id, orden, nombre, palabra_clave, cantidad_texto, cantidad, unidad_id) VALUES
  (1, 1, 'Arroz', 'Arroz', '1 ½ tazas', NULL, NULL),
  (1, 2, 'Pollo', 'Pollo', '500 g', 500, 1),
  (1, 3, 'Espinaca', 'Espinaca', '1 manojo', 1, 6),
  (1, 4, 'Jitomate', 'Jitomate', '2 piezas', 2, 5),
  (2, 1, 'Pollo', 'Pollo', '500 g', 500, 1),
  (2, 2, 'Jitomate', 'Jitomate', '3 piezas', 3, 5),
  (2, 3, 'Chile', 'Chile', '2 piezas', 2, 5),
  (2, 4, 'Tortilla', 'Tortilla', '12 piezas', 12, 5),
  (3, 1, 'Huevo', 'Huevo', '2 piezas', 2, 5),
  (3, 2, 'Espinaca', 'Espinaca', '1 puño', NULL, NULL),
  (3, 3, 'Queso', 'Queso', '50 g', 50, 1),
  (4, 1, 'Tortilla', 'Tortilla', '8 piezas', 8, 5),
  (4, 2, 'Huevo', 'Huevo', '2 piezas', 2, 5),
  (4, 3, 'Chile', 'Chile', '3 piezas', 3, 5),
  (4, 4, 'Queso', 'Queso', '80 g', 80, 1),
  (5, 1, 'Pasta', 'Pasta', '250 g', 250, 1),
  (5, 2, 'Jitomate', 'Jitomate', '4 piezas', 4, 5),
  (5, 3, 'Queso', 'Queso', '60 g', 60, 1),
  (6, 1, 'Frijol', 'Frijol', '500 g', 500, 1),
  (6, 2, 'Jitomate', 'Jitomate', '2 piezas', 2, 5),
  (6, 3, 'Chile', 'Chile', '1 pieza', 1, 5),
  (6, 4, 'Limón', 'Limón', '1 pieza', 1, 5),
  (7, 1, 'Pescado', 'Pescado', '2 filetes', NULL, NULL),
  (7, 2, 'Limón', 'Limón', '2 piezas', 2, 5),
  (7, 3, 'Arroz', 'Arroz', '1 taza', NULL, NULL),
  (7, 4, 'Zanahoria', 'Zanahoria', '1 pieza', 1, 5),
  (8, 1, 'Arroz', 'Arroz', '1 taza', NULL, NULL),
  (8, 2, 'Leche', 'Leche', '1 L', 1, 3);

-- minutos_temporizador activa el botón de temporizador en el modo cocina
INSERT INTO receta_pasos (receta_id, orden, texto, minutos_temporizador) VALUES
  (1, 1, 'Corta el pollo en cubos y dóralo con un poco de aceite.', NULL),
  (1, 2, 'Licúa el jitomate con ajo y cebolla, y agrégalo al pollo.', NULL),
  (1, 3, 'Añade el arroz lavado y 3 tazas de agua. Cocina tapado 20 minutos.', 20),
  (1, 4, 'Al final incorpora la espinaca picada y deja reposar 5 minutos.', 5),
  (2, 1, 'Cuece el pollo y deshébralo.', NULL),
  (2, 2, 'Sofríe cebolla en rodajas y agrega el jitomate licuado con el chile.', NULL),
  (2, 3, 'Incorpora el pollo y cocina 10 minutos.', 10),
  (2, 4, 'Sirve sobre tostadas o tortillas calientes.', NULL),
  (3, 1, 'Bate los huevos con una pizca de sal.', NULL),
  (3, 2, 'Vierte en un sartén caliente y agrega espinaca y queso.', NULL),
  (3, 3, 'Dobla a la mitad y cocina 1 minuto más.', 1),
  (4, 1, 'Corta las tortillas en triángulos y dóralas.', NULL),
  (4, 2, 'Prepara una salsa verde con los chiles y báñalas.', NULL),
  (4, 3, 'Sirve con huevo estrellado y queso encima.', NULL),
  (5, 1, 'Cuece la pasta en agua con sal.', NULL),
  (5, 2, 'Cocina el jitomate picado con ajo y aceite hasta que espese.', NULL),
  (5, 3, 'Mezcla con la pasta y termina con queso rallado.', NULL),
  (6, 1, 'Remoja los frijoles desde la noche anterior.', NULL),
  (6, 2, 'Cuécelos con cebolla y sal hasta que estén suaves.', NULL),
  (6, 3, 'Pica jitomate, chile y cebolla; agrega limón para el pico de gallo.', NULL),
  (7, 1, 'Marina el pescado con limón, sal y pimienta 10 minutos.', 10),
  (7, 2, 'Prepara el arroz con la zanahoria en cubitos.', NULL),
  (7, 3, 'Cocina el pescado a la plancha 4 minutos por lado.', 4),
  (8, 1, 'Cuece el arroz en agua con canela hasta que abra.', NULL),
  (8, 2, 'Agrega la leche y azúcar al gusto.', NULL),
  (8, 3, 'Cocina a fuego bajo moviendo hasta que espese.', NULL);

-- Una receta preparada ayer (aparece en el historial)
INSERT INTO recetas_preparadas (hogar_id, receta_id, usuario_id, porciones, preparada_en) VALUES
  (1, 3, 2, 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 9 HOUR);

-- ---------- Foto escaneada hoy (HU-10) ----------
INSERT INTO escaneos (id, hogar_id, usuario_id, referencia_imagen, origen, estado, creado_en, analizado_en, modelo) VALUES
  (1, 1, 1, 'uploads/escaneos/1/demo-refrigerador.jpg', 'camara', 'confirmado',
   CURDATE() + INTERVAL 8 HOUR, CURDATE() + INTERVAL 8 HOUR, 'qhdc-vision-v1');

INSERT INTO identificaciones_ia (hogar_id, escaneo_id, resultado_texto, confianza, caja_x, caja_y, caja_ancho, caja_alto,
                                 catalogo_id, alimento_sugerido_id, cantidad_sugerida, caducidad_sugerida, incluir, estado,
                                 alimento_confirmado_id, cantidad_confirmada, caducidad_confirmada, confirmada_en, movimiento_id) VALUES
  (1, 1, 'Espinaca', 0.9400, 12.00, 30.00, 26.00, 34.00, NULL, 8, 1, CURDATE() + INTERVAL 2 DAY, TRUE, 'confirmada',
   8, 1, CURDATE() + INTERVAL 2 DAY, CURDATE() + INTERVAL 8 HOUR,
   (SELECT id FROM movimientos_inventario m WHERE m.hogar_id = 1 AND m.alimento_id = 8 AND m.tipo = 'entrada' ORDER BY m.registrado_en DESC LIMIT 1)),
  (1, 1, 'Jitomate', 0.9100, 45.00, 40.00, 22.00, 25.00, 3, 9, 5, CURDATE() + INTERVAL 5 DAY, TRUE, 'confirmada',
   9, 5, CURDATE() + INTERVAL 5 DAY, CURDATE() + INTERVAL 8 HOUR, NULL),
  (1, 1, 'Brócoli',  0.6200, 70.00, 55.00, 20.00, 30.00, 8, NULL, 1, CURDATE() + INTERVAL 5 DAY, FALSE, 'rechazada',
   NULL, NULL, NULL, NULL, NULL);

-- ---------- Asistente ----------
INSERT INTO conversaciones_asistente (id, hogar_id, usuario_id, iniciada_en) VALUES
  (1, 1, 1, NOW() - INTERVAL 1 HOUR);
INSERT INTO mensajes_asistente (hogar_id, conversacion_id, autor, contenido, intencion, alimento_id, creado_en) VALUES
  (1, 1, 'usuario',   '¿Qué debo usar primero?', 'usar_primero', NULL, NOW(3) - INTERVAL 60 MINUTE),
  (1, 1, 'asistente', 'Usa primero la pechuga de pollo: caduca mañana. La espinaca y la leche también van pronto.', 'usar_primero', 7, NOW(3) - INTERVAL 60 MINUTE + INTERVAL 1 SECOND),
  (1, 1, 'usuario',   '¿Cuánto me dura la leche?', 'duracion', 5, NOW(3) - INTERVAL 59 MINUTE),
  (1, 1, 'asistente', 'Te queda 0.4 L; a tu ritmo te alcanza para 1 día. Ya está en tu lista de compras.', 'duracion', 5, NOW(3) - INTERVAL 59 MINUTE + INTERVAL 1 SECOND);

-- ---------- Cálculos de IA guardados (HU-05 y HU-06) ----------
INSERT INTO predicciones_consumo (hogar_id, alimento_id, consumo_promedio_diario, dias_restantes,
                                  fecha_agotamiento_estimada, confianza, ventana_dias, metodo)
SELECT hogar_id, alimento_id, promedio_diario, dias_restantes, fecha_agotamiento, 0.8000, 7, 'promedio_7_dias'
  FROM vista_prediccion_consumo
 WHERE hogar_id = 1 AND promedio_diario > 0;

INSERT INTO recomendaciones_consumo (hogar_id, alimento_id, lote_id, receta_sugerida_id, prioridad, motivo,
                                     vigente_hasta, metodo)
SELECT i.hogar_id, i.alimento_id,
       (SELECT l.id FROM lotes_alimento l
         WHERE l.hogar_id = i.hogar_id AND l.alimento_id = i.alimento_id AND l.estado = 'disponible'
         ORDER BY l.fecha_caducidad LIMIT 1),
       (SELECT v.receta_id FROM vista_recetas_disponibilidad v
          JOIN receta_ingredientes ri ON ri.receta_id = v.receta_id
         WHERE v.hogar_id = i.hogar_id AND i.nombre LIKE CONCAT('%', ri.palabra_clave, '%')
         ORDER BY v.puntos DESC, v.coincidencia DESC LIMIT 1),
       IF(i.estado_caducidad = 'urgente', 1, 2),
       IF(i.estado_caducidad = 'urgente', 'Es lo más urgente de tu refrigerador.', 'Caduca en los próximos días.'),
       i.proxima_caducidad + INTERVAL 1 DAY,
       'reglas_caducidad'
  FROM vista_inventario i
 WHERE i.hogar_id = 1 AND i.estado_caducidad IN ('urgente', 'pronto');

-- ---------- Lista del súper ----------
CALL sp_generar_lista(1, 1, @lista_id);
INSERT INTO lista_compras_items (hogar_id, lista_id, nombre_libre, cantidad_texto, precio_estimado, prioridad, motivo, agregado_por)
VALUES (1, @lista_id, 'Aceite de oliva', '1 botella', 120.00, 'baja', 'manual', 1);

-- ---------- Avisos ----------
CALL sp_generar_avisos(1);
-- Tadeo ya vio el aviso del termómetro
INSERT INTO notificaciones_lecturas (notificacion_id, usuario_id)
SELECT id, 1 FROM notificaciones WHERE hogar_id = 1 AND clave = 'disp-4' AND activa;
