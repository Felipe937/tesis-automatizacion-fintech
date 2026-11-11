# Contrato de Integración — Calendly API v2

**Archivo fuente:** `services/calendly/src/client.js`, `services/calendly/src/schemas.js`, `services/calendly/src/index.js`  
**Autenticación:** `Authorization: Bearer {CALENDLY_API_TOKEN}`  
**Base URL:** `https://api.calendly.com`  
**Validación de webhooks:** HMAC-SHA256 con `CALENDLY_WEBHOOK_SECRET`  

---

## Operaciones

### 1. getEvent(uri)

Obtiene detalles de un evento programado de Calendly.

**Payload de entrada:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `uri` | `string` (URL) | Sí | URI completa del evento (devuelta por webhook) |

**Zod schema:** `z.string().url()` (vía `EventResponseSchema`)

**Payload de respuesta:**
```json
{
  "uri": "https://api.calendly.com/scheduled_events/uuid",
  "name": "Asesoría Financiera",
  "start_time": "2026-11-10T10:00:00Z",
  "end_time": "2026-11-10T11:00:00Z"
}
```

---

### 2. getInvitee(uri)

Obtiene detalles de un invitado específico.

**Payload de entrada:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `uri` | `string` (URL) | Sí | URI completa del invitado (devuelta por webhook) |

**Zod schema:** `InviteeResponseSchema`

**Payload de respuesta:**
```json
{
  "uri": "https://api.calendly.com/scheduled_events/uuid/invitees/uuid2",
  "email": "usuario@ejemplo.com.co",
  "first_name": "Juan",
  "last_name": "Pérez",
  "phone_number": "+57 300 123 4567",
  "status": "active",
  "created_at": "2026-11-10T08:00:00Z"
}
```

---

### 3. validateWebhook(payload, signature, secret)

Valida la firma HMAC de un webhook entrante de Calendly.

**Payload de entrada:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `payload` | `string` | Sí | Cuerpo crudo del request |
| `signature` | `string` | Sí | Valor del header `X-Calendly-Signature` |
| `secret` | `string` | Sí | `CALENDLY_WEBHOOK_SECRET` |

**Payload de respuesta:** `{ "valid": true }` o `{ "valid": false }`

**Errores:**
| Error | Significado |
|-------|-------------|
| `CalendlyWebhookValidationError` | Falta firma o falta secreto |

---

### 4. parseWebhookPayload(payload)

Valida y parsea el payload de un webhook de Calendly (evento invitee.created / invitee.canceled).

**Payload de entrada:** Objeto JSON con `event` y `payload.invitee` / `payload.event`.

**Zod schema:** `CalendlyWebhookPayloadSchema`

**Ejemplo sintético (CLI):**
```json
{ "command": "parseWebhook", "payload": { "event": "invitee.created", "payload": { "invitee": { "email": "usuario@ejemplo.com.co", "first_name": "Juan", "last_name": "Pérez" }, "event": { "start_time": "2026-11-10T10:00:00Z", "end_time": "2026-11-10T11:00:00Z" } } } }
```

---

## Seguridad

- No hardcodear `CALENDLY_API_TOKEN` ni `CALENDLY_WEBHOOK_SECRET`; usar `process.env`.
- Validación HMAC obligatoria en webhooks entrantes (tiempo constante con `timingSafeEqual`).
- No registrar emails ni tokens en logs en texto plano.

---

## RF cubiertos

- RF-001 a RF-005 (captura de leads vía Calendly webhook)