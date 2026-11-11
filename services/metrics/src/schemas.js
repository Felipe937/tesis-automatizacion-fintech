/**
 * @fileoverview Esquemas de validación Zod para parámetros de entrada del componente de métricas.
 * Compatible con Zod v4 (v4.6.6+).
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Esquema de parámetros de entrada
// ---------------------------------------------------------------------------

/** Parámetros de entrada para el cálculo de métricas de automatización */
export const MetricsInputSchema = z.object({
  /** Identificador del workflow a medir (ej: 'captura-leads', 'alertas-financieras') */
  workflowId: z.string().min(1, 'El workflowId es requerido'),

  /** Fecha y hora de inicio del periodo de medición (ISO 8601) */
  periodoInicio: z.string().datetime('La fecha de inicio debe ser ISO 8601 válida'),

  /** Fecha y hora de fin del periodo de medición (ISO 8601) */
  periodoFin: z.string().datetime('La fecha de fin debe ser ISO 8601 válida'),

  /** Línea base de tiempo manual en segundos por operación (según §1.1.1 de la tesis) */
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
});

// ---------------------------------------------------------------------------
// Esquemas de salida del informe
// ---------------------------------------------------------------------------

/** Métricas calculadas por workflow */
export const WorkflowMetricsSchema = z.object({
  /** Número de observaciones (ejecuciones) analizadas */
  observaciones: z.number().int().nonnegative(),
  /** Media de latencia_ms */
  mediaLatenciaMs: z.number().nonnegative(),
  /** Mediana de latencia_ms */
  medianaLatenciaMs: z.number().nonnegative(),
  /** Desviación estándar de latencia_ms */
  desviacionEstandarLatenciaMs: z.number().nonnegative(),
  /** Tasa de error: (errores / total) × 100 */
  tasaErrorPorcentaje: z.number().nonnegative().max(100),
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
  /** Comparación VD2: tasa de errores operativos */
  comparacionVD2: ReduccionResultSchema,
  /** Número de observaciones usadas */
  observacionesUsadas: z.number().int().nonnegative(),
  /** Advertencia si hay datos insuficientes (< umbral) */
  advertenciaDatosInsuficientes: z.string().optional(),
  /** Conclusión explícita sobre la hipótesis */
  conclusionHipotesis: z.string(),
  /** Indica si los datos son sintéticos (para pruebas) */
  datosSinteticos: z.boolean().default(false),
});