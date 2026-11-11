# Registro de Decisiones Técnicas (ADR)

**Tesis IS25237** — Automatización de Procesos de Venta e Inversión mediante Integración de APIs y Herramientas No-code/Low-code para Emprendedores del Sector Fintech en Colombia.

Este documento registra las decisiones de arquitectura, autenticación y datos que explican **por qué** el prototipo es como es. Cada decisión incluye el requisito de tesis al que responde (con la cita de la sección correspondiente), la justificación técnica, los riesgos, las limitaciones, el estado de cumplimiento y el camino alternativo para alcanzar el cumplimiento completo.

> **Base documental.** Este registro se elaboró por contraste directo con el documento original de la tesis (`tesis-IS25237-con-figuras-3-4-y-5.docx`), capítulos I a V, Anexos y Manual Técnico. Las citas remiten a la sección del documento, no a números de línea.
>
> **Alcance de la evidencia.** El repositorio es un artefacto académico. Las mediciones de campo (piloto de ocho semanas con el usuario real) **no están incluidas** en el repositorio: el piloto se ejecutó sobre un entorno de pruebas con datos sintéticos. En consecuencia, ninguna cifra de este repositorio constituye un resultado empírico de la hipótesis; el código las produce, pero su valor depende de datos que el repositorio no puede publicar por razones de protección de datos personales (Ley 1581/2012).

---

## Índice

| ADR | Título | Requisito | Estado |
|---|---|---|---|
| [ADR-001](#adr-001) | Autenticación OAuth 2.0 por proveedor | RF-011 / RNF-003 | **Cumplimiento parcial documentado** |
| [ADR-002](#adr-002) | Versiones de plataforma: PostgreSQL 16, Traefik 3, Node 20 | §4.5.1 | Desviaciones documentadas |
| [ADR-003](#adr-003) | Esquema idempotente y estrategia de migración | RNF-006 | Cumplido |
| [ADR-004](#adr-004) | Operacionalización de VD1 y VD2 y línea base trazable | §2.4, §3.4.3, §3.5 | Parcial — depende del piloto |
| [ADR-005](#adr-005) | Métricas y Dashboard como servicios HTTP en lugar de *Execute Command* | §4.5.3 | Desviación justificada |
| [ADR-006](#adr-006) | Definición de los indicadores del reporte semanal | RF-012 | Cumplido |
| [ADR-007](#adr-007) | Frecuencia y automatización del dashboard | §4.4 | Cumplido |
| [ADR-008](#adr-008) | Lint compartido sin dependencias externas | RNF-005 | Cumplido |
| [ADR-009](#adr-009) | Capa Make (Integromat) sin escenarios exportados | §3.6.1, §4.1 | No evidenciado |
| [ADR-010](#adr-010) | Seguridad del repositorio y datos de terceros | RNF-003 / Ley 1581 | Cumplido |
| [ADR-011](#adr-011) | MER: la Figura 5 del documento no coincide con el §4.3 | MER Cap. IV | Discrepancia documentada |
| [ADR-012](#adr-012) | Dashboard: el mockup de §4.4 no coincide con su propia descripción | §4.4 | Discrepancia resuelta |
| [ADR-013](#adr-013) | Doble numeración de requerimientos en el documento | §3.6 | Discrepancia documentada |

---

## ADR-001 — Autenticación OAuth 2.0 por proveedor

**Estado:** Cumplimiento parcial documentado.
**Requisitos de tesis:** RF-011 (§3.6.3) y RNF-003 (§3.6.4), además de la restricción general de §3.6.2.

### Texto del requisito

> **RF-011** — «Las conexiones con **HubSpot, Mailchimp y Microsoft Graph** deben autenticarse mediante OAuth 2.0. El sistema debe **almacenar los tokens de acceso de forma cifrada y renovarlos automáticamente antes de su vencimiento sin intervención manual».» (Prioridad: Alta)

> **RNF-003** — «Toda comunicación con las APIs externas ocurre **exclusivamente mediante HTTPS y autenticación OAuth 2.0**. Las credenciales se almacenan **cifradas en el gestor de n8n**; jamás en texto plano dentro del código fuente.» (Métrica: cero incidentes de exposición de credenciales; 100 % de las llamadas API mediante HTTPS.)

> **Restricción general (§3.6.2)** — «Segunda: toda comunicación con las APIs externas ocurre mediante HTTPS con autenticación OAuth 2.0, **sin excepciones**.»

El diagrama de despliegue (§4.1.2) etiqueta la conexión con las APIs externas —HubSpot CRM, Mailchimp, Calendly y Microsoft Graph— como «API REST / Webhooks · **OAuth 2.0** · HTTPS».

### Decisión

El mecanismo de autenticación se declara **explícitamente por proveedor y por modo**, con dos modos por integración: un modo OAuth 2.0 conforme al requisito y un modo alternativo heredado que **se identifica como tal** en el código, en los contratos y en este documento. Ningún API Key ni Private App Token se presenta como OAuth 2.0.

| Proveedor | Modo OAuth 2.0 (RF-011) | Modo alternativo (degradado) | Mecanismo técnico del modo OAuth |
|---|---|---|---|
| **Microsoft Graph** | ✅ OAuth 2.0 *Client Credentials* (MSAL Node) | — | `services/excel-reconciler/src/graphClient.js` — `ConfidentialClientApplication`, caché y renovación automática de tokens |
| **HubSpot** | ✅ OAuth 2.0 *Authorization Code* + *Refresh Token* | `private_app` (Private App Token `pat-na1-…`) | `services/hubspot/src/client.js` — canje del refresh token en `https://api.hubapi.com/oauth/v1/token`, renovación antes de expirar y reintento único ante HTTP 401 |
| **Mailchimp** | ✅ OAuth 2.0 *Authorization Code* | `api_key` (`Authorization: apikey <key>`) | `services/mailchimp/src/client.js` — canje del código en `https://login.mailchimp.com/oauth2/token`; el token **no expira** (Mailchimp no emite `refresh_token`) |
| **Calendly** | ⚠️ OAuth 2.1 (*Authorization Code* + **PKCE S256**, consentimiento interactivo del usuario) | `pat` (Personal Access Token) | `services/calendly/src/client.js` — acepta un access token OAuth 2.1 emitido fuera del proceso |

La lógica OAuth común (caché, expiración, renovación, tipado de errores) está centralizada en **`services/common/oauth2.js`** y se reutiliza desde los tres clientes, sin duplicación.

### Cumplimiento de los tres sub-requisitos de RF-011

| Sub-requisito | Implementación | Evidencia |
|---|---|---|
| «autenticarse mediante OAuth 2.0» | Modo `oauth2` en HubSpot, Mailchimp y Microsoft Graph (ya conforme); modo `oauth2` en Calendly con la limitación documentada abajo | `services/common/oauth2.js`, `services/*/src/client.js` |
| «almacenar los tokens de acceso de forma cifrada» | Los tokens **no viven en el repositorio**: se gestionan en el **gestor de credenciales de n8n**, cifradas con AES-256 mediante `N8N_ENCRYPTION_KEY` (§4.5.3: «cifra las credenciales con AES-256 antes de almacenarlas en PostgreSQL»). En el `.env` sólo hay identificadores de cliente, nunca el token de acceso | `infrastructure/docker-compose.yml` (`N8N_ENCRYPTION_KEY`), `.gitignore`, auditoría de seguridad |
| «renovarlos automáticamente antes de su vencimiento sin intervención manual» | Renovación transparente 60 s antes de expirar (HubSpot); token sin expiración (Mailchimp, Microsoft Graph vía MSAL); expiración declarada y error explícito (Calendly) | `services/common/oauth2.js` (`DEFAULT_REFRESH_MARGIN_MS`), pruebas de `oauth2.test.js` |

### Por qué Calendly es un caso distinto

**RF-011 enumera «HubSpot, Mailchimp y Microsoft Graph» — Calendly no está en esa lista.** Pero RNF-003 y la restricción general de §3.6.2 sí son «sin excepciones», y el diagrama de despliegue etiqueta las cuatro plataformas como OAuth 2.0. Por tanto **Calendly queda cubierto por RNF-003**, aunque no por RF-011: la desviación debe documentarse frente a ambos.

La verificación técnica confirma que el tratamiento es distinto:

- El servidor de autorización de Calendly (`https://calendly.com/.well-known/oauth-authorization-server`) declara `response_types_supported: ["code"]`, `code_challenge_methods_supported: ["S256"]` y `token_endpoint_auth_methods_supported: ["none"]`: **sólo admite authorization code con PKCE**, que exige consentimiento interactivo del usuario final y un cliente público. No existe un flujo `client_credentials` equivalente al de Microsoft Graph para integraciones server-to-server desatendidas.
- La documentación de Calendly declara que los **Personal Access Tokens** son el mecanismo indicado para «aplicaciones internas o privadas de una sola cuenta» (caso de uso explícito: «Pushing Calendly event and invitee data into your company's CRM»).

**El propio Manual Técnico de la tesis (§4.5.2, paso quinto) prescribe esta vía**: «Se necesitan cuatro: el **token de acceso privado de HubSpot** (cuenta Professional obligatoria), las **credenciales OAuth 2.0 de Mailchimp**, el **token personal de Calendly** y las credenciales de una aplicación registrada en Microsoft Azure».

Es decir: **el documento contiene una contradicción interna** entre sus requisitos (RF-011/RNF-003: OAuth 2.0 para todas las plataformas) y su propio manual de instalación (Private App Token para HubSpot y Personal Token para Calendly). El repositorio **implementa ambos modos** y documenta la contradicción, que es la única forma de que el prototipo sea desplegable tal como el manual describe y, a la vez, prepare el camino al cumplimiento pleno.

### Riesgos

| Riesgo | Mitigación implementada |
|---|---|
| Token de HubSpot expirado en caliente | Renovación automática con margen de 60 s + reintento único tras 401 + invalidación de caché |
| Refresh token revocado (el usuario desconectó la app) | Error tipado `TokenRevokedError` con mensaje que indica rehacer la autorización; no se reintenta en bucle |
| Token de Mailchimp revocado | Error 401 → `MailchimpAuthError` indicando rehacer el flujo |
| Token de Calendly expirado | `createStaticTokenProvider` con expiración opcional (`tokenExpiresInMs`) → error explícito |
| Filtración de secretos en logs | Los clientes registran operaciones, **nunca** tokens ni cuerpos con datos personales |

### Limitaciones

1. **El despliegue con OAuth 2.0 real no pudo ejecutarse en este entorno**: no se dispone de cuentas de las plataformas SaaS ni de tokens de las aplicaciones de desarrollador. La evidencia es el código, su contrato y sus pruebas unitarias con dobles de `fetch` y adaptadores de axios, no una autenticación real contra los servicios de los proveedores.
2. Los modos alternativos (`private_app`, `api_key`, `pat`) siguen disponibles porque son los que exige el propio Manual Técnico (§4.5.2) y porque eliminan la dependencia del consentimiento interactivo. **Deben usarse sólo cuando la alternativa OAuth no sea viable, y el informe de resultados debe declarar qué modo se usó.**
3. El repositorio no puede publicar las credenciales cifradas del gestor de n8n (son de la instancia del piloto); su custodia y rotación corresponden al despliegue.

### Estado de cumplimiento

| Proveedor | ¿Cumple en el código? | ¿Demostrado en ejecución real? |
|---|---|---|
| Microsoft Graph | Sí | No (sin credenciales de Azure AD) |
| HubSpot | Sí (modo `oauth2`) | No (sin app de desarrollador) |
| Mailchimp | Sí (modo `oauth2`) | No (sin app registrada) |
| Calendly | Parcialmente: el cliente soporta token OAuth 2.1; falta el consentimiento interactivo (paso de despliegue) | No |

### Alternativa necesaria para el cumplimiento completo

1. Registrar las aplicaciones de desarrollador (HubSpot, Mailchimp) y la app OAuth 2.1 de Calendly en el Developer Portal de cada proveedor.
2. Realizar el consentimiento del usuario y persistir el refresh token (HubSpot) o el access token (Mailchimp, Calendly) en el gestor de credenciales de n8n.
3. Fijar `HUBSPOT_AUTH_MODE=oauth2`, `MAILCHIMP_AUTH_MODE=oauth2` y `CALENDLY_AUTH_MODE=oauth2` en el `.env` de producción.
4. Eliminar del `.env` los valores `HUBSPOT_ACCESS_TOKEN`, `MAILCHIMP_API_KEY` y `CALENDLY_API_TOKEN` para que no quede una vía alterna disponible.
5. Registrar en el informe final el identificador de la app, los scopes concedidos y la fecha del consentimiento.

### Fuentes

- HubSpot, *Authentication overview* y *Legacy private apps* — <https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/overview>
- Mailchimp, *OAuth 2* y *Set up an OAuth app* — <https://mailchimp.com/developer/marketing/api-concepts/authentication/oauth-2/>
- Calendly, *Creating an OAuth app* y *Authentication overview* — <https://developer.calendly.com/docs/authentication/creating-an-oauth-app>
- Calendly, metadatos del servidor de autorización — <https://calendly.com/.well-known/oauth-authorization-server>

---

## ADR-002 — Versiones de plataforma: PostgreSQL 16, Traefik 3, Node 20

**Estado:** Desviaciones documentadas y reversibles.
**Requisito de tesis:** §4.5.1 (Tabla de requisitos de software) y §3.6.5 (Restricciones y dependencias).

### Requisitos del documento

> **§4.5.1** — Ubuntu Server 22.04 LTS · Docker Engine 24.0 · Docker Compose 2.20 · n8n 2.6.3 · **PostgreSQL 15** · **Node.js 18 LTS** · **Traefik 2.10**

> **§3.6.5** — «Para correr el sistema hacen falta: Docker Engine 24.0 o superior, Docker Compose 2.20 o superior, Node.js 18 LTS, n8n en su versión 2.6.3, **PostgreSQL 15** y una conexión a internet con al menos 10 Mbps disponibles.»

### Estado real del repositorio

| Componente | Tesis | Repositorio | Justificación |
|---|---|---|---|
| n8n | 2.6.3 | **2.6.3** | Alineado exactamente. |
| PostgreSQL | 15 | **16 Alpine** | **Desviación.** Razón: ciclo de vida y disponibilidad de la imagen oficial multi-arquitectura. El esquema es compatible con 15 y 16 (sólo usa tipos existentes desde PostgreSQL 9.5/10). Cambiar a `postgres:15-alpine` es una línea, sin tocar el esquema. |
| Node.js | 18 LTS | **18** (módulos nuevos) / **20** (excel-reconciler) | El reconciliador usa `node:test` y `fetch` nativos con comportamiento estable desde Node 20. El resto de servicios mantiene 18 LTS, alineado. |
| Traefik | 2.10 | **3.6.7** | **Desviación.** Traefik 2.10 está fuera de soporte; la rama 3 corrige vulnerabilidades y añade el middleware `rateLimit` por IP, que el §4.1.2 del documento describe («bloquea cualquier petición que no esté destinada a un servicio declarado explícitamente»). |
| Docker / Compose | 24.0 / 2.20 | Los del host | Sin desviación. |
| Ubuntu | 22.04 LTS | 22.04 LTS | Alineado. |

> **Corrección de una afirmación previa.** La versión anterior del README de este repositorio justificaba PostgreSQL 16 con una «incompatibilidad de `postgres:15-alpine` con `uuid-ossp` y `pg_trgm`». **Esa afirmación no era verificable y se ha retirado**: no se reproduce con las imágenes oficiales actuales. La razón real es de ciclo de vida y disponibilidad.

### Riesgos

- Un revisor que compare la tesis con el repositorio puede leer las diferencias como incumplimientos. Se mitiga documentándolas aquí y en el README.
- Un *downgrade* del contenedor de PostgreSQL requiere exportar y restaurar los datos (procedimiento en `infrastructure/README.dev.md`).
- Traefik 3 cambia la sintaxis de algunos middlewares respecto de 2.10; el repositorio usa la sintaxis de la rama 3 de forma coherente.

### Estado

Desviaciones técnicas **documentadas y reversibles**; no afectan la validez del MER ni de las fórmulas de negocio.

---

## ADR-003 — Esquema idempotente y estrategia de migración

**Estado:** Cumplido.
**Requisito de tesis:** RNF-006 (Portabilidad: «despliegue exitoso en entorno limpio, documentado paso a paso») y §3.6.5.

### Problema encontrado

`init.sql` declaraba `CREATE TYPE IF NOT EXISTS lead_estado AS ENUM (…)`. **Esa sintaxis no existe en PostgreSQL**: produce `ERROR: syntax error at or near "NOT"`. El script fallaba en el primer arranque y abortaba la inicialización del contenedor.

### Decisión

1. Los cinco tipos ENUM se crean dentro de bloques `DO … $$ … EXCEPTION WHEN duplicate_object THEN RAISE NOTICE … $$`, forma canónica de hacer idempotente la creación de un tipo.
2. Las tablas, índices y comentarios conservan `IF NOT EXISTS`.
3. Se eliminó el acoplamiento a nombres fijos: `GRANT` y `COMMENT ON DATABASE` se resuelven dinámicamente con `current_database()` y `current_user`.
4. Se fija `timezone = 'America/Bogota'` a nivel de base de datos, coherente con la hora local del piloto (§4.1.2: «n8n corre… hora de Colombia»).
5. Se añade la tabla `schema_migrations` con la versión `001_init_mer`: la versión del esquema queda registrada y auditable.
6. **Política de migraciones:** ninguna migración borra tablas, columnas, índices ni datos; la reejecución del script es segura.

### Estrategia de reejecución

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < infrastructure/config/postgres/init.sql
```

### Verificación

`infrastructure/scripts/verify-init.mjs` levanta un PostgreSQL limpio, aplica `init.sql` **dos veces** y comprueba: existencia de las seis entidades del MER, los cinco ENUM con sus valores, los índices, las claves foráneas, las restricciones UNIQUE, la zona horaria, el registro de migración, la **persistencia de datos entre ejecuciones** y la **ausencia de tablas internas de n8n** en el esquema. **Resultado: 12/12 comprobaciones correctas.**

---

## ADR-004 — Operacionalización de VD1 y VD2, y línea base trazable

**Estado:** Parcial — la operacionalización está implementada y verificada; la medición real depende del piloto.
**Requisito de tesis:** §2.4 (variables), §3.4.3 (telemetría) y §3.5 (técnicas de análisis).

### Definición de las variables en el documento

> **VD1 — Variable Dependiente 1: Tiempo de sincronización de datos** (§2.4). «Es el tiempo **en segundos** que toma el sistema en actualizar la información entre aplicaciones tras detectarse un cambio. Se busca verificar una reducción de al menos el **70 %** frente al traspaso manual, **analizando los registros de ejecución** de n8n y Make.»

> **VD2 — Variable Dependiente 2: Tasa de errores operativos** (§2.4). «Es el **porcentaje de datos incorrectos o repetidos en los sistemas de destino sobre el total de registros procesados**. La meta es demostrar una reducción del **50 %** en comparación con la digitación manual previa.»

> **§3.4.3 (telemetría).** «el sistema registrará de forma automática la **latencia**, el **número de ejecuciones exitosas**, el **volumen de datos procesados** y la **tasa de fallas** en las llamadas a las APIs.»

> **§3.5 (análisis).** «se aplicarán técnicas de **estadística descriptiva**… se agrupará en variables de tiempo y de errores… se calcularán **medias aritméticas, medianas y desviaciones estándar**.»

### Decisión y corrección más importante

La primera implementación del componente de métricas calculaba VD2 como **fracción de ejecuciones fallidas** (`errores / ejecuciones`). Eso **no es lo que define la tesis**: la VD2 del documento es una tasa **por registro procesado** («datos incorrectos o repetidos … sobre el total de registros procesados»).

Se implementan **las dos lecturas**, con la de la tesis como la que se reporta como VD2:

| Métrica | Definición | Uso |
|---|---|---|
| `tasaErrorRegistrosPorcentaje` | (registros procesados en ejecuciones fallidas ÷ total de registros procesados) × 100 | **VD2 según la tesis** — se reporta en el correo y en el informe de texto |
| `tasaErrorPorcentaje` | (ejecuciones fallidas ÷ ejecuciones totales) × 100 | Diagnóstico operativo: tasa de fallos de flujo (§3.4.3) |

**Atribución conservadora.** `automation_log` no registra cuántos registros concretos fueron erróneos, sólo el total procesado por ejecución. Se adopta la cota **superior**: todos los registros de una ejecución fallida se consideran erróneos. Es la lectura más exigente para demostrar la reducción y, por tanto, la más honesta a la hora de reportar.

### Fórmulas implementadas (idénticas a `services/metrics/src/calculator.js`)

| Magnitud | Fórmula | Unidad |
|---|---|---|
| Media | `Σ(latencia_ms) / n` | ms |
| Mediana | valor central de la muestra ordenada | ms |
| Desviación estándar | `√(Σ(x − x̄)² / (n − 1))` (muestral) | ms |
| VD1 | `((líneaBase_s × 1000 − mediaLatencia_ms) / (líneaBase_s × 1000)) × 100` | % |
| VD2 (tesis) | `((tasaErrorManual − tasaErrorRegistros) / tasaErrorManual) × 100` | % |
| Diagnóstico | `((tasaErrorManual − tasaErrorEjecuciones) / tasaErrorManual) × 100` | % |

La línea base de VD1 se expresa en **segundos** (unidad de la tesis) y se convierte a **milisegundos** antes de compararla con la latencia medida.

### Línea base parametrizada y trazable

La línea base **no es un literal en el código**. El componente la recibe como parámetro validado con Zod, junto con su procedencia (`fuente`, `descripcion`, `fechaMedicion`, `notas`), y el informe **imprime la línea base efectivamente aplicada**.

| Parámetro | Unidad | Origen documental |
|---|---|---|
| `lineaBaseTiempoManualSegundos` | segundos por operación | §1.1.1 / Resumen: «hasta el **28 %** de su jornada laboral» en transcripción manual |
| `lineaBaseTasaErrorManual` | porcentaje (0–100) | §1.1.1 / Resumen: «tasas de error **superiores al 5 %**» |
| `umbralObservacionesMinimo` | observaciones | Criterio estadístico (30 por defecto) |

### Reglas de honestidad estadística

1. Si `observaciones < umbralObservacionesMinimo` (30), el informe incluye `advertenciaDatosInsuficientes` y **la conclusión se marca como preliminar y no concluyente** (`conclusionDefinitiva: false`).
2. Un periodo sin ejecuciones produce un aviso explícito (`advertenciaPeriodoSinRegistros`) y métricas en cero, **no** una conclusión favorable.
3. Las latencias nulas se excluyen de los cálculos estadísticos pero siguen contando para el total de ejecuciones y para la tasa de error.

### Limitaciones

- Los valores por defecto del `.env.example` (120 s y 5 %) son **marcadores de posición** derivados de la descripción del proceso manual (§1.1.1), **no** de una medición del piloto. Se declara en el `.env.example`, en el Compose, en ADR-004 y en el informe de correo.
- **El piloto de ocho semanas no está documentado en el repositorio**, por lo que las metas del 70 % y del 50 % **no pueden darse por cumplidas**. El componente calcula y publica el valor real con la línea base que se le pase.

---

## ADR-005 — Métricas y Dashboard como servicios HTTP en lugar de *Execute Command*

**Estado:** Desviación justificada.
**Requisito de tesis:** §4.5.3 (componentes) y §4.1.2 (diagrama de despliegue).

### Lo que dice el documento

> **§4.5.3** — «Los scripts de Node.js cubren lo que n8n no puede hacer solo. Son **cuatro módulos independientes**: `hubspot.js`… `mailchimp.js`… `calendly.js`… y `onedrive.js`… n8n los invoca cuando los necesita a través del nodo **"Execute Command"**.»

> **§4.1.2 (diagrama de despliegue)** — el contenedor «Node.js 18 LTS · Scripts de transformación» se relaciona con n8n mediante la arista «**Ejecución de scripts**».

### Decisión

El repositorio **no ejecuta comandos dentro del contenedor de n8n**. Los componentes de negocio se despliegan como **microservicios HTTP** (`node:http`, sin framework) en la red interna de Docker, con el mismo patrón que ya usaba `services/excel-reconciler`:

```
n8n ──HTTP + x-api-key──▶ metrics:3001/metrics      ──▶ PostgreSQL (automation_log)
n8n ──HTTP + x-api-key──▶ dashboard:3002/dashboard  ──▶ PostgreSQL (MER) ──▶ OneDrive (Graph API)
n8n ──HTTP + x-api-key──▶ excel-reconciler:3000/reconcile ──▶ OneDrive (Graph API)
```

- Autenticación interna por header `x-api-key` con comparación en tiempo constante.
- `GET /health` sin autenticación para los health checks de Docker.
- Usuario no-root, `read_only: true` y `no-new-privileges:true`.

### Justificación

1. **Seguridad.** El nodo *Execute Command* habilita la ejecución de procesos arbitrarios en el contenedor de n8n, con las implicaciones de aislamiento, escalada de privilegios y auditoría que implica. La vía HTTP permite autenticar, validar y limitar la superficie expuesta.
2. **Coherencia con el propio repositorio.** `excel-reconciler` ya era un servicio HTTP con API key; el cambio homogeneiza la arquitectura en lugar de mezclar dos mecanismos.
3. **Testabilidad.** La lógica de negocio queda en funciones puras con pruebas unitarias, en lugar de código embebido en el JSON de un workflow.
4. **Reproducibilidad.** Cada componente es un contenedor con su propio `Dockerfile` y sus dependencias declaradas, alineado con RNF-006.

### Correspondencia con los cuatro módulos de la tesis

| Módulo de §4.5.3 | Implementación en el repositorio |
|---|---|
| `hubspot.js` | `services/hubspot/` (cliente + OAuth 2.0) |
| `mailchimp.js` | `services/mailchimp/` (cliente + OAuth 2.0) |
| `calendly.js` | `services/calendly/` (cliente + HMAC de webhooks) |
| `onedrive.js` (Graph API + OAuth 2.0) | `services/excel-reconciler/src/graphClient.js` + `services/dashboard/src/graphClientAdapter.js` |

El repositorio **no crea un archivo `onedrive.js`**: la lectura y escritura en Excel/OneDrive vía Microsoft Graph está implementada en `graphClient.js` y reutilizada por el dashboard a través del adaptador, tal como exige el requisito de no duplicar el cliente Graph.

### Riesgo residual

Se añade `pg` como dependencia directa de `metrics` y `dashboard` (una por servicio). Como alternativa, ambos componentes aceptan los datos ya extraídos por n8n (parámetro `ejecuciones` / bloques precargados), de modo que pueden funcionar sin acceso directo a la base de datos.

---

## ADR-006 — Definición de los indicadores del reporte semanal

**Estado:** Cumplido.
**Requisito de tesis:** RF-012 (§3.6.3).

### Texto del requisito

> **RF-012** — «Cada lunes a las 8:00 a. m. el sistema debe enviar al correo del usuario piloto un resumen de la semana anterior con el número de **contactos procesados**, **citas registradas**, **negocios cerrados** y **flujos fallidos**, tomando los datos de la tabla de logs en PostgreSQL.» (Prioridad: Baja)

### Defecto encontrado

El workflow `reporte-semanal` calculaba `contactos_procesados` y `citas_registradas` con **la misma subconsulta** (`SUM(registros_procesados)` sobre `automation_log` con `workflow_id = 'captura-leads'`). Ambos indicadores devolvían el mismo número y, además, contaban *operaciones del workflow*, no *contactos ni citas*. `negocios_cerrados` se calculaba sobre `lead.estado = 'cliente'` filtrando por `fecha_registro` (fecha de alta), no por la de cierre.

### Definiciones corregidas

| Indicador | Fuente | Fórmula | Nota |
|---|---|---|---|
| `contactos_procesados` | `lead` | `COUNT(*)` con `fecha_registro` dentro del periodo | Contactos efectivamente sincronizados con el CRM |
| `citas_registradas` | `appointment` | `COUNT(*)` con `fecha_hora_inicio` dentro del periodo | Citas agendadas vía Calendly (evento de agenda, no un contacto) |
| `negocios_cerrados` | `lead` | `COUNT(*)` con `estado = 'cliente'` y `fecha_ultima_actualizacion` dentro del periodo | Limitación: `lead` no guarda historial de cambios de estado |
| `flujos_fallidos` | `automation_log` | `COUNT(*)` con `estado = 'error'` dentro del periodo | Ejecuciones fallidas de **todos** los workflows del periodo |

Ningún indicador se calcula a partir de operaciones financieras: `investment` no participa del reporte semanal (sí del dashboard, bloque d).

### Interpretación de «tomando los datos de la tabla de logs»

El RF-012 pide que el resumen se elabore «tomando los datos de la tabla de logs en PostgreSQL». La lectura literal (los cuatro indicadores salen de `automation_log`) es **técnicamente imposible para tres de los cuatro**: `automation_log` no distingue un contacto de una cita; sólo cuenta «registros procesados», que es un agregado. Ése era precisamente el defecto corregido.

**Interpretación adoptada:** el reporte se construye con datos de PostgreSQL, usando `automation_log` como fuente del indicador de flujos fallidos y del conjunto de observaciones que alimenta las métricas VD1/VD2, y las tablas de negocio (`lead`, `appointment`) como fuente de los indicadores de evento (contactos y citas), porque son las que registran el hecho de negocio que el indicador nombra. Se documenta de forma explícita en la anotación del workflow y en `docs/contracts/metrics.md`.

### Riesgo residual

`negocios_cerrados` es una **aproximación**: si un lead pasó por varios estados en el mismo periodo, se cuenta una sola vez. Para un histórico exacto haría falta una tabla de transiciones de estado (extensión del MER, fuera del alcance de esta iteración y sin alterar el MER sin contraste con la tesis).

---

## ADR-007 — Frecuencia y automatización del dashboard

**Estado:** Cumplido.
**Requisito de tesis:** §4.4.

### Decisión

`workflows/actualizacion-dashboard.json`:

| Aspecto | Decisión | Justificación |
|---|---|---|
| Frecuencia | **Diaria a las 6:00 a. m. (America/Bogota)**, regla cron editable en el trigger | El dashboard es una vista operativa de consulta frecuente; una actualización diaria mantiene el libro Excel al día sin coste de API significativo, y se ejecuta **antes** del reporte semanal (lunes 8:00) para que el libro ya contenga la semana en curso |
| Periodo analizado | Ventana móvil configurable con `DASHBOARD_PERIODO_HORAS` (168 h = 7 días por defecto) | El bloque c es el «calendario de la semana» de §4.4 y el resto de bloques se acumulan sobre el histórico |
| Orquestación | n8n invoca al componente `dashboard` por HTTP | Reutiliza la autenticación y el cliente Graph ya implementados (ADR-005) |
| Idempotencia | Se omite si ya hay una ejecución `exito` de `dashboard-ejecutivo` en las últimas 23 h | Evita ejecuciones duplicadas en una ejecución diaria |
| Trazabilidad | Toda ejecución (éxito o error) se registra en `automation_log` | `automation_log` es la fuente de verdad del componente de métricas (§2.4) |
| Errores | Salida de error de cada nodo → `Registrar Error` → alerta por correo | El fallo nunca queda silencioso (RF-008/RNF de notificaciones) |

### Variables de entorno requeridas

- `DASHBOARD_EXCEL_DRIVE_ITEM_ID` — identificador del libro Excel en OneDrive (Graph Explorer: `GET /me/drive/root:/Dashboard.xlsx` → `id`).
- `DASHBOARD_EXCEL_WORKSHEET` — nombre de la hoja (por defecto `Dashboard Ejecutivo`).

---

## ADR-008 — Lint compartido sin dependencias externas

**Estado:** Cumplido.
**Requisito de tesis:** RNF-005 (Mantenibilidad: «los scripts de Node.js siguen los principios de Clean Code y documentan todas las funciones públicas con comentarios JSDoc»).

### Problema encontrado

Los `package.json` de `hubspot`, `mailchimp` y `calendly` declaraban `"lint": "echo 'Lint pendiente'"`: el comando **no revisaba ningún archivo**. El proyecto ya tenía una solución de linting en `services/excel-reconciler/scripts/lint.mjs`, pero no se reutilizaba.

### Decisión

La implementación vive en **`services/scripts/lint.mjs`** (una sola copia para todo el proyecto); `services/excel-reconciler/scripts/lint.mjs` delega en ella. **No se introduce ESLint ni ninguna dependencia nueva**: el prototipo prioriza la reproducibilidad sin instalación global ni paquetes transitivos.

### Reglas aplicadas

| Regla | Severidad |
|---|---|
| Sintaxis JS/MJS (`node --check`) | error |
| Sentencias `debugger` residuales | error |
| `.only()` en archivos de prueba | error |
| Patrones de credenciales literales (`pat-…`, `sk-…`, `Bearer …`, `clientSecret: '…'`, `BEGIN … PRIVATE KEY`, contraseñas) | error |
| Espacios finales, líneas > 140 caracteres, falta de newline final | aviso |

El patrón de secretos detecta el **valor literal** pero el lint **no imprime el valor encontrado**: sólo el tipo de credencial, para no convertir el linter en un vector de filtración.

---

## ADR-009 — Capa Make (Integromat) sin escenarios exportados

**Estado:** No evidenciado — documentado como limitación.

### Lo que el documento afirma

Make aparece en el documento como **capa de orquestación secundaria**, no accesoria:

- §1.3 / Resumen: «un prototipo funcional que usa n8n 2.6.3 como motor de orquestación autohospedado, scripts de transformación en Node.js 18 LTS y **flujos secundarios en Make**».
- §2.4: las métricas se verifican «analizando los registros de ejecución de **n8n y Make**».
- §3.4.3: «**Telemetría y logs automáticos de n8n y Make**».
- §3.6.1 (alcance de la ERS): «Para conectarlas se utilizan n8n como motor de orquestación autohospedado, scripts de transformación escritos en Node.js y **flujos secundarios configurados en Make**».
- §3.6.2 (actores): el Administrador «es quien interviene cuando algo falla o cuando se necesita ajustar una regla de negocio», incluidos «los flujos de Make».

### Hallazgo

**El repositorio no contiene ninguna exportación, blueprint ni captura de los escenarios de Make**, y no hay script, Makefile ni configuración que los genere. La mención del README a tres escenarios concretos («Formularios Web → CRM», «Recordatorios SMS», «Exportaciones programadas») **no tiene respaldo documental en la tesis**: en el documento no aparece esa enumeración.

### Decisión

**No se afirma que Make se haya utilizado.** La referencia se conserva en el README y en el diagrama, pero reescrita como **capa opcional y no verificada**, y este ADR documenta qué haría falta para reproducirla.

### Lo que necesita un tercero para reproducirla

1. Una cuenta de Make con los conectores activos (HubSpot, Mailchimp, SMS, OneDrive).
2. Definir los escenarios con la misma semántica que los workflows de n8n, de modo que cada flujo de Make quede cubierto por un flujo equivalente en n8n.
3. Exportar cada escenario a JSON (Make ofrece *Export blueprint*) y versionarlo en `workflows/make/` junto con un `README.md` que documente módulos, frecuencia y variables de entorno.
4. Sustituir cada webhook de Make por el webhook de n8n ya existente, para que el flujo no se bifurque.
5. Definir cómo se inyectan las ejecuciones de Make en `automation_log`, porque **la telemetría de la tesis (VD1 y VD2) se calcula sobre «los registros de ejecución de n8n y Make»** y `automation_log` sólo registra n8n.

### Limitaciones de la ausencia

- No se puede auditar qué parte del proceso automatizado se ejecutó en Make y qué parte en n8n.
- Las ejecuciones de Make **no quedan trazadas** en `automation_log`, que es la base de VD1/VD2: si Make se ejecutó en el piloto, la medición de la hipótesis está incompleta.
- La ausencia de exportaciones impide la reproducibilidad exigida por RNF-006 para esa parte de la arquitectura.

### Estado

**Pendiente.** Requiere una sesión con acceso a la cuenta de Make del piloto.

---

## ADR-010 — Seguridad del repositorio y datos de terceros

**Estado:** Cumplido.
**Requisito de tesis:** RNF-003 («Las credenciales se almacenan cifradas en el gestor de n8n; jamás en texto plano dentro del código fuente») y Ley 1581/2012.

### Hallazgos y correcciones

| Hallazgo | Corrección |
|---|---|
| `infrastructure/traefik/certs/acme.json` estaba **versionado**. Es el estado de la cuenta ACME: en producción contiene **claves privadas** | Se elimina del índice de Git (`git rm --cached`) y se añade la ruta correcta a `.gitignore` (además de `*.pem`, `*.key`, `*.p12`, `*.pfx`) |
| `.gitignore` ignoraba `infrastructure/config/traefik/certs/` (ruta inexistente) en lugar de `infrastructure/traefik/certs/` (ruta real) | Corregido; se conservan ambas por robustez |
| `.env`, `infrastructure/n8n_data/`, `infrastructure/postgres/` y `infrastructure/data/` correctamente ignorados | Verificado |
| Los fixtures usaban nombres y correos de personas reales («María García», «juan.perez@ejemplo.com.co») | Sustituidos por identificadores neutros («Lead Demo 3», `usuario@ejemplo.com.co`) |
| Los clientes registraban datos personales en consola | Se eliminó el correo del log; se registra la operación y el identificador no sensible |

### Rotación de credenciales

**Ninguna credencial real de producción está expuesta en el repositorio**: el fichero `.env` está ignorado y `.env.example` sólo contiene marcadores `<REEMPLAZAR_…>`. Una auditoría sobre los 71 ficheros versionados no detecta secretos (el único patrón similar es una clave de prueba en `excel-reconciler`, obviously sintética).

**Recomendación operativa:** rotar el secreto de la cuenta ACME si el `acme.json` versionado llegó a contener claves reales en un clon ya publicado. **En el estado auditado el fichero estaba vacío (0 bytes), por lo que no hay material criptográfico que rotar.** En cualquier despliegue nuevo: `openssl rand -hex 32` para `N8N_ENCRYPTION_KEY` y `openssl rand -base64 32` para la contraseña de PostgreSQL.

### Datos personales

- Los datos de demostración son sintéticos y genéricos.
- Los logs de auditoría registran identificadores de workflow y duraciones, nunca correos, nombres ni contenidos de negocio.
- El libro Excel del dashboard contiene datos del piloto: su publicación exige autorización del responsable del tratamiento (Ley 1581/2012, Art. 5 y 9).

---

## ADR-011 — MER: la Figura 5 del documento no coincide con el §4.3

**Estado:** Discrepancia documentada; se implementa la versión textual.

### Lo que dice el §4.3 (prosa)

> «La base de datos PostgreSQL que sostiene el sistema tiene **cinco entidades principales**. […] **Lead** es el núcleo del modelo… Sus atributos clave son `id_lead` (PK), `nombre`, `correo_electronico`, `telefono`, `fecha_registro` y `fecha_ultima_actualizacion`. El campo `estado` acepta seis valores posibles: `nuevo`, `prospecto`, `cita_pendiente`, `cita_confirmada`, `cliente` e `inactivo`. El atributo `id_hubspot` guarda la referencia al registro correspondiente en el CRM.
> **Campaign** recoge cada campaña de Mailchimp… `id_campaign` (PK) y `nombre`, un campo `estado` con cuatro opciones —`pendiente`, `activa`, `completada`, `cancelada`— y la referencia externa `id_mailchimp`.
> **Appointment** almacena las citas agendadas por Calendly. Se relaciona con **Lead** mediante `id_lead` (FK), registra `fecha_hora_inicio`, `fecha_hora_fin` y el `enlace_calendly`… estado `pendiente`, `confirmada`, `cancelada` o `completada`.
> **Investment** registra cada operación financiera cerrada. Aparte de `id_investment` (PK) e `id_lead` (FK), guarda `monto`, `tipo_instrumento`, `fecha_registro` y estado (`activa`, `vencida` o `cancelada`). El campo `id_excel_row` mantiene la referencia a la fila correspondiente en la hoja de Excel/OneDrive.
> **AutomationLog** es distinta a las demás: no almacena datos de negocio sino del comportamiento del sistema. Cada fila es una ejecución de un workflow de n8n, con su `workflow_id`, timestamps de inicio y fin, estado (`exito`, `error` o `advertencia`), cantidad de registros procesados, latencia en milisegundos y un campo `mensaje_error` que solo se rellena cuando algo falla.
> En cuanto a las relaciones: un **Lead** tiene múltiples **Appointments** (1:N) y múltiples **Investments** (1:N). Con **Campaign** la relación es M:N, resuelta mediante una tabla de asociación `campaign_lead`. **AutomationLog** no tiene clave foránea hacia las otras entidades: registra el sistema, no los datos.»

### Lo que muestra la Figura 5 (imagen del documento)

La **Figura 5** del documento es un diagrama MER con **cinco entidades de otro diseño**:

| Entidad (Figura 5) | Atributos |
|---|---|
| `Contacto` | `id_contacto` (PK), `nombre`, `apellido`, `email`, `telefono`, `etiqueta_segmento`, `fecha_creacion`, `fuente_origen` |
| `EjecucionFlujo` | `id_ejecucion` (PK), `id_contacto` (FK), `nombre_flujo`, `fecha_inicio`, `fecha_fin`, `estado`, `mensaje_error` |
| `Negocio` | `id_negocio` (PK), `id_contacto` (FK), `nombre_negocio`, `monto`, `estado`, `fecha_cierre`, `tipo_producto` |
| `Cita` | `id_cita` (PK), `id_contacto` (FK), `fecha_hora`, `duracion_min`, `estado`, `plataforma` |
| `ReporteInversion` | `id_reporte` (PK), `id_negocio` (FK), `monto`, `fecha_cierre`, `nombre_cliente`, `tipo_producto`, `fecha_registro` |

Relaciones en la figura: `Contacto` 1:N `Negocio`, 1:N `EjecucionFlujo`, 1:N `Cita`; `Negocio` 1:1 `ReporteInversion`. **No existe la relación M:N ni la tabla `campaign_lead`.**

### Discrepancia y decisión

La **imagen de la Figura 5 pertenece a un borrador anterior** del modelo de datos: no incluye la entidad `Campaign` ni la relación M:N, usa nombres genéricos en español (`Contacto`, `Negocio`, `Cita`) y carece de los campos `id_hubspot`, `id_mailchimp`, `id_excel_row`, `latencia_ms` y `registros_procesados`, que sí son exigidos por el §4.3, por RF-008/RF-009 y por el flujo de conciliación de Excel.

**Decisión: se implementa el MER del §4.3** (que es el que el propio repositorio ya contenía, el que exige la automatización descrita en §4 y el que soporta los workflows). El MER del §4.3 coincide **entidad por entidad, atributo por atributo y relación por relación** con `infrastructure/config/postgres/init.sql`:

| Entidad | §4.3 | `init.sql` |
|---|---|---|
| Lead | id_lead (PK), nombre, correo_electronico, telefono, fecha_registro, fecha_ultima_actualizacion, estado (6), id_hubspot | idéntico ✓ |
| Campaign | id_campaign (PK), nombre, estado (4), id_mailchimp | idéntico ✓ |
| Appointment | id_appointment (PK), id_lead (FK), fecha_hora_inicio, fecha_hora_fin, enlace_calendly, estado (4) | idéntico ✓ |
| Investment | id_investment (PK), id_lead (FK), monto, tipo_instrumento, fecha_registro, estado (3), id_excel_row | idéntico ✓ |
| AutomationLog | workflow_id, timestamps, estado (3), registros_procesados, latencia_ms, mensaje_error | idéntico ✓ |
| campaign_lead | M:N Campaign ↔ Lead | idéntico ✓ |

**Acción pendiente para el autor:** regenerar la Figura 5 con el diagrama del §4.3 antes de la entrega final, o sustituir la imagen por el diagrama generado desde el esquema. Es una inconsistencia **del documento**, no del código.

---

## ADR-012 — Dashboard: el mockup de §4.4 no coincide con su propia descripción

**Estado:** Discrepancia resuelta por composición.

### Las dos fuentes

**§4.4 (descripción textual del dashboard ejecutivo):**

> «Vive en Excel/OneDrive y reúne en una sola pantalla los indicadores que más importan en el día a día. Hay un **gráfico de barras** que muestra cuántos leads hay en cada etapa del ciclo —nuevo, prospecto, cita pendiente, cita confirmada, cliente—. Debajo, una tabla con las **campañas de Mailchimp** del período: cuántas se enviaron, qué tasa de apertura tuvieron y cuántos clics generaron. **Al lado**, el **calendario de la semana** con las citas ya confirmadas. Y al final, el **resumen financiero**: saldo total de inversiones activas, número de operaciones del mes en curso y variación porcentual frente al mes anterior.»

**Mockup de la Figura «Dashboard Ejecutivo — Asesor Fintech»** (imagen §4.4):

| Sección del mockup | Contenido |
|---|---|
| Cabecera | «EXCEL / ONEDRIVE · Dashboard Ejecutivo - Asesor Fintech» con pestañas `Inicio` `Leads` `Citas` `Inversiones` `Reportes` |
| PERIODO DE CONSULTA | Periodo («Noviembre 2026»), filtro «Todos los estados», botón «Actualizar datos» |
| INDICADORES CLAVE DE GESTIÓN (KPIs) | Leads registradas · Citas agendadas · Inversiones registradas · Conversión (14,4 %) |
| SEGUIMIENTO COMERCIAL | Estado del lead · Cantidad · Participación %, con 4 etapas: Nuevo, En seguimiento, Cita agendada, Convertido |
| RESUMEN DE INVERSIONES | Total de operaciones · Monto acumulado · Operaciones pendientes · Operaciones completadas |
| MONITOREO DE INTEGRACIONES | Plataforma · Última sincronización · Estado (HubSpot CRM, Mailchimp, Calendly, Excel/OneDrive) |
| CONTROL DE ACTUALIZACIÓN | Última actualización · Estado general («Sincronización correcta») + botones «Exportar reporte» / «Consultar registros» |

**El mockup no contiene la tabla de campañas Mailchimp ni el calendario de la semana**, y el §4.4 no menciona los KPI, el monitoreo de integraciones ni el control de actualización.

### Decisión: composición de ambas fuentes

El componente implementa **la unión de ambas**, sin inventar ningún indicador:

| Bloque | Origen | Estado en el repositorio |
|---|---|---|
| Cabecera, pestañas, periodo de consulta | Mockup | ✓ |
| Indicadores clave (4 KPIs) | Mockup | ✓ `kpis` |
| Seguimiento comercial (estado + etapa + cantidad + %) | Mockup (etapas) + §4.4 (gráfico de barras) + MER (6 estados) | ✓ `seguimientoComercial` |
| Campañas Mailchimp | §4.4 | ✓ `campañasMailchimp` |
| Citas del periodo | §4.4 | ✓ `citasSemana` |
| Resumen financiero | §4.4 + Mockup (líneas adicionales) | ✓ `resumenFinanciero` |
| Monitoreo de integraciones | Mockup | ✓ `monitoreoIntegraciones` (derivado de `automation_log`) |
| Control de actualización | Mockup | ✓ `controlActualizacion` |

### Detalles de resolución

1. **Etapas del embudo.** El MER tiene 6 estados; el mockup 4 etapas comerciales; el §4.4 enumera 5. La tabla muestra **las seis filas del MER** con una columna «Etapa comercial» que las agrega en las cuatro etapas del mockup (`Nuevo`, `En seguimiento`, `Cita agendada`, `Convertido`). El estado `inactivo` queda **fuera del embudo** y con participación 0 %, para no alterar la suma (que debe ser 100 %).
2. **Pestañas.** El mockup las representa como pestañas de hoja. El libro se escribe en **una sola hoja** (el workflow escribe en `DASHBOARD_EXCEL_WORKSHEET`); las pestañas se representan como una fila de navegación en la cabecera. Crear cinco hojas por Graph API es posible (`POST /workbook/worksheets`) pero rompe el modelo de «una actualización = una escritura atómica» y añade superficie de API. **Limitación documentada.**
3. **Botones del mockup.** «Actualizar datos» corresponde al workflow programado (se documenta el disparador); «Exportar reporte» y «Consultar registros» son affordances de interfaz de usuario sin equivalente en un libro estático: el primero se cubre con la notificación por correo y el segundo con la trazabilidad en `automation_log`. **Documentado como no implementados.**
4. **Frecuencia.** El documento no fija una frecuencia de actualización del dashboard: §4.4 lo describe como «una sola pantalla» de consulta diaria. Se adoptó frecuencia diaria (ADR-007).

---

## ADR-013 — Doble numeración de requerimientos en el documento

**Estado:** Discrepancia documentada; se usa la numeración del enunciado y de la primera tabla.

### Hallazgo

El documento contiene **dos versiones de las tablas de requerimientos** con numeración distinta para el mismo identificador:

| ID | Primera tabla (§3.6.3, antes de §3.6.4) | Segunda tabla (§3.6.3, tras §3.6.1–3.6.2) |
|---|---|---|
| RF-001 | Captura de contactos nuevos desde HubSpot (webhook, 60 s) | Captura automática de leads (5 s) |
| RF-011 | **Autenticación OAuth 2.0 con APIs externas** | Panel de monitoreo de estado |
| RF-012 | **Reporte semanal de actividad** | Habilitación individual de plataformas |
| RNF-001 | Disponibilidad (99 %, 8 semanas) | Rendimiento (≤ 10 s en el 95 %) |
| RNF-002 | Rendimiento (≤ 30 s) | Disponibilidad (99 % en horario laboral) |
| RNF-003 | Seguridad (TLS 1.2+, credenciales en `.env`) | Seguridad (HTTPS + OAuth 2.0, credenciales cifradas en el gestor de n8n) |
| RNF-004 | Protección de datos personales (retención 90 días) | Escalabilidad (500 registros/día) |
| RNF-005 | Mantenibilidad (JSDoc + README + anotaciones) | Mantenibilidad (Clean Code + JSDoc + anotaciones) |
| RNF-006 | Portabilidad (Docker Compose) | Portabilidad (despliegue en entorno limpio) |

Las dos versiones coinciden en lo esencial: n8n 2.6.3, OAuth 2.0, HTTPS, cifrado de credenciales, retención de 90 días, JSDoc, anotaciones en los workflows, README y portabilidad con Docker Compose.

### Decisión

El repositorio y este registro usan **la numeración de la primera tabla** (RF-011 = OAuth 2.0, RF-012 = reporte semanal), que es la del enunciado del proyecto y la de la que derivan las tareas de implementación. Cuando una métrica de aceptación sólo existe en la segunda versión, se cita con su identificador de esa versión (`RNF-003 (2ª versión)`), para que la trazabilidad sea inequívoca.

**Acción pendiente para el autor:** eliminar la tabla duplicada del documento y dejar una sola versión canónica, o numerar las dos series de forma que no colisionen.

---

## Trazabilidad de requisitos

| Requisito (documento) | Componente | Archivos | Prueba |
|---|---|---|---|
| RF-011 (OAuth 2.0, tokens cifrados y renovados) | `services/common/oauth2.js`, `hubspot`, `mailchimp`, `calendly`, `excel-reconciler` | `common/oauth2.js`, `*/src/client.js` | `common/__tests__/oauth2.test.js` (14), `*/__tests__/oauth.test.js` (31) |
| RNF-003 (2ª v.) — HTTPS + OAuth 2.0 + credenciales cifradas en n8n | Compose, `.env.example`, `.gitignore` | `docker-compose.yml`, `.env.example` | Auditoría de seguridad (0 secretos) |
| RF-007 / RF-010 — Reintentos (3 intentos, 30 s / exponencial) | Clientes HTTP | `*/src/client.js` | `oauth.test.js`, `client.test.js` |
| RF-008 / RF-009 — Log de ejecuciones en PostgreSQL | `init.sql` + workflows | `init.sql`, `workflows/*.json` | `verify-init.mjs`, `integration.test.js` |
| RF-009 / RF-008 — Notificación por correo ante fallo | Workflows | `workflows/*.json` | Revisión de conexiones + `emailSend` |
| RF-010 (1ª v.) / RF-011 (2ª v.) — Panel de monitoreo de n8n | n8n nativo | `docker-compose.yml` (`EXECUTIONS_DATA_MAX_AGE`) | — |
| RF-012 — Reporte semanal (lunes 8:00) | `workflows/reporte-semanal.json` + `services/metrics` | `workflows/reporte-semanal.json`, `services/metrics/src/*` | `service.test.js` (23), `server.test.js` (8), `integration.test.js` (4) |
| §2.4 VD1 / VD2 — variables dependientes | `services/metrics/src/calculator.js` | `calculator.js`, `schemas.js` | `calculator.test.js` (22), `service.test.js` (23) |
| §3.4.3 — Telemetría (latencia, ejecuciones, volumen, fallas) | `init.sql` (`automation_log`) | `init.sql` | `verify-init.mjs` |
| §3.5 — Estadística descriptiva (media, mediana, desviación) | `services/metrics/src/calculator.js` | `calculator.js` | `calculator.test.js` |
| §4.3 — MER (5 entidades + `campaign_lead`) | `infrastructure/config/postgres/init.sql` | `init.sql` | `verify-init.mjs` (12), `integration.test.js` (4) |
| §4.4 — Dashboard ejecutivo (4 bloques + mockup) | `services/dashboard` + `workflows/actualizacion-dashboard.json` | `services/dashboard/src/*`, `workflows/actualizacion-dashboard.json` | `dashboard.test.js` (29), `service.test.js` (12), `excelWriter.test.js` (16), `server.test.js` (6) |
| RNF-001 (2ª v.) — Rendimiento ≤ 10 s | Métricas de latencia | `calculator.js` | `calculator.test.js` |
| RNF-002 (2ª v.) — Disponibilidad 99 % | `restart: unless-stopped` + healthchecks | `docker-compose.yml` | — |
| RNF-005 — Mantenibilidad (JSDoc, anotaciones, README) | Todos los servicios | `src/*.js`, `workflows/*.json`, `README.md` | `npm run lint` (49 ficheros) |
| RNF-006 — Portabilidad | Compose + Dockerfiles | `infrastructure/`, `services/*/Dockerfile` | `docker compose config` (6 servicios) |
| Ley 1581/2012 — Protección de datos | `.gitignore`, servicios, `init.sql` | — | Auditoría de seguridad |
