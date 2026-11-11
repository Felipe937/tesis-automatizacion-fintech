/**
 * @fileoverview Núcleo reutilizable del componente de métricas.
 *
 * Resuelve el origen de los datos (PostgreSQL real o conjunto sintético),
 * calcula los indicadores VD1/VD2 y devuelve un informe JSON estable y
 * validado con Zod.
 *
 * Lo usan tanto el CLI (`src/index.js`) como el servidor HTTP (`src/server.js`),
 * de modo que ambos caminos producen exactamente el mismo informe.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import {
  MetricsInputSchema,
  MetricsReportSchema,
} from './schemas.js';
import { calcularMetricasWorkflow } from './calculator.js';
import { obtenerEjecucionesSinteticas } from './syntheticData.js';
import {
  crearPool,
  consultarEjecutions,
  cerrarPool,
  PostgresSourceError,
} from './postgresSource.js';

/**
 * Error de validación de la entrada del componente.
 */
export class MetricsValidationError extends Error {
  /**
   * @param {string} message - Descripción del error
   * @param {object} [detalles] - Detalle de campos inválidos
   */
  constructor(message, detalles = null) {
    super(message);
    this.name = 'MetricsValidationError';
    this.detalles = detalles;
  }
}

/**
 * Valida y normaliza la entrada del componente.
 *
 * @param {object} entrada - Payload crudo
 * @returns {object} Entrada validada (tipada por MetricsInputSchema)
 * @throws {MetricsValidationError} Si la entrada no cumple el esquema
 */
export function validarEntrada(entrada) {
  const resultado = MetricsInputSchema.safeParse(entrada);
  if (!resultado.success) {
    const errores = resultado.error.flatten();
    throw new MetricsValidationError(
      `La entrada no cumple el contrato del componente de métricas. ` +
        `Campos inválidos: ${Object.keys(errores.fieldErrors).join(', ') || 'raíz'}.`,
      errores,
    );
  }
  return resultado.data;
}

/**
 * Construye el informe de métricas a partir de observaciones ya resueltas.
 *
 * @param {object} params - Parámetros
 * @param {object} params.input - Entrada ya validada
 * @param {Array<object>} params.ejecuciones - Observaciones a analizar
 * @param {'postgres'|'sintetico'} params.fuenteDatos - Origen de las observaciones
 * @returns {object} Informe de métricas validado
 */
export function construirInforme({ input, ejecuciones, fuenteDatos }) {
  const lineasBase = {
    tiempoManualSegundos: input.lineaBaseTiempoManualSegundos,
    tasaErrorManual: input.lineaBaseTasaErrorManual,
    umbralObservacionesMinimo: input.umbralObservacionesMinimo,
  };

  const resultado = calcularMetricasWorkflow(ejecuciones, lineasBase);

  const informe = {
    periodo: {
      inicio: input.periodoInicio,
      fin: input.periodoFin,
    },
    workflowId: input.workflowId,
    metricas: resultado.metricas,
    comparacionVD1: resultado.comparacionVD1,
    comparacionVD2: resultado.comparacionVD2,
    comparacionVD2Registros: resultado.comparacionVD2Registros,
    lineaBase: {
      ...lineasBase,
      ...(input.lineaBaseProveniencia
        ? { proveniencia: input.lineaBaseProveniencia }
        : {}),
    },
    observacionesUsadas: resultado.observacionesUsadas,
    conclusionHipotesis: resultado.conclusionHipotesis,
    conclusionDefinitiva: resultado.conclusionDefinitiva,
    fuenteDatos,
    datosSinteticos: fuenteDatos === 'sintetico',
    ...(resultado.advertenciaDatosInsuficientes
      ? { advertenciaDatosInsuficientes: resultado.advertenciaDatosInsuficientes }
      : {}),
    ...(resultado.advertenciaPeriodoSinRegistros
      ? { advertenciaPeriodoSinRegistros: resultado.advertenciaPeriodoSinRegistros }
      : {}),
  };

  // El informe se valida contra el esquema de salida: la interfaz JSON es
  // estable para n8n y para el informe final de la tesis.
  return MetricsReportSchema.parse(informe);
}

/**
 * Punto de entrada del componente: valida, resuelve los datos y calcula.
 *
 * @param {object} entrada - Payload crudo
 * @param {object} [deps] - Dependencias inyectables (para pruebas)
 * @param {Function} [deps.poolFactory] - Fábrica de pools de PostgreSQL
 * @param {Function} [deps.consultar] - Función de consulta a automation_log
 * @returns {Promise<object>} Informe de métricas validado
 * @throws {MetricsValidationError} Si la entrada es inválida
 * @throws {PostgresSourceError} Si falla la consulta a PostgreSQL
 */
export async function generarInformeMetricas(entrada, deps = {}) {
  const input = validarEntrada(entrada);

  const consultar = deps.consultar ?? consultarEjecutions;
  const poolFactory = deps.poolFactory ?? crearPool;

  let ejecuciones;
  let fuenteDatos = input.fuenteDatos;

  if (input.fuenteDatos === 'sintetico') {
    ejecuciones = obtenerEjecucionesSinteticas();
    fuenteDatos = 'sintetico';
  } else if (Array.isArray(input.ejecuciones)) {
    // Observaciones reales entregadas por el orquestador.
    // Un arreglo vacío es válido: significa "el periodo no tiene ejecuciones".
    ejecuciones = input.ejecuciones;
    fuenteDatos = 'postgres';
  } else {
    // Consulta directa a automation_log.
    // El pool se cierra sólo si lo creó el propio servicio: un pool inyectado
    // pertenece a quien lo inyectó (pruebas de integración).
    const pool = poolFactory(input.postgres ?? {});
    try {
      ejecuciones = await consultar({
        pool,
        schema: input.postgres?.schema ?? 'public',
        periodoInicio: input.periodoInicio,
        periodoFin: input.periodoFin,
        workflowId: input.workflowId,
      });
    } finally {
      if (!deps.poolFactory) {
        await cerrarPool(pool);
      }
    }
    fuenteDatos = 'postgres';
  }

  return construirInforme({ input, ejecuciones, fuenteDatos });
}
