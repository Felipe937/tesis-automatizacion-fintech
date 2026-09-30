# excel-reconciler — Servicio de Conciliación Financiera

Servicio Node.js (ESM) que concilia transacciones de inversión entre n8n y Excel en OneDrive vía Microsoft Graph API.

## Índice

- [Arquitectura](#arquitectura)
- [Instalación](#instalación)
- [Variables de entorno](#variables-de-entorno)
- [CLI (línea de comandos)](#cli-línea-de-comandos)
- [Servidor HTTP](#servidor-http)
- [Contrato API — POST /reconcile](#contrato-api--post-reconcile)
- [Tests](#tests)
- [Docker](#docker)
- [Despliegue en n8n](#despliegue-en-n8n)
- [Licencia](#licencia)

---

## Arquitectura

```
n8n (workflow) ──HTTP POST──▶ excel-reconciler:3000/reconcile
                                      │
                                      ▼
                              Microsoft Graph API
                                      │
                                      ▼
                              Excel en OneDrive
```

- **CLI**: `src/index.js` — para uso con nodo Execute Command de n8n (stdin/stdout)
- **HTTP**: `src/server.js` — microservicio interno, llamado por nodo HTTP Request de n8n
- **Core**: `src/core.js` — lógica compartida, sin I/O, testeable

---

## Instalación

```bash
cd services/excel-reconciler
npm ci
```

Requiere Node.js ≥ 20.

---

## Variables de entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `MICROSOFT_CLIENT_ID` | App Registration Client ID (Azure AD) | Sí |
| `MICROSOFT_CLIENT_SECRET` | Client Secret value | Sí |
| `MICROSOFT_TENANT_ID` | Directory (tenant) ID | Sí |
| `RECONCILER_API_KEY` | API Key para autenticación HTTP (64 chars hex) | Solo servidor |
| `PORT` | Puerto del servidor HTTP (default: 3000) | No |
| `HOST` | Host del servidor HTTP (default: 0.0.0.0) | No |

Generar `RECONCILER_API_KEY`:
```bash
openssl rand -hex 32
```

---

## CLI (línea de comandos)

### Uso con pipe (recomendado para n8n Execute Command)

```bash
echo '{"metadata":...,"excelTarget":...,"transacciones":[],"opciones":{}}' \
  | node src/index.js
```

### Uso con archivo

```bash
node src/index.js --payload ./fixtures/sample-payload.json
```

### Formato de salida (stdout)

```json
{
  "exitoso": true,
  "timestamp": "2026-09-30T12:00:00.000Z",
  "procesoMetadata": { ... },
  "resumen": { ... },
  "resultados": [ ... ],
  "accionRequerida": [ ... ]
}
```

### Errores (stdout)

```json
{
  "exitoso": false,
  "timestamp": "2026-09-30T12:00:00.000Z",
  "error": {
    "tipo": "ValidationError|ConfigurationError|GraphAuthError|ResourceNotFoundError|GraphApiError|ReconciliationError",
    "mensaje": "Descripción legible",
    "stack": "..."  // solo en NODE_ENV=development
  }
}
```

### Códigos de salida

- `0` — Éxito
- `1` — Error (cualquier tipo)

---

## Servidor HTTP

### Arranque

```bash
export RECONCILER_API_KEY="$(openssl rand -hex 32)"
export MICROSOFT_CLIENT_ID="..."
export MICROSOFT_CLIENT_SECRET="..."
export MICROSOFT_TENANT_ID="..."
node src/server.js
```

O con npm:
```bash
npm run start:server
```

### Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/health` | No | Health check — 200 `{"status":"ok"}` |
| POST | `/reconcile` | `x-api-key` | Procesa conciliación |

### Autenticación

Header requerido en `/reconcile`:
```
x-api-key: <RECONCILER_API_KEY>
```

Comparación en tiempo constante (`crypto.timingSafeEqual`).

### Límites

- Body máx: **1 MB** (413 PayloadTooLarge)
- Timeout petición: **60 s**
- Shutdown graceful: SIGTERM/SIGINT (10s force)

---

## Contrato API — POST /reconcile

### Request

```json
{
  "metadata": {
    "workflowId": "string",
    "executionId": "string",
    "timestamp": "ISO8601",
    "fuente": "HUBSPOT|CORREDOR_API|MANUAL|CALENDLY|EMAIL",
    "schemaVersion": "1.0"
  },
  "excelTarget": {
    "driveItemId": "string",
    "worksheetName": "Portafolio",
    "tableName": "string (opcional)"
  },
  "transacciones": [
    {
      "id": "string (UUID v4 recomendado)",
      "fecha": "YYYY-MM-DD",
      "ticker": "string (max 20, uppercase)",
      "tipoActivo": "ACCION|BONO|FIC|CDT|ETF|DIVISA|CRYPTO",
      "operacion": "COMPRA|VENTA|DIVIDENDO|CUPON|REBALANCEO",
      "cantidad": "number (positive)",
      "precioUnitario": "number (nonnegative)",
      "valorBruto": "number (nonnegative)",
      "comisiones": "number (nonnegative, default 0)",
      "impuestos": "number (nonnegative, default 0)",
      "valorNeto": "number",
      "moneda": "COP|USD|EUR (default COP)",
      "tasaCambio": "number (positive, default 1)",
      "corredor": "string",
      "estado": "PENDIENTE|EJECUTADA|FALLIDA|CANCELADA|PARCIAL",
      "numeroCuenta": "string (opcional)",
      "referenciaExterna": "string (opcional)",
      "notas": "string (opcional)"
    }
  ],
  "opciones": {
    "toleranciaCOP": "number (nonnegative, default 1)",
    "crearFaltantes": "boolean (default false)",
    "actualizarDiscrepancias": "boolean (default false)",
    "columnaIdExcel": "string (default 'ID_Transaccion')"
  }
}
```

Ver schema completo en `src/schemas.js` (`N8nPayloadSchema`).

### Response exitoso (200)

```json
{
  "exitoso": true,
  "timestamp": "2026-09-30T12:00:00.000Z",
  "procesoMetadata": {
    "workflowId": "...",
    "executionId": "...",
    "fuente": "MANUAL",
    "driveItemId": "...",
    "worksheetName": "Portafolio"
  },
  "resumen": {
    "totalIdsAnalizados": 10,
    "coincidencias": 8,
    "discrepancias": 1,
    "soloEnN8n": 1,
    "soloEnExcel": 0,
    "conDiscrepanciaCritica": 0,
    "tasaConciliacion": "80.00%",
    "metricasN8n": { ... },
    "metricasExcel": { ... },
    "diferenciaNeta": "0.00",
    "iniciadoEn": "...",
    "finalizadoEn": "...",
    "toleranciaAplicadaCOP": 1
  },
  "resultados": [
    {
      "id": "TXN-001",
      "status": "COINCIDE|DISCREPANCIA|SOLO_EN_N8N|SOLO_EN_EXCEL",
      "transaccionN8n": { ... },
      "registroExcel": { ... },
      "excelRowIndex": 5,
      "discrepancias": [
        { "campo": "valorNeto", "valorN8n": "100000", "valorExcel": "100500", "diferencia": "500", "esCritico": true }
      ],
      "tieneCritico": true,
      "timestamp": "..."
    }
  ],
  "accionRequerida": [ ... ]
}
```

### Errores

| HTTP | error.tipo | Causa |
|------|------------|-------|
| 400 | `ValidationError` | Body vacío, JSON inválido, schema Zod falla |
| 401 | `Unauthorized` | Falta `x-api-key` o inválida |
| 413 | `PayloadTooLarge` | Body > 1 MB |
| 404 | `ResourceNotFoundError` | Archivo/hoja Excel no encontrado en OneDrive |
| 500 | `ConfigurationError` | Variables de entorno Microsoft faltantes |
| 502 | `GraphAuthError` | Fallo auth Azure AD / permisos |
| 502 | `GraphApiError` | Error Graph API (throttling, red, etc.) |
| 500 | `ReconciliationError` | Error interno motor conciliación |

Cuerpo de error:
```json
{
  "exitoso": false,
  "timestamp": "...",
  "error": {
    "tipo": "ValidationError",
    "mensaje": "Descripción"
  }
}
```

---

## Tests

```bash
# Todos los tests (reconciler + server)
npm test

# Solo tests del motor de conciliación
node --test src/__tests__/reconciler.test.js

# Solo tests del servidor HTTP
node --test src/__tests__/server.test.js
```

### Qué cubren los tests

- `reconciler.test.js` (13 tests): normalización Excel, clasificación COINCIDE/DISCREPANCIA/SOLO_EN_N8N/SOLO_EN_EXCEL, métricas portafolio, IDs duplicados.
- `server.test.js`: `/health` 200; POST sin key 401; key inválida 401; body vacío 400; JSON inválido 400; schema inválido 400 (no cuelga); body >1MB 413; petición válida responde <5s (sin Microsoft).

---

## Docker

### Construir imagen

```bash
cd services/excel-reconciler
docker build -t excel-reconciler .
```

### Ejecutar contenedor

```bash
docker run -d \
  --name excel-reconciler \
  -p 3000:3000 \
  -e MICROSOFT_CLIENT_ID=... \
  -e MICROSOFT_CLIENT_SECRET=... \
  -e MICROSOFT_TENANT_ID=... \
  -e RECONCILER_API_KEY=... \
  excel-reconciler
```

### Healthcheck

```bash
curl -f http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

### Probar endpoint

```bash
curl -X POST http://localhost:3000/reconcile \
  -H "Content-Type: application/json" \
  -H "x-api-key: $RECONCILER_API_KEY" \
  -d @../fixtures/sample-payload.json
```

---

## Despliegue en n8n

### 1. Credencial en n8n

Crear credencial **Header Auth** llamada `Reconciler API Key`:
- Name: `x-api-key`
- Value: `<valor de RECONCILER_API_KEY>`

### 2. Importar workflow

En n8n: **Workflows → Import** → seleccionar `workflows/conciliacion-excel.json`.

El workflow espera:
- Webhook POST en `/webhook/conciliacion`
- Recibe payload JSON
- Llama `http://excel-reconciler:3000/reconcile` con header `x-api-key` desde la credencial
- Responde con el resultado de la conciliación

### 3. HTTP Request node config

- URL: `http://excel-reconciler:3000/reconcile`
- Method: POST
- Authentication: Header Auth → `Reconciler API Key`
- Body: `={{ $json }}` (JSON recibido en webhook)
- **Error handling**: Continue On Fail → conectar nodo `Responder Error` para devolver `{{ $json.error }}`

---

## Licencia

MIT License — Copyright (c) 2026 Tesis Automatización Fintech — Colombia