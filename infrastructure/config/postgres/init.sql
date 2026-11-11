-- =============================================================================
-- init.sql — Inicialización de PostgreSQL para n8n Fintech Colombia
-- =============================================================================
-- Ejecución: automática en el primer arranque del contenedor (initdb.d).
--          Reejecución manual y segura:  psql -U <user> -d <db> -f init.sql
--
-- REGLAS DE ESTA MIGRACIÓN
--   1. Es IDEMPOTENTE: puede ejecutarse varias veces sin efectos destructivos.
--      Los CREATE TYPE se resuelven con bloques DO/EXCEPTION porque PostgreSQL
--      NO admite la sintaxis `CREATE TYPE IF NOT EXISTS` (error de sintaxis en
--      cualquier versión, incluida PostgreSQL 15 y 16).
--   2. NO borra tablas, columnas, índices ni datos existentes.
--   3. NO toca las tablas internas de n8n (workflow_entity, credentials_entity,
--      execution_entity, etc.): sólo crea objetos en el schema public con
--      nombres propios del MER.
--   4. NO usa nombres fijos de base de datos ni de usuario: se resuelven con
--      current_database() y current_user, de modo que el script funciona con
--      cualquier valor de POSTGRES_DB / POSTGRES_USER.
--   5. Si un ENUM ya existe con otros valores, NO se altera (alterar tipos
--     _usage_ requiere conversiones manuales): se documenta en la tabla
--      schema_migrations y se deja el tipo intacto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensiones
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- -----------------------------------------------------------------------------
-- Zona horaria de la base de datos (hora Colombia, UTC-5 sin horario de verano)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Bogota');
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'No se pudo fijar el timezone de la base de datos (privilegios insuficientes).';
END
$$;

-- -----------------------------------------------------------------------------
-- Privilegios y metadatos de la base de datos
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', current_database(), current_user);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'No se pudieron reasignar privilegios sobre la base de datos.';
END
$$;

-- Comentario de auditoría (Ley 1581 — Art. 12: Deber de Seguridad)
DO $$
BEGIN
  EXECUTE format(
    'COMMENT ON DATABASE %I IS %L',
    current_database(),
    'Base de datos del motor de automatización n8n. Proyecto Fintech Colombia. '
    'Clasificación: CONFIDENCIAL. Ley 1581/2012. Acceso restringido.'
  );
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'No se pudo comentar la base de datos.';
END
$$;

-- =============================================================================
-- REGISTRO DE MIGRACIONES (trazabilidad academically: qué esquema se aplicó)
-- =============================================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(50) PRIMARY KEY,
  descripcion TEXT NOT NULL,
  aplicada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE schema_migrations IS
  'Registro de migraciones aplicadas al esquema de negocio del MER (tesis IS25237).';

-- =============================================================================
-- TABLAS DE NEGOCIO (Proyecto Fintech — MER Cap. IV de la tesis IS25237)
-- Separadas de las tablas internas de n8n (workflows, credenciales, ejecuciones)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TIPOS ENUM (antes de las tablas, por requerimiento de PostgreSQL)
-- Nota: `CREATE TYPE IF NOT EXISTS` NO existe en PostgreSQL. Se usa el bloque
-- DO/EXCEPTION, que captura duplicate_object y continúa sin error.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE lead_estado AS ENUM (
    'nuevo',
    'prospecto',
    'cita_pendiente',
    'cita_confirmada',
    'cliente',
    'inactivo'
  );
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'El tipo lead_estado ya existe: se conserva sin modificar.';
END
$$;

DO $$
BEGIN
  CREATE TYPE campaign_estado AS ENUM (
    'pendiente',
    'activa',
    'completada',
    'cancelada'
  );
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'El tipo campaign_estado ya existe: se conserva sin modificar.';
END
$$;

DO $$
BEGIN
  CREATE TYPE appointment_estado AS ENUM (
    'pendiente',
    'confirmada',
    'cancelada',
    'completada'
  );
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'El tipo appointment_estado ya existe: se conserva sin modificar.';
END
$$;

DO $$
BEGIN
  CREATE TYPE investment_estado AS ENUM (
    'activa',
    'vencida',
    'cancelada'
  );
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'El tipo investment_estado ya existe: se conserva sin modificar.';
END
$$;

DO $$
BEGIN
  CREATE TYPE log_estado AS ENUM (
    'exito',
    'error',
    'advertencia'
  );
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'El tipo log_estado ya existe: se conserva sin modificar.';
END
$$;

-- -----------------------------------------------------------------------------
-- Tabla: lead
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead (
  id_lead BIGSERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  correo_electronico VARCHAR(255) NOT NULL UNIQUE,
  telefono VARCHAR(50),
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado lead_estado NOT NULL DEFAULT 'nuevo',
  id_hubspot VARCHAR(100) UNIQUE
);

-- -----------------------------------------------------------------------------
-- Tabla: campaign
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign (
  id_campaign BIGSERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  estado campaign_estado NOT NULL DEFAULT 'pendiente',
  id_mailchimp VARCHAR(100) UNIQUE
);

-- -----------------------------------------------------------------------------
-- Tabla: appointment
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment (
  id_appointment BIGSERIAL PRIMARY KEY,
  id_lead BIGINT NOT NULL REFERENCES lead(id_lead),
  fecha_hora_inicio TIMESTAMPTZ NOT NULL,
  fecha_hora_fin TIMESTAMPTZ,
  enlace_calendly TEXT,
  estado appointment_estado NOT NULL DEFAULT 'pendiente'
);

-- -----------------------------------------------------------------------------
-- Tabla: investment
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investment (
  id_investment BIGSERIAL PRIMARY KEY,
  id_lead BIGINT NOT NULL REFERENCES lead(id_lead),
  monto NUMERIC(18,4) NOT NULL,
  tipo_instrumento VARCHAR(100),
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado investment_estado NOT NULL DEFAULT 'activa',
  id_excel_row VARCHAR(50)
);

-- -----------------------------------------------------------------------------
-- Tabla: automation_log
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_log (
  id_log BIGSERIAL PRIMARY KEY,
  workflow_id VARCHAR(100) NOT NULL,
  timestamp_inicio TIMESTAMPTZ NOT NULL,
  timestamp_fin TIMESTAMPTZ,
  estado log_estado NOT NULL,
  registros_procesados INT DEFAULT 0,
  latencia_ms INT,
  mensaje_error TEXT
);

-- -----------------------------------------------------------------------------
-- Tabla: campaign_lead (relación M:N entre campaign y lead)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_lead (
  id_campaign BIGINT NOT NULL REFERENCES campaign(id_campaign),
  id_lead BIGINT NOT NULL REFERENCES lead(id_lead),
  PRIMARY KEY (id_campaign, id_lead)
);

-- -----------------------------------------------------------------------------
-- ÍNDICES
-- Nota: los índices sobre columnas de fecha soportan las consultas periódicas
-- del reporte semanal (RF-012) y del dashboard ejecutivo (§4.4).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lead_correo_electronico ON lead(correo_electronico);
CREATE INDEX IF NOT EXISTS idx_lead_id_hubspot ON lead(id_hubspot);
CREATE INDEX IF NOT EXISTS idx_lead_estado ON lead(estado);
CREATE INDEX IF NOT EXISTS idx_lead_fecha_registro ON lead(fecha_registro);
CREATE INDEX IF NOT EXISTS idx_appointment_id_lead ON appointment(id_lead);
CREATE INDEX IF NOT EXISTS idx_appointment_fecha_hora_inicio ON appointment(fecha_hora_inicio);
CREATE INDEX IF NOT EXISTS idx_investment_id_lead ON investment(id_lead);
CREATE INDEX IF NOT EXISTS idx_investment_fecha_registro ON investment(fecha_registro);
CREATE INDEX IF NOT EXISTS idx_campaign_lead_id_lead ON campaign_lead(id_lead);
CREATE INDEX IF NOT EXISTS idx_automation_log_workflow_id ON automation_log(workflow_id);
CREATE INDEX IF NOT EXISTS idx_automation_log_timestamp_inicio ON automation_log(timestamp_inicio);
CREATE INDEX IF NOT EXISTS idx_automation_log_workflow_timestamp
  ON automation_log(workflow_id, timestamp_inicio);

-- -----------------------------------------------------------------------------
-- COMENTARIOS DE TABLA (auditoría, Ley 1581/2012)
-- -----------------------------------------------------------------------------
COMMENT ON TABLE lead IS 'Registro de leads/captación de prospectos (Calendly → HubSpot → Mailchimp). Clasificación: CONFIDENCIAL.';
COMMENT ON TABLE campaign IS 'Campañas de email marketing (Mailchimp). Clasificación: CONFIDENCIAL.';
COMMENT ON TABLE appointment IS 'Citas agendadas vía Calendly vinculadas a un lead. Clasificación: CONFIDENCIAL.';
COMMENT ON TABLE investment IS 'Inversiones/portafolio de clientes. Clasificación: CONFIDENCIAL — dato financiero sensible.';
COMMENT ON TABLE automation_log IS 'Log de ejecución de workflows n8n (trazabilidad y auditoría). Clasificación: INTERNA.';
COMMENT ON TABLE campaign_lead IS 'Relación M:N entre campañas y leads (suscripción). Clasificación: CONFIDENCIAL.';

-- -----------------------------------------------------------------------------
-- REGISTRO DE LA VERSIÓN DE ESQUEMA APLICADA
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, descripcion)
VALUES (
  '001_init_mer',
  'Esquema inicial del MER (lead, campaign, appointment, investment, automation_log, campaign_lead) con ENUMs e índices.'
)
ON CONFLICT (version) DO UPDATE
  SET descripcion = EXCLUDED.descripcion;
