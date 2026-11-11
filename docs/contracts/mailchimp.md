# Contrato de Integración — Mailchimp API v3

**Archivo fuente:** `services/mailchimp/src/client.js`, `services/mailchimp/src/schemas.js`, `services/mailchimp/src/index.js`  
**Autenticación:** `Authorization: apikey {MAILCHIMP_API_KEY}`  
**Base URL:** `https://{serverPrefix}.api.mailchimp.com/3.0`  
**Server prefix:** Se deriva de la API Key (ej: `us21`) o `MAILCHIMP_SERVER_PREFIX`  
**Reintentos:** 3 intentos, backoff exponencial ante HTTP 429 y 5xx  

---

## Operaciones

### 1. addOrUpdateMember(listId, email, data)

Crea o actualiza un suscriptor en una lista de Mailchimp (upsert vía PUT).

**Payload de entrada:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `listId` | `string` | Sí | ID de la lista de Mailchimp |
| `email` | `string` (email) | Sí | Correo del suscriptor |
| `mergeFields` | `object` | No | `{ FNAME, LNAME, PHONE, ADDRESS }` |
| `status` | `enum` | No (default: 'subscribed') | `subscribed`, `unsubscribed`, `cleaned`, `pending` |
| `tags` | `string[]` | No | Tags para etiquetar (ej: `['nuevo', 'bienvenida']`) |

**Zod schema:** `AddOrUpdateMemberInputSchema`

**Payload de respuesta:**
```json
{
  "id": "subscriber_hash_md5",
  "email_address": "juan@ejemplo.com.co",
  "status": "subscribed",
  "merge_fields": { "FNAME": "Juan", "LNAME": "Pérez" },
  "list_id": "lista123"
}
```

**Códigos de error:**
| Código | Significado |
|--------|-------------|
| 401 | `MailchimpAuthError` — API Key inválida |
| 429/5xx | Reintento automático (3×, backoff exponencial) |

**Ejemplo sintético (CLI):**
```json
{ "command": "addOrUpdateMember", "listId": "lista123", "email": "juan@ejemplo.com.co", "mergeFields": { "FNAME": "Juan" }, "tags": ["nuevo"] }
```

---

### 2. addTag(listId, email, tag)

Añade un tag a un suscriptor existente.

**Payload de entrada:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `listId` | `string` | Sí | ID de la lista |
| `email` | `string` (email) | Sí | Correo del suscriptor |
| `tag` | `string` | Sí | Tag a añadir (ej: `bienvenida`, `onboarding`) |

**Zod schema:** `AddTagInputSchema`

**Payload de respuesta:**
```json
{
  "members": [
    {
      "email": "juan@ejemplo.com.co",
      "tags": [{ "name": "bienvenida", "status": "active" }]
    }
  ]
}
```

**Ejemplo sintético (CLI):**
```json
{ "command": "addTag", "listId": "lista123", "email": "juan@ejemplo.com.co", "tag": "bienvenida" }
```

---

## Seguridad

- No hardcodear `MAILCHIMP_API_KEY`; usar `process.env`.
- El `subscriber_hash` se calcula internamente como MD5 del email en minúsculas.
- No registrar emails en logs en texto plano.

---

## RF cubiertos

- RF-001 a RF-005 (suscripción a Mailchimp, tags por etapa)
- RF-003 (secuencias de email por etapa del embudo)