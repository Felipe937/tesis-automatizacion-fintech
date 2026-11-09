# 🚀 Diagrama de Despliegue

> **Proyecto:** Automatización de Procesos de Venta e Inversión — Fintech Colombia  
> **Tesis:** Universidad Manuela Beltrán (UMB) · IS25237  
> **Última actualización:** Noviembre 2026

## Descripción

Este diagrama muestra la topología de despliegue del sistema: contenedores Docker,
redes internas, volúmenes persistentes y la comunicación con servicios externos.
El diseño prioriza el aislamiento de red y el cifrado en tránsito y en reposo
conforme a buenas prácticas derivadas de la Ley 1581 de 2012.

## Diagrama de Despliegue

```mermaid
flowchart TB
    subgraph INTERNET["🌐 Internet"]
        BROWSER["🖥️ Navegador del<br/>Asesor Fintech"]
        WEBHOOKS["📡 Webhooks entrantes<br/>Calendly · HubSpot"]
        APIS["☁️ APIs externas<br/>HubSpot · Mailchimp<br/>Calendly · Graph API"]
    end

    subgraph VPS["🖥️ VPS Ubuntu 22.04 LTS — Proveedor Cloud"]
        direction TB

        subgraph DOCKER["🐳 Docker Engine + Compose v2"]
            direction TB

            subgraph NET_PUB["Red: fintech_public"]
                TRAEFIK["🔒 Traefik v3.6<br/>───────────<br/>Puertos: 80, 443<br/>TLS: Let's Encrypt ACME<br/>Cabeceras OWASP<br/>Rate Limiting"]
            end

            subgraph NET_INT["Red: fintech_internal<br/>(internal: true — sin acceso a Internet)"]
                PG["🐘 PostgreSQL 16 Alpine<br/>───────────<br/>Puerto interno: 5432<br/>Auth: SCRAM-SHA-256<br/>Sin puertos expuestos"]
            end

            subgraph NET_SVC["Red: fintech_services<br/>(salida a Internet permitida)"]
                RECONCILER["📈 Excel Reconciler<br/>───────────<br/>Node.js ≥20 LTS<br/>Puerto interno: 3000<br/>read_only: true"]
            end

            N8N["⚙️ n8n (latest)<br/>───────────<br/>Puerto interno: 5678<br/>Usuario: node (no root)<br/>Cifrado AES-256<br/>Timezone: America/Bogota"]
        end

        subgraph VOLUMES["💾 Volúmenes Persistentes"]
            VOL_N8N["📁 ./n8n_data/<br/>Workflows + config"]
            VOL_PG["📁 ./postgres/<br/>Datos PostgreSQL"]
            VOL_CERTS["📁 ./traefik/certs/<br/>Certificados ACME"]
        end
    end

    %% Conexiones externas
    BROWSER -- "HTTPS :443" --> TRAEFIK
    WEBHOOKS -- "HTTPS POST :443" --> TRAEFIK

    %% Traefik → n8n
    TRAEFIK -- "HTTP :5678<br/>fintech_public" --> N8N

    %% n8n ↔ PostgreSQL
    N8N -- "TCP :5432<br/>fintech_internal" --> PG

    %% n8n → Excel Reconciler
    N8N -- "HTTP POST :3000<br/>fintech_services" --> RECONCILER

    %% n8n → APIs externas
    N8N -- "HTTPS<br/>fintech_services" --> APIS

    %% Reconciler → Microsoft Graph
    RECONCILER -- "HTTPS<br/>graph.microsoft.com" --> APIS

    %% Volúmenes
    N8N -. "mount" .-> VOL_N8N
    PG -. "mount" .-> VOL_PG
    TRAEFIK -. "mount" .-> VOL_CERTS

    %% Redes de n8n (pertenece a las 3)
    N8N ~~~ NET_PUB
    N8N ~~~ NET_INT
    N8N ~~~ NET_SVC

    %% Estilos
    classDef internet fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef container fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef volume fill:#fff9c4,stroke:#f9a825,stroke-width:1px,stroke-dasharray: 5 5
    classDef network fill:#fce4ec,stroke:#c62828,stroke-width:1px

    class BROWSER,WEBHOOKS,APIS internet
    class TRAEFIK,N8N,PG,RECONCILER container
    class VOL_N8N,VOL_PG,VOL_CERTS volume
```

## Tabla de Contenedores

| Contenedor | Imagen | Red(es) | Puerto Expuesto | Seguridad |
|---|---|---|---|---|
| `traefik` | `traefik:v3.6.7` | fintech_public | 80, 443 | `no-new-privileges`, socket Docker read-only |
| `n8n` | `n8nio/n8n:latest` | public + internal + services | Ninguno (vía Traefik) | Usuario `node`, cifrado AES-256, sin telemetría |
| `n8n_postgres` | `postgres:16-alpine` | fintech_internal | Ninguno | SCRAM-SHA-256, red interna aislada |
| `excel-reconciler` | Build local | fintech_services | Ninguno | `read_only: true`, `no-new-privileges` |

## Redes Docker

| Red | Tipo | Acceso a Internet | Propósito |
|---|---|---|---|
| `fintech_public` | bridge | ✅ Sí | Traefik expone puertos 80/443 al exterior |
| `fintech_internal` | bridge (internal) | ❌ No | Comunicación n8n ↔ PostgreSQL aislada |
| `fintech_services` | bridge | ✅ Sí (saliente) | Excel Reconciler necesita acceder a Microsoft Graph API |

## Requisitos del VPS

| Recurso | Mínimo (dev/test) | Recomendado (producción) |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 2 GB | 4 GB |
| Almacenamiento | 20 GB SSD | 50 GB SSD |
| SO | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
