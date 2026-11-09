# 🔄 Workflows de Automatización — n8n

> **Proyecto:** Automatización Fintech Colombia · UMB · IS25237

## Descripción

Esta carpeta contiene los flujos de automatización exportados en formato JSON
para importar directamente en una instancia de [n8n](https://n8n.io/).

## Workflows Disponibles

| Archivo | Descripción | APIs Involucradas |
|---|---|---|
| [`conciliacion-excel.json`](./conciliacion-excel.json) | Conciliación financiera: recibe transacciones vía webhook, invoca el servicio Excel Reconciler y devuelve resultados | Excel Reconciler (interno), Microsoft Graph API |
| [`lead-capture-hubspot.json`](./lead-capture-hubspot.json) | Captura de leads: recibe un webhook de Calendly, busca/crea el contacto en HubSpot CRM y lo agrega a Mailchimp | Calendly (webhook), HubSpot API v3, Mailchimp API v3 |

## Cómo Importar un Workflow en n8n

### Método 1 — Desde la interfaz web (recomendado)

1. Accede a tu instancia de n8n en `https://n8n.tudominio.com`.
2. En el menú lateral, haz clic en **Workflows**.
3. Haz clic en el botón **⋮** (menú) → **Import from File**.
4. Selecciona el archivo `.json` del workflow que deseas importar.
5. El workflow se abrirá en el editor. Revisa los nodos antes de activarlo.

### Método 2 — Vía API REST de n8n

```bash
# Importar un workflow usando la API de n8n
curl -X POST https://n8n.tudominio.com/api/v1/workflows \
  -H "Content-Type: application/json" \
  -H "X-N8N-API-KEY: tu-api-key" \
  -d @lead-capture-hubspot.json
```

### Método 3 — Vía CLI de n8n (dentro del contenedor)

```bash
# Acceder al contenedor de n8n
docker exec -it n8n sh

# Importar el workflow
n8n import:workflow --input=/path/to/lead-capture-hubspot.json
```

## Configuración Post-Importación

> ⚠️ **Importante:** Después de importar cada workflow, debes configurar las credenciales
> de las APIs externas. Los workflows exportados **no incluyen credenciales por seguridad**.

### Paso 1 — Configurar credenciales en n8n

1. Ve a **Settings → Credentials** en la interfaz de n8n.
2. Crea las credenciales necesarias para cada servicio:

| Credencial | Tipo en n8n | Datos necesarios |
|---|---|---|
| HubSpot | `hubspotApi` | Private App Token |
| Mailchimp | `mailchimpApi` | API Key + Server Prefix |
| Calendly | `calendlyApi` | Personal Access Token |
| Excel Reconciler | `httpHeaderAuth` | API Key interna (`RECONCILER_API_KEY`) |

### Paso 2 — Asignar credenciales a los nodos

1. Abre el workflow importado en el editor.
2. Haz clic en cada nodo que requiera autenticación.
3. En la sección **Credentials**, selecciona la credencial que creaste.
4. Guarda el workflow.

### Paso 3 — Activar el workflow

1. Una vez configuradas todas las credenciales, haz clic en el toggle **Active**
   en la esquina superior derecha del editor.
2. El workflow comenzará a escuchar webhooks o a ejecutarse según su programación.

## Convenciones de Nomenclatura

Los workflows siguen esta convención de nombres:

```
<acción>-<recurso>-<destino>.json
```

Ejemplos:
- `lead-capture-hubspot.json` → Captura de lead con destino HubSpot
- `conciliacion-excel.json` → Conciliación con destino Excel/OneDrive
- `email-sequence-mailchimp.json` → Secuencia de email con Mailchimp (futuro)

## Estructura de un Workflow n8n

Cada archivo `.json` contiene:

```json
{
  "name": "Nombre del Workflow",
  "nodes": [
    {
      "parameters": { /* configuración del nodo */ },
      "id": "uuid-único",
      "name": "Nombre del Nodo",
      "type": "n8n-nodes-base.tipoNodo",
      "position": [x, y]
    }
  ],
  "connections": {
    "Nombre del Nodo Origen": {
      "main": [[ { "node": "Nombre del Nodo Destino", "type": "main", "index": 0 } ]]
    }
  },
  "settings": { "executionOrder": "v1" }
}
```

## Solución de Problemas

| Problema | Solución |
|---|---|
| El webhook no recibe datos | Verifica que Traefik esté reenviando las peticiones a n8n. Revisa los logs: `docker compose logs -f traefik` |
| Error de autenticación con HubSpot | Verifica que el token de Private App tenga los scopes correctos: `crm.objects.contacts.read`, `crm.objects.contacts.write` |
| El workflow no se activa | Asegúrate de que todas las credenciales estén configuradas correctamente y el toggle "Active" esté encendido |
| Error 502 en el Excel Reconciler | Verifica que el contenedor `excel-reconciler` esté corriendo: `docker compose ps` |
