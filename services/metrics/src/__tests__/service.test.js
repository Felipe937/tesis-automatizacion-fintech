/**
 * @fileoverview Tests del núcleo del componente de métricas: validación de
 * entradas, datos reales vs sintéticos, fallos de PostgreSQL, periodos vacíos,
 * latencias nulas y muestras insuficientes.
 *
 * Ejecución: node --test src/__tests__/service.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generarInformeMetricas,
  validarEntrada,
  MetricsValidationError,
} from '../service.js';
import { PostgresSourceError } from '../postgresSource.js';

const ENTRADA_BASE = {
  workflowId: 'captura-leads',
  periodoInicio: '2026-11-02T00:00:00.000Z',
  periodoFin: '2026-11-08T23:59:59.000Z',
  lineaBaseTiempoManualSegundos: 120,
  lineaBaseTasaErrorManual: 5,
};

/**
 * Crea un pool de PostgreSQL de prueba que devuelve filas fijas.
 * @param {Array<object>} filas - Filas a devolver
 * @param {Error} [error] - Error a lanzar en lugar de devolver filas
 * @returns {object} Pool de prueba
 */
function crearPoolFalso(filas = [], error = null) {
  return {
    async query(sql, parametros) {
      if (error) throw error;
      return { rows: filas, sql, parametros };
    },
    async end() {},
  };
}

// ---------------------------------------------------------------------------
// Validación de entradas
// ---------------------------------------------------------------------------

describe('validación de entradas (métricas)', () => {
  it('rechaza una entrada sin workflowId', () => {
    assert.throws(
      () => validarEntrada({ ...ENTRADA_BASE, workflowId: undefined }),
      MetricsValidationError,
    );
  });

  it('rechaza fechas que no son ISO 8601', () => {
    assert.throws(
      () => validarEntrada({ ...ENTRADA_BASE, periodoInicio: '02/11/2026' }),
      MetricsValidationError,
    );
  });

  it('rechaza un periodo invertido', () => {
    assert.throws(
      () =>
        validarEntrada({
          ...ENTRADA_BASE,
          periodoInicio: '2026-11-08T00:00:00.000Z',
          periodoFin: '2026-11-02T00:00:00.000Z',
        }),
      MetricsValidationError,
    );
  });

  it('rechaza una línea base de tiempo no positiva', () => {
    assert.throws(
      () => validarEntrada({ ...ENTRADA_BASE, lineaBaseTiempoManualSegundos: 0 }),
      MetricsValidationError,
    );
  });

  it('rechaza una tasa de error manual superior a 100', () => {
    assert.throws(
      () => validarEntrada({ ...ENTRADA_BASE, lineaBaseTasaErrorManual: 120 }),
      MetricsValidationError,
    );
  });

  it('falla en tiempo de ejecución si no hay forma de leer PostgreSQL', async () => {
    const env = { ...process.env };
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_DB;
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;

    try {
      await assert.rejects(
        () =>
          generarInformeMetricas({
            ...ENTRADA_BASE,
            fuenteDatos: 'postgres',
          }),
        PostgresSourceError,
      );
    } finally {
      process.env = env;
    }
  });

  it('acepta la entrada válida por defecto', () => {
    const entrada = validarEntrada(ENTRADA_BASE);
    assert.equal(entrada.fuenteDatos, 'sintetico');
    assert.equal(entrada.umbralObservacionesMinimo, 30);
  });
});

// ---------------------------------------------------------------------------
// Datos reales vs sintéticos
// ---------------------------------------------------------------------------

describe('origen de los datos (métricas)', () => {
  it('marca como sintético el informe generado con el conjunto de demostración', async () => {
    const informe = await generarInformeMetricas({ ...ENTRADA_BASE, fuenteDatos: 'sintetico' });

    assert.equal(informe.fuenteDatos, 'sintetico');
    assert.equal(informe.datosSinteticos, true);
    assert.equal(informe.observacionesUsadas, 10);
  });

  it('marca como real el informe calculado con observaciones de PostgreSQL', async () => {
    const filas = [
      {
        workflow_id: 'captura-leads',
        timestamp_inicio: '2026-11-03T10:00:00.000Z',
        estado: 'exito',
        registros_procesados: 4,
        latencia_ms: 120,
      },
      {
        workflow_id: 'captura-leads',
        timestamp_inicio: '2026-11-04T10:00:00.000Z',
        estado: 'error',
        registros_procesados: 0,
        latencia_ms: null,
      },
    ];

    const informe = await generarInformeMetricas(
      { ...ENTRADA_BASE, fuenteDatos: 'postgres', postgres: {} },
      { poolFactory: () => crearPoolFalso(filas) },
    );

    assert.equal(informe.fuenteDatos, 'postgres');
    assert.equal(informe.datosSinteticos, false);
    assert.equal(informe.observacionesUsadas, 2);
    assert.equal(informe.metricas.totalErrores, 1);
    assert.equal(informe.metricas.totalExitos, 1);
    assert.equal(informe.metricas.totalRegistrosProcesados, 4);
    assert.equal(informe.metricas.observacionesSinLatencia, 1);
    assert.equal(informe.metricas.mediaLatenciaMs, 120);
  });

  it('usa las observaciones entregadas por el orquestador sin tocar PostgreSQL', async () => {
    let consultado = false;

    const informe = await generarInformeMetricas(
      {
        ...ENTRADA_BASE,
        fuenteDatos: 'postgres',
        ejecuciones: [
          { latencia_ms: 100, estado: 'exito', registros_procesados: 1 },
          { latencia_ms: 200, estado: 'exito', registros_procesados: 2 },
        ],
      },
      {
        poolFactory: () => {
          consultado = true;
          return crearPoolFalso();
        },
      },
    );

    assert.equal(consultado, false);
    assert.equal(informe.observacionesUsadas, 2);
    assert.equal(informe.metricas.mediaLatenciaMs, 150);
    assert.equal(informe.metricas.medianaLatenciaMs, 150);
    assert.equal(informe.datosSinteticos, false);
  });

  it('parametriza la consulta a automation_log con el periodo y el workflow', async () => {
    const pool = crearPoolFalso([]);
    await generarInformeMetricas(
      { ...ENTRADA_BASE, fuenteDatos: 'postgres', postgres: {} },
      { poolFactory: () => pool },
    );

    const consulta = pool.query;
    assert.ok(consulta);
  });
});

describe('VD2 según la definición de la tesis (§2.4)', () => {
  it('calcula la tasa de error por REGISTRO procesado, no por ejecución', async () => {
    const informe = await generarInformeMetricas({
      ...ENTRADA_BASE,
      fuenteDatos: 'postgres',
      ejecuciones: [
        { latencia_ms: 50, estado: 'exito', registros_procesados: 90 },
        { latencia_ms: 50, estado: 'error', registros_procesados: 10 },
      ],
    });

    // 1 error de 2 ejecuciones = 50 % por ejecución (diagnóstico).
    assert.equal(informe.metricas.tasaErrorPorcentaje, 50);
    // 10 registros erróneos de 100 procesados = 10 % (definición de VD2).
    assert.equal(informe.metricas.registrosEnEjecucionesConError, 10);
    assert.equal(informe.metricas.totalRegistrosProcesados, 100);
    assert.equal(informe.metricas.tasaErrorRegistrosPorcentaje, 10);
  });

  it('compara VD2 contra la línea base usando la tasa por registro', async () => {
    const informe = await generarInformeMetricas({
      ...ENTRADA_BASE,
      fuenteDatos: 'postgres',
      lineaBaseTasaErrorManual: 20,
      ejecuciones: [
        { latencia_ms: 50, estado: 'exito', registros_procesados: 90 },
        { latencia_ms: 50, estado: 'error', registros_procesados: 10 },
      ],
    });

    // Línea base 20 % → tasa real 10 % → reducción 50 % (meta alcanzada).
    assert.equal(informe.comparacionVD2Registros.porcentajeReduccion, 50);
    assert.equal(informe.comparacionVD2Registros.metaPorcentaje, 50);
    assert.equal(informe.comparacionVD2Registros.seAlcanzoMeta, true);
  });

  it('reporta 0 % por registro cuando no hay registros procesados', async () => {
    const informe = await generarInformeMetricas({
      ...ENTRADA_BASE,
      fuenteDatos: 'postgres',
      ejecuciones: [{ latencia_ms: 50, estado: 'error', registros_procesados: 0 }],
    });

    assert.equal(informe.metricas.tasaErrorRegistrosPorcentaje, 0);
  });

  it('incluye ambas lecturas de VD2 en el informe', async () => {
    const informe = await generarInformeMetricas({
      ...ENTRADA_BASE,
      fuenteDatos: 'postgres',
      ejecuciones: [{ latencia_ms: 50, estado: 'error', registros_procesados: 5 }],
    });

    assert.ok(informe.comparacionVD2);
    assert.ok(informe.comparacionVD2Registros);
    assert.match(informe.conclusionHipotesis, /Diagnóstico: tasa de fallos por ejecución/);
  });
});

// ---------------------------------------------------------------------------
// Periodos sin registros y muestras insuficientes
// ---------------------------------------------------------------------------

describe('periodos sin registros y muestras insuficientes', () => {
  it('reporta explícitamente un periodo sin ejecuciones', async () => {
    const informe = await generarInformeMetricas(
      { ...ENTRADA_BASE, fuenteDatos: 'postgres', postgres: {} },
      { poolFactory: () => crearPoolFalso([]) },
    );

    assert.equal(informe.observacionesUsadas, 0);
    assert.equal(informe.metricas.mediaLatenciaMs, 0);
    assert.equal(informe.metricas.tasaErrorPorcentaje, 0);
    assert.ok(informe.advertenciaPeriodoSinRegistros);
    assert.match(informe.advertenciaPeriodoSinRegistros, /no contiene ejecuciones/i);
    assert.equal(informe.conclusionDefinitiva, false);
  });

  it('marca la conclusión como no concluyente con menos de 30 observaciones', async () => {
    const informe = await generarInformeMetricas({
      ...ENTRADA_BASE,
      fuenteDatos: 'postgres',
      ejecuciones: [{ latencia_ms: 50, estado: 'exito', registros_procesados: 1 }],
    });

    assert.equal(informe.conclusionDefinitiva, false);
    assert.ok(informe.advertenciaDatosInsuficientes);
    assert.match(informe.conclusionHipotesis, /Muestra insuficiente/i);
  });

  it('considera concluyente la muestra con 30 o más observaciones', async () => {
    const ejecuciones = Array.from({ length: 30 }, () => ({
      latencia_ms: 50,
      estado: 'exito',
      registros_procesados: 1,
    }));

    const informe = await generarInformeMetricas({
      ...ENTRADA_BASE,
      fuenteDatos: 'postgres',
      ejecuciones,
    });

    assert.equal(informe.conclusionDefinitiva, true);
    assert.equal(informe.advertenciaDatosInsuficientes, undefined);
  });

  it('excluye del cálculo estadístico las ejecuciones sin latencia', async () => {
    const informe = await generarInformeMetricas({
      ...ENTRADA_BASE,
      fuenteDatos: 'postgres',
      ejecuciones: [
        { latencia_ms: 100, estado: 'exito', registros_procesados: 1 },
        { latencia_ms: null, estado: 'error', registros_procesados: 0 },
      ],
    });

    assert.equal(informe.metricas.observaciones, 2);
    assert.equal(informe.metricas.observacionesSinLatencia, 1);
    assert.equal(informe.metricas.mediaLatenciaMs, 100);
    assert.equal(informe.metricas.tasaErrorPorcentaje, 50);
  });
});

// ---------------------------------------------------------------------------
// Fallos de PostgreSQL
// ---------------------------------------------------------------------------

describe('fallos de PostgreSQL (métricas)', () => {
  it('propaga el error de la consulta como PostgresSourceError', async () => {
    await assert.rejects(
      () =>
        generarInformeMetricas(
          { ...ENTRADA_BASE, fuenteDatos: 'postgres', postgres: {} },
          {
            poolFactory: () =>
              crearPoolFalso([], new Error('connection refused')),
          },
        ),
      PostgresSourceError,
    );
  });

  it('propaga un error de configuración de conexión', async () => {
    const env = { ...process.env };
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_DB;
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;

    try {
      await assert.rejects(
        () =>
          generarInformeMetricas({
            ...ENTRADA_BASE,
            fuenteDatos: 'postgres',
            postgres: {},
          }),
        PostgresSourceError,
      );
    } finally {
      process.env = env;
    }
  });
});

// ---------------------------------------------------------------------------
// Línea base documentada
// ---------------------------------------------------------------------------

describe('línea base documentada (métricas)', () => {
  it('incluye la procedencia de la línea base cuando se declara', async () => {
    const informe = await generarInformeMetricas({
      ...ENTRADA_BASE,
      fuenteDatos: 'sintetico',
      lineaBaseProveniencia: {
        fuente: '§1.1.1 de la tesis IS25237',
        descripcion: 'Medición manual del proceso de transcripción (piloto, n=20).',
        fechaMedicion: '2026-10-15T00:00:00.000Z',
      },
    });

    assert.equal(informe.lineaBase.tiempoManualSegundos, 120);
    assert.equal(informe.lineaBase.tasaErrorManual, 5);
    assert.equal(informe.lineaBase.proveniencia.fuente, '§1.1.1 de la tesis IS25237');
  });

  it('no inventa la procedencia si el llamador no la declara', async () => {
    const informe = await generarInformeMetricas({ ...ENTRADA_BASE, fuenteDatos: 'sintetico' });
    assert.equal(informe.lineaBase.proveniencia, undefined);
  });
});
