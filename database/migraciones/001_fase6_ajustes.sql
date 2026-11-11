-- =====================================================================
--  001 · Fase 6: categorías por hogar e inicio de sesión con Google
--  Se aplica con:  npm run db:migrar   (desde backend/)
--  Las bases nuevas ya lo traen en qhdc_base_de_datos.sql.
-- =====================================================================

-- Categorías: las generales (hogar_id NULL) son de todos; cada hogar puede
-- agregar las suyas. "ambito" permite que el nombre sea único por hogar
-- sin chocar con NULL (0 = generales).
ALTER TABLE categorias_alimento
  ADD COLUMN hogar_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN ambito   BIGINT UNSIGNED AS (COALESCE(hogar_id, 0)) STORED AFTER hogar_id,
  DROP INDEX uq_categorias_nombre,
  ADD UNIQUE KEY uq_categorias_ambito_nombre (ambito, nombre),
  ADD KEY idx_categorias_hogar (hogar_id),
  ADD CONSTRAINT fk_categorias_hogar FOREIGN KEY (hogar_id) REFERENCES hogares (id);

-- Google: identificador estable de la cuenta (el "sub" del token de Google)
ALTER TABLE usuarios
  ADD COLUMN google_sub VARCHAR(64) NULL AFTER contrasena_hash,
  ADD UNIQUE KEY uq_usuarios_google (google_sub);
