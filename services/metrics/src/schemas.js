/**
 * @fileoverview Esquemas de validación Zod para el componente de métricas.
 * Compatible con Zod v4 (v4.6.6+).
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Esquemas de entrada
// ---------------------------------------------------------------------------

/** Estados posibles de una ejecución en `automation_log.estado`. */
export const EstadoEjecucionEnum = z.enum(['exito', 'error', 'advertencia']);

/**
 * Una ejecución individual registrada en `automation_log`.
 *
 * `latencia_ms` admite null: las ejecuciones que no alcanzan a medir su
 * latencia (por ejemplo, fallos tempranos) se excluyen de los cálculos
 * estadísticos pero siguen contando para el total de ejecuciones.
 */
export const EjecucionSchema = z.object({
  /** Latencia de la ejecución en milisegundos (null si no se midió) */
  latencia_ms: z.number().int().nonnegative().nullable().default(null),
  /** Estado de la ejecución */
  estado: EstadoEjecucionEnum,
  /** Número de registros de negocio procesados por la ejecución */
  registros_procesados: z.coerce
    .number()
    .int('registros_procesados debe ser un entero')
    .nonnegative('registros_procesados no puede ser negativo')
    .default(0),
  /** Workflow al que pertenece la ejecución (opcional, informativo) */
  workflow_id: z.string().optional(),
  /** Inicio de la ejecución (ISO 8601, informativo) */
  timestamp_inicio: z.string().datetime().optional(),
});

/**
 * Configuración de la conexión a PostgreSQL.
 * Si se omite, el servicio usa las variables de entorno POSTGRES_*.
 */
export const PostgresConfigSchema = z.object({
  /** Cadena de conexión completa (postgresql://...). Tiene prioridad sobre el resto. */
  connectionString: z.string().min(1).optional(),
  /** Host de PostgreSQL */
  host: z.string().min(1).optional(),
  /** Puerto de PostgreSQL */
  port: z.coerce.number().int().positive().optional(),
  /** Nombre de la base de datos */
  database: z.string().min(1).optional(),
  /** Usuario de la base de datos */
  user: z.string().min(1).optional(),
  /** Contraseña de la base de datos */
  password: z.string().optional(),
  /** Schema donde viven las tablas de negocio (por defecto: public) */
  schema: z.string().min(1).default('public'),
});

/**
 * Procedencia documentada de la línea base manual.
 *
 * La línea base NO puede inventarse: debe provenir de mediciones reales del
 * proceso manual del piloto. Este bloque registra quién la midió, cómo y
 * cuándo, de modo que el informe sea auditable.
 */
export const LineaBaseProvenienciaSchema = z.object({
  /** Fuente documental de la medición (ej: '§1.1.1 de la tesis IS25237') */
  fuente: z.string().min(1, 'La fuente de la línea base es requerida'),
  /** Descripción de cómo se midió el proceso manual */
  descripcion: z.string().min(1, 'La descripción metodológica es requerida'),
  /** Fecha de la medición (ISO 8601) */
  fechaMedicion: z.string().datetime('La fecha de medición debe ser ISO 8601 válida'),
  /** Observaciones adicionales */
  notas: z.string().optional(),
});

/** Parámetros de entrada para el cálculo de métricas de automatización. */
export const MetricsInputSchema = z
  .object({
    /** Identificador del workflow a medir (ej: 'captura-leads', 'alertas-financieras') */
    workflowId: z.string().min(1, 'El workflowId es requerido'),

    /** Fecha y hora de inicio del periodo de medición (ISO 8601) */
    periodoInicio: z.string().datetime('La fecha de inicio debe ser ISO 8601 válida'),

    /** Fecha y hora de fin del periodo de medición (ISO 8601) */
    periodoFin: z.string().datetime('La fecha de fin debe ser ISO 8601 válida'),

    /**
     * Línea base de tiempo manual en segundos por operación (según §1.1.1 de la tesis).
     * Debe sustentarse en mediciones reales del proceso manual (ver docs/decisions.md).
     */
    lineaBaseTiempoManualSegundos: z
      .number()
      .positive('La línea base de tiempo manual debe ser un número positivo'),

    /** Línea base de tasa de error manual en porcentaje (según §1.1.1 de la tesis) */
    lineaBaseTasaErrorManual: z
      .number()
      .nonnegative('La línea base de tasa de error manual no puede ser negativa')
      .max(100, 'La línea base de tasa de error manual no puede exceder 100%'),

    /** Umbral mínimo de observaciones para conclusiones estadísticas (default: 30) */
    umbralObservacionesMinimo: z
      .number()
      .int()
      .positive()
      .default(30),

    /**
     * Origen de los datos de observación.
     *   - 'postgres'   → se leen de `automation_log` (datos reales / empíricos).
     *   - 'sintetico'  → se usan las ejecuciones sintéticas de demostración.
     */
    fuenteDatos: z.enum(['postgres', 'sintetico']).default('sintetico'),

    /**
     * Observaciones reales ya extraídas por el orquestador.
     * Si se proveen, tienen prioridad sobre la consulta a PostgreSQL.
     */
    ejecuciones: z.array(EjecucionSchema).optional(),

    /** Configuración opcional de la conexión a PostgreSQL */
    postgres: PostgresConfigSchema.optional(),

    /** Procedencia documentada de la línea base manual */
    lineaBaseProveniencia: LineaBaseProvenienciaSchema.optional(),
  })
  .refine(
    (data) => data.periodoFin >= data.periodoInicio,
    {
      message: 'periodoFin no puede ser anterior a periodoInicio',
      path: ['periodoFin'],
    },
  );

// ---------------------------------------------------------------------------
// Esquemas de salida del informe
// ---------------------------------------------------------------------------

/** Métricas calculadas por workflow */
export const WorkflowMetricsSchema = z.object({
  /** Número de observaciones (ejecuciones) analizadas */
  observaciones: z.number().int().nonnegative(),
  /** Ejecuciones con estado 'exito' */
  totalExitos: z.number().int().nonnegative(),
  /** Ejecuciones con estado 'error' */
  totalErrores: z.number().int().nonnegative(),
  /** Ejecuciones con estado 'advertencia' */
  totalAdvertencias: z.number().int().nonnegative(),
  /** Ejecuciones sin latencia medida (excluidas de los cálculos estadísticos) */
  observacionesSinLatencia: z.number().int().nonnegative(),
  /** Media de latencia_ms */
  mediaLatenciaMs: z.number().nonnegative(),
  /** Mediana de latencia_ms */
  medianaLatenciaMs: z.number().nonnegative(),
  /** Desviación estándar de latencia_ms */
  desviacionEstandarLatenciaMs: z.number().nonnegative(),
  /** Tasa de error por ejecución: (errores / ejecuciones) × 100 — diagnóstico operativo */
  tasaErrorPorcentaje: z.number().nonnegative().max(100),
  /** Registros procesados por ejecuciones fallidas (atribución conservadora) */
  registrosEnEjecucionesConError: z.number().int().nonnegative(),
  /**
   * Tasa de error por REGISTRO procesado — definición de VD2 en la tesis (§2.4):
   * «porcentaje de datos incorrectos o repetidos sobre el total de registros
   * procesados».
   */
  tasaErrorRegistrosPorcentaje: z.number().nonnegative().max(100),
  /** Total de registros procesados */
  totalRegistrosProcesados: z.number().int().nonnegative(),
});

/** Resultado del cálculo de reducción frente a línea base */
export const ReduccionResultSchema = z.object({
  /** Fórmula usada: ((baseline - automatizado) / baseline) × 100 */
  formula: z.string(),
  /** Porcentaje de reducción calculado */
  porcentajeReduccion: z.number(),
  /** ¿Se alcanzó la meta documentada en la tesis? */
  seAlcanzoMeta: z.boolean(),
  /** Meta documentada en porcentaje */
  metaPorcentaje: z.number(),
});

/** Línea base documentada con su procedencia */
export const LineaBaseSchema = z.object({
  /** Tiempo manual de referencia en segundos */
  tiempoManualSegundos: z.number().positive(),
  /** Tasa de error manual de referencia en porcentaje */
  tasaErrorManual: z.number().nonnegative(),
  /** Umbral mínimo de observaciones usado para el análisis */
  umbralObservacionesMinimo: z.number().int().positive(),
  /** Procedencia de la medición */
  proveniencia: z
    .object({
      fuente: z.string(),
      descripcion: z.string(),
      fechaMedicion: z.string(),
      notas: z.string().optional(),
    })
    .optional(),
});

/** Informe completo de métricas */
export const MetricsReportSchema = z.object({
  /** Periodo medido (inicio y fin) */
  periodo: z.object({
    inicio: z.string().datetime(),
    fin: z.string().datetime(),
  }),
  /** Workflow medido */
  workflowId: z.string(),
  /** Métricas calculadas */
  metricas: WorkflowMetricsSchema,
  /** Comparación VD1: tiempo de sincronización */
  comparacionVD1: ReduccionResultSchema,
  /** Comparación VD2: tasa de errores operativos (definición de la tesis, por registro) */
  comparacionVD2Registros: ReduccionResultSchema,
  /** Comparación VD2 operativa por ejecución (indicador diagnóstico) */
  comparacionVD2: ReduccionResultSchema,
  /** Línea base utilizada, con su procedencia */
  lineaBase: LineaBaseSchema,
  /** Número de observaciones usadas */
  observacionesUsadas: z.number().int().nonnegative(),
  /** Advertencia si hay datos insuficientes (< umbral) */
  advertenciaDatosInsuficientes: z.string().optional(),
  /** Advertencia específica cuando el periodo no tiene registros */
  advertenciaPeriodoSinRegistros: z.string().optional(),
  /** Conclusión explícita sobre la hipótesis */
  conclusionHipotesis: z.string(),
  /** Indica si la conclusión es estadísticamente concluyente */
  conclusionDefinitiva: z.boolean(),
  /** Origen de los datos: 'postgres' (reales) | 'sintetico' (demostración) */
  fuenteDatos: z.enum(['postgres', 'sintetico']),
  /** Indica si los datos son sintéticos (para pruebas) */
  datosSinteticos: z.boolean().default(false),
});
