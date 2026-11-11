# Contrato de Componente — Dashboard Ejecutivo

**Archivo fuente:** `services/dashboard/src/dashboard.js`, `services/dashboard/src/schemas.js`, `services/dashboard/src/index.js`, `services/dashboard/src/graphClientAdapter.js`  
**Propósito:** Generar el dashboard ejecutivo del Asesor Fintech (§4.4 de la tesis IS25237) con cuatro bloques y actualizar un libro Excel en OneDrive vía Microsoft Graph API.  

---

## Bloques del dashboard (§4.4)

### a) Gráfico de barras: leads por etapa del ciclo comercial

Etapas según MER (tabla `lead.estado`): `nuevo`, `prospecto`, `cita_pendiente`, `cita_confirmada`, `cliente`, `inactivo`.

**Payload de salida:**
```json
{
  "leadsPorEtapa": {
    "nuevo": 2,
    "prospecto": 2,
    "cita_pendiente": 1,
    "cita_confirmada": 2,
    "cliente": 2,
    "inactivo": 1,
    "total": 10
  }
}
```

### b) Tabla de campañas Mailchimp del periodo

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id_campaign` | `number` | ID de campaña |
| `nombre` | `string` | Nombre de la campaña |
| `estado` | `string` | Estado (pendiente, activa, completada, cancelada) |
| `enviadas` | `number` | Cantidad de emails enviados |
| `tasaApertura` | `number` | Tasa de apertura en porcentaje |
| `clicsGenerados` | `number` | Cantidad de clics |

### c) Calendario de la semana con citas confirmadas

Filtra citas de `appointment` con `estado = 'confirmada'` dentro del rango periodoInicio–periodoFin.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id_appointment` | `number` | ID de la cita |
| `id_lead` | `number` | ID del lead asociado |
| `nombreLead` | `string` | Nombre del lead |
| `fecha_hora_inicio` | `string` (datetime) | Inicio de la cita |
| `fecha_hora_fin` | `string` (datetime, opcional) | Fin de la cita |
| `enlace_calendly` | `string` (URL, opcional) | Enlace de Calendly |

### d) Resumen financiero

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `saldoTotalInversionesActivas` | `number` | Suma de `monto` donde `estado = 'activa'` |
| `numeroOperacionesMesActual` | `number` | Operaciones del mes en curso |
| `variacionPorcentualMesAnterior` | `number` | Variación % respecto al mes anterior |

---

## Operación: generarDashboard(params)

**Payload de entrada (DashboardInputSchema):**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `workflowId` | `string` | Sí | ID del workflow |
| `periodoInicio` | `string` (datetime) | Sí | Inicio del periodo |
| `periodoFin` | `string` (datetime) | Sí | Fin del periodo |
| `datosSinteticos` | `boolean` | No (default: true) | Usar datos sintéticos para pruebas |
| `excelDriveItemId` | `string` | No | ID del archivo Excel en OneDrive |
| `excelWorksheetName` | `string` | No (default: 'Dashboard Ejecutivo') | Nombre de la hoja |

**Payload de respuesta (DashboardOutputSchema):**
```json
{
  "workflowId": "dashboard-ejecutivo",
  "fechaActualizacion": "2026-11-10T12:00:00Z",
  "periodo": { "inicio": "2026-11-02T00:00:00Z", "fin": "2026-11-08T23:59:59Z" },
  "leadsPorEtapa": { ... },
  "campañasMailchimp": [ ... ],
  "citasSemana": [ ... ],
  "resumenFinanciero": { ... },
  "datosSinteticos": true
}
```

---

## Actualización de Excel (OneDrive / Microsoft Graph)

Se reutiliza `createGraphClient` desde `services/excel-reconciler/src/graphClient.js` (vía `graphClientAdapter.js`, sin duplicar código).

**Autenticación:** `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (variables de entorno).

**Escritura:** `updateRange(driveItemId, worksheetName, rangeAddress, valores)` escribiendo desde A1 con los 4 bloques organizados en filas y la fecha de última actualización en cada hoja.

**Manejo de errores:**
- Errores de conexión a Graph API: `GraphAuthError` o `GraphApiError` con mensaje claro.
- Errores de conexión a PostgreSQL: mensaje descriptivo en `automation_log`.
- No publicar datos personales (emails, nombres reales) en logs.

---

## Seguridad

- No hardcodear credenciales de Microsoft Graph; usar `process.env`.
- Datos sintéticos en todas las pruebas.
- Fecha y hora de última actualización en cada hoja de Excel.
- Registrar ejecución en `automation_log` (workflow_id: 'dashboard-ejecutivo').

---

## RF / VS cubiertos

- §4.4 (dashboard ejecutivo: 4 bloques)
- VD1, VD2 (métricas de desempeño)
- RNF-005 (JSDoc en funciones públicas)