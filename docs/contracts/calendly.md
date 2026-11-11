# Contrato de Integración — Calendly API v2

| | |
|---|---|
| **Archivo fuente** | `services/calendly/src/client.js`, `services/calendly/src/schemas.js`, `services/calendly/src/index.js` |
| **Propósito** | Recibir las reuniones agendadas (webhook) y consultar el evento y sus invitados. |
| **Base URL** | `https://api.calendly.com` |
| **Autenticación** | **OAuth 2.1** (modo `oauth2`) o **Personal Access Token** (modo `pat`). Ver §1. |
| **Validación de webhooks** | HMAC-SHA256 con `CALENDLY_WEBHOOK_SECRET`, comparación en tiempo constante. |

---

## 1. Autenticación (RF-011) — caso particular

**El RF-011 de la tesis menciona HubSpot, Mailchimp y Microsoft Graph. Calendly no aparece en esa enumeración.** La verificación contra la documentación oficial de Calendly muestra que su modelo de autorización es distinto y que el Personal Access Token es el mecanismo que el propio proveedor sanciona para aplicaciones internas de una sola cuenta.

| Modo | Configuración | Mecanismo | ¿Cumple OAuth 2.0? |
|---|---|---|---|
| `oauth2` | `CALENDLY_ACCESS_TOKEN` | Token emitido por una **app OAuth 2.1** de Calendly (Authorization Code + **PKCE S256**, con consentimiento interactivo del usuario). Se envía como `Authorization: Bearer`. | **Sí, con consentimiento humano** |
| `pat` | `CALENDLY_API_TOKEN` | Personal Access Token (`Bearer`). Es el mecanismo documentado por Calendly para «aplicaciones internas o privadas de una sola cuenta». | **No** |

**Por qué no hay flujo `client_credentials`:** el servidor de autorización de Calendly declara `response_types_supported: ["code"]`, `code_challenge_methods_supported: ["S256"]` y `token_endpoint_auth_methods_supported: ["none"]`. Es decir, **sólo admite authorization code con PKCE** (cliente público), que exige que una persona autorice la aplicación en el navegador. Un workflow de n8n desatendido no puede completar ese flujo.

**Consecuencia y camino futuro:** el cliente **ya acepta un token OAuth 2.1**, de modo que la vía conforme está disponible sin reescribir el servicio. Lo que falta es un paso de despliegue: registrar la app en el Developer Portal de Calendly, completar el consentimiento del usuario y almacenar el token. En el piloto se utiliza el modo `pat`, **declarado como desviación** en `docs/decisions.md` (ADR-001).

La selección de modo es explícita (`CALENDLY_AUTH_MODE`) o inferida: si existe `CALENDLY_ACCESS_TOKEN` → `oauth2`; si sólo existe `CALENDLY_API_TOKEN` → `pat`. El cliente expone `modoAutenticacion` para auditoría en ejecución.

**Expiración:** el token estático puede declararse con `tokenExpiresInMs`; al expirar, el cliente lanza `CalendlyAuthError` con un mensaje explícito en lugar de fallar con un 401 confuso.

---

## 2. Operaciones

### 2.1 `getEvent(uri)`

| Campo | Tipo | Requerido | Validación |
|---|---|---|---|
| `uri` | `string` (URL) | **Sí** | URL de la API (`https://api.calendly.com/scheduled_events/…`) |

**Zod de respuesta:** `EventResponseSchema` (`uri`, `name`, `start_time`, `end_time` obligatorios; `status`, `event_type`, `location`, `created_at`, `updated_at` opcionales).

```json
{
  "uri": "https://api.calendly.com/scheduled_events/uuid",
  "name": "Asesoría Financiera",
  "status": "active",
  "start_time": "2026-11-10T10:00:00.000Z",
  "end_time": "2026-11-10T11:00:00.000Z",
  "event_type": "https://api.calendly.com/event_types/ET-1"
}
```

### 2.2 `getInvitee(uri)`

| Campo | Tipo | Requerido | Validación |
|---|---|---|---|
| `uri` | `string` (URL) | **Sí** | URL de la API del invitado |

**Zod de respuesta:** `InviteeResponseSchema` (`uri`, `email`, `first_name`, `status`, `created_at` obligatorios; `phone_number` y `canceled_at` opcionales).

```json
{
  "uri": "https://api.calendly.com/scheduled_events/uuid/invitees/uuid2",
  "email": "usuario@ejemplo.com.co",
  "first_name": "Lead",
  "last_name": "Demo",
  "phone_number": "+57 300 123 4567",
  "status": "active",
  "created_at": "2026-11-10T08:00:00.000Z"
}
```

### 2.3 `validateCalendlyWebhook(payload, signature, secret)`

Valida la firma HMAC-SHA256 de un webhook entrante.

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `payload` | `string \| Buffer` | **Sí** | Cuerpo crudo de la petición |
| `signature` | `string` | **Sí** | Header `X-Calendly-Signature` (hexadecimal) |
| `secret` | `string` | **Sí** | `CALENDLY_WEBHOOK_SECRET` |

**Respuesta:** `true` / `false`. La comparación es en tiempo constante (`timingSafeEqual`); si las longitudes difieren, se devuelve `false` sin comparar.

**Errores:** `CalendlyWebhookValidationError` si falta la firma o el secreto.

### 2.4 `parseCalendlyWebhookPayload(payload)`

Valida el payload del webhook (`invitee.created`, `invitee.canceled`, …).

**Zod:** `CalendlyWebhookPayloadSchema` — exige `event`, `payload.invitee.{email, first_name, last_name, uri}` y `payload.event.{start_time, end_time, uri}`.

**Ejemplo sintético (CLI):**

```json
{
  "command": "parseWebhook",
  "payload": {
    "event": "invitee.created",
    "payload": {
      "invitee": {
        "email": "usuario@ejemplo.com.co",
        "first_name": "Lead",
        "last_name": "Demo",
        "uri": "https://api.calendly.com/scheduled_events/uuid/invitees/uuid2"
      },
      "event": {
        "start_time": "2026-11-10T10:00:00Z",
        "end_time": "2026-11-10T11:00:00Z",
        "uri": "https://api.calendly.com/scheduled_events/uuid"
      }
    }
  }
}
```

---

## 3. Validaciones Zod (resumen)

| Schema | Reglas |
|---|---|
| `CalendlyWebhookPayloadSchema` | `event` no vacío; `invitee.email` con formato de correo; `invitee.first_name` / `last_name` obligatorios; `phone_number` opcional; `event.start_time` / `end_time` ISO 8601; URIs con formato de URL. |
| `EventResponseSchema` | `uri` URL, `name` no vacío, `start_time` / `end_time` ISO 8601. |
| `InviteeResponseSchema` | `uri` URL, `email` válido, `first_name` no vacío, `status` no vacío, `created_at` ISO 8601. |

---

## 4. Errores posibles

| Error | Origen | Causa |
|---|---|---|
| `CalendlyAuthError` | `client.js` | 401/403, token ausente o expirado, fallo al obtener el token. |
| `CalendlyApiError` | `client.js` | Otros errores HTTP; expone `statusCode` y `calendlyError`. |
| `CalendlyWebhookValidationError` | `client.js` | Firma o secreto ausente en la validación del webhook. |
| `ZodError` | `schemas.js` | Entrada o respuesta incompleta. |

---

## 5. Seguridad

- Ninguna credencial se escribe en el código: todo procede de `process.env`.
- La validación HMAC del webhook es obligatoria y en tiempo constante.
- Los logs no imprimen tokens ni Firmas.

---

## 6. Relación con los workflows

| Workflow | Uso |
|---|---|
| `workflows/captura-leads.json` | Nodo **Webhook Calendly** (evento `invitee.created`) → nodo **Validar HMAC Calendly** (Code node con HMAC sobre el cuerpo crudo) → creación del lead y de la cita en PostgreSQL. |

---

## 7. Pruebas

| Fichero | Cobertura |
|---|---|
| `src/__tests__/client.test.js` | Validación HMAC (firma válida, inválida, ausente), payload de webhook, creación del cliente. |
| `src/__tests__/oauth.test.js` | Resolución de modo, envío del token Bearer, token expirado, 401, 404, respuestas incompletas. |
