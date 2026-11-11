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
 * UNIDADES (contrato con n8n y con la base de datos):
 *   - latencia_ms              → milisegundos (automation_log.latencia_ms)
 *   - tiempoManualSegundos    → segundos por operación (§1.1.1 de la tesis)
 *   - tasaErrorManual          → porcentaje 0-100
 *   - porcentajeReduccion      → porcentaje 0-100 (puede ser negativo si el
 *                                proceso automatizado es PEOR que el manual)
 *
 * Todos los cálculos operan sobre arrays de números. No generan datos ficticios:
 * el origen de las observaciones (PostgreSQL o sintético) se declara
 * explícitamente en el informe resultante.
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
 * @param {number} metaPorcentaje - Meta de reducción documentada en la tesis
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

  const lista = Array.isArray(ejecuciones) ? ejecuciones : [];
  const observaciones = lista.length;

  const esMuestraInsuficiente = observaciones < umbralObservacionesMinimo;

  const advertencia = esMuestraInsuficiente
    ? `Datos insuficientes: solo ${observaciones} observación(es), se requieren al menos ` +
      `${umbralObservacionesMinimo} para conclusiones estadísticas válidas.`
    : null;

  const advertenciaPeriodoSinRegistros =
    observaciones === 0
      ? 'El periodo consultado no contiene ejecuciones registradas en automation_log. ' +
        'No es posible calcular indicadores empíricos para este periodo.'
      : null;

  // Latencias válidas (no nulas) para cálculos estadísticos
  const latenciasValidas = lista
    .map((e) => e.latencia_ms)
    .filter((l) => l !== null && l !== undefined);

  const observacionesSinLatencia = observaciones - latenciasValidas.length;

  const totalRegistrosProcesados = lista.reduce(
    (acc, e) => acc + (e.registros_procesados ?? 0),
    0,
  );

  const totalErrores = lista.filter((e) => e.estado === 'error').length;
  const totalAdvertencias = lista.filter((e) => e.estado === 'advertencia').length;
  const totalExitos = lista.filter((e) => e.estado === 'exito').length;

  // Tasa de error operativa por EJECUCIÓN (fracción de flujos que fallan).
  const tasaErrorEjecucionesPorcentaje =
    Math.round(calcularTasaError(totalErrores, observaciones) * 100) / 100;

  // Tasa de error por REGISTRO — definición de VD2 en la tesis (§2.4,
  // Variable Dependiente 2): «el porcentaje de datos incorrectos o repetidos
  // en los sistemas de destino sobre el total de registros procesados».
  //
  // `automation_log` no registra cuántos registros fueron erróneos, sólo el
  // total procesado por ejecución. Se adopta la atribución CONSERVADORA: todos
  // los registros de una ejecución fallida se consideran erróneos (cota
  // superior). Es la lectura más exigente para demostrar la reducción.
  const registrosEnEjecucionesConError = lista
    .filter((e) => e.estado === 'error')
    .reduce((acc, e) => acc + (e.registros_procesados ?? 0), 0);

  const tasaErrorRegistrosPorcentaje =
    totalRegistrosProcesados > 0
      ? Math.round((registrosEnEjecucionesConError / totalRegistrosProcesados) * 10000) / 100
      : 0;

  const metricas = {
    observaciones,
    totalExitos,
    totalErrores,
    totalAdvertencias,
    observacionesSinLatencia,
    mediaLatenciaMs: Math.round(calcularMedia(latenciasValidas) * 100) / 100,
    medianaLatenciaMs: Math.round(calcularMediana(latenciasValidas) * 100) / 100,
    desviacionEstandarLatenciaMs: Math.round(
      calcularDesviacionEstandar(latenciasValidas) * 100,
    ) / 100,
    tasaErrorPorcentaje: tasaErrorEjecucionesPorcentaje,
    registrosEnEjecucionesConError,
    totalRegistrosProcesados,
    tasaErrorRegistrosPorcentaje,
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

  // VD2: Tasa de errores operativos (meta: reducción ≥ 50%).
  //
  // La tesis (§2.4, Variable Dependiente 2) define esta variable como el
  // «porcentaje de datos incorrectos o repetidos en los sistemas de destino
  // sobre el total de registros procesados». Ésa es la comparación que
  // `comparacionVD2Registros` implementa y la que se reporta como VD2.
  //
  // `comparacionVD2` conserva la lectura operativa por ejecución (fracción de
  // flujos que fallan), que es un indicador diagnóstico complementario.
  const comparacionVD2Registros = calcularReduccion(
    tasaErrorManual,
    metricas.tasaErrorRegistrosPorcentaje,
    50,
  );

  const comparacionVD2 = calcularReduccion(
    tasaErrorManual,
    metricas.tasaErrorPorcentaje,
    50,
  );

  // Conclusión explícita sobre la hipótesis.
  // Con muestra insuficiente la conclusión NO es concluyente: se marca como
  // preliminar para no presentar un resultado empírico sobre una muestra corta.
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
  // VD2 (definición de la tesis): tasa de errores por REGISTRO procesado.
  if (comparacionVD2Registros.seAlcanzoMeta) {
    partesConclusion.push(
      `VD2: se alcanzó la meta del ≥50% de reducción (${comparacionVD2Registros.porcentajeReduccion}%).`,
    );
  } else {
    partesConclusion.push(
      `VD2: NO se alcanzó la meta del ≥50% de reducción (${comparacionVD2Registros.porcentajeReduccion}%).`,
    );
  }
  // Diagnóstico complementario: fallos por ejecución.
  partesConclusion.push(
    `Diagnóstico: tasa de fallos por ejecución ${metricas.tasaErrorPorcentaje}%.`,
  );

  const conclusionDefinitiva = !esMuestraInsuficiente;
  const prefijo = esMuestraInsuficiente
    ? `[Muestra insuficiente: ${observaciones} de ${umbralObservacionesMinimo} observaciones requeridas. ` +
      'Resultado preliminar, NO concluyente.] '
    : '';

  const conclusionHipotesis = prefijo + partesConclusion.join(' ');

  return {
    metricas,
    comparacionVD1,
    comparacionVD2,
    comparacionVD2Registros,
    observacionesUsadas: observaciones,
    advertenciaDatosInsuficientes: advertencia,
    advertenciaPeriodoSinRegistros,
    conclusionHipotesis,
    conclusionDefinitiva,
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
  const {
    metricas,
    comparacionVD1,
    comparacionVD2,
    comparacionVD2Registros,
    conclusionHipotesis,
    advertenciaDatosInsuficientes,
    advertenciaPeriodoSinRegistros,
    conclusionDefinitiva = true,
  } = resultado;

  const lineas = [];
  lineas.push('============================================================');
  lineas.push(' INFORME DE MÉTRICAS — VALIDACIÓN HIPÓTESIS VD1/VD2');
  lineas.push(' Tesis IS25237 — Automatización Fintech');
  lineas.push('============================================================');
  lineas.push('');
  lineas.push(`Workflow medido: ${workflowId}`);
  lineas.push(`Periodo medido: ${periodoInicio} al ${periodoFin}`);
  lineas.push(`Origen de los datos: ${datosSinteticos ? 'SINTÉTICOS (demostración)' : 'REALES (PostgreSQL)'}`);
  lineas.push('');
  lineas.push('--- Métricas calculadas ---');
  lineas.push(`Observaciones: ${metricas.observaciones}`);
  lineas.push(`Ejecuciones con éxito: ${metricas.totalExitos ?? 0}`);
  lineas.push(`Ejecuciones con error: ${metricas.totalErrores ?? 0}`);
  lineas.push(`Ejecuciones con advertencia: ${metricas.totalAdvertencias ?? 0}`);
  lineas.push(`Observaciones sin latencia: ${metricas.observacionesSinLatencia ?? 0}`);
  lineas.push(`Media de latencia: ${metricas.mediaLatenciaMs} ms`);
  lineas.push(`Mediana de latencia: ${metricas.medianaLatenciaMs} ms`);
  lineas.push(`Desviación estándar de latencia: ${metricas.desviacionEstandarLatenciaMs} ms`);
  lineas.push(`Tasa de error por ejecución (diagnóstico): ${metricas.tasaErrorPorcentaje}%`);
  lineas.push(
    `Tasa de error por registro procesado (VD2, definición de la tesis): ` +
      `${metricas.tasaErrorRegistrosPorcentaje}%`,
  );
  lineas.push(`Total de registros procesados: ${metricas.totalRegistrosProcesados}`);
  lineas.push('');
  lineas.push('--- Comparación VD1: Tiempo de sincronización ---');
  lineas.push(`Fórmula: ${comparacionVD1.formula}`);
  lineas.push(`Reducción alcanzada: ${comparacionVD1.porcentajeReduccion}%`);
  lineas.push(`Meta: ≥ 70%`);
  lineas.push(`¿Se alcanzó?: ${comparacionVD1.seAlcanzoMeta ? 'SÍ' : 'NO'}`);
  lineas.push('');
  lineas.push('--- Comparación VD2: Tasa de errores operativos (por registro) ---');
  lineas.push(`Fórmula: ${comparacionVD2Registros.formula}`);
  lineas.push(`Reducción alcanzada: ${comparacionVD2Registros.porcentajeReduccion}%`);
  lineas.push(`Meta: ≥ 50%`);
  lineas.push(`¿Se alcanzó?: ${comparacionVD2Registros.seAlcanzoMeta ? 'SÍ' : 'NO'}`);
  lineas.push('');
  lineas.push('--- Diagnóstico: tasa de fallos por ejecución ---');
  lineas.push(`Fórmula: ${comparacionVD2.formula}`);
  lineas.push(`Reducción: ${comparacionVD2.porcentajeReduccion}%`);
  lineas.push('');
  lineas.push('--- Conclusión de la hipótesis ---');
  lineas.push(conclusionHipotesis);
  lineas.push(`Conclusión estadísticamente concluyente: ${conclusionDefinitiva ? 'SÍ' : 'NO'}`);
  if (advertenciaPeriodoSinRegistros) {
    lineas.push('');
    lineas.push('--- ADVERTENCIA ---');
    lineas.push(advertenciaPeriodoSinRegistros);
  }
  if (advertenciaDatosInsuficientes) {
    lineas.push('');
    lineas.push('--- ADVERTENCIA ---');
    lineas.push(advertenciaDatosInsuficientes);
  }
  lineas.push('');
  lineas.push('============================================================');

  return lineas.join('\n');
}
