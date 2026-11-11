# Contrato de Integración — HubSpot API v3

**Archivo fuente:** `services/hubspot/src/client.js`, `services/hubspot/src/schemas.js`, `services/hubspot/src/index.js`  
**Autenticación:** Bearer token (`HUBSPOT_ACCESS_TOKEN` o `HUBSPOT_API_KEY`)  
**Base URL:** `https://api.hubapi.com/crm/v3/objects/contacts`  
**Reintentos:** 3 intentos, intervalo 30s ante HTTP 429 y 503  

---

## Operaciones

### 1. getContact(email)

Busca un contacto en HubSpot por correo electrónico.

**Payload de entrada:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `email` | `string` (email) | Sí | Correo electrónico del contacto |

**Zod schema:** `z.string().email()`

**Payload de respuesta:**
```json
[
  {
    "id": "123456789",
    "properties": {
      "firstname": "Juan",
      "lastname": "Pérez",
      "email": "juan@ejemplo.com.co",
      "phone": "+57 300 123 4567",
      "estado": "nuevo"
    }
  }
]
```

**Códigos de error:**
| Código | Significado | Comportamiento |
|--------|-------------|----------------|
| 401/403 | `HubSpotAuthError` | Token inválido o permisos insuficientes |
| 429/503 | Reintento automático (3×, 30s) | Si persiste, `HubSpotApiError` |
| Otro | `HubSpotApiError` | Error de API con statusCode y detalle |

**Ejemplo sintético (CLI):**
```json
{ "command": "getContact", "email": "usuario@ejemplo.com.co" }
```

---

### 2. createContact(data)

Crea un nuevo contacto en HubSpot.

**Payload de entrada:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `firstname` | `string` | Sí | Nombre |
| `lastname` | `string` | Sí | Apellido |
| `email` | `string` (email) | Sí | Correo electrónico |
| `phone` | `string` | No | Teléfono |
| `estado` | `enum` | No (default: 'nuevo') | `nuevo`, `prospecto`, `cita_pendiente`, `cita_confirmada`, `cliente`, `inactivo` |

**Zod schema:** `CreateContactInputSchema`

**Payload de respuesta:**
```json
{
  "id": "123456789",
  "properties": {
    "firstname": "Juan",
    "lastname": "Pérez",
    "email": "juan@ejemplo.com.co",
    "phone": "+57 300 123 4567",
    "estado": "nuevo"
  },
  "createdAt": "2026-11-10T10:00:00Z",
  "updatedAt": "2026-11-10T10:00:00Z"
}
```

**Códigos de error:**
| Código | Significado |
|--------|-------------|
| 409 | Email ya existe (HubSpotApiError) |
| 400 | Campos inválidos (Zod validation) |

**Ejemplo sintético (CLI):**
```json
{ "command": "createContact", "firstname": "Juan", "lastname": "Pérez", "email": "juan@ejemplo.com.co", "estado": "nuevo" }
```

---

### 3. updateContact(contactId, data)

Actualiza propiedades de un contacto existente.

**Payload de entrada:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `contactId` | `string` | Sí | ID interno de HubSpot |
| `properties` | `object` | Sí | Al menos una propiedad a actualizar |

**Zod schema:** `UpdateContactInputSchema`

**Payload de respuesta:**
```json
{
  "id": "123456789",
  "properties": { "estado": "cliente" },
  "updatedAt": "2026-11-10T11:00:00Z"
}
```

**Códigos de error:**
| Código | Significado |
|--------|-------------|
| 404 | Contacto no encontrado (HubSpotApiError) |

---

## Seguridad

- No hardcodear `HUBSPOT_ACCESS_TOKEN` ni `HUBSPOT_API_KEY`; usar `process.env`.
- Los permisos mínimos de la Private App: `crm.objects.contacts.read`, `crm.objects.contacts.write`.
- No registrar emails ni tokens en logs en texto plano.

---

## RF cubiertos

- RF-001 a RF-005 (captura de leads, sincronización HubSpot)