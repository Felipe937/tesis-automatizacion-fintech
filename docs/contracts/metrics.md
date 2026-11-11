# Contrato de Componente — Métricas VD1/VD2

**Archivo fuente:** `services/metrics/src/calculator.js`, `services/metrics/src/schemas.js`, `services/metrics/src/index.js`  
**Propósito:** Validar la hipótesis de la tesis (§2.4, §3.5) calculando indicadores de desempeño del proceso automatizado frente a línea base manual.  

---

## Variables dependientes (§2.4)

| Variable | Descripción | Meta | Línea base (§1.1.1) |
|----------|-------------|------|---------------------|
| VD1 | Tiempo de sincronización (segundos) | Reducción ≥ 70% | 28% de jornada en transcripción manual |
| VD2 | Tasa de errores operativos (%) | Reducción ≥ 50% | > 5% tasa de error tipográfico |

---

## Operación: calcularMetricasWorkflow(ejecuciones, lineasBase)

**Payload de entrada:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `ejecuciones` | `array` | Sí | Array de `{ latencia_ms, estado, registros_procesados }` |
| `lineasBase.tiempoManualSegundos` | `number` | Sí | Tiempo manual en segundos (se convierte a ms) |
| `lineasBase.tasaErrorManual` | `number` | Sí | Tasa de error manual en porcentaje |
| `lineasBase.umbralObservacionesMinimo` | `number` | No (default: 30) | Umbral para conclusiones estadísticas |

**Cálculos realizados:**
- Media aritmética de `latencia_ms`
- Mediana de `latencia_ms`
- Desviación estándar muestral de `latencia_ms`
- Tasa de error: `(errores / total) × 100`
- Reducción VD1: `((baseline_ms - mediaLatenciaMs) / baseline_ms) × 100` (meta ≥ 70%)
- Reducción VD2: `((tasaErrorManual - tasaErrorAutomatizado) / tasaErrorManual) × 100` (meta ≥ 50%)

**Payload de respuesta:**
```json
{
  "metricas": {
    "observaciones": 10,
    "mediaLatenciaMs": 43.9,
    "medianaLatenciaMs": 43.5,
    "desviacionEstandarLatenciaMs": 4.68,
    "tasaErrorPorcentaje": 20,
    "totalRegistrosProcesados": 76
  },
  "comparacionVD1": {
    "formula": "((baseline - automatizado) / baseline) × 100",
    "porcentajeReduccion": 99.97,
    "seAlcanzoMeta": true,
    "metaPorcentaje": 70
  },
  "comparacionVD2": {
    "formula": "((baseline - automatizado) / baseline) × 100",
    "porcentajeReduccion": -300,
    "seAlcanzoMeta": false,
    "metaPorcentaje": 50
  },
  "observacionesUsadas": 10,
  "advertenciaDatosInsuficientes": "Datos insuficientes: solo 10 observación(es)...",
  "conclusionHipotesis": "VD1: se alcanzó... VD2: NO se alcanzó..."
}
```

**Reglas de datos insuficientes:**
- Si `observaciones < umbralObservacionesMinimo` (default 30), se incluye `advertenciaDatosInsuficientes` y no se emite conclusión definitiva.

---

## Seguridad

- No generar resultados ficticios; si datos reales insuficientes, devolver "datos insuficientes".
- Datos sintéticos claramente marcados como `datosSinteticos: true`.
- No publicar datos personales ni financieros reales.

---

## Pruebas unitarias

22 pruebas en `services/metrics/src/__tests__/calculator.test.js` cubriendo media, mediana, desviación estándar, tasa de error, reducción y métricas completas.