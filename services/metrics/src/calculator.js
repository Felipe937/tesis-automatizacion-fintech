/**
 * @fileoverview Lógica estadística para el componente de métricas (VD1/VD2).
 *
 * Calcula:
 *   - Media aritmética de latencia_ms
 *   - Mediana de latencia_ms
 *   - Desviación estándar de latencia_ms
 *   - Tasa de error operativo (errores / total) × 100
 *   - Porcentaje de reducción frente a línea base: ((baseline - automatizado) / baseline) × 100
 *
 * Todos los cálculos operan sobre arrays de números. No generan datos ficticios.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

/**
 * Calcula la media aritmética de un array de números.
 *
 * @param {number[]} valores - Array de valores numéricos
 * @returns {number} Media aritmética. Retorna 0 si el array está vacío.
 */
export function calcularMedia(valores) {
  if (!Array.isArray(valores) || valores.length === 0) {
    return 0;
  }
  const suma = valores.reduce((acc, v) => acc + v, 0);
  return suma / valores.length;
}

/**
 * Calcula la mediana de un array de números.
 *
 * @param {number[]} valores - Array de valores numéricos
 * @returns {number} Mediana. Retorna 0 si el array está vacío.
 */
export function calcularMediana(valores) {
  if (!Array.isArray(valores) || valores.length === 0) {
    return 0;
  }
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  if (ordenados.length % 2 === 0) {
    return (ordenados[medio - 1] + ordenados[medio]) / 2;
  }
  return ordenados[medio];
}

/**
 * Calcula la desviación estándar muestral de un array de números.
 * Usa n-1 como denominador (desviación estándar de muestra).
 *
 * @param {number[]} valores - Array de valores numéricos
 * @returns {number} Desviación estándar. Retorna 0 si hay menos de 2 valores.
 */
export function calcularDesviacionEstandar(valores) {
  if (!Array.isArray(valores) || valores.length < 2) {
    return 0;
  }
  const media = calcularMedia(valores);
  const sumaCuadrados = valores.reduce(
    (acc, v) => acc + Math.pow(v - media, 2),
    0,
  );
  return Math.sqrt(sumaCuadrados / (valores.length - 1));
}

/**
 * Calcula la tasa de error operativa en porcentaje.
 *
 * @param {number} totalErrores - Número de ejecuciones con error
 * @param {number} totalEjecuciones - Número total de ejecuciones
 * @returns {number} Tasa de error en porcentaje (0-100). Retorna 0 si no hay ejecuciones.
 */
export function calcularTasaError(totalErrores, totalEjecuciones) {
  if (!totalEjecuciones || totalEjecuciones === 0) {
    return 0;
  }
  return (totalErrores / totalEjecuciones) * 100;
}

/**
 * Calcula el porcentaje de reducción frente a una línea base.
 * Fórmula: ((baseline - automatizado) / baseline) × 100
 *
 * @param {number} baseline - Valor de la línea base (proceso manual)
 * @param {number} automatizado - Valor medido en el proceso automatizado
 * @returns {object} Objeto con fórmula, porcentaje y si se alcanzó la meta
 */
export function calcularReduccion(baseline, automatizado, metaPorcentaje) {
  const formula = '((baseline - automatizado) / baseline) × 100';
  let porcentajeReduccion = 0;

  if (baseline && baseline > 0) {
    porcentajeReduccion = ((baseline - automatizado) / baseline) * 100;
  }

  const seAlcanzoMeta = porcentajeReduccion >= metaPorcentaje;

  return {
    formula,
    porcentajeReduccion: Math.round(porcentajeReduccion * 100) / 100,
    seAlcanzoMeta,
    metaPorcentaje,
  };
}

/**
 * Calcula todas las métricas para un conjunto de ejecuciones de un workflow.
 *
 * @param {Array<{ latencia_ms: number|null, estado: string, registros_procesados: number }>} ejecuciones
 * @param {object} lineasBase - Líneas base de comparación
 * @param {number} lineasBase.tiempoManualSegundos - Línea base VD1 (segundos)
 * @param {number} lineasBase.tasaErrorManual - Línea base VD2 (porcentaje)
 * @param {number} [lineasBase.umbralObservacionesMinimo=30] - Umbral mínimo de observaciones
 * @returns {object} Métricas calculadas, comparaciones VD1/VD2 y advertencias
 */
export function calcularMetricasWorkflow(ejecuciones, lineasBase) {
  const {
    tiempoManualSegundos,
    tasaErrorManual,
    umbralObservacionesMinimo = 30,
  } = lineasBase;

  const observaciones = ejecuciones.length;
  const advertencia =
    observaciones < umbralObservacionesMinimo
      ? `Datos insuficientes: solo ${observaciones} observación(es), se requieren al menos ${umbralObservacionesMinimo} para conclusiones estadísticas válidas.`
      : null;

  // Latencias válidas (no nulas) para cálculos estadísticos
  const latenciasValidas = ejecuciones
    .map((e) => e.latencia_ms)
    .filter((l) => l !== null && l !== undefined);

  const totalRegistrosProcesados = ejecuciones.reduce(
    (acc, e) => acc + (e.registros_procesados ?? 0),
    0,
  );

  const totalErrores = ejecuciones.filter(
    (e) => e.estado === 'error',
  ).length;

  const metricas = {
    observaciones,
    mediaLatenciaMs: Math.round(calcularMedia(latenciasValidas) * 100) / 100,
    medianaLatenciaMs: Math.round(calcularMediana(latenciasValidas) * 100) / 100,
    desviacionEstandarLatenciaMs: Math.round(
      calcularDesviacionEstandar(latenciasValidas) * 100,
    ) / 100,
    tasaErrorPorcentaje: Math.round(calcularTasaError(totalErrores, observaciones) * 100) / 100,
    totalRegistrosProcesados,
  };

  // VD1: Tiempo de sincronización (meta: reducción ≥ 70%)
  // La línea base viene en segundos (según §1.1.1 de la tesis) y la latencia
  // medida está en ms (automation_log.latencia_ms). Se convierte a ms para
  // comparar unidades consistentes.
  const tiempoManualMs = tiempoManualSegundos * 1000;
  const comparacionVD1 = calcularReduccion(
    tiempoManualMs,
    metricas.mediaLatenciaMs,
    70,
  );

  // VD2: Tasa de errores operativos (meta: reducción ≥ 50%)
  const comparacionVD2 = calcularReduccion(
    tasaErrorManual,
    metricas.tasaErrorPorcentaje,
    50,
  );

  // Conclusión explícita sobre la hipótesis
  const partesConclusion = [];
  if (comparacionVD1.seAlcanzoMeta) {
    partesConclusion.push(
      `VD1: se alcanzó la meta del ≥70% de reducción (${comparacionVD1.porcentajeReduccion}%).`,
    );
  } else {
    partesConclusion.push(
      `VD1: NO se alcanzó la meta del ≥70% de reducción (${comparacionVD1.porcentajeReduccion}%).`,
    );
  }
  if (comparacionVD2.seAlcanzoMeta) {
    partesConclusion.push(
      `VD2: se alcanzó la meta del ≥50% de reducción (${comparacionVD2.porcentajeReduccion}%).`,
    );
  } else {
    partesConclusion.push(
      `VD2: NO se alcanzó la meta del ≥50% de reducción (${comparacionVD2.porcentajeReduccion}%).`,
    );
  }

  const conclusionHipotesis = partesConclusion.join(' ');

  return {
    metricas,
    comparacionVD1,
    comparacionVD2,
    observacionesUsadas: observaciones,
    advertenciaDatosInsuficientes: advertencia,
    conclusionHipotesis,
  };
}

/**
 * Genera un informe de texto plano a partir del resultado del cálculo.
 *
 * @param {object} resultado - Resultado de calcularMetricasWorkflow
 * @param {string} periodoInicio - Fecha de inicio del periodo
 * @param {string} periodoFin - Fecha de fin del periodo
 * @param {string} workflowId - ID del workflow medido
 * @param {boolean} [datosSinteticos=false] - Indica si los datos son sintéticos
 * @returns {string} Informe en formato texto plano
 */
export function generarInformeTexto(
  resultado,
  periodoInicio,
  periodoFin,
  workflowId,
  datosSinteticos = false,
) {
  const { metricas, comparacionVD1, comparacionVD2, conclusionHipotesis, advertenciaDatosInsuficientes } = resultado;

  const lineas = [];
  lineas.push('============================================================');
  lineas.push(' INFORME DE MÉTRICAS — VALIDACIÓN HIPÓTESIS VD1/VD2');
  lineas.push(' Tesis IS25237 — Automatización Fintech');
  lineas.push('============================================================');
  lineas.push('');
  lineas.push(`Workflow medido: ${workflowId}`);
  lineas.push(`Periodo medido: ${periodoInicio} al ${periodoFin}`);
  lineas.push(`Datos sintéticos: ${datosSinteticos ? 'SÍ' : 'NO'}`);
  lineas.push('');
  lineas.push('--- Métricas calculadas ---');
  lineas.push(`Observaciones: ${metricas.observaciones}`);
  lineas.push(`Media de latencia: ${metricas.mediaLatenciaMs} ms`);
  lineas.push(`Mediana de latencia: ${metricas.medianaLatenciaMs} ms`);
  lineas.push(`Desviación estándar de latencia: ${metricas.desviacionEstandarLatenciaMs} ms`);
  lineas.push(`Tasa de error: ${metricas.tasaErrorPorcentaje}%`);
  lineas.push(`Total de registros procesados: ${metricas.totalRegistrosProcesados}`);
  lineas.push('');
  lineas.push('--- Comparación VD1: Tiempo de sincronización ---');
  lineas.push(`Fórmula: ${comparacionVD1.formula}`);
  lineas.push(`Línea base (manual): ${comparacionVD1.metaPorcentaje >= 70 ? 'N/A (meta fija 70%)' : 'N/A'}`);
  lineas.push(`Reducción alcanzada: ${comparacionVD1.porcentajeReduccion}%`);
  lineas.push(`Meta: ≥ 70%`);
  lineas.push(`¿Se alcanzó?: ${comparacionVD1.seAlcanzoMeta ? 'SÍ' : 'NO'}`);
  lineas.push('');
  lineas.push('--- Comparación VD2: Tasa de errores operativos ---');
  lineas.push(`Fórmula: ${comparacionVD2.formula}`);
  lineas.push(`Línea base (manual): ${comparacionVD2.metaPorcentaje >= 50 ? 'N/A (meta fija 50%)' : 'N/A'}`);
  lineas.push(`Reducción alcanzada: ${comparacionVD2.porcentajeReduccion}%`);
  lineas.push(`Meta: ≥ 50%`);
  lineas.push(`¿Se alcanzó?: ${comparacionVD2.seAlcanzoMeta ? 'SÍ' : 'NO'}`);
  lineas.push('');
  lineas.push('--- Conclusión de la hipótesis ---');
  lineas.push(conclusionHipotesis);
  if (advertenciaDatosInsuficientes) {
    lineas.push('');
    lineas.push('--- ADVERTENCIA ---');
    lineas.push(advertenciaDatosInsuficientes);
  }
  lineas.push('');
  lineas.push('============================================================');

  return lineas.join('\n');
}