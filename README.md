<div align="center">

# 🚀 Automatización de Procesos de Venta e Inversión mediante Integración de APIs y Herramientas No-code/Low-code para Emprendedores del Sector Fintech en Colombia

[![Licencia MIT](https://img.shields.io/badge/Licencia-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?logo=node.js)](https://nodejs.org/)
[![n8n](https://img.shields.io/badge/n8n-Self--Hosted-EA4B71?logo=n8n)](https://n8n.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](./infrastructure/docker-compose.yml)
[![Estado](https://img.shields.io/badge/Estado-Prototipo%20Funcional-yellow)]()

**Tesis de Grado — Ingeniería de Software**  
*Objetivo Específico 5: Diseñar e implementar una arquitectura de automatización replicable para emprendedores Fintech colombianos sin grandes equipos de desarrollo.*

</div>

---

> [!CAUTION]
> **Descargo de responsabilidad legal**
>
> Este repositorio es un **artefacto académico de ingeniería de software** elaborado como prototipo funcional para una tesis de grado. El diseño técnico incorpora consideraciones derivadas de la **Ley 1581 de 2012** sobre Protección de Datos Personales de Colombia (principios de finalidad, seguridad, temporalidad y circulación restringida), como buena práctica de desarrollo de software responsable.
>
> Sin embargo, **este trabajo no constituye, ni pretende sustituir, una asesoría o auditoría jurídica formal**. El cumplimiento normativo efectivo de la Ley 1581/2012, el Decreto 1377 de 2013, las circulares de la Superintendencia Financiera de Colombia (SFC) y cualquier otra regulación sectorial aplicable al ámbito Fintech es responsabilidad exclusiva de cada organización y requiere la intervención de profesionales del derecho competentes. Los autores de este repositorio no asumen ninguna responsabilidad por el uso que terceros hagan del código aquí publicado en entornos de producción con datos reales de titulares.

---

## 📋 Tabla de Contenidos

1. [Descripción del Proyecto](#-descripción-del-proyecto)
2. [Arquitectura del Sistema](#-arquitectura-del-sistema)
3. [Stack Tecnológico](#-stack-tecnológico)
4. [Requisitos Previos de Infraestructura](#-requisitos-previos-de-infraestructura)
5. [Estructura del Repositorio](#-estructura-del-repositorio)
6. [Guía de Implementación Rápida](#-guía-de-implementación-rápida)
7. [Flujos de Automatización](#-flujos-de-automatización)
8. [Configuración de Integraciones](#-configuración-de-integraciones)
9. [Consideraciones de Seguridad y Privacidad](#-consideraciones-de-seguridad-y-privacidad)
10. [Glosario para Emprendedores](#-glosario-para-emprendedores)
11. [Contribuciones](#-contribuciones)
12. [Licencia](#-licencia)

---

## 📌 Descripción del Proyecto

Este repositorio contiene el prototipo funcional de una arquitectura de **automatización de bajo costo** diseñada específicamente para **emprendedores y startups del sector Fintech colombiano** que:

- Operan con equipos pequeños (1–5 personas) sin desarrolladores de tiempo completo.
- Necesitan sincronizar datos entre su CRM, plataforma de email marketing, agenda de reuniones y reportes financieros en Excel.
- Buscan cumplir con buenas prácticas de seguridad de datos sin sacrificar agilidad operativa.

### ¿Qué problema resuelve?

| Proceso Manual (antes) | Proceso Automatizado (después) |
|---|---|
| Copiar leads de Calendly a HubSpot manualmente | Sincronización en tiempo real vía webhook |
| Enviar secuencias de Mailchimp de forma individual | Enrollment automático basado en etapa CRM |
| Actualizar portafolio de inversión en Excel a mano | Script Node.js que concilia vía Microsoft Graph API |
| Detectar discrepancias financieras de forma visual | Motor de conciliación con tolerancia configurable y reporte estructurado |

---

## 🏛️ Arquitectura del Sistema

El sistema sigue un patrón de **orquestación centralizada con integraciones spoke**: n8n actúa como el hub central que coordina las señales entre todas las herramientas externas.

```
                         ┌─────────────────────────────────────────────────────────────────┐
                         │                     VPS AUTOALOJADO (Colombia)                    │
                         │                                                                   │
  ┌──────────────┐       │  ┌─────────────┐     ┌──────────────────────────────────────┐   │
  │   Calendly   │──────▶│  │   Traefik   │────▶│                n8n                   │   │
  │  (Webhooks)  │       │  │  TLS/HTTPS  │     │     Motor de Orquestación             │   │
  └──────────────┘       │  │  Let'sEncr. │     │                                      │   │
                         │  └─────────────┘     │  Workflow 1: Captura de Leads        │   │
  ┌──────────────┐       │                      │  Workflow 2: Secuencias de Email      │   │
  │   HubSpot    │◀─────▶│                      │  Workflow 3: Sync Portafolio Excel    │   │
  │     CRM      │       │                      │  Workflow 4: Alertas Financieras      │   │
  └──────────────┘       │                      └──────────┬───────────────────────────┘   │
                         │                                 │                                │
  ┌──────────────┐       │                      ┌──────────▼───────────────────────────┐   │
  │  Mailchimp   │◀─────▶│                      │          PostgreSQL 16                │   │
  │   Campaigns  │       │                      │    Base de datos persistente n8n     │   │
  └──────────────┘       │                      │    (Red interna — no expuesta)       │   │
                         │                      └──────────────────────────────────────┘   │
  ┌──────────────┐       │                                                                   │
  │  Microsoft   │◀─────▶│  ┌────────────────────────────────────────────────────────┐     │
  │  365/OneDrive│       │  │         Node.js — excel-reconciler service              │     │
  │  Excel API   │       │  │   Conciliación financiera con Microsoft Graph API       │     │
  └──────────────┘       │  │   Decimal.js · Zod · MSAL · axios-retry                │     │
                         │  └────────────────────────────────────────────────────────┘     │
                         │                                                                   │
                         └─────────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────────────────────────────┐
  │  Make (Integromat) — Capa complementaria No-code para flujos visuales adicionales       │
  │  Escenarios: Formularios Web → CRM · Recordatorios SMS · Exportaciones programadas     │
  └────────────────────────────────────────────────────────────────────────────────────────┘
```

### Roles de cada capa

| Componente | Rol | Tipo |
|---|---|---|
| **n8n** (self-hosted) | Orquestador principal. Procesa webhooks, ejecuta lógica condicional, llama APIs | Low-code |
| **Traefik** | Reverse proxy con TLS automático (Let's Encrypt). Expone n8n con HTTPS | Infraestructura |
| **PostgreSQL** | Almacena workflows, credenciales cifradas y logs de ejecución de n8n | Infraestructura |
| **Node.js** (`excel-reconciler`) | Conciliación financiera avanzada. Lógica que excede las capacidades de n8n nativo | Custom code |
| **Make (Integromat)** | Automatizaciones visuales complementarias de bajo código. Ideal para casos simples | No-code |
| **HubSpot CRM** | Fuente de verdad del ciclo de vida del cliente (leads → clientes → inversores) | SaaS |
| **Mailchimp** | Motor de email marketing con segmentación por etapa del embudo | SaaS |
| **Calendly** | Captura de reuniones y onboarding de nuevos prospectos | SaaS |
| **Excel / OneDrive** | Repositorio de reportes financieros y portafolio de inversión | SaaS |

---

## 🔧 Stack Tecnológico

### Herramientas No-code / Low-code

| Herramienta | Versión mínima | Costo estimado (plan básico) | Caso de uso en este proyecto |
|---|---|---|---|
| [n8n](https://n8n.io/) | `latest` (self-hosted) | \$0 (self-hosted) | Orquestación central de flujos |
| [Make](https://www.make.com/) | — | Desde \$9 USD/mes | Flujos visuales complementarios |
| [HubSpot](https://www.hubspot.com/) | CRM Free o Starter | Desde \$0 | Gestión de contactos y pipeline |
| [Mailchimp](https://mailchimp.com/) | Essentials+ | Desde \$13 USD/mes | Campañas y automatización de email |
| [Calendly](https://calendly.com/) | Professional+ | Desde \$10 USD/mes | Agendamiento y webhooks de reuniones |
| [Microsoft 365](https://www.microsoft.com/es-co/microsoft-365) | Business Basic+ | Desde \$6 USD/mes | Excel en línea + OneDrive |

### Código y Servicios de Soporte

| Tecnología | Versión | Propósito |
|---|---|---|
| Node.js | ≥ 20.0.0 LTS | Runtime del servicio de conciliación financiera |
| Docker + Docker Compose v2 | Estable | Contenerización de n8n, Traefik y PostgreSQL |
| Traefik | v3.1 | Reverse proxy + TLS automático con ACME/Let's Encrypt |
| PostgreSQL | 16 Alpine | Base de datos de n8n (credenciales cifradas, workflows) |
| `decimal.js` | ^10.4.3 | Aritmética financiera de precisión exacta (evita errores IEEE 754) |
| `zod` | ^3.23.8 | Validación de contratos de datos entre n8n y el servicio custom |
| `@azure/msal-node` | ^2.16.2 | Autenticación OAuth2 con Microsoft Graph API |

---

## 🖥️ Requisitos Previos de Infraestructura

Antes de comenzar la implementación, asegúrate de cumplir con todos los requisitos de esta sección. Están organizados por prioridad e impacto.

### 1. Servidor Virtual Privado (VPS)

Se requiere un VPS con acceso SSH root o sudo. El prototipo fue desarrollado y probado sobre Ubuntu 22.04 LTS.

| Recurso | Mínimo (dev/test) | Recomendado (producción) |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 2 GB | 4 GB |
| Almacenamiento | 20 GB SSD | 50 GB SSD |
| SO | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Ancho de banda | 1 TB/mes | Ilimitado o 3 TB/mes |

**Proveedores de VPS con presencia en Colombia / Latinoamérica recomendados:**

- [DigitalOcean](https://www.digitalocean.com/) — Droplet básico (~\$12 USD/mes). Datacenter en NYC/Toronto con baja latencia a Colombia.
- [Hetzner Cloud](https://www.hetzner.com/cloud) — CPX11 (~€4.15/mes). Opción más económica de Europa.
- [Vultr](https://www.vultr.com/) — Instancia regular cloud (~\$12 USD/mes).
- [AWS EC2](https://aws.amazon.com/ec2/) — t3.small en us-east-1 (~\$17 USD/mes). Para escenarios con mayor crecimiento.

> [!TIP]
> Para un emprendimiento Fintech en Colombia que deba cumplir con la **soberanía del dato**, considera que la Ley 1581 de 2012 no prohíbe expresamente el alojamiento en servidores internacionales, pero sí impone el mismo estándar de seguridad. Consulta con tu equipo legal si procesas datos sensibles de categoría especial (salud financiera, biometric).

### 2. Dominio y DNS

- Un nombre de dominio registrado (ej: `tuempresa.com.co`). El NIC Colombia ([NIC.CO](https://www.nic.co/)) gestiona los dominios `.com.co`.
- Un subdominio apuntando al IP del VPS mediante registro tipo **A**:

  ```
  n8n.tuempresa.com.co  →  A  →  <IP_DE_TU_VPS>
  ```

- Si usas Cloudflare como DNS (recomendado), puedes activar el modo **proxy naranja** para ocultar la IP real del servidor.

### 3. Software en el VPS

Instalar en el VPS antes de ejecutar el deploy:

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Docker Engine (método oficial)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Docker Compose V2 (viene incluido con Docker Engine moderno)
docker compose version   # Verificar: debe mostrar v2.x.x

# Utilidades necesarias
sudo apt install -y apache2-utils openssl git nano
```

### 4. Cuentas y Credenciales de Servicios Externos

Debes tener activas y configuradas las siguientes cuentas antes de iniciar:

| Servicio | Recurso a obtener | Dónde obtenerlo |
|---|---|---|
| **HubSpot** | Private App Token (con permisos `crm.objects.contacts`, `crm.objects.deals`) | `Settings → Integrations → Private Apps` |
| **Mailchimp** | API Key + Server Prefix (ej: `us21`) | `Account → Extras → API keys` |
| **Calendly** | Personal Access Token + Webhook Signing Key | `Integrations → API & Webhooks` |
| **Microsoft 365** | App Registration en Azure AD con `Files.ReadWrite.All` y `Sites.ReadWrite.All` | `portal.azure.com → Azure Active Directory → App registrations` |
| **Email SMTP** | Credenciales SMTP para notificaciones del sistema n8n | Gmail con App Password, o Brevo (ex-Sendinblue) |

### 5. Conocimientos Técnicos Mínimos Requeridos

Este repositorio está diseñado para ser replicable con conocimientos intermedios. No se requiere experiencia en desarrollo de software avanzado, pero sí es necesario:

- ✅ Conectarse a un servidor Linux vía SSH (`ssh usuario@IP`)
- ✅ Editar archivos de texto en terminal (`nano archivo.env`)
- ✅ Ejecutar comandos básicos de terminal (copiar, mover archivos, permisos)
- ✅ Crear una cuenta en una plataforma SaaS y ubicar su sección de API Keys
- ⚠️ Opcional pero recomendado: noción básica de JSON y variables de entorno

---

## 📁 Estructura del Repositorio

```
tesis-automatizacion-fintech/
│
├── 📄 README.md                          ← Este archivo
├── 📄 LICENSE                            ← Licencia MIT
├── 📄 .gitignore                         ← Archivos excluidos del repositorio
│
├── 📂 infrastructure/                    ← Infraestructura de despliegue (Docker)
│   ├── 🐳 docker-compose.yml             ← Orquestación: Traefik + n8n + PostgreSQL
│   ├── 📄 .env.example                   ← Plantilla de variables de entorno
│   ├── 📜 deploy.sh                      ← Script de primer despliegue en VPS
│   └── 📂 config/
│       ├── 📂 traefik/
│       │   ├── traefik.yml               ← Config estática (ACME, entrypoints, logs)
│       │   └── dynamic.yml               ← Política TLS + cabeceras OWASP + rate limit
│       └── 📂 postgres/
│           └── init.sql                  ← Inicialización de base de datos
│
└── 📂 services/
    └── 📂 excel-reconciler/              ← Servicio Node.js de conciliación financiera
        ├── 📄 package.json
        ├── 📂 fixtures/
        │   └── sample-payload.json       ← Payload de prueba (6 transacciones BVC/internacional)
        └── 📂 src/
            ├── index.js                  ← Orquestador principal del servicio
            ├── schemas.js                ← Contratos de datos con Zod
            ├── graphClient.js            ← Cliente Microsoft Graph + MSAL OAuth2
            ├── reconciler.js             ← Motor de conciliación con Decimal.js
            └── __tests__/
                └── reconciler.test.js    ← 13 tests unitarios (Node.js nativo)
```

---

## ⚡ Guía de Implementación Rápida

Sigue estos pasos en orden. Tiempo estimado de implementación para alguien sin experiencia previa en Docker: **2–4 horas**.

### Paso 1 — Clonar el repositorio

```bash
git clone https://github.com/<tu-usuario>/tesis-automatizacion-fintech.git
cd tesis-automatizacion-fintech/infrastructure
```

### Paso 2 — Configurar variables de entorno

```bash
# Copiar la plantilla
cp .env.example .env

# Asegurar permisos restrictivos (CRÍTICO — contiene contraseñas)
chmod 600 .env

# Editar y rellenar TODOS los valores <REEMPLAZAR_...>
nano .env
```

**Valores que debes generar de forma segura:**

```bash
# Contraseña para PostgreSQL (mínimo 32 caracteres)
openssl rand -base64 32

# Clave de cifrado para n8n (GUÁRDALA EN UN LUGAR SEGURO — sin ella pierdes todas las credenciales)
openssl rand -hex 32

# Hash de contraseña para el dashboard de Traefik
htpasswd -nB admin
# Copia el resultado y reemplaza cada $ por $$ en el archivo .env
```

### Paso 3 — Ejecutar el despliegue

```bash
chmod +x deploy.sh
sudo bash deploy.sh
```

El script verifica prerrequisitos, crea directorios con los permisos correctos, y levanta los tres contenedores en el orden correcto (Traefik → PostgreSQL → n8n).

### Paso 4 — Verificar el despliegue

```bash
# Ver estado de contenedores
docker compose ps

# Verificar que el certificado TLS esté activo (esperar 1–2 min tras el primer inicio)
curl -I https://n8n.tuempresa.com.co

# Ver logs de n8n en tiempo real
docker compose logs -f n8n
```

Accede a `https://n8n.tudominio.com` e inicia sesión con las credenciales de `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD`.

### Paso 5 — Instalar el servicio de conciliación

```bash
cd ../services/excel-reconciler
npm install

# Ejecutar los tests para verificar que todo funciona
npm test
# Resultado esperado: ℹ tests 13 ✔ pass 13 ✖ fail 0
```

---

## 🔄 Flujos de Automatización

### Flujo 1 — Captura y Calificación de Leads (Calendly → HubSpot → Mailchimp)

```
Prospecto agenda reunión         Calendly dispara webhook         n8n recibe el evento
en Calendly            ──────▶  con datos del invitado  ──────▶  y valida la estructura
                                                                          │
                                                         ┌────────────────▼──────────────────┐
                                                         │  ¿El contacto existe en HubSpot?  │
                                                         └─────────────┬──────────┬──────────┘
                                                                       │ NO       │ SÍ
                                                              ┌────────▼──┐  ┌────▼──────────┐
                                                              │  Crear    │  │  Actualizar   │
                                                              │  Contacto │  │  etapa a      │
                                                              │  en HubSpot│  │  "Reunión     │
                                                              └────────┬──┘  │  Agendada"    │
                                                                       │     └────┬──────────┘
                                                                       └──────────┘
                                                                                │
                                                              ┌─────────────────▼─────────────┐
                                                              │  Agregar a lista "Prospectos  │
                                                              │  Calificados" en Mailchimp    │
                                                              │  → Iniciar secuencia de       │
                                                              │    bienvenida (3 emails)      │
                                                              └───────────────────────────────┘
```

### Flujo 2 — Conciliación de Portafolio de Inversión (n8n → Node.js → Excel)

```
Corredor / API externa           n8n obtiene                  Nodo "Execute Command"
envía datos de     ──────────▶  transacciones    ──────────▶  invoca excel-reconciler
transacciones                   del período                    con payload JSON
                                                                      │
                                                     ┌────────────────▼──────────────────┐
                                                     │  graphClient.js lee la hoja       │
                                                     │  "Portafolio" del Excel en        │
                                                     │  OneDrive vía Microsoft Graph API │
                                                     └────────────────┬──────────────────┘
                                                                      │
                                                     ┌────────────────▼──────────────────┐
                                                     │  reconciler.js compara con        │
                                                     │  Decimal.js (precisión exacta)    │
                                                     │  Resultado: COINCIDE /            │
                                                     │  DISCREPANCIA / SOLO_EN_N8N /     │
                                                     │  SOLO_EN_EXCEL                    │
                                                     └────────────────┬──────────────────┘
                                                                      │
                                                     ┌────────────────▼──────────────────┐
                                                     │  Si hay discrepancias:            │
                                                     │  → Actualizar celdas en Excel     │
                                                     │  → Enviar alerta por email/Slack  │
                                                     │  → Crear tarea en HubSpot CRM     │
                                                     └───────────────────────────────────┘
```

### Flujo 3 — Secuencias de Email por Etapa del Embudo (HubSpot → n8n → Mailchimp)

Cuando un contacto avanza de etapa en el pipeline de HubSpot (por ejemplo, de `Prospecto` a `Cliente`), n8n detecta el cambio vía polling o webhook y:

1. Elimina al contacto de la lista de email de "Prospectos" en Mailchimp.
2. Lo agrega a la lista de "Clientes Activos".
3. Dispara la secuencia de onboarding correspondiente (ej: instrucciones de apertura de cuenta).

---

## ⚙️ Configuración de Integraciones

### HubSpot CRM

1. Ve a **Settings → Integrations → Private Apps** y crea una nueva App.
2. Asigna los scopes mínimos: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.deals.read`, `crm.objects.deals.write`.
3. Copia el token generado y agrégalo en tu `.env` como `HUBSPOT_API_KEY`.

> [!NOTE]
> HubSpot recomienda Private Apps sobre API Keys para mejor seguridad y rastreabilidad de accesos. Las API Keys clásicas fueron deprecadas en noviembre de 2022.

### Mailchimp

1. En Mailchimp ve a **Account → Extras → API keys** y genera una nueva clave.
2. El **Server Prefix** son los caracteres antes del guión en la URL de tu cuenta (ej: si accedes desde `us21.admin.mailchimp.com`, tu prefix es `us21`).
3. Agrega ambos valores al `.env` como `MAILCHIMP_API_KEY` y `MAILCHIMP_SERVER_PREFIX`.

### Calendly

1. En Calendly ve a **Integrations → API & Webhooks**.
2. Genera un **Personal Access Token** (para autenticación básica de API).
3. Crea un webhook apuntando a: `https://n8n.tudominio.com/webhook/calendly-events`.
4. Copia la **Signing Key** del webhook para verificar la autenticidad de los eventos entrantes.

### Microsoft 365 / Excel / OneDrive

Esta integración requiere un registro de aplicación en Azure AD:

1. Ve a [portal.azure.com](https://portal.azure.com) → **Azure Active Directory → App registrations → New registration**.
2. En **Redirect URIs** agrega: `https://n8n.tudominio.com/rest/oauth2-credential/callback`.
3. En **API Permissions** agrega (tipo Application, no Delegated): `Files.ReadWrite.All`, `Sites.ReadWrite.All`.
4. Haz clic en **Grant admin consent** para activar los permisos.
5. En **Certificates & secrets** crea un nuevo Client Secret (anota el valor, sólo se muestra una vez).
6. Anota el **Application (client) ID** y el **Directory (tenant) ID** desde la pantalla de Overview.

Para obtener el `driveItemId` del archivo Excel, usa la Graph Explorer:

```
GET https://graph.microsoft.com/v1.0/me/drive/root:/Portafolio.xlsx
# Copia el campo "id" del response
```

---

## 🔐 Consideraciones de Seguridad y Privacidad

Este proyecto incorpora las siguientes medidas técnicas como buenas prácticas de ingeniería de software. **No reemplazan una auditoría de seguridad profesional.**

| Medida | Implementación | Principio Ley 1581 relacionado |
|---|---|---|
| **Cifrado en tránsito** | TLSv1.2/1.3 obligatorio (Traefik + Let's Encrypt) | Art. 17 — Deber de seguridad |
| **Cifrado en reposo** | `N8N_ENCRYPTION_KEY` (AES-256 para credenciales) | Art. 17 — Deber de seguridad |
| **Red interna aislada** | PostgreSQL en red Docker `internal: true` | Art. 17 — Circulación restringida |
| **Sin telemetría** | `N8N_DIAGNOSTICS_ENABLED=false` | Art. 10 — Principio de finalidad |
| **Retención limitada** | `EXECUTIONS_DATA_MAX_AGE=90` días | Art. 9 — Principio de temporalidad |
| **Cabeceras OWASP** | HSTS, CSP, X-Frame-Options, XSS-Filter | OWASP Secure Headers |
| **Rate limiting** | 100 req/s global, 30 req/s en APIs | Art. 17 — Protección contra abuso |
| **Secretos fuera del repo** | `.env` en `.gitignore`, permisos 600 | Art. 17 — Acceso controlado |

### Recomendaciones adicionales para producción

- [ ] Configurar backups cifrados diarios de PostgreSQL (ver [`deploy.sh`](./infrastructure/deploy.sh) para el script de backup con GPG).
- [ ] Implementar autenticación de dos factores (2FA) en todas las cuentas SaaS (HubSpot, Mailchimp, Calendly, Microsoft 365).
- [ ] Registrar un Responsable de Protección de Datos (RPD) si tu Fintech procesa datos personales de más de 1.000 titulares.
- [ ] Publicar el Aviso de Privacidad en tu sitio web antes de recolectar datos de prospectos vía Calendly.
- [ ] Activar la IP Allowlist en [`config/traefik/dynamic.yml`](./infrastructure/config/traefik/dynamic.yml) para restringir el acceso al editor de n8n a las IPs de tu equipo.

---

## 📖 Glosario para Emprendedores

Términos técnicos usados en este repositorio, explicados en lenguaje cotidiano:

| Término | Explicación sencilla |
|---|---|
| **API** | Una "puerta trasera digital" que permite que dos aplicaciones se comuniquen entre sí de forma automática. |
| **Webhook** | Un aviso automático que una app envía a otra cuando ocurre un evento (ej: "se agendó una reunión en Calendly"). |
| **VPS** | Un servidor en la nube que tú controlas completamente, como alquilar un computador que está siempre prendido en internet. |
| **Docker** | Una tecnología que empaca el software en "cajas" (contenedores) que funcionan igual en cualquier servidor. |
| **TLS/HTTPS** | El candado verde del navegador. Cifra la información para que nadie pueda interceptarla en tránsito. |
| **n8n** | Una plataforma visual (como Lego) para construir automatizaciones conectando distintas aplicaciones. Se autoaloja en tu VPS. |
| **Make (Integromat)** | Similar a n8n pero en la nube (no requiere servidor propio). Ideal para flujos más sencillos. |
| **Orquestador** | El "director de orquesta" de las automatizaciones: decide qué aplicación debe actuar y cuándo. |
| **Conciliación financiera** | El proceso de comparar dos fuentes de datos financieros para detectar diferencias o errores. |
| **Variables de entorno** | Configuraciones secretas (contraseñas, tokens) que se guardan fuera del código para mayor seguridad. |
| **Ley 1581 de 2012** | La ley colombiana que regula cómo las empresas deben recolectar, almacenar y usar datos personales de sus clientes. |

---

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Haz un fork del repositorio.
2. Crea una rama descriptiva: `git checkout -b feat/nombre-del-cambio`.
3. Haz commit de tus cambios con mensajes claros: `git commit -m "feat: descripción del cambio"`.
4. Abre un Pull Request describiendo qué cambiaste y por qué.

Si encuentras un bug de seguridad, por favor **no abras un issue público**. Reporta la vulnerabilidad de forma responsable directamente al autor.

---

## 📄 Licencia

Este proyecto está publicado bajo la **Licencia MIT**.

Puedes usar, copiar, modificar, distribuir y sublicenciar el código de este repositorio, incluso con fines comerciales, siempre y cuando incluyas el aviso de copyright y la licencia en todas las copias o partes sustanciales del software.

Ver el archivo [LICENSE](./LICENSE) para el texto completo.

---

<div align="center">

**Hecho con ❤️ para el ecosistema emprendedor Fintech de Colombia**

*Tesis de Grado — Ingeniería de Software · 2026*

</div>
