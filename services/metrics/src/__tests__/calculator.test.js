/**
 * @fileoverview Tests unitarios para el módulo de cálculos estadísticos.
 * Todos los datos son sintéticos. No se lee de bases de datos reales.
 *
 * Ejecución: node --test src/__tests__/calculator.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularMedia,
  calcularMediana,
  calcularDesviacionEstandar,
  calcularTasaError,
  calcularReduccion,
  calcularMetricasWorkflow,
} from '../calculator.js';

// ---------------------------------------------------------------------------
// Media aritmética
// ---------------------------------------------------------------------------

describe('calcularMedia', () => {
  it('calcula la media de un array de números', () => {
    assert.equal(calcularMedia([10, 20, 30, 40]), 25);
  });

  it('retorna 0 para array vacío', () => {
    assert.equal(calcularMedia([]), 0);
  });

  it('calcula la media de un solo elemento', () => {
    assert.equal(calcularMedia([42]), 42);
  });
});

// ---------------------------------------------------------------------------
// Mediana
// ---------------------------------------------------------------------------

describe('calcularMediana', () => {
  it('calcula la mediana de array con cantidad impar', () => {
    assert.equal(calcularMediana([1, 3, 5]), 3);
  });

  it('calcula la mediana de array con cantidad par', () => {
    assert.equal(calcularMediana([1, 2, 3, 4]), 2.5);
  });

  it('retorna 0 para array vacío', () => {
    assert.equal(calcularMediana([]), 0);
  });

  it('ordena internamente antes de calcular', () => {
    assert.equal(calcularMediana([10, 1, 5]), 5);
  });
});

// ---------------------------------------------------------------------------
// Desviación estándar
// ---------------------------------------------------------------------------

describe('calcularDesviacionEstandar', () => {
  it('calcula la desviación estándar muestral', () => {
    const resultado = calcularDesviacionEstandar([2, 4, 4, 4, 5, 5, 7, 9]);
    // Desviación estándar poblacional conocida de este conjunto es 2
    // Muestral (n-1) es ~2.138
    assert.ok(resultado > 2 && resultado < 2.2);
  });

  it('retorna 0 para array vacío', () => {
    assert.equal(calcularDesviacionEstandar([]), 0);
  });

  it('retorna 0 para un solo elemento', () => {
    assert.equal(calcularDesviacionEstandar([5]), 0);
  });
});

// ---------------------------------------------------------------------------
// Tasa de error
// ---------------------------------------------------------------------------

describe('calcularTasaError', () => {
  it('calcula el porcentaje de error', () => {
    assert.equal(calcularTasaError(3, 10), 30);
  });

  it('retorna 0 si no hay ejecuciones', () => {
    assert.equal(calcularTasaError(0, 0), 0);
  });

  it('retorna 100 si todas fallaron', () => {
    assert.equal(calcularTasaError(5, 5), 100);
  });
});

// ---------------------------------------------------------------------------
// Reducción frente a línea base
// ---------------------------------------------------------------------------

describe('calcularReduccion', () => {
  it('calcula reducción positiva', () => {
    const resultado = calcularReduccion(100, 30, 70);
    assert.equal(resultado.porcentajeReduccion, 70);
    assert.equal(resultado.seAlcanzoMeta, true);
    assert.equal(resultado.formula, '((baseline - automatizado) / baseline) × 100');
  });

  it('no alcanza meta si la reducción es insuficiente', () => {
    const resultado = calcularReduccion(100, 80, 70);
    assert.equal(resultado.porcentajeReduccion, 20);
    assert.equal(resultado.seAlcanzoMeta, false);
  });

  it('maneja baseline cero', () => {
    const resultado = calcularReduccion(0, 30, 70);
    assert.equal(resultado.porcentajeReduccion, 0);
    assert.equal(resultado.seAlcanzoMeta, false);
  });
});

// ---------------------------------------------------------------------------
// Métricas completas de workflow
// ---------------------------------------------------------------------------

describe('calcularMetricasWorkflow', () => {
  const ejecuciones = [
    { latencia_ms: 40, estado: 'exito', registros_procesados: 10 },
    { latencia_ms: 50, estado: 'exito', registros_procesados: 8 },
    { latencia_ms: 45, estado: 'error', registros_procesados: 0 },
    { latencia_ms: 55, estado: 'exito', registros_procesados: 12 },
    { latencia_ms: null, estado: 'exito', registros_procesados: 5 }, // latencia nula, excluida de stats
  ];

  const lineasBase = {
    tiempoManualSegundos: 0.2, // 200 ms expresado en segundos, consistente con latencias ms
    tasaErrorManual: 10,
    umbralObservacionesMinimo: 30,
  };

  it('calcula todas las métricas correctamente', () => {
    const resultado = calcularMetricasWorkflow(ejecuciones, lineasBase);

    assert.equal(resultado.metricas.observaciones, 5);
    assert.equal(resultado.metricas.mediaLatenciaMs, 47.5); // (40+50+45+55)/4
    assert.equal(resultado.metricas.tasaErrorPorcentaje, 20); // 1 error / 5 ejecuciones
    assert.equal(resultado.metricas.totalRegistrosProcesados, 35); // 10+8+0+12+5
    assert.equal(resultado.observacionesUsadas, 5);
  });

  it('calcula VD1 con meta de 70%', () => {
    const resultado = calcularMetricasWorkflow(ejecuciones, lineasBase);
    // Media latencia 47.5ms vs línea base 200ms (0.2s) → reducción ~76%, alcanza meta
    assert.equal(resultado.comparacionVD1.seAlcanzoMeta, true);
    assert.equal(resultado.comparacionVD1.metaPorcentaje, 70);
  });

  it('calcula VD2 con meta de 50%', () => {
    const resultado = calcularMetricasWorkflow(ejecuciones, lineasBase);
    // Tasa error 20% vs línea base 10% → aumento, no reducción
    assert.equal(resultado.comparacionVD2.seAlcanzoMeta, false);
    assert.equal(resultado.comparacionVD2.metaPorcentaje, 50);
  });

  it('genera advertencia cuando hay menos de 30 observaciones', () => {
    const resultado = calcularMetricasWorkflow(ejecuciones, lineasBase);
    assert.ok(
      resultado.advertenciaDatosInsuficientes,
      'Debe advertir datos insuficientes con 5 observaciones',
    );
    assert.ok(
      resultado.advertenciaDatosInsuficientes.includes('5'),
      'La advertencia debe mencionar el número de observaciones',
    );
  });

  it('no genera advertencia con 30 o más observaciones', () => {
    const muchasEjecuciones = Array(30).fill({
      latencia_ms: 40,
      estado: 'exito',
      registros_procesados: 1,
    });
    const resultado = calcularMetricasWorkflow(muchasEjecuciones, lineasBase);
    assert.equal(resultado.advertenciaDatosInsuficientes, null);
  });

  it('genera conclusión explícita sobre la hipótesis', () => {
    const resultado = calcularMetricasWorkflow(ejecuciones, lineasBase);
    assert.ok(resultado.conclusionHipotesis);
    assert.ok(
      resultado.conclusionHipotesis.includes('VD1') &&
        resultado.conclusionHipotesis.includes('VD2'),
    );
  });
});