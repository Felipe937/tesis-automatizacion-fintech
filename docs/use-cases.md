# 📋 Diagrama de Casos de Uso

> **Proyecto:** Automatización de Procesos de Venta e Inversión — Fintech Colombia  
> **Tesis:** Universidad Manuela Beltrán (UMB) · IS25237  
> **Última actualización:** Noviembre 2026

## Descripción

Este diagrama presenta los casos de uso principales del sistema de automatización.
Se identifican tres actores: el **Asesor Fintech** (usuario humano principal),
el **Sistema n8n** (orquestador automatizado) y el **Cliente** (prospecto/inversionista).

## Diagrama de Casos de Uso

```mermaid
flowchart LR
    subgraph ACTORES_IZQ["👤 Actores Humanos"]
        ASESOR["🧑‍💼 Asesor Fintech"]
        CLIENTE["👤 Cliente / Prospecto"]
    end

    subgraph SISTEMA["📦 Sistema de Automatización Fintech"]
        UC1["📝 CU-01: Registrar Lead"]
        UC2["📧 CU-02: Enviar Campaña<br/>de Email Marketing"]
        UC3["📅 CU-03: Agendar Cita<br/>de Asesoría"]
        UC4["⚙️ CU-04: Ejecutar Flujo<br/>de Automatización"]
        UC5["📊 CU-05: Conciliar<br/>Portafolio Excel"]
        UC6["🔄 CU-06: Sincronizar<br/>Contacto con CRM"]
        UC7["📋 CU-07: Consultar<br/>Logs de Ejecución"]
        UC8["👥 CU-08: Gestionar<br/>Pipeline de Ventas"]
        UC9["🔔 CU-09: Recibir<br/>Alertas de Discrepancias"]
        UC10["📈 CU-10: Generar Reporte<br/>de Automatización"]
    end

    subgraph ACTORES_DER["🤖 Actores de Sistema"]
        N8N["⚙️ Sistema n8n<br/>Orquestador"]
    end

    %% Asesor → Casos de uso
    ASESOR --> UC1
    ASESOR --> UC2
    ASESOR --> UC3
    ASESOR --> UC4
    ASESOR --> UC5
    ASESOR --> UC7
    ASESOR --> UC8
    ASESOR --> UC9
    ASESOR --> UC10

    %% Cliente → Casos de uso
    CLIENTE --> UC3
    CLIENTE --> UC1

    %% n8n → Casos de uso (automatizados)
    N8N --> UC1
    N8N --> UC2
    N8N --> UC4
    N8N --> UC5
    N8N --> UC6
    N8N --> UC9
```

## Especificación de Casos de Uso

### CU-01: Registrar Lead

| Campo | Descripción |
|---|---|
| **Actores** | Asesor Fintech, Cliente, Sistema n8n |
| **Precondición** | El prospecto no existe previamente en el sistema |
| **Flujo principal** | 1. El cliente completa un formulario web o agenda una reunión en Calendly.<br/>2. El webhook llega a n8n vía Traefik.<br/>3. n8n valida la estructura del payload.<br/>4. n8n crea el contacto en HubSpot CRM.<br/>5. n8n registra el lead en PostgreSQL.<br/>6. n8n agrega al lead a la lista de Mailchimp correspondiente. |
| **Flujo alternativo** | Si el lead ya existe en HubSpot, n8n actualiza la etapa del pipeline en lugar de crear uno nuevo. |
| **Postcondición** | El lead queda registrado en HubSpot, PostgreSQL y Mailchimp con estado "prospecto". |
| **APIs involucradas** | Calendly (webhook), HubSpot (API v3), Mailchimp (API v3) |

### CU-02: Enviar Campaña de Email Marketing

| Campo | Descripción |
|---|---|
| **Actores** | Asesor Fintech, Sistema n8n |
| **Precondición** | Existen leads registrados en la lista de Mailchimp objetivo |
| **Flujo principal** | 1. El asesor configura la campaña en n8n (plantilla, lista, programación).<br/>2. n8n crea la campaña en Mailchimp vía API.<br/>3. n8n programa o envía la campaña según la configuración.<br/>4. Mailchimp envía los emails a los destinatarios.<br/>5. n8n registra las métricas (aperturas, clics) en PostgreSQL. |
| **Postcondición** | La campaña queda enviada y las métricas registradas para análisis. |
| **APIs involucradas** | Mailchimp (API v3), HubSpot (consulta de segmentos) |

### CU-03: Agendar Cita de Asesoría

| Campo | Descripción |
|---|---|
| **Actores** | Cliente, Asesor Fintech |
| **Precondición** | El asesor tiene disponibilidad configurada en Calendly |
| **Flujo principal** | 1. El cliente selecciona un horario disponible en Calendly.<br/>2. Calendly envía un webhook `invitee.created` a n8n.<br/>3. n8n registra la cita en PostgreSQL.<br/>4. n8n actualiza la etapa del lead en HubSpot a "Reunión Agendada".<br/>5. n8n envía un email de confirmación vía Mailchimp. |
| **Flujo alternativo** | Si el cliente cancela, Calendly envía un webhook `invitee.cancelled` y n8n actualiza el estado. |
| **Postcondición** | La cita queda registrada y el pipeline del lead actualizado. |
| **APIs involucradas** | Calendly (webhooks + API v2), HubSpot (API v3), Mailchimp (API v3) |

### CU-04: Ejecutar Flujo de Automatización

| Campo | Descripción |
|---|---|
| **Actores** | Asesor Fintech, Sistema n8n |
| **Precondición** | El workflow existe y está activo en n8n |
| **Flujo principal** | 1. El flujo se dispara por webhook, cronograma o ejecución manual.<br/>2. n8n ejecuta los nodos del workflow en secuencia.<br/>3. Cada nodo interactúa con la API correspondiente.<br/>4. n8n registra el resultado en `automation_log`.<br/>5. Si hay errores, n8n notifica al asesor por email. |
| **Postcondición** | La ejecución queda registrada con estado `success` o `error`. |
| **APIs involucradas** | Variable según el workflow ejecutado |

### CU-05: Conciliar Portafolio Excel

| Campo | Descripción |
|---|---|
| **Actores** | Asesor Fintech, Sistema n8n |
| **Precondición** | El archivo Excel de portafolio existe en OneDrive con la estructura esperada |
| **Flujo principal** | 1. n8n recibe las transacciones del período (vía webhook o scheduled).<br/>2. n8n envía el payload al servicio Excel Reconciler.<br/>3. El servicio lee el Excel desde OneDrive vía Microsoft Graph API.<br/>4. El motor compara transacciones con aritmética Decimal.js.<br/>5. Se generan resultados: COINCIDE, DISCREPANCIA, SOLO_EN_N8N, SOLO_EN_EXCEL.<br/>6. Si hay discrepancias, se actualizan las celdas en Excel y se notifica al asesor. |
| **Postcondición** | El portafolio Excel refleja el estado actualizado con notas de discrepancias. |
| **APIs involucradas** | Microsoft Graph API (OneDrive/Excel) |

### CU-06: Sincronizar Contacto con CRM

| Campo | Descripción |
|---|---|
| **Actores** | Sistema n8n |
| **Precondición** | El contacto existe en al menos una fuente (Calendly, Mailchimp o formulario) |
| **Flujo principal** | 1. n8n detecta un cambio en el estado del contacto.<br/>2. n8n busca el contacto en HubSpot por email.<br/>3. n8n actualiza o crea el contacto según corresponda.<br/>4. n8n sincroniza la etapa del pipeline con la lista de Mailchimp. |
| **Postcondición** | El contacto está sincronizado entre HubSpot y Mailchimp. |
| **APIs involucradas** | HubSpot (API v3), Mailchimp (API v3) |

### CU-07 a CU-10: Casos de Uso de Soporte

| Caso de Uso | Descripción | Actor Principal |
|---|---|---|
| CU-07: Consultar Logs | El asesor revisa el historial de ejecuciones de workflows | Asesor Fintech |
| CU-08: Gestionar Pipeline | El asesor mueve leads entre etapas del embudo de ventas en HubSpot | Asesor Fintech |
| CU-09: Recibir Alertas | n8n envía notificaciones por email cuando detecta discrepancias financieras | Sistema n8n, Asesor |
| CU-10: Generar Reporte | El asesor solicita un resumen de automatizaciones ejecutadas en un período | Asesor Fintech |
