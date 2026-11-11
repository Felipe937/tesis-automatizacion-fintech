/**
 * @fileoverview Núcleo reutilizable del componente de dashboard ejecutivo.
 *
 * Resuelve el origen de los datos (MER en PostgreSQL o conjunto sintético),
 * calcula los cuatro bloques de §4.4 y devuelve un informe JSON estable y
 * validado con Zod. Lo usan el CLI (`src/index.js`) y el servidor HTTP
 * (`src/server.js`), de modo que ambos caminos producen el mismo informe.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { DashboardInputSchema, DashboardOutputSchema } from './schemas.js';
import { generarDashboard } from './dashboard.js';
import { generarDatosSinteticos } from './syntheticData.js';
import {
  crearPool,
  consultarDatosDashboard,
  cerrarPool,
  PostgresSourceError,
} from './postgresSource.js';

/**
 * Error de validación de la entrada del componente.
 */
export class DashboardValidationError extends Error {
  /**
   * @param {string} message - Descripción del error
   * @param {object} [detalles] - Detalle de campos inválidos
   */
  constructor(message, detalles = null) {
    super(message);
    this.name = 'DashboardValidationError';
    this.detalles = detalles;
  }
}

/**
 * Error al escribir el informe en OneDrive.
 */
export class DashboardExcelError extends Error {
  /**
   * @param {string} message - Descripción del error
   * @param {Error} [cause] - Error original
   */
  constructor(message, cause = null) {
    super(message);
    this.name = 'DashboardExcelError';
    this.cause = cause;
  }
}

/**
 * Valida y normaliza la entrada del componente.
 *
 * Compatibilidad: `datosSinteticos` (campo antiguo) se traduce a `fuenteDatos`
 * cuando este último no fue indicado de forma explícita.
 *
 * @param {object} entrada - Payload crudo
 * @returns {object} Entrada validada
 * @throws {DashboardValidationError} Si la entrada no cumple el esquema
 */
export function validarEntrada(entrada) {
  const normalizada = { ...entrada };

  if (
    normalizada.fuenteDatos === undefined &&
    typeof normalizada.datosSinteticos === 'boolean'
  ) {
    normalizada.fuenteDatos = normalizada.datosSinteticos ? 'sintetico' : 'postgres';
  }

  const resultado = DashboardInputSchema.safeParse(normalizada);
  if (!resultado.success) {
    const errores = resultado.error.flatten();
    throw new DashboardValidationError(
      `La entrada no cumple el contrato del componente de dashboard. ` +
        `Campos inválidos: ${Object.keys(errores.fieldErrors).join(', ') || 'raíz'}.`,
      errores,
    );
  }
  return resultado.data;
}

/**
 * Resuelve el conjunto de datos del dashboard según el origen declarado.
 *
 * @param {object} input - Entrada ya validada
 * @param {object} [deps] - Dependencias inyectables (para pruebas)
 * @returns {Promise<object>} Datos listos para el cálculo
 */
async function resolverDatos(input, deps = {}) {
  if (input.fuenteDatos === 'sintetico') {
    return { ...generarDatosSinteticos(), ejecuciones: [], resumenAutomatizaciones: null };
  }

  const hayDatosPrecargados =
    input.leads !== undefined &&
    input.campanas !== undefined &&
    input.citas !== undefined &&
    input.inversiones !== undefined;

  if (hayDatosPrecargados) {
    return {
      leads: input.leads,
      campanas: input.campanas,
      metricasCampanas: input.metricasCampanas ?? [],
      citas: input.citas,
      inversiones: input.inversiones,
      ejecuciones: [],
      resumenAutomatizaciones: null,
    };
  }

  const consultar = deps.consultar ?? consultarDatosDashboard;
  const poolFactory = deps.poolFactory ?? crearPool;
  const pool = poolFactory(input.postgres ?? {});

  try {
    return await consultar({
      pool,
      schema: input.postgres?.schema ?? 'public',
      periodoInicio: input.periodoInicio,
      periodoFin: input.periodoFin,
    });
  } finally {
    // El pool se cierra sólo si lo creó el propio servicio: un pool inyectado
    // pertenece a quien lo inyectó (pruebas de integración).
    if (!deps.poolFactory) {
      await cerrarPool(pool);
    }
  }
}

/**
 * Genera el informe completo del dashboard a partir de la entrada.
 *
 * @param {object} entrada - Payload crudo
 * @param {object} [deps] - Dependencias inyectables (para pruebas)
 * @returns {Promise<object>} Informe del dashboard validado
 * @throws {DashboardValidationError} Si la entrada es inválida
 * @throws {PostgresSourceError} Si falla la consulta a PostgreSQL
 */
export async function generarDashboardDesdeEntrada(entrada, deps = {}) {
  const input = validarEntrada(entrada);
  const datos = await resolverDatos(input, deps);

  const dashboard = generarDashboard({
    workflowId: input.workflowId,
    periodoInicio: input.periodoInicio,
    periodoFin: input.periodoFin,
    leads: datos.leads ?? [],
    campañas: datos.campanas ?? [],
    metricasCampañas: datos.metricasCampanas ?? [],
    citas: datos.citas ?? [],
    inversiones: datos.inversiones ?? [],
    ejecuciones: datos.ejecuciones ?? [],
    fechaActual: deps.fechaActual ?? new Date().toISOString(),
    fuenteDatos: input.fuenteDatos,
    resumenAutomatizaciones: datos.resumenAutomatizaciones ?? null,
  });

  return DashboardOutputSchema.parse(dashboard);
}

/**
 * Genera el informe y lo escribe en el libro Excel de OneDrive.
 *
 * @param {object} entrada - Payload crudo
 * @param {object} deps - Dependencias inyectables (para pruebas)
 * @param {object} deps.graphClient - Cliente Graph (obligatorio)
 * @returns {Promise<{dashboard: object, excel: object|null}>} Resultado
 * @throws {DashboardExcelError} Si la escritura en OneDrive falla
 */
export async function generarDashboardYActualizarExcel(entrada, deps = {}) {
  const dashboard = await generarDashboardDesdeEntrada(entrada, deps);
  const input = validarEntrada(entrada);

  if (!input.actualizarExcel || !input.excelDriveItemId) {
    return { dashboard, excel: null };
  }

  if (!deps.graphClient) {
    throw new DashboardExcelError(
      'Se solicitó actualizar Excel pero no se proporcionó un cliente Graph válido.',
    );
  }

  const { escribirDashboardEnExcel } = await import('./excelWriter.js');

  try {
    const excel = await escribirDashboardEnExcel(deps.graphClient, {
      driveItemId: input.excelDriveItemId,
      worksheetName: input.excelWorksheetName,
      dashboard,
    });
    return { dashboard, excel };
  } catch (error) {
    throw new DashboardExcelError(
      `No se pudo escribir el dashboard en OneDrive: ${error.message}`,
      error,
    );
  }
}
