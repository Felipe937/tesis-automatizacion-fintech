# Contrato de Componente — Dashboard Ejecutivo

| | |
|---|---|
| **Archivo fuente** | `services/dashboard/src/dashboard.js`, `services/dashboard/src/service.js`, `services/dashboard/src/schemas.js`, `services/dashboard/src/postgresSource.js`, `services/dashboard/src/excelWriter.js`, `services/dashboard/src/graphClientAdapter.js`, `services/dashboard/src/server.js`, `services/dashboard/src/index.js` |
| **Propósito** | Generar el dashboard ejecutivo del Asesor Fintech (§4.4 de la tesis IS25237) con los cuatro bloques y actualizar un libro Excel en OneDrive vía Microsoft Graph API. |
| **Consumidores** | `workflows/actualizacion-dashboard.json`, informe final de la tesis. |
| **Transporte** | HTTP (`POST /dashboard`) o CLI (`node src/index.js` con payload por stdin). |

---

## 1. Bloques del dashboard (§4.4)

El §4.4 de la tesis describe el dashboard ejecutivo en dos fuentes: la **prosa** («gráfico de barras… tabla de campañas… calendario de la semana… resumen financiero») y el **mockup** (imagen del documento: KPIs, seguimiento comercial, resumen de inversiones, monitoreo de integraciones y control de actualización). Ambas se implementan, sin indicadores inventados: la composición está justificada en `docs/decisions.md` (ADR-012).

### 0) Indicadores clave de gestión (KPIs) — mockup

| Campo | Tipo | Fuente |
|---|---|---|
| `leadsRegistradas` | `number` | Leads captados en el periodo (`lead.fecha_registro`) |
| `citasAgendadas` | `number` | Citas del periodo, excluidas las canceladas (`appointment`) |
| `inversionesRegistradas` | `number` | Inversiones con `fecha_registro` en el periodo |
| `conversionPorcentaje` | `number` | Leads en estado `cliente` ÷ total de leads del periodo × 100 |

### a) Seguimiento comercial — mockup + §4.4

**Fuente:** tabla `lead`. Cada **estado del MER** (6) con la **etapa comercial** del mockup (4) y su **participación porcentual**.

| Estado del MER | Etapa comercial | Mockup |
|---|---|---|
| `nuevo` | Nuevo | Nuevo |
| `prospecto` | En seguimiento | En seguimiento |
| `cita_pendiente` | Cita agendada | Cita agendada |
| `cita_confirmada` | Cita agendada | Cita agendada |
| `cliente` | Convertido | Convertido |
| `inactivo` | — (fuera del embudo) | — (no aparece en el mockup) |

La participación se calcula sobre el total de leads del periodo; `inactivo` se informa con participación 0 % para no alterar la suma (100 %).

### b) Campañas Mailchimp

**Fuente:** tabla `campaign` (identidad y estado) y tabla `campaign_lead` (suscriptores).

| Campo | Tipo | Origen | Descripción |
|---|---|---|---|
| `id_campaign` | `number` | `campaign.id_campaign` | Identificador de la campaña. |
| `nombre` | `string` | `campaign.nombre` | Nombre de la campaña. |
| `estado` | `string` | `campaign.estado` | `pendiente` / `activa` / `completada` / `cancelada`. |
| `suscriptores` | `number` | `COUNT(campaign_lead)` | Suscriptores registrados en el MER. |
| `enviadas` | `number` | Métricas de Mailchimp | Emails enviados. **No está en el MER.** |
| `tasaApertura` | `number` | Métricas de Mailchimp | Porcentaje de apertura. **No está en el MER.** |
| `clicsGenerados` | `number` | Métricas de Mailchimp | Clics. **No está en el MER.** |

> **Las tres últimas métricas son de reporte de Mailchimp y no están almacenadas en el MER.** Si el orquestador no las provee (`metricasCampañas`), el componente las informa como `0` y añade una advertencia explícita; en el Excel se escriben como `n/d` («no disponible»), **nunca como un cero medido**. El campo `suscriptores` sí es un dato del MER y es el que da contenido al bloque en modo PostgreSQL.

### c) Citas del periodo — §4.4

**Fuente:** tabla `appointment` (con `LEFT JOIN` a `lead` para el nombre).

Filtro: `estado = 'confirmada'` y `fecha_hora_inicio` dentro del periodo.

| Campo | Tipo | Descripción |
|---|---|---|
| `id_appointment` | `number` | Identificador de la cita. |
| `id_lead` | `number` | Lead asociado. |
| `nombreLead` | `string` | Nombre del lead (`'(sin nombre)'` si el lead se borró). |
| `fecha_hora_inicio` | `string` (datetime) | Inicio de la cita. |
| `fecha_hora_fin` | `string` (datetime, opcional) | Fin de la cita. |
| `enlace_calendly` | `string` (URL, opcional) | Enlace de la reunión. |

### d) Resumen financiero — §4.4 + mockup

**Fuente:** tabla `investment` (histórico completo, no acotado al periodo: el saldo es acumulado).

| Campo | Tipo | Fórmula | Origen |
|---|---|---|---|
| `saldoTotalInversionesActivas` | `number` | `SUM(monto)` con `estado = 'activa'` | §4.4 |
| `numeroOperacionesMesActual` | `number` | `COUNT(*)` con `fecha_registro` en el mes de `fechaActual` | §4.4 |
| `variacionPorcentualMesAnterior` | `number` | `((mesActual − mesAnterior) / mesAnterior) × 100`; `0` si el mes anterior no tuvo operaciones, `100` si pasó de 0 a > 0 | §4.4 |
| `totalOperaciones` | `number` | `COUNT(*)` de inversiones | Mockup |
| `montoAcumulado` | `number` | `SUM(monto)` de las inversiones activas (mismo valor que el saldo) | Mockup |
| `operacionesPendientes` | `number` | Inversiones con `estado = 'activa'` | Mockup |
| `operacionesCompletadas` | `number` | Inversiones con `estado = 'vencida'` | Mockup |
| `operacionesCanceladas` | `number` | Inversiones con `estado = 'cancelada'` | MER (§4.3) |

### e) Monitoreo de integraciones — mockup

**Fuente:** tabla `automation_log`. Una fila por plataforma de las cuatro del §4.1.2, con la última ejecución registrada entre los workflows que la integran.

| Campo | Tipo | Descripción |
|---|---|---|
| `plataforma` | `string` | `HubSpot CRM`, `Mailchimp`, `Calendly` o `Excel / OneDrive` |
| `ultimaSincronizacion` | `string \| null` | `timestamp_inicio` de la última ejecución (ISO 8601); `null` si no hay ejecuciones |
| `estado` | `string` | `Correcto`, `Con advertencias`, `Con errores` o `Sin ejecuciones` |

| Plataforma | Workflows que la integran |
|---|---|
| HubSpot CRM | `captura-leads`, `secuencias-email` |
| Mailchimp | `captura-leads`, `secuencias-email` |
| Calendly | `captura-leads` |
| Excel / OneDrive | `conciliacion-excel`, `alertas-financieras`, `dashboard-ejecutivo` |

### f) Control de actualización — mockup

| Campo | Tipo | Descripción |
|---|---|---|
| `ultimaActualizacion` | `string` | Fecha y hora de generación del dashboard (ISO 8601) |
| `estadoGeneral` | `string` | `Sincronización correcta` o `Revisar sincronizaciones con errores` |

### g) Trazabilidad de automatizaciones (sección suplementaria)

**Fuente:** tabla `automation_log`, acotada al periodo.

`totalEjecuciones`, `ejecucionesExitosas`, `ejecucionesConError`, `ejecucionesConAdvertencia`, `registrosProcesados`, `latenciaMediaMs` (media de `latencia_ms`).

> Esta sección **no sustituye ni altera** ninguno de los cuatro bloques de §4.4: es la información de `automation_log` que §3.4.3 define como telemetría del sistema. Véase `docs/DESIGN.md` §6.

---

## 2. Entrada

### 2.1 Parámetros (`DashboardInputSchema`)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `workflowId` | `string` | **Sí** | Workflow que solicita el dashboard. |
| `periodoInicio` | `string` | **Sí** | ISO 8601. |
| `periodoFin` | `string` | **Sí** | ISO 8601. No puede ser anterior a `periodoInicio`. |
| `fuenteDatos` | `'postgres' \| 'sintetico'` | No (def. `sintetico`) | Origen de los datos. |
| `datosSinteticos` | `boolean` | No | **Heredado.** Si se informa y `fuenteDatos` no, se traduce a `fuenteDatos`. |
| `postgres` | `object` | No | Configuración de conexión; si se omite, se usan `POSTGRES_*`. |
| `leads` / `campanas` / `metricasCampanas` / `citas` / `inversiones` | `array` | No | Datos precargados (pruebas o modo sin base de datos). |
| `excelDriveItemId` | `string` | No | ID del libro Excel en OneDrive. Sin él, no se escribe en OneDrive. |
| `excelWorksheetName` | `string` | No (def. `Dashboard Ejecutivo`) | Hoja dentro del libro. |
| `actualizarExcel` | `boolean` | No (def. `true`) | Permite desactivar la escritura sin quitar el `driveItemId`. |

---

## 3. Salida (`DashboardOutputSchema`)

Además de los cuatro bloques y la sección de trazabilidad:

| Campo | Tipo | Descripción |
|---|---|---|
| `workflowId` | `string` | Workflow solicitante. |
| `fechaActualizacion` | `string` | Fecha y hora de la actualización (ISO 8601). |
| `periodo.inicio` / `periodo.fin` | `string` | Periodo analizado. |
| `kpis` | `object` | Indicadores clave de gestión (ver §1.0). |
| `leadsPorEtapa` | `object` | Conteo por estado del MER y total. |
| `seguimientoComercial` | `array` | Estado del MER, etapa comercial, cantidad y participación (ver §1.a). |
| `campañasMailchimp` | `array` | Tabla de campañas (ver §1.b). |
| `citasSemana` | `array` | Citas confirmadas del periodo (ver §1.c). |
| `resumenFinanciero` | `object` | Bloque financiero (ver §1.d). |
| `monitoreoIntegraciones` | `array` | Última sincronización y estado por plataforma (ver §1.e). |
| `controlActualizacion` | `object` | Última actualización y estado general (ver §1.f). |
| `resumenAutomatizaciones` | `object` | Trazabilidad de `automation_log` (ver §1.g). |
| `metricasMailchimpDisponibles` | `boolean` | `true` si se recibieron métricas de reporte de Mailchimp. |
| `fuenteDatos` | `'postgres' \| 'sintetico'` | **Origen de los datos.** |
| `datosSinteticos` | `boolean` | `true` si el informe procede del conjunto de demostración. |
| `advertencias` | `string[]` | Notas sobre la cobertura de los datos (p. ej. métricas de Mailchimp no disponibles). |

---

## 4. Validaciones Zod

| Regla | Consecuencia |
|---|---|
| `workflowId` no vacío | `DashboardValidationError` (HTTP 400) |
| Fechas ISO 8601 | `DashboardValidationError` (HTTP 400) |
| `periodoFin >= periodoInicio` | `DashboardValidationError` (HTTP 400) |
| Estados de lead, campaña y cita como cadenas no vacías | `DashboardValidationError` (HTTP 400) |
| Montos no negativos; conteos enteros no negativos | `DashboardValidationError` (HTTP 400) |
| `tasaApertura` en 0–100 | `DashboardValidationError` (HTTP 400) |
| Salida conforme a `DashboardOutputSchema` | El informe nunca sale del componente sin validar |

---

## 5. Errores posibles

| Error | HTTP | Origen | Causa típica |
|---|---|---|---|
| `DashboardValidationError` | 400 | `service.js` | Payload inválido; incluye `detalles` campo a campo. |
| `PostgresSourceError` | 500 | `postgresSource.js` | Configuración ausente, base de datos inaccesible o consulta fallida. |
| `DashboardExcelError` | 502 | `service.js` | Fallo al escribir en OneDrive (Graph API, permisos, `driveItemId` inexistente). |
| `GraphAuthError` | 502 | `graphClient.js` | Token de Azure AD rechazado o permisos `Files.ReadWrite.All` no concedidos. |
| `GraphApiError` | 502 | `graphClient.js` | Error de Graph API (throttling, hoja inexistente). |
| `ResourceNotFoundError` | 502 | `graphClient.js` | El `driveItemId` o la hoja no existen en OneDrive. |
| `Unauthorized` | 401 | `server.js` | Header `x-api-key` ausente o incorrecto. |
| `NotFound` | 404 | `server.js` | Ruta distinta de `/health` o `/dashboard`. |
| `PayloadTooLarge` | 413 | `server.js` | Cuerpo > 2 MB. |

---

## 6. Autenticación

### 6.1 Contra el servicio (n8n → dashboard)

Header `x-api-key` con comparación en tiempo constante. Clave en `DASHBOARD_API_KEY`; en n8n, credencial `httpHeaderAuth` con nombre de header `x-api-key` (*Dashboard API Key*).

### 6.2 Contra OneDrive (Microsoft Graph)

**OAuth 2.0 Client Credentials** (App Registration en Azure AD), reutilizando `createGraphClient` de `services/excel-reconciler/src/graphClient.js` a través de `graphClientAdapter.js` — **no se duplica el cliente ni la autenticación**.

| Variable | Descripción |
|---|---|
| `MICROSOFT_CLIENT_ID` | Application (client) ID de la App Registration. |
| `MICROSOFT_CLIENT_SECRET` | Client secret. |
| `MICROSOFT_TENANT_ID` | Directory (tenant) ID. |
| `DASHBOARD_EXCEL_DRIVE_ITEM_ID` | ID del libro Excel (Graph Explorer: `GET /me/drive/root:/<archivo>.xlsx` → `id`). |

Scopes requeridos en Azure AD: `Files.ReadWrite.All`, `Sites.ReadWrite.All`, con consentimiento de administrador.

MSAL gestiona la caché del token y su renovación automática antes de la expiración.

---

## 7. Actualización de Excel (OneDrive)

### 7.1 Mecanismo

1. `PATCH /me/drive/items/{driveItemId}/workbook/worksheets/{hoja}/range(address='A1:F{n}')` con los **valores** de toda la matriz.
2. Una serie de `PATCH` dirigidos (uno por nivel jerárquico y por rango de cifras) aplica el **formato**: `font`, `fill`, `numberFormat`, `horizontalAlignment`, `borders`, `columnWidth`, `rowHeight`.

El formato se aplica en un número reducido de llamadas fusionando celdas contiguas de la misma columna y formato.

### 7.2 Formatos numéricos

| Magnitud | Formato | Resultado |
|---|---|---|
| Entero | `#,##0` | `12.000` |
| Decimal | `#,##0.00` | `43.90` |
| Porcentaje | `0.00"%"` | `34.50%` |
| Variación | `+0.00"%";-0.00"%"` | `-25.50%` |
| Monto COP | `#,##0" COP"` | `12.000.000 COP` |
| Latencia | `#,##0" ms"` | `145 ms` |
| Fecha y hora | `dd/mm/yyyy hh:mm` | `05/11/2026 10:00` |

Las fechas se escriben como **número serial de Excel** calculado en hora `America/Bogota` (no texto ISO), para que el formato se aplique y la columna sea ordenable.

### 7.3 Diseño

La composición, la paleta, la jerarquía y las reglas de anti-patrones están en **`docs/DESIGN.md`**.

---

## 8. Ejemplo de respuesta (datos sintéticos)

```json
{
  "workflowId": "dashboard-ejecutivo",
  "fechaActualizacion": "2026-11-10T12:00:00.000Z",
  "periodo": { "inicio": "2026-11-02T00:00:00.000Z", "fin": "2026-11-08T23:59:59.000Z" },
  "leadsPorEtapa": {
    "nuevo": 2, "prospecto": 2, "cita_pendiente": 1,
    "cita_confirmada": 2, "cliente": 2, "inactivo": 1, "total": 10
  },
  "kpis": {
    "leadsRegistradas": 10,
    "citasAgendadas": 3,
    "inversionesRegistradas": 1,
    "conversionPorcentaje": 20
  },
  "seguimientoComercial": [
    { "estado": "nuevo", "etapaComercial": "Nuevo", "cantidad": 2, "participacionPorcentaje": 20 },
    { "estado": "inactivo", "etapaComercial": "— (fuera del embudo)", "cantidad": 1, "participacionPorcentaje": 0 }
  ],
  "monitoreoIntegraciones": [
    { "plataforma": "HubSpot CRM", "ultimaSincronizacion": "2026-11-08T05:00:00.000Z", "estado": "Correcto" },
    { "plataforma": "Mailchimp", "ultimaSincronizacion": null, "estado": "Sin ejecuciones" }
  ],
  "controlActualizacion": {
    "ultimaActualizacion": "2026-11-10T12:00:00.000Z",
    "estadoGeneral": "Sincronización correcta"
  },
  "campañasMailchimp": [
    {
      "id_campaign": 1, "nombre": "Bienvenida Noviembre", "estado": "completada",
      "enviadas": 150, "tasaApertura": 34.5, "clicsGenerados": 28, "suscriptores": 12
    }
  ],
  "citasSemana": [
    {
      "id_appointment": 101, "id_lead": 3, "nombreLead": "Lead Demo 3",
      "fecha_hora_inicio": "2026-11-09T10:00:00.000Z",
      "fecha_hora_fin": "2026-11-09T11:00:00.000Z",
      "enlace_calendly": "https://calendly.com/asesor/reunion-101"
    }
  ],
  "resumenFinanciero": {
    "saldoTotalInversionesActivas": 12000000,
    "numeroOperacionesMesActual": 1,
    "variacionPorcentualMesAnterior": -66.67
  },
  "resumenAutomatizaciones": {
    "totalEjecuciones": 12, "ejecucionesExitosas": 10, "ejecucionesConError": 1,
    "ejecucionesConAdvertencia": 1, "registrosProcesados": 40, "latenciaMediaMs": 128.5
  },
  "metricasMailchimpDisponibles": true,
  "fuenteDatos": "sintetico",
  "datosSinteticos": true,
  "advertencias": []
}
```

> ⚠️ Ejemplo generado con el conjunto **sintético** (`services/dashboard/src/syntheticData.js`). **No es un resultado empírico.**

---

## 9. Relación con los workflows

| Workflow | Uso |
|---|---|
| `workflows/actualizacion-dashboard.json` | Nodo **Consultar Resumen MER** (verificación de conexión) → **Preparar Payload Dashboard** → **Invocar Dashboard** (`POST http://dashboard:3002/dashboard`) → notificación al piloto y registro en `automation_log` con `workflow_id = 'dashboard-ejecutivo'`. |

---

## 10. Seguridad

- No se hardcodean credenciales: todo procede de variables de entorno o del gestor de credenciales de n8n.
- El log de auditoría del servidor registra **workflowId y duración**: nunca el payload ni datos personales.
- Los datos de demostración no contienen nombres ni correos de personas reales.
- La publicación del libro Excel con datos del piloto exige autorización del responsable del tratamiento (Ley 1581/2012).

---

## 11. Pruebas

| Fichero | Cobertura |
|---|---|
| `src/__tests__/dashboard.test.js` | Bloques a–d, KPIs, seguimiento comercial, monitoreo, control, casos límite del cálculo (29 pruebas). |
| `src/__tests__/service.test.js` | Validación, datos reales del MER, consulta de las seis entidades, fallos de PostgreSQL y de OneDrive, datos sintéticos (12 pruebas). |
| `src/__tests__/excelWriter.test.js` | Construcción de la matriz, formatos, serial de fecha, jerarquía del formato, errores de escritura (16 pruebas). |
| `src/__tests__/server.test.js` | Health, 401, 400, JSON inválido, 404 (6 pruebas). |
