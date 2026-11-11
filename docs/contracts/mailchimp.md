# Contrato de Integración — Mailchimp API v3

| | |
|---|---|
| **Archivo fuente** | `services/mailchimp/src/client.js`, `services/mailchimp/src/schemas.js`, `services/mailchimp/src/index.js` |
| **Propósito** | Suscribir y etiquetar prospectos y clientes según su etapa en el embudo comercial. |
| **Base URL** | `https://{serverPrefix}.api.mailchimp.com/3.0` |
| **Autenticación** | **OAuth 2.0** (RF-011) — modo `oauth2`. Modo alternativo `api_key`, declarado como tal. |
| **Reintentos** | 3 intentos con backoff exponencial ante HTTP 429 y 5xx, y errores de red. |

---

## 1. Autenticación (RF-011)

### 1.1 Modos

| Modo | Configuración | Mecanismo | ¿Cumple RF-011? |
|---|---|---|---|
| `oauth2` | `MAILCHIMP_CLIENT_ID`, `MAILCHIMP_CLIENT_SECRET`, `MAILCHIMP_OAUTH_CODE` (+ `MAILCHIMP_REDIRECT_URI`), o bien `MAILCHIMP_ACCESS_TOKEN` si el token ya fue emitido | OAuth 2.0 Authorization Code. Canje del código en `https://login.mailchimp.com/oauth2/token`; el access token se envía como `Authorization: Bearer`. | **Sí** |
| `api_key` | `MAILCHIMP_API_KEY` | `Authorization: apikey <key>`. **No es OAuth 2.0.** | No |

**Renovación:** los tokens de Mailchimp **no expiran** y Mailchimp no emite `refresh_token`. No hay renovación que gestionar; la única causa de fallo es la **revocación** por parte del usuario, que se traduce en `MailchimpAuthError` con instrucción de rehacer el flujo de autorización.

**Datacenter (server prefix):** obligatorio en modo `oauth2` (`MAILCHIMP_SERVER_PREFIX`, ej. `us21`). En modo `api_key` se puede derivar del sufijo de la clave (`<clave>-us21`).

La selección de modo es explícita (`MAILCHIMP_AUTH_MODE`) o inferida: `clientId` + `clientSecret` + `code` (o `accessToken`) → `oauth2`; sólo `apiKey` → `api_key`. El cliente expone `modoAutenticacion` y `serverPrefix` para auditoría en ejecución.

---

## 2. Operaciones

### 2.1 `addOrUpdateMember(listId, email, data)`

Upsert de suscriptor vía `PUT /lists/{list_id}/members/{subscriber_hash}`.

| Campo | Tipo | Requerido | Validación |
|---|---|---|---|
| `listId` | `string` | **Sí** | mín. 1 carácter |
| `email` | `string` | **Sí** | email válido |
| `mergeFields` | `object` | No (def. `{}`) | `FNAME`, `LNAME`, `PHONE`, `ADDRESS` |
| `status` | `enum` | No (def. `subscribed`) | `subscribed`, `unsubscribed`, `cleaned`, `pending` |
| `tags` | `string[]` | No (def. `[]`) | Etiquetas a aplicar |

**Zod:** `AddOrUpdateMemberInputSchema` · **Respuesta:** `MemberResponseSchema`.

```json
{
  "id": "8f3c1a2b",
  "email_address": "usuario@ejemplo.com.co",
  "status": "subscribed",
  "merge_fields": { "FNAME": "Lead", "LNAME": "Demo" },
  "list_id": "lista123"
}
```

| Código | Comportamiento |
|---|---|
| 401 | `MailchimpAuthError` (token revocado o clave inválida) |
| 400 | `MailchimpApiError` (recurso inválido, p. ej. email mal formado) |
| 429 / 5xx | Reintento automático; si persiste, `MailchimpApiError` |
| Respuesta incompleta | `ZodError` |

**Ejemplo sintético (CLI):** `{ "command": "addOrUpdateMember", "listId": "lista123", "email": "usuario@ejemplo.com.co", "tags": ["nuevo"] }`

### 2.2 `addTag(listId, email, tag)`

Añade una etiqueta a un suscriptor vía `POST /lists/{list_id}/members/{subscriber_hash}/tags`.

| Campo | Tipo | Requerido | Validación |
|---|---|---|---|
| `listId` | `string` | **Sí** | mín. 1 carácter |
| `email` | `string` | **Sí** | email válido |
| `tag` | `string` | **Sí** | mín. 1 carácter |

**Zod:** `AddTagInputSchema` · **Respuesta:** `TagsResponseSchema`.

```json
{ "members": [{ "email": "usuario@ejemplo.com.co", "tags": [{ "name": "nuevo", "status": "active" }] }] }
```

**Ejemplo sintético (CLI):** `{ "command": "addTag", "listId": "lista123", "email": "usuario@ejemplo.com.co", "tag": "cita_pendiente" }`

### 2.3 `subscriberHash(email)`

MD5 del correo en minúsculas y sin espacios. Es el identificador de suscriptor que exige la API. Se exporta para poder verificarlo de forma independiente.

---

## 3. Validaciones Zod (resumen)

| Schema | Reglas |
|---|---|
| `AddOrUpdateMemberInputSchema` | `listId` obligatorio; `email` con formato de correo; `status` del ENUM de Mailchimp; `tags` como arreglo de cadenas. |
| `AddTagInputSchema` | `listId` y `tag` obligatorios; `email` con formato de correo. |
| `MemberResponseSchema` | `id`, `email_address`, `status`, `merge_fields` y `list_id` presentes. |
| `TagsResponseSchema` | `members[].email` válido y `members[].tags[].status ∈ {active, inactive}`. |

---

## 4. Errores posibles

| Error | Origen | Causa |
|---|---|---|
| `MailchimpAuthError` | `client.js` | 401, credencial ausente, token revocado, fallo del endpoint de tokens, datacenter no resoluble. |
| `MailchimpApiError` | `client.js` | Otros errores HTTP; expone `statusCode` y `mailchimpError`. |
| `ZodError` | `schemas.js` | Entrada o respuesta incompleta. |

---

## 5. Seguridad

- Ninguna credencial se escribe en el código: todo procede de `process.env`.
- Los logs no imprimen el token; sí la operación, la lista y el correo (que es dato del propio suscriptor: revisar el tratamiento conforme a la Ley 1581/2012).
- En modo `oauth2` el `client_secret` sólo se usa en el canje del código.

---

## 6. Relación con los workflows

| Workflow | Uso |
|---|---|
| `workflows/captura-leads.json` | Nodo **Suscriptor Mailchimp** (alta en la lista de prospectos). |
| `workflows/secuencias-email.json` | Nodos de etiquetado por etapa del embudo (`nuevo`, `cita_pendiente`, `cliente`) y registro en `campaign_lead`. |

---

## 7. Pruebas

| Fichero | Cobertura |
|---|---|
| `src/__tests__/client.test.js` | Creación del cliente, resolución del modo, validación de entrada, `subscriberHash`. |
| `src/__tests__/oauth.test.js` | Cabecera `apikey` vs `Bearer`, datacenter obligatorio en modo OAuth, 401, 400, respuestas incompletas, estabilidad del hash. |
