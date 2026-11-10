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

-- =============================================================================
-- TABLAS DE NEGOCIO (Proyecto Fintech — MER Cap. IV de la tesis IS25237)
-- Separadas de las tablas internas de n8n (workflows, credenciales, ejecucións)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TIPOS ENUM (antes de las tablas, por requerimiento de PostgreSQL)
-- -----------------------------------------------------------------------------

CREATE TYPE lead_estado AS ENUM (
  'nuevo',
  'prospecto',
  'cita_pendiente',
  'cita_confirmada',
  'cliente',
  'inactivo'
);

CREATE TYPE campaign_estado AS ENUM (
  'pendiente',
  'activa',
  'completada',
  'cancelada'
);

CREATE TYPE appointment_estado AS ENUM (
  'pendiente',
  'confirmada',
  'cancelada',
  'completada'
);

CREATE TYPE investment_estado AS ENUM (
  'activa',
  'vencida',
  'cancelada'
);

CREATE TYPE log_estado AS ENUM (
  'exito',
  'error',
  'advertencia'
);

-- -----------------------------------------------------------------------------
-- Tabla: lead
-- -----------------------------------------------------------------------------

CREATE TABLE lead (
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

CREATE TABLE campaign (
  id_campaign BIGSERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  estado campaign_estado NOT NULL DEFAULT 'pendiente',
  id_mailchimp VARCHAR(100) UNIQUE
);

-- -----------------------------------------------------------------------------
-- Tabla: appointment
-- -----------------------------------------------------------------------------

CREATE TABLE appointment (
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

CREATE TABLE investment (
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

CREATE TABLE automation_log (
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

CREATE TABLE campaign_lead (
  id_campaign BIGINT NOT NULL REFERENCES campaign(id_campaign),
  id_lead BIGINT NOT NULL REFERENCES lead(id_lead),
  PRIMARY KEY (id_campaign, id_lead)
);

-- -----------------------------------------------------------------------------
-- ÍNDICES
-- -----------------------------------------------------------------------------

CREATE INDEX idx_lead_correo_electronico ON lead(correo_electronico);
CREATE INDEX idx_lead_id_hubspot ON lead(id_hubspot);
CREATE INDEX idx_lead_estado ON lead(estado);
CREATE INDEX idx_appointment_id_lead ON appointment(id_lead);
CREATE INDEX idx_investment_id_lead ON investment(id_lead);
CREATE INDEX idx_automation_log_workflow_id ON automation_log(workflow_id);
CREATE INDEX idx_automation_log_timestamp_inicio ON automation_log(timestamp_inicio);

-- -----------------------------------------------------------------------------
-- COMENTARIOS DE TABLA (auditoría, Ley 1581/2012)
-- -----------------------------------------------------------------------------

COMMENT ON TABLE lead IS 'Registro de leads/captación de prospectos (Calendly → HubSpot → Mailchimp). Clasificación: CONFIDENCIAL.';
COMMENT ON TABLE campaign IS 'Campañas de email marketing (Mailchimp). Clasificación: CONFIDENCIAL.';
COMMENT ON TABLE appointment IS 'Citas agendadas vía Calendly vinculadas a un lead. Clasificación: CONFIDENCIAL.';
COMMENT ON TABLE investment IS 'Inversiones/portafolio de clientes. Clasificación: CONFIDENCIAL — dato financiero sensible.';
COMMENT ON TABLE automation_log IS 'Log de ejecución de workflows n8n (trazabilidad y auditoría). Clasificación: INTERNA.';
COMMENT ON TABLE campaign_lead IS 'Relación M:N entre campañas y leads (suscripción). Clasificación: CONFIDENCIAL.';
