/**
 * @fileoverview Datos sintéticos de demostración del componente de métricas.
 *
 * ⚠️ IMPORTANTE — Estos valores NO son resultados empíricos.
 *
 * Son un conjunto fijo de ejecuciones ficticias que existe únicamente para
 * validar el cableado del componente (CLI, HTTP, workflow) sin depender de un
 * piloto con datos reales. Todo informe generado con ellos se marca con
 * `fuenteDatos: 'sintetico'` y `datosSinteticos: true`, y su texto plano lo
 * declara de forma explícita. No deben presentarse como evidencia de la
 * hipótesis VD1/VD2.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

/**
 * Ejecuciones sintéticas de demostración (10 registros).
 * @type {ReadonlyArray<{latencia_ms: number, estado: string, registros_procesados: number}>}
 */
export const EJECUCIONES_SINTETICAS = Object.freeze([
  { latencia_ms: 45, estado: 'exito', registros_procesados: 10 },
  { latencia_ms: 38, estado: 'exito', registros_procesados: 8 },
  { latencia_ms: 52, estado: 'exito', registros_procesados: 12 },
  { latencia_ms: 41, estado: 'error', registros_procesados: 0 },
  { latencia_ms: 39, estado: 'exito', registros_procesados: 9 },
  { latencia_ms: 47, estado: 'exito', registros_procesados: 11 },
  { latencia_ms: 43, estado: 'exito', registros_procesados: 7 },
  { latencia_ms: 50, estado: 'error', registros_procesados: 0 },
  { latencia_ms: 44, estado: 'exito', registros_procesados: 10 },
  { latencia_ms: 40, estado: 'exito', registros_procesados: 9 },
]);

/**
 * Devuelve una copia mutable de las ejecuciones sintéticas.
 * @returns {Array<object>} Copia del conjunto sintético
 */
export function obtenerEjecucionesSinteticas() {
  return EJECUCIONES_SINTETICAS.map((ejecucion) => ({ ...ejecucion }));
}
