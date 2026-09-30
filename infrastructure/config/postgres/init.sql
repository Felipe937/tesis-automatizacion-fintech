-- =============================================================================
-- init.sql — Inicialización de PostgreSQL para n8n Fintech Colombia
-- Ejecutado automáticamente en el primer arranque del contenedor
-- =============================================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Asegurar que el usuario de n8n sólo tenga privilegios sobre su base de datos
-- (El usuario ya se crea con POSTGRES_USER/POSTGRES_PASSWORD en el contenedor)
GRANT ALL PRIVILEGES ON DATABASE n8n_fintech TO n8n_user;

-- Comentario de auditoría (Ley 1581 — Art. 12: Deber de Seguridad)
COMMENT ON DATABASE n8n_fintech IS
  'Base de datos del motor de automatización n8n. Proyecto Fintech Colombia. '
  'Clasificación: CONFIDENCIAL. Ley 1581/2012. Acceso restringido.';
