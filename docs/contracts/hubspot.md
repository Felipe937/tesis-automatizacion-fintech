# Contrato de Integración — HubSpot API v3

| | |
|---|---|
| **Archivo fuente** | `services/hubspot/src/client.js`, `services/hubspot/src/schemas.js`, `services/hubspot/src/index.js` |
| **Propósito** | Sincronizar contactos del embudo comercial (captura de leads vía Calendly y cambios de etapa). |
| **Base URL** | `https://api.hubapi.com/crm/v3/objects/contacts` |
| **Autenticación** | **OAuth 2.0** (RF-011) — modo `oauth2`. Modo alternativo `private_app`, declarado como tal. |
| **Reintentos** | 3 intentos con intervalo fijo de 30 s ante HTTP 429 y 503 y errores de red. |

---

## 1. Autenticación (RF-011)

### 1.1 Modos

| Modo | Configuración | Mecanismo | ¿Cumple RF-011? |
|---|---|---|---|
| `oauth2` | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_REFRESH_TOKEN` (+ `HUBSPOT_REDIRECT_URI`, `HUBSPOT_SCOPES`) | OAuth 2.0 Authorization Code + Refresh Token. Canje del refresh token en `https://api.hubapi.com/oauth/v1/token`; access tokens de corta duración con **renovación automática** 60 s antes de expirar. | **Sí** |
| `private_app` | `HUBSPOT_ACCESS_TOKEN` | Private App Token (`pat-na1-…` / `pat-eu1-…`) enviado como `Authorization: Bearer`. **No es OAuth 2.0.** | No |

La selección de modo es explícita (`HUBSPOT_AUTH_MODE`) o inferida: si existen `clientId` + `clientSecret` + `refreshToken` → `oauth2`; si sólo hay `accessToken` → `private_app`. El cliente expone `modoAutenticacion` para poder auditar en ejecución qué mecanismo está en uso.

### 1.2 Manejo de tokens

| Situación | Comportamiento |
|---|---|
| Token por caducar | Renovación transparente antes de la expiración (`services/common/oauth2.js`) |
| HTTP 401 de la API | Se invalida la caché del token y se reintenta **una sola vez** con un token nuevo |
| HTTP 401 persistente | `HubSpotAuthError` (no se reintenta en bucle) |
| Refresh token revocado (`invalid_grant`) | `HubSpotAuthError` con instrucción de **rehacer el flujo de autorización** |
| Endpoint de tokens inaccesible | `HubSpotAuthError` con la causa original |

---

## 2. Operaciones

### 2.1 `getContact(email)`

Busca un contacto por correo electrónico.

| Campo | Tipo | Requerido | Validación |
|---|---|---|---|
| `email` | `string` | **Sí** | `z.string().email()` |

**Respuesta:** array de contactos (`ContactSearchResponseSchema`).

```json
[{ "id": "123456789", "properties": { "firstname": "Lead", "lastname": "Demo", "email": "usuario@ejemplo.com.co", "phone": "+57 300 123 4567", "estado": "nuevo" } }]
```

| Código | Comportamiento |
|---|---|
| 401 / 403 | `HubSpotAuthError` (token inválido o scopes insuficientes) |
| 429 / 503 | Reintento automático (3 × 30 s); si persiste, `HubSpotApiError` |
| Otro | `HubSpotApiError` con `statusCode` y cuerpo de error de HubSpot |
| Respuesta incompleta | `ZodError` |

**Ejemplo sintético (CLI):** `{ "command": "getContact", "email": "usuario@ejemplo.com.co" }`

### 2.2 `createContact(data)`

| Campo | Tipo | Requerido | Validación |
|---|---|---|---|
| `firstname` | `string` | **Sí** | mín. 1 carácter |
| `lastname` | `string` | **Sí** | mín. 1 carácter |
| `email` | `string` | **Sí** | email válido |
| `phone` | `string` | No | — |
| `estado` | `enum` | No (def. `nuevo`) | `nuevo`, `prospecto`, `cita_pendiente`, `cita_confirmada`, `cliente`, `inactivo` (MER Cap. IV) |

**Zod:** `CreateContactInputSchema`. **Respuesta:** `ContactCreateResponseSchema`.

```json
{ "id": "123456789", "properties": { "firstname": "Lead", "lastname": "Demo", "email": "usuario@ejemplo.com.co", "phone": "+57 300 123 4567", "estado": "nuevo" }, "createdAt": "2026-11-10T10:00:00Z" }
```

| Código | Comportamiento |
|---|---|
| 409 | Email ya existente → `HubSpotApiError` |
| 400 / campos inválidos | `ZodError` |

**Ejemplo sintético (CLI):** `{ "command": "createContact", "firstname": "Lead", "lastname": "Demo", "email": "usuario@ejemplo.com.co", "estado": "nuevo" }`

### 2.3 `updateContact(contactId, data)`

| Campo | Tipo | Requerido | Validación |
|---|---|---|---|
| `contactId` | `string` | **Sí** | mín. 1 carácter |
| `properties` | `object` | **Sí** | al menos una propiedad (`firstname`, `lastname`, `email`, `phone`, `estado`) |

**Zod:** `UpdateContactInputSchema`. **Respuesta:** `ContactUpdateResponseSchema`.

```json
{ "id": "123456789", "properties": { "estado": "cita_confirmada" }, "updatedAt": "2026-11-10T11:00:00Z" }
```

| Código | Comportamiento |
|---|---|
| 404 | `HubSpotApiError` |

---

## 3. Validaciones Zod (resumen)

| Schema | Reglas |
|---|---|
| `CreateContactInputSchema` | `firstname` y `lastname` obligatorios; `email` con formato de correo; `estado` del ENUM del MER. |
| `UpdateContactInputSchema` | `contactId` obligatorio; `properties` con al menos un campo. |
| `ContactSearchResponseSchema` | `results[].id` string; `properties` con los campos esperados. |
| `ContactCreateResponseSchema` | `id` + `properties` con `firstname`, `lastname`, `email`. |
| `ContactUpdateResponseSchema` | `id` + `properties` libre. |

---

## 4. Errores posibles

| Error | Origen | Causa |
|---|---|---|
| `HubSpotAuthError` | `client.js` | 401/403, credencial ausente, refresh token revocado, fallo del endpoint de tokens. |
| `HubSpotApiError` | `client.js` | Cualquier otro error HTTP; expone `statusCode` y `hubspotError`. |
| `ZodError` | `schemas.js` | Entrada o respuesta incompleta. |
| Error de red | `axios-retry` | Se reintenta 3 veces; al agotar, `HubSpotApiError`. |

---

## 5. Seguridad

- Ninguna credencial se escribe en el código: todo procede de `process.env`.
- Los logs registran la **operación**, no el correo del contacto ni el token.
- Scopes mínimos recomendados: `crm.objects.contacts.read`, `crm.objects.contacts.write`.
- En modo `oauth2`, el `client_secret` sólo se usa en el canje del token; nunca se envía a la API de CRM.

---

## 6. Relación con los workflows

| Workflow | Uso |
|---|---|
| `workflows/captura-leads.json` | Nodos **Buscar Contacto HubSpot**, **Crear Contacto HubSpot** y **Actualizar Contacto HubSpot** (mediante HTTP Request con credencial `httpHeaderAuth`). |
| `workflows/secuencias-email.json` | Nodo **Detectar Cambio HubSpot** (polling de contactos por estado). |

---

## 7. Pruebas

| Fichero | Cobertura |
|---|---|
| `src/__tests__/client.test.js` | Creación del cliente, resolución del modo, validación de entrada (Zod), mapeo de errores. |
| `src/__tests__/oauth.test.js` | Resolución de modo, envío del token Bearer, reintento tras 401 con renovación, 401/404, refresh token revocado, respuestas incompletas. |
