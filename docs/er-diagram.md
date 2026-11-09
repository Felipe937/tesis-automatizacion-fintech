# 🗄️ Modelo Entidad-Relación — Base de Datos PostgreSQL

> **Proyecto:** Automatización de Procesos de Venta e Inversión — Fintech Colombia  
> **Tesis:** Universidad Manuela Beltrán (UMB) · IS25237  
> **Última actualización:** Noviembre 2026

## Descripción

Este modelo Entidad-Relación representa la estructura de datos del sistema de automatización.
La base de datos PostgreSQL 16 almacena la información de leads, campañas de email marketing,
citas agendadas, logs de automatización y usuarios del sistema.

> **Nota:** n8n gestiona internamente sus propias tablas (workflows, credenciales cifradas,
> ejecuciones). Las entidades aquí documentadas son las del **dominio de negocio** del
> emprendimiento Fintech, accesibles tanto por n8n como por los servicios custom.

## Diagrama Entidad-Relación

```mermaid
erDiagram
    USER {
        uuid id PK "Identificador único (uuid-ossp)"
        varchar email UK "Correo electrónico del asesor"
        varchar full_name "Nombre completo"
        varchar role "Rol: admin | asesor | readonly"
        varchar password_hash "Hash bcrypt de la contraseña"
        boolean is_active "Estado activo/inactivo"
        timestamp created_at "Fecha de creación"
        timestamp updated_at "Última actualización"
    }

    LEAD {
        uuid id PK "Identificador único"
        uuid user_id FK "Asesor asignado"
        varchar first_name "Nombre del prospecto"
        varchar last_name "Apellido del prospecto"
        varchar email UK "Correo del prospecto"
        varchar phone "Teléfono de contacto"
        varchar company "Empresa u organización"
        varchar source "Origen: calendly | hubspot | web_form | manual"
        varchar hubspot_contact_id "ID del contacto en HubSpot CRM"
        varchar mailchimp_member_id "ID del suscriptor en Mailchimp"
        varchar pipeline_stage "Etapa: prospecto | contactado | reunion_agendada | cliente | inactivo"
        jsonb custom_fields "Campos personalizados en formato JSON"
        varchar consent_status "Estado del consentimiento: pendiente | otorgado | revocado"
        timestamp consent_date "Fecha de obtención del consentimiento (Ley 1581)"
        timestamp created_at "Fecha de creación"
        timestamp updated_at "Última actualización"
    }

    CAMPAIGN {
        uuid id PK "Identificador único"
        uuid user_id FK "Asesor que creó la campaña"
        varchar name "Nombre de la campaña"
        varchar mailchimp_campaign_id "ID de campaña en Mailchimp"
        varchar mailchimp_list_id "ID de la lista/audiencia en Mailchimp"
        varchar type "Tipo: bienvenida | onboarding | seguimiento | reactivacion"
        varchar status "Estado: borrador | programada | enviada | completada"
        integer total_recipients "Total de destinatarios"
        integer total_opens "Total de aperturas"
        integer total_clicks "Total de clics"
        decimal open_rate "Tasa de apertura (%)"
        decimal click_rate "Tasa de clics (%)"
        timestamp scheduled_at "Fecha programada de envío"
        timestamp sent_at "Fecha real de envío"
        timestamp created_at "Fecha de creación"
        timestamp updated_at "Última actualización"
    }

    APPOINTMENT {
        uuid id PK "Identificador único"
        uuid lead_id FK "Lead asociado a la cita"
        uuid user_id FK "Asesor que atiende la cita"
        varchar calendly_event_id UK "ID del evento en Calendly"
        varchar calendly_invitee_id "ID del invitado en Calendly"
        varchar event_type "Tipo: consulta_inicial | seguimiento | cierre | onboarding"
        varchar status "Estado: scheduled | completed | cancelled | no_show"
        varchar meeting_url "URL de la reunión virtual (Zoom, Meet, etc.)"
        text notes "Notas del asesor sobre la reunión"
        timestamp starts_at "Fecha y hora de inicio"
        timestamp ends_at "Fecha y hora de fin"
        varchar timezone "Zona horaria (ej: America/Bogota)"
        timestamp cancelled_at "Fecha de cancelación (si aplica)"
        varchar cancellation_reason "Motivo de cancelación"
        timestamp created_at "Fecha de creación"
        timestamp updated_at "Última actualización"
    }

    AUTOMATION_LOG {
        uuid id PK "Identificador único"
        uuid user_id FK "Asesor que disparó o supervisó la ejecución"
        uuid lead_id FK "Lead afectado (si aplica)"
        varchar workflow_name "Nombre del workflow en n8n"
        varchar n8n_execution_id "ID de ejecución en n8n"
        varchar trigger_type "Tipo de disparo: webhook | schedule | manual"
        varchar trigger_source "Fuente: calendly | hubspot | cron | ui"
        varchar status "Estado: running | success | error | warning"
        integer duration_ms "Duración en milisegundos"
        jsonb input_summary "Resumen del payload de entrada (sin datos sensibles)"
        jsonb output_summary "Resumen del resultado de salida"
        text error_message "Mensaje de error (si status = error)"
        varchar error_type "Tipo de error: ValidationError | GraphApiError | etc."
        timestamp started_at "Fecha y hora de inicio"
        timestamp finished_at "Fecha y hora de fin"
        timestamp created_at "Fecha de creación"
    }

    %% ─── Relaciones ───

    USER ||--o{ LEAD : "gestiona"
    USER ||--o{ CAMPAIGN : "crea"
    USER ||--o{ APPOINTMENT : "atiende"
    USER ||--o{ AUTOMATION_LOG : "supervisa"

    LEAD ||--o{ APPOINTMENT : "tiene"
    LEAD ||--o{ AUTOMATION_LOG : "genera"

    LEAD }o--o{ CAMPAIGN : "recibe"
```

## Descripción de Entidades

### `USER` — Usuarios del Sistema
Representa a los asesores fintech y administradores que operan el sistema de automatización.
Cada usuario tiene un rol que determina sus permisos de acceso.

### `LEAD` — Prospectos y Clientes
Almacena la información de los prospectos capturados desde múltiples fuentes (Calendly, HubSpot,
formularios web). Incluye campos de sincronización con HubSpot y Mailchimp, así como el estado
del consentimiento de tratamiento de datos (Ley 1581 de 2012).

### `CAMPAIGN` — Campañas de Email Marketing
Registra las campañas de Mailchimp sincronizadas con el sistema. Incluye métricas de rendimiento
(aperturas, clics) para análisis del embudo de ventas.

### `APPOINTMENT` — Citas Agendadas
Almacena las reuniones agendadas a través de Calendly, vinculadas al lead y al asesor correspondiente.
Permite rastrear el ciclo completo de la reunión (agendada → completada/cancelada).

### `AUTOMATION_LOG` — Registro de Automatizaciones
Log detallado de cada ejecución de los workflows de n8n. Incluye el tipo de disparo, duración,
estado final y resúmenes de entrada/salida para auditoría. No almacena datos personales
sensibles en los campos de resumen (cumplimiento Ley 1581).

## Índices Recomendados

```sql
-- Búsqueda frecuente de leads por email y etapa del pipeline
CREATE INDEX idx_lead_email ON lead (email);
CREATE INDEX idx_lead_pipeline_stage ON lead (pipeline_stage);
CREATE INDEX idx_lead_source ON lead (source);

-- Búsqueda de citas por fecha y estado
CREATE INDEX idx_appointment_starts_at ON appointment (starts_at);
CREATE INDEX idx_appointment_status ON appointment (status);

-- Consulta de logs por fecha y estado de ejecución
CREATE INDEX idx_automation_log_started_at ON automation_log (started_at);
CREATE INDEX idx_automation_log_status ON automation_log (status);
CREATE INDEX idx_automation_log_workflow ON automation_log (workflow_name);

-- Búsqueda full-text con pg_trgm (habilitado en init.sql)
CREATE INDEX idx_lead_name_trgm ON lead USING gin (first_name gin_trgm_ops);
```
