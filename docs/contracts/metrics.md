# Contrato de Componente — Métricas VD1/VD2

| | |
|---|---|
| **Archivo fuente** | `services/metrics/src/calculator.js`, `services/metrics/src/service.js`, `services/metrics/src/schemas.js`, `services/metrics/src/postgresSource.js`, `services/metrics/src/server.js`, `services/metrics/src/index.js` |
| **Propósito** | Calcular los indicadores de desempeño del proceso automatizado frente a la línea base manual y contrastar la hipótesis VD1/VD2 (§2.4, §3.5 de la tesis). |
| **Consumidores** | `workflows/reporte-semanal.json` (RF-012), informe final de la tesis. |
| **Transporte** | HTTP (`POST /metrics`) o CLI (`node src/index.js` con payload por stdin). |

---

## 1. Variables dependientes (§2.4)

> **VD1 — Variable Dependiente 1: Tiempo de sincronización de datos** (§2.4 de la tesis). «Es el tiempo **en segundos** que toma el sistema en actualizar la información entre aplicaciones tras detectarse un cambio. Se busca verificar una reducción de al menos el **70 %** frente al traspaso manual, **analizando los registros de ejecución** de n8n y Make.»
>
> **VD2 — Variable Dependiente 2: Tasa de errores operativos** (§2.4 de la tesis). «Es el **porcentaje de datos incorrectos o repetidos en los sistemas de destino sobre el total de registros procesados**. La meta es demostrar una reducción del **50 %** en comparación con la digitación manual previa.»
>
> **§3.4.3 (telemetría).** «el sistema registrará de forma automática la **latencia**, el **número de ejecuciones exitosas**, el **volumen de datos procesados** y la **tasa de fallas** en las llamadas a las APIs.»
>
> **§3.5 (análisis).** «se aplicarán técnicas de **estadística descriptiva**… se calcularán **medias aritméticas, medianas y desviaciones estándar**.»

| Variable | Descripción | Meta | Línea base (§1.1.1) |
|---|---|---|---|
| VD1 | Tiempo de sincronización (**segundos**) | Reducción ≥ 70 % | 28 % de la jornada en transcripción manual (WEF, 2022) |
| VD2 | Tasa de errores operativos (**% de datos incorrectos sobre registros procesados**) | Reducción ≥ 50 % | > 5 % de tasa de error tipográfico |

> La línea base **se recibe como parámetro** y se documenta con su procedencia (`lineaBaseProveniencia`). Los valores por defecto del `.env.example` son marcadores de posición derivados de §1.1.1, **no** mediciones del piloto. Véase `docs/decisions.md` (ADR-004).

### Dos lecturas de VD2

`automation_log` no registra cuántos registros concretos fueron erróneos, sólo el total procesado por ejecución. Por eso el componente calcula **dos** tasas de error y reporta como **VD2** la que corresponde a la definición de la tesis:

| Métrica | Fórmula | Uso |
|---|---|---|
| `tasaErrorRegistrosPorcentaje` | (Σ `registros_procesados` de ejecuciones con `estado='error'` ÷ Σ `registros_procesados` de todas las ejecuciones) × 100 | **VD2 según §2.4** — atribución conservadora (cota superior): todos los registros de una ejecución fallida se consideran erróneos |
| `tasaErrorPorcentaje` | (ejecuciones con `estado='error'` ÷ ejecuciones totales) × 100 | Diagnóstico operativo: tasa de fallos de flujo (§3.4.3) |

---

## 2. Entrada

### 2.1 Parámetros (`MetricsInputSchema`)

| Campo | Tipo | Obligatorio | Unidad / dominio | Descripción |
|---|---|---|---|---|
| `workflowId` | `string` | **Sí** | no vacío | Workflow medido. El valor `'todos'` mide el conjunto de workflows del periodo. |
| `periodoInicio` | `string` | **Sí** | ISO 8601 | Inicio del periodo de medición. |
| `periodoFin` | `string` | **Sí** | ISO 8601 | Fin del periodo. No puede ser anterior a `periodoInicio`. |
| `lineaBaseTiempoManualSegundos` | `number` | **Sí** | > 0, segundos | Tiempo del proceso manual por operación. |
| `lineaBaseTasaErrorManual` | `number` | **Sí** | 0–100, % | Tasa de error del proceso manual. |
| `umbralObservacionesMinimo` | `number` | No | entero > 0 (def. 30) | Muestra mínima para conclusiones statistics válidas. |
| `fuenteDatos` | `'postgres' \| 'sintetico'` | No (def. `sintetico`) | — | Origen de las observaciones. |
| `ejecuciones` | `array<Ejecucion>` | No | — | Observaciones reales entregadas por el orquestador. **Si se informa, tienen prioridad sobre la consulta a PostgreSQL.** |
| `postgres` | `object` | No | — | Configuración de conexión (`connectionString` o `host`/`port`/`database`/`user`/`password`/`schema`). Si se omite, se usan las variables `POSTGRES_*`. |
| `lineaBaseProveniencia` | `object` | No | — | Trazabilidad de la medición manual (ver §2.3). |

### 2.2 Observación (`EjecucionSchema`)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `latencia_ms` | `number \| null` | No (def. `null`) | Latencia en milisegundos. `null` = no se midió. |
| `estado` | `'exito' \| 'error' \| 'advertencia'` | **Sí** | Estado de la ejecución (ENUM `log_estado`). |
| `registros_procesados` | `number` | No (def. 0) | Registros de negocio procesados. |
| `workflow_id` | `string` | No | Informativo. |
| `timestamp_inicio` | `string` | No | ISO 8601. Informativo. |

### 2.3 Procedencia de la línea base (`LineaBaseProvenienciaSchema`)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `fuente` | `string` | **Sí** | Referencia documental de la medición. |
| `descripcion` | `string` | **Sí** | Metodología de medición. |
| `fechaMedicion` | `string` | **Sí** | ISO 8601. |
| `notas` | `string` | No | Observaciones adicionales. |

### 2.4 Reglas de refinamiento (Zod)

1. `periodoFin >= periodoInicio`.
2. Si `fuenteDatos = 'postgres'` y no se informa `ejecuciones`, el componente **consulta `automation_log`**. Si tampoco hay configuración de PostgreSQL en el payload, se usan las variables de entorno `POSTGRES_*`; si faltan, el error es explícito (`PostgresSourceError`).

---

## 3. Salida

### 3.1 Estructura (`MetricsReportSchema`)

| Campo | Tipo | Descripción |
|---|---|---|
| `periodo.inicio` / `periodo.fin` | `string` | Periodo medido. |
| `workflowId` | `string` | Workflow medido. |
| `metricas.observaciones` | `number` | Ejecuciones analizadas. |
| `metricas.totalExitos` / `totalErrores` / `totalAdvertencias` | `number` | Desglose por estado. |
| `metricas.observacionesSinLatencia` | `number` | Ejecuciones excluidas de los cálculos estadísticos. |
| `metricas.mediaLatenciaMs` | `number` | Media aritmética (ms). |
| `metricas.medianaLatenciaMs` | `number` | Mediana (ms). |
| `metricas.desviacionEstandarLatenciaMs` | `number` | Desviación estándar **muestral** (ms). |
| `metricas.tasaErrorPorcentaje` | `number` | `(errores / observaciones) × 100` — diagnóstico por ejecución. |
| `metricas.registrosEnEjecucionesConError` | `number` | Registros procesados por ejecuciones fallidas (atribución conservadora). |
| `metricas.tasaErrorRegistrosPorcentaje` | `number` | `(registros erróneos / registros procesados) × 100` — **VD2 según §2.4**. |
| `metricas.totalRegistrosProcesados` | `number` | Suma de `registros_procesados`. |
| `comparacionVD1` | `object` | `{formula, porcentajeReduccion, seAlcanzoMeta, metaPorcentaje}` — meta 70 %. |
| `comparacionVD2Registros` | `object` | Igual — meta 50 %. **Es la VD2 de la tesis.** |
| `comparacionVD2` | `object` | Igual — lectura por ejecución, indicador diagnóstico. |
| `lineaBase` | `object` | Línea base aplicada y su `proveniencia` (si se informó). |
| `observacionesUsadas` | `number` | Observaciones efectivamente usadas. |
| `advertenciaDatosInsuficientes` | `string?` | Presente si `observaciones < umbral`. |
| `advertenciaPeriodoSinRegistros` | `string?` | Presente si el periodo no tiene ejecuciones. |
| `conclusionHipotesis` | `string` | Conclusión VD1/VD2 (preliminar si la muestra es insuficiente). |
| `conclusionDefinitiva` | `boolean` | `false` si la muestra es insuficiente. |
| `fuenteDatos` | `'postgres' \| 'sintetico'` | **Origen de los datos.** |
| `datosSinteticos` | `boolean` | `true` si el informe procede del conjunto de demostración. |

### 3.2 Fórmulas y unidades

| Magnitud | Fórmula | Unidad |
|---|---|---|
| Media | `Σ(latencia_ms) / n` | ms |
| Mediana | valor central de la muestra ordenada | ms |
| Desviación estándar | `√(Σ(x − x̄)² / (n − 1))` (muestral) | ms |
| Tasa de error por ejecución (diagnóstico) | `(errores / ejecuciones) × 100` | % |
| **Tasa de error por registro (VD2 de la tesis)** | `(registros de ejecuciones fallidas / registros procesados) × 100` | % |
| Reducción VD1 | `((líneaBase_s × 1000 − mediaLatencia_ms) / (líneaBase_s × 1000)) × 100` | % |
| Reducción VD2 | `((tasaErrorManual − tasaErrorRegistros) / tasaErrorManual) × 100` | % |

La línea base de VD1 se expresa en **segundos** y se convierte a **milisegundos** antes de compararla con la latencia medida, para que las magnitudes sean comparables.

### 3.3 Ejemplo de respuesta (datos sintéticos)

```json
{
  "periodo": { "inicio": "2026-11-02T00:00:00.000Z", "fin": "2026-11-08T23:59:59.000Z" },
  "workflowId": "todos",
  "metricas": {
    "observaciones": 10,
    "totalExitos": 8,
    "totalErrores": 2,
    "totalAdvertencias": 0,
    "observacionesSinLatencia": 0,
    "mediaLatenciaMs": 43.9,
    "medianaLatenciaMs": 43.5,
    "desviacionEstandarLatenciaMs": 4.68,
    "tasaErrorPorcentaje": 20,
    "registrosEnEjecucionesConError": 0,
    "tasaErrorRegistrosPorcentaje": 0,
    "totalRegistrosProcesados": 76
  },
  "comparacionVD1": {
    "formula": "((baseline - automatizado) / baseline) × 100",
    "porcentajeReduccion": 99.97,
    "seAlcanzoMeta": true,
    "metaPorcentaje": 70
  },
  "comparacionVD2Registros": {
    "formula": "((baseline - automatizado) / baseline) × 100",
    "porcentajeReduccion": 100,
    "seAlcanzoMeta": true,
    "metaPorcentaje": 50
  },
  "comparacionVD2": {
    "formula": "((baseline - automatizado) / baseline) × 100",
    "porcentajeReduccion": -300,
    "seAlcanzoMeta": false,
    "metaPorcentaje": 50
  },
  "lineaBase": {
    "tiempoManualSegundos": 120,
    "tasaErrorManual": 5,
    "umbralObservacionesMinimo": 30
  },
  "observacionesUsadas": 10,
  "advertenciaDatosInsuficientes": "Datos insuficientes: solo 10 observación(es), se requieren al menos 30 para conclusiones estadísticas válidas.",
  "conclusionHipotesis": "[Muestra insuficiente: 10 de 30 observaciones requeridas. Resultado preliminar, NO concluyente.] VD1: se alcanzó la meta del ≥70% de reducción (99.97%). VD2: se alcanzó la meta del ≥50% de reducción (100%). Diagnóstico: tasa de fallos por ejecución 20%.",
  "conclusionDefinitiva": false,
  "fuenteDatos": "sintetico",
  "datosSinteticos": true
}
```

> ⚠️ Este ejemplo procede del conjunto **sintético** de demostración (`services/metrics/src/syntheticData.js`). **No es un resultado empírico.**

---

## 4. Validaciones Zod

| Regla | Mensaje | Consecuencia |
|---|---|---|
| `workflowId` no vacío | «El workflowId es requerido» | `MetricsValidationError` (HTTP 400) |
| Fechas ISO 8601 | «La fecha de inicio debe ser ISO 8601 válida» | `MetricsValidationError` (HTTP 400) |
| `periodoFin >= periodoInicio` | «periodoFin no puede ser anterior a periodoInicio» | `MetricsValidationError` (HTTP 400) |
| Línea base de tiempo > 0 | «La línea base de tiempo manual debe ser un número positivo» | `MetricsValidationError` (HTTP 400) |
| Tasa de error manual en 0–100 | «La línea base de tasa de error manual no puede exceder 100%» | `MetricsValidationError` (HTTP 400) |
| `estado` ∈ {exito, error, advertencia} | — | `MetricsValidationError` (HTTP 400) |
| `registros_procesados` entero ≥ 0 | — | `MetricsValidationError` (HTTP 400) |
| `umbralObservacionesMinimo` entero > 0 | — | `MetricsValidationError` (HTTP 400) |
| Salida conforme a `MetricsReportSchema` | — | El informe nunca sale del componente sin validar |

---

## 5. Errores posibles

| Error | HTTP | Origen | Causa típica |
|---|---|---|---|
| `MetricsValidationError` | 400 | `validarEntrada` | Payload incompleto o con tipos/campos inválidos. |
| `PostgresSourceError` | 500 | `postgresSource.js` | Falta la configuración de conexión, la base de datos no responde o la consulta falla. |
| `ZodError` (anidado) | 400 | `safeParse` | Detalle campo a campo; se devuelve en `error.detalles`. |
| `Unauthorized` | 401 | `server.js` | Header `x-api-key` ausente o incorrecto. |
| `NotFound` | 404 | `server.js` | Ruta distinta de `/health` o `/metrics`. |
| `PayloadTooLarge` | 413 | `server.js` | Cuerpo > 1 MB. |
| `UnhandledRejection` / `UncaughtException` | 500 | `index.js` (CLI) | Fallo asíncrono no controlado. |

---

## 6. Autenticación

- **HTTP:** header `x-api-key` con comparación en tiempo constante (`timingSafeEqual`). La clave se toma de `METRICS_API_KEY`; en n8n se configura como credencial `httpHeaderAuth` con **nombre de header `x-api-key`** (*Metrics API Key*).
- **CLI:** no requiere autenticación (uso local).
- El servicio **no se expone al host**: vive en la red interna `fintech_internal` de Docker Compose.

---

## 7. Relación con los workflows

| Workflow | Uso |
|---|---|
| `workflows/reporte-semanal.json` (RF-012) | Nodo **Consultar Ejecuciones Semana** lee `automation_log` → nodo **Preparar Payload Métricas** construye el payload → nodo **Invocar Métricas** (`POST http://metrics:3001/metrics`) → el informe VD1/VD2 se integra en el correo. |

El workflow **no replica ninguna fórmula**: las consultas SQL sólo aportan las filas; el cálculo, la validación y el juicio sobre la suficiencia de la muestra ocurren en el componente.

---

## 8. Seguridad

- No se generan datos ficticios: si no hay observaciones, el informe lo dice.
- Los datos sintéticos se marcan siempre (`fuenteDatos: 'sintetico'`, `datosSinteticos: true`) y el informe en texto plano lo declara en su primera línea.
- El log de auditoría del servidor registra **workflowId y duración**: nunca el payload ni datos personales.

---

## 9. Pruebas

| Fichero | Cobertura |
|---|---|
| `src/__tests__/calculator.test.js` | Media, mediana, desviación estándar, tasa de error, reducción, métricas completas, muestra insuficiente (22 pruebas). |
| `src/__tests__/service.test.js` | Validación de entradas, datos reales vs sintéticos, prioridad de `ejecuciones`, periodo sin registros, latencias nulas, fallos de PostgreSQL, procedencia de la línea base (19 pruebas). |
| `src/__tests__/server.test.js` | Health, 401 sin API key, 400 con entrada inválida, body vacío, JSON inválido, 404 (8 pruebas). |
| `src/__tests__/integration.test.js` | **Integración contra PostgreSQL real con el esquema del MER**: aplica `init.sql`, siembra datos sintéticos y comprueba que `metrics` calcula sobre `automation_log` y que `dashboard` calcula los cuatro bloques sobre las seis entidades. Se **omite** si no se define `INTEGRATION_PG_URL` (4 pruebas). |
