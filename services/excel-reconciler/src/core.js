/**
 * @fileoverview Núcleo de negocio reutilizable para conciliación financiera.
 * Exporta `processPayload` para uso tanto en CLI como en servidor HTTP.
 * Sin efectos de lado: no usa process.exit, no escribe en stdout/stderr.
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { N8nPayloadSchema } from './schemas.js';
import { createGraphClient, GraphAuthError, GraphApiError, ResourceNotFoundError } from './graphClient.js';

// Re-export error classes from graphClient for CLI compatibility
export { GraphAuthError, GraphApiError, ResourceNotFoundError };
import { reconcile, ReconciliationStatus } from './reconciler.js';

// ---------------------------------------------------------------------------
// Errores de nivel de aplicación (tipados para manejo en HTTP)
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  constructor(message, zodErrors = null) {
    super(message);
    this.name = 'ValidationError';
    this.zodErrors = zodErrors;
  }
}

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class ReconciliationError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'ReconciliationError';
    this.cause = cause;
  }
}

export class ExcelWriteError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'ExcelWriteError';
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Verificación de variables de entorno
// ---------------------------------------------------------------------------

/**
 * Carga y valida la configuración desde variables de entorno.
 * @returns {{ clientId: string, clientSecret: string, tenantId: string }}
 * @throws {ConfigurationError}
 */
export function loadEnvConfig() {
  const required = {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    tenantId: process.env.MICROSOFT_TENANT_ID,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => {
      const envMap = {
        clientId: 'MICROSOFT_CLIENT_ID',
        clientSecret: 'MICROSOFT_CLIENT_SECRET',
        tenantId: 'MICROSOFT_TENANT_ID',
      };
      return envMap[key];
    });

  if (missing.length > 0) {
    throw new ConfigurationError(
      `Variables de entorno faltantes: ${missing.join(', ')}. ` +
      'Configúralas en el archivo .env o en las variables del entorno del VPS.',
    );
  }

  return required;
}

// ---------------------------------------------------------------------------
// Escritura de resultados de vuelta al Excel
// ---------------------------------------------------------------------------

function indexToColumnLetter(index) {
  let result = '';
  let n = index;
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

/**
 * Escribe resultados de conciliación de vuelta al Excel en OneDrive.
 * @param {object} graphClient
 * @param {object} payload
 * @param {object} reconciliationResult
 * @param {string[]} excelHeaders
 * @returns {Promise<void>}
 * @throws {ExcelWriteError}
 */
export async function writeResultsToExcel(graphClient, payload, reconciliationResult, excelHeaders) {
  const { driveItemId, worksheetName, tableName } = payload.excelTarget;
  const { actualizarDiscrepancias, crearFaltantes } = payload.opciones;

  const estadoColIndex = excelHeaders.indexOf('Estado');
  const notasColIndex = excelHeaders.indexOf('Notas');

  if (actualizarDiscrepancias) {
    const discrepancias = reconciliationResult.resultados.filter(
      (r) => r.status === ReconciliationStatus.DISCREPANCIA,
    );

    for (const record of discrepancias) {
      if (!record.excelRowIndex) continue;

      const notaDiscrepancia =
        `DISCREPANCIA DETECTADA [${new Date().toLocaleDateString('es-CO')}]: ` +
        record.discrepancias
          .map((d) => `${d.campo}: Excel="${d.valorExcel}" vs n8n="${d.valorN8n}"`)
          .join(' | ');

      if (estadoColIndex >= 0) {
        const colLetter = indexToColumnLetter(estadoColIndex);
        const address = `${colLetter}${record.excelRowIndex}`;
        await graphClient.updateRange(driveItemId, worksheetName, address, [
          ['DISCREPANCIA'],
        ]);
      }

      if (notasColIndex >= 0) {
        const colLetter = indexToColumnLetter(notasColIndex);
        const address = `${colLetter}${record.excelRowIndex}`;
        await graphClient.updateRange(driveItemId, worksheetName, address, [
          [notaDiscrepancia],
        ]);
      }
    }
  }

  if (crearFaltantes && tableName) {
    const soloEnN8n = reconciliationResult.resultados.filter(
      (r) => r.status === ReconciliationStatus.SOLO_EN_N8N,
    );

    if (soloEnN8n.length > 0) {
      const newRows = soloEnN8n.map((record) => {
        const txn = record.transaccionN8n;
        return excelHeaders.map((header) => {
          const mapping = {
            'ID_Transaccion': txn?.id,
            'Fecha': txn?.fecha,
            'Ticker': txn?.ticker,
            'Tipo_Activo': txn?.tipoActivo,
            'Operacion': txn?.operacion,
            'Cantidad': txn?.cantidad,
            'Precio_Unitario': txn?.precioUnitario,
            'Valor_Bruto': txn?.valorBruto,
            'Comisiones': txn?.comisiones,
            'Impuestos': txn?.impuestos,
            'Valor_Neto': txn?.valorNeto,
            'Moneda': txn?.moneda ?? 'COP',
            'Estado': txn?.estado,
            'Corredor': txn?.corredor,
            'Referencia_Externa': txn?.referenciaExterna ?? '',
            'Notas': `INSERTADO AUTOMÁTICAMENTE [${new Date().toLocaleDateString('es-CO')}]`,
          };
          return mapping[header] ?? '';
        });
      });

      await graphClient.appendRowsToTable(driveItemId, worksheetName, tableName, newRows);
    }
  }
}

// ---------------------------------------------------------------------------
// Función principal reutilizable
// ---------------------------------------------------------------------------

/**
 * Procesa un payload de conciliación y devuelve el resultado estructurado.
 * No hace process.exit, no escribe en stdout/stderr.
 * Lanza errores tipados para que el llamador decida cómo manejarlos.
 *
 * @param {object} rawPayload - Payload JSON crudo (sin validar)
 * @param {object} [envConfig] - Configuración opcional (si no se pasa, se lee de process.env)
 * @returns {Promise<object>} - Resultado estructurado: { exitoso: true, ... }
 * @throws {ValidationError} - Payload inválido (Zod)
 * @throws {ConfigurationError} - Variables de entorno faltantes
 * @throws {GraphAuthError} - Error de autenticación con Azure AD
 * @throws {ResourceNotFoundError} - Archivo/hoja Excel no encontrado
 * @throws {GraphApiError} - Error de Graph API
 * @throws {ReconciliationError} - Error en motor de conciliación
 * @throws {ExcelWriteError} - Error escribiendo en Excel (no fatal, se adjunta advertencia)
 */
export async function processPayload(rawPayload, envConfig) {
  // 1. Cargar configuración
  const config = envConfig ?? loadEnvConfig();

  // 2. Validar payload con Zod
  const parseResult = N8nPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    const zodErrors = parseResult.error.flatten();
    throw new ValidationError(
      `El payload no cumple el schema esperado. ` +
      `Campos inválidos: ${Object.keys(zodErrors.fieldErrors).join(', ')}. ` +
      `Verifica la versión del schema (schemaVersion en metadata).`,
      zodErrors,
    );
  }

  const payload = parseResult.data;
  const { driveItemId, worksheetName } = payload.excelTarget;

  // 3. Crear cliente Graph
  const graphClient = createGraphClient(config);

  // 4. Leer Excel de OneDrive
  let excelData;
  try {
    excelData = await graphClient.readWorksheetData(driveItemId, worksheetName);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw new ResourceNotFoundError(
        `No se encontró el archivo Excel en OneDrive (DriveItemId: ${driveItemId}). ` +
        `Verifica que el ID sea correcto y que la App tenga permiso Files.ReadWrite.All.`,
      );
    }
    if (error instanceof GraphAuthError) {
      throw error;
    }
    throw new GraphApiError(
      `Error al leer el Excel de OneDrive: ${error.message}`,
      error.statusCode ?? 0,
      error.graphError ?? null,
      error,
    );
  }

  // 5. Ejecutar motor de conciliación
  let reconciliationResult;
  try {
    reconciliationResult = reconcile(
      payload.transacciones,
      excelData.headers,
      excelData.rows,
      payload.opciones,
    );
  } catch (error) {
    throw new ReconciliationError(
      `Error interno en el motor de conciliación: ${error.message}`,
      error,
    );
  }

  // 6. (Opcional) Escribir resultados de vuelta al Excel
  if (payload.opciones.actualizarDiscrepancias || payload.opciones.crearFaltantes) {
    try {
      await writeResultsToExcel(
        graphClient,
        payload,
        reconciliationResult,
        excelData.headers,
      );
    } catch (error) {
      // Error no fatal: adjuntar advertencia al resultado
      reconciliationResult.advertencias = reconciliationResult.advertencias ?? [];
      reconciliationResult.advertencias.push({
        tipo: 'ESCRITURA_EXCEL_FALLIDA',
        mensaje: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 7. Devolver resultado estructurado
  return {
    exitoso: true,
    procesoMetadata: {
      workflowId: payload.metadata.workflowId,
      executionId: payload.metadata.executionId,
      fuente: payload.metadata.fuente,
      driveItemId,
      worksheetName,
    },
    ...reconciliationResult,
  };
}

// ---------------------------------------------------------------------------
// Helpers para serialización de errores (útil en CLI y HTTP)
// ---------------------------------------------------------------------------

/**
 * Serializa un error para respuesta HTTP/CLI.
 * @param {Error} error
 * @returns {object}
 */
export function serializeError(error) {
  const errorType = error.name ?? 'Error';
  const message = error.message ?? String(error);

  let statusCode = 500;
  if (error instanceof ValidationError) statusCode = 400;
  else if (error instanceof ConfigurationError) statusCode = 500;
  else if (error instanceof ResourceNotFoundError) statusCode = 404;
  else if (error instanceof GraphAuthError) statusCode = 502;
  else if (error instanceof GraphApiError) statusCode = 502;
  else if (error instanceof ReconciliationError) statusCode = 500;
  else if (error instanceof ExcelWriteError) statusCode = 500;

  return {
    exitoso: false,
    timestamp: new Date().toISOString(),
    error: {
      tipo: errorType,
      mensaje: message,
      ...(process.env.NODE_ENV === 'development' && error.stack ? { stack: error.stack } : {}),
    },
    statusCode,
  };
}

/**
 * Serializa resultado exitoso para respuesta HTTP/CLI.
 * @param {object} data
 * @returns {object}
 */
export function serializeSuccess(data) {
  return {
    exitoso: true,
    timestamp: new Date().toISOString(),
    ...data,
  };
}