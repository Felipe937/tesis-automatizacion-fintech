# 🏛️ Arquitectura Global de Integración de APIs

> **Proyecto:** Automatización de Procesos de Venta e Inversión — Fintech Colombia  
> **Tesis:** Universidad Manuela Beltrán (UMB) · IS25237  
> **Última actualización:** Noviembre 2026

## Descripción

Este diagrama representa la arquitectura de integración completa del sistema. El orquestador
central (n8n) coordina los flujos de datos entre las APIs externas (HubSpot, Mailchimp,
Calendly, Microsoft Graph) y los servicios internos (Excel Reconciler, PostgreSQL).

## Diagrama de Arquitectura

```mermaid
flowchart TB
    subgraph EXTERNAS["🌐 APIs y Servicios Externos"]
        CAL["📅 Calendly<br/>Agendamiento de citas"]
        HUB["📊 HubSpot CRM<br/>Gestión de leads y pipeline"]
        MAIL["📧 Mailchimp<br/>Email marketing y campañas"]
        GRAPH["☁️ Microsoft Graph API<br/>OneDrive / Excel Online"]
    end

    subgraph VPS["🖥️ VPS Autoalojado — Colombia"]
        subgraph PROXY["Capa de Red Pública"]
            TRAEFIK["🔒 Traefik v3<br/>Reverse Proxy + TLS<br/>Let's Encrypt ACME"]
        end

        subgraph ORQUESTACION["Capa de Orquestación"]
            N8N["⚙️ n8n<br/>Motor de automatización<br/>Low-code / Self-hosted"]
        end

        subgraph SERVICIOS["Capa de Servicios Custom"]
            RECONCILER["📈 Excel Reconciler<br/>Node.js · Decimal.js · Zod<br/>Conciliación financiera"]
        end

        subgraph DATOS["Capa de Datos"]
            PG["🐘 PostgreSQL 16<br/>Workflows, credenciales<br/>cifradas, logs de ejecución"]
        end
    end

    subgraph COMPLEMENTARIO["🔧 Capa Complementaria No-code"]
        MAKE["🟣 Make (Integromat)<br/>Flujos visuales adicionales"]
    end

    %% Conexiones externas → VPS
    CAL -- "Webhook POST<br/>invitee.created" --> TRAEFIK
    TRAEFIK -- "HTTPS / TLS 1.3" --> N8N

    %% n8n ↔ APIs externas
    N8N -- "REST API v3<br/>Crear/actualizar contactos" --> HUB
    HUB -- "Webhook / Polling<br/>Pipeline changes" --> N8N
    N8N -- "REST API<br/>Agregar a lista / campaña" --> MAIL
    MAIL -- "Webhook<br/>Eventos de email" --> N8N
    N8N -- "API v2<br/>Consultar eventos" --> CAL

    %% n8n → Servicios internos
    N8N -- "HTTP POST interno<br/>Payload JSON" --> RECONCILER
    RECONCILER -- "Microsoft Graph API<br/>Leer/escribir Excel" --> GRAPH

    %% n8n → Base de datos
    N8N -- "TCP 5432<br/>Red interna" --> PG

    %% Make complementario
    MAKE -. "Escenarios<br/>complementarios" .-> HUB
    MAKE -. "Formularios web<br/>SMS recordatorios" .-> MAIL

    %% Estilos
    classDef external fill:#e1f5fe,stroke:#0288d1,stroke-width:2px
    classDef infra fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef data fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class CAL,HUB,MAIL,GRAPH external
    class TRAEFIK,N8N infra
    class RECONCILER service
    class PG data
```

## Tabla de Componentes

| Componente | Tipo | Protocolo | Rol en el Sistema |
|---|---|---|---|
| **Traefik** | Reverse Proxy | HTTPS/TLS 1.2-1.3 | Punto de entrada único, TLS automático con Let's Encrypt |
| **n8n** | Orquestador | HTTP interno | Hub central que coordina todos los flujos de automatización |
| **PostgreSQL** | Base de datos | TCP 5432 (interno) | Persistencia de workflows, credenciales cifradas y ejecuciones |
| **Excel Reconciler** | Microservicio | HTTP interno | Conciliación financiera con aritmética de precisión exacta |
| **HubSpot CRM** | SaaS externo | REST API v3 | Fuente de verdad del ciclo de vida del cliente |
| **Mailchimp** | SaaS externo | REST API v3 | Motor de email marketing con segmentación |
| **Calendly** | SaaS externo | Webhooks + API v2 | Captura de reuniones y onboarding de prospectos |
| **Microsoft Graph** | SaaS externo | REST API v1.0 | Lectura y escritura de archivos Excel en OneDrive |
| **Make (Integromat)** | SaaS externo | HTTP/REST | Automatizaciones visuales complementarias |

## Flujo de Datos Principal

1. **Ingreso de leads**: Un prospecto agenda una reunión en Calendly → webhook llega a Traefik → n8n lo procesa.
2. **Enriquecimiento CRM**: n8n crea o actualiza el contacto en HubSpot CRM con los datos del prospecto.
3. **Activación de email**: n8n agrega al contacto en la lista correspondiente de Mailchimp e inicia la secuencia de bienvenida.
4. **Conciliación financiera**: n8n envía transacciones al Excel Reconciler → el servicio lee el Excel de OneDrive, compara con Decimal.js, y escribe los resultados de vuelta.
5. **Persistencia**: Todos los logs de ejecución y credenciales se almacenan cifrados en PostgreSQL.
