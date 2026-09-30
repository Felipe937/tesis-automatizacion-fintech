/**
 * @fileoverview Punto de entrada principal del servicio de conciliación financiera.
 *
 * Orquesta el flujo completo:
 *   1. Leer y validar el payload JSON de n8n (stdin o archivo)
 *   2. Obtener token OAuth2 y conectarse a Microsoft Graph API
 *   3. Leer la hoja de cálculo de Excel en OneDrive
 *   4. Ejecutar el motor de conciliación financiera
 *   5. (Opcional) Escribir resultados de vuelta al Excel
 *   6. Emitir el resultado consolidado en stdout (para que n8n lo capture)
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 *
 * Uso desde n8n (nodo "Execute Command"):
 *   echo '<payload_json>' | node src/index.js
 *
 * Uso con archivo de payload:
 *   node src/index.js --payload ./fixtures/sample-payload.json
 *
 * Variables de entorno requeridas:
 *   MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { N8nPayloadSchema } from './schemas.js';
import { createGraphClient, GraphAuthError, GraphApiError, ResourceNotFoundError } from './graphClient.js';
import { reconcile, ReconciliationStatus } from './reconciler.js';

// ---------------------------------------------------------------------------
// Errores de nivel de aplicación (para distinguir categorías en la respuesta)
// ---------------------------------------------------------------------------

class ValidationError extends Error {
  constructor(message, zodErrors) {
    super(message);
    this.name = 'ValidationError';
    this.zodErrors = zodErrors;
  }
}

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// ---------------------------------------------------------------------------
// Lectura del payload de entrada
// ---------------------------------------------------------------------------

/**
 * Lee el payload JSON desde stdin (modo pipe, para uso con n8n) o desde
 * un archivo cuando se pasa el flag --payload <ruta>.
 *
 * Usar stdin como canal de datos evita exponer información sensible en los
 * argumentos del proceso (visibles en `ps aux`).
 *
 * @returns {Promise<object>} - Payload parseado como objeto JavaScript
 * @throws {ValidationError}  - Si el JSON está malformado o no se recibe nada
 */
async function readPayload() {
  const args = process.argv.slice(2);
  const payloadFlagIndex = args.indexOf('--payload');

  // Modo archivo: útil para desarrollo y testing local
  if (payloadFlagIndex !== -1 && args[payloadFlagIndex + 1]) {
    const filePath = args[payloadFlagIndex + 1];
    try {
      const raw = readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (error) {
      throw new ValidationError(
        `No se pudo leer el archivo de payload "${filePath}": ${error.message}`,
        null,
      );
    }
  }

  // Modo stdin: producción (n8n pipe → este proceso)
  return new Promise((resolve, reject) => {
    // Si stdin no es un pipe (terminal interactiva), no esperar indefinidamente
    if (process.stdin.isTTY) {
      reject(
        new ValidationError(
          'No se recibió payload. Usa pipe o el flag --payload <archivo>.\n' +
          'Ejemplo: echo \'{"metadata":...}\' | node src/index.js\n' +
          'Ejemplo: node src/index.js --payload ./fixtures/sample-payload.json',
          null,
        ),
      );
      return;
    }

    let raw = '';
    const rl = createInterface({ input: process.stdin });

    rl.on('line', (line) => { raw += line; });
    rl.on('close', () => {
      if (!raw.trim()) {
        reject(new ValidationError('El payload recibido está vacío.', null));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(
          new ValidationError(
            `El payload no es JSON válido: ${error.message}. ` +
            'Verifica que el nodo de n8n esté formateando correctamente el JSON de salida.',
            null,
          ),
        );
      }
    });

    rl.on('error', (error) => {
      reject(new ValidationError(`Error leyendo stdin: ${error.message}`, null));
    });
  });
}

// ---------------------------------------------------------------------------
// Verificación de variables de entorno
// ---------------------------------------------------------------------------

/**
 * Valida que todas las variables de entorno requeridas estén presentes.
 * Falla explícitamente al inicio (fail-fast) en lugar de errores crípticos
 * al hacer la primera llamada a Graph API.
 *
 * @returns {{ clientId: string, clientSecret: string, tenantId: string }}
 * @throws {ConfigurationError} - Si alguna variable está ausente
 */
function loadAndValidateEnvConfig() {
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
      'Configúralas en el archivo .env o en las variables del entorno del VPS. ' +
      'Para obtener estos valores, ve a portal.azure.com → Azure Active Directory → App registrations.',
    );
  }

  return required;
}

// ---------------------------------------------------------------------------
// Escritura de resultados de vuelta al Excel (modo actualización)
// ---------------------------------------------------------------------------

/**
 * Escribe los resultados de la conciliación de vuelta al Excel en OneDrive.
 * Actualiza una columna "Estado_Conciliacion" y agrega filas faltantes.
 *
 * Esta función sólo se ejecuta si `opciones.actualizarDiscrepancias === true`
 * o `opciones.crearFaltantes === true` en el payload.
 *
 * @param {object}   graphClient       - Instancia del cliente Graph
 * @param {object}   payload           - Payload validado de n8n
 * @param {object}   reconciliationResult - Resultado del motor de conciliación
 * @param {string[]} excelHeaders      - Headers del Excel (para construir rangos)
 */
async function writeResultsToExcel(graphClient, payload, reconciliationResult, excelHeaders) {
  const { driveItemId, worksheetName, tableName } = payload.excelTarget;
  const { actualizarDiscrepancias, crearFaltantes } = payload.opciones;

  // Índice de la columna Estado en el Excel (para actualización inline)
  const estadoColIndex = excelHeaders.indexOf('Estado');
  const notasColIndex = excelHeaders.indexOf('Notas');

  if (actualizarDiscrepancias) {
    const discrepancias = reconciliationResult.resultados.filter(
      (r) => r.status === ReconciliationStatus.DISCREPANCIA,
    );

    for (const record of discrepancias) {
      if (!record.excelRowIndex) continue;

      // Construir nota de discrepancia legible
      const notaDiscrepancia =
        `DISCREPANCIA DETECTADA [${new Date().toLocaleDateString('es-CO')}]: ` +
        record.discrepancias
          .map((d) => `${d.campo}: Excel="${d.valorExcel}" vs n8n="${d.valorN8n}"`)
          .join(' | ');

      // Actualizar celdas de Estado y Notas en la fila con discrepancia
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

    console.log(`[Index] ${discrepancias.length} discrepancias marcadas en Excel.`);
  }

  if (crearFaltantes && tableName) {
    const soloEnN8n = reconciliationResult.resultados.filter(
      (r) => r.status === ReconciliationStatus.SOLO_EN_N8N,
    );

    if (soloEnN8n.length > 0) {
      // Construir filas para insertar (en el orden de los headers del Excel)
      const newRows = soloEnN8n.map((record) => {
        const txn = record.transaccionN8n;
        // Mapear al orden de columnas del Excel
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
      console.log(`[Index] ${newRows.length} transacciones nuevas insertadas en Excel.`);
    }
  }
}

/**
 * Convierte un índice de columna (0-based) a letra(s) Excel (A, B, ..., Z, AA, AB, ...).
 *
 * @param {number} index - Índice 0-based de la columna
 * @returns {string}     - Letra(s) de columna Excel
 */
function indexToColumnLetter(index) {
  let result = '';
  let n = index;
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

// ---------------------------------------------------------------------------
// Serialización de respuesta para n8n
// ---------------------------------------------------------------------------

/**
 * Serializa el resultado final para emisión en stdout.
 * n8n captura stdout del comando y lo parsea como JSON.
 *
 * @param {boolean} exitoso     - Si el proceso completó sin errores fatales
 * @param {object}  data        - Datos del resultado
 * @param {string}  [errorMsg]  - Mensaje de error si no fue exitoso
 * @param {string}  [errorType] - Tipo de error para clasificación en n8n
 */
function emitResult(exitoso, data, errorMsg = null, errorType = null) {
  const output = {
    exitoso,
    timestamp: new Date().toISOString(),
    ...(exitoso ? data : {
      error: {
        tipo: errorType,
        mensaje: errorMsg,
        // Stack en modo debug para facilitar resolución de problemas
        stack: process.env.NODE_ENV === 'development'
          ? data?.stack
          : undefined,
      },
    }),
  };

  // Emitir en stdout (n8n lo captura). Usar JSON.stringify con indentación
  // para facilitar lectura en el panel de n8n durante desarrollo.
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Función principal orquestadora
// ---------------------------------------------------------------------------

async function main() {
  console.error('[Index] Servicio de Conciliación Financiera — n8n/Excel'); // stderr no interfiere con n8n
  console.error('[Index] Tesis Automatización Fintech — Colombia | MIT License');

  // PASO 1: Verificación de configuración (fail-fast)
  let envConfig;
  try {
    envConfig = loadAndValidateEnvConfig();
  } catch (error) {
    emitResult(false, error, error.message, 'ConfigurationError');
    process.exit(1);
  }

  // PASO 2: Leer el payload desde stdin o archivo
  let rawPayload;
  try {
    rawPayload = await readPayload();
  } catch (error) {
    emitResult(false, error, error.message, error.name);
    process.exit(1);
  }

  // PASO 3: Validar payload con Zod (contrato con n8n)
  const parseResult = N8nPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    const zodErrors = parseResult.error.flatten();
    emitResult(
      false,
      { zodErrors },
      `El payload de n8n no cumple el schema esperado. ` +
      `Campos inválidos: ${Object.keys(zodErrors.fieldErrors).join(', ')}. ` +
      `Verifica la versión del schema (schemaVersion en metadata).`,
      'ValidationError',
    );
    process.exit(1);
  }

  const payload = parseResult.data;
  const { driveItemId, worksheetName } = payload.excelTarget;

  console.error(
    `[Index] Payload válido. WorkflowId: ${payload.metadata.workflowId} | ` +
    `ExecutionId: ${payload.metadata.executionId} | ` +
    `Transacciones: ${payload.transacciones.length}`,
  );

  // PASO 4: Crear cliente de Graph API (con MSAL)
  let graphClient;
  try {
    graphClient = createGraphClient(envConfig);
  } catch (error) {
    emitResult(false, error, error.message, error.name);
    process.exit(1);
  }

  // PASO 5: Leer datos del Excel en OneDrive
  let excelData;
  try {
    excelData = await graphClient.readWorksheetData(driveItemId, worksheetName);
    console.error(
      `[Index] Excel leído: ${excelData.totalRows} filas, ` +
      `${excelData.totalColumns} columnas en hoja "${worksheetName}"`,
    );
  } catch (error) {
    let errorMsg;
    if (error instanceof ResourceNotFoundError) {
      errorMsg =
        `No se encontró el archivo Excel en OneDrive (DriveItemId: ${driveItemId}). ` +
        `Verifica que el ID sea correcto y que la App tenga permiso Files.ReadWrite.All.`;
    } else if (error instanceof GraphAuthError) {
      errorMsg =
        `Error de autenticación con Microsoft 365: ${error.message}. ` +
        `Verifica las credenciales en las variables de entorno.`;
    } else {
      errorMsg = `Error al leer el Excel de OneDrive: ${error.message}`;
    }
    emitResult(false, error, errorMsg, error.name);
    process.exit(1);
  }

  // PASO 6: Ejecutar el motor de conciliación financiera
  let reconciliationResult;
  try {
    reconciliationResult = reconcile(
      payload.transacciones,
      excelData.headers,
      excelData.rows,
      payload.opciones,
    );
  } catch (error) {
    emitResult(
      false,
      error,
      `Error interno en el motor de conciliación: ${error.message}`,
      'ReconciliationError',
    );
    process.exit(1);
  }

  // PASO 7: (Opcional) Escribir resultados de vuelta al Excel
  if (payload.opciones.actualizarDiscrepancias || payload.opciones.crearFaltantes) {
    try {
      await writeResultsToExcel(
        graphClient,
        payload,
        reconciliationResult,
        excelData.headers,
      );
    } catch (error) {
      // Error no fatal: el resultado de conciliación ya está calculado.
      // Se añade advertencia pero no se aborta el proceso.
      console.error(
        `[Index] ⚠️ Error al escribir resultados en Excel: ${error.message}. ` +
        `La conciliación fue exitosa pero los cambios NO se guardaron en OneDrive.`,
      );
      reconciliationResult.advertencias = reconciliationResult.advertencias ?? [];
      reconciliationResult.advertencias.push({
        tipo: 'ESCRITURA_EXCEL_FALLIDA',
        mensaje: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // PASO 8: Emitir resultado final en stdout para n8n
  emitResult(true, {
    // Metadatos del proceso (para trazabilidad en n8n)
    procesoMetadata: {
      workflowId: payload.metadata.workflowId,
      executionId: payload.metadata.executionId,
      fuente: payload.metadata.fuente,
      driveItemId,
      worksheetName,
    },
    // Resultado de la conciliación
    ...reconciliationResult,
  });

  console.error('[Index] Proceso completado exitosamente.');
}

// ---------------------------------------------------------------------------
// Arrancar — captura errores no manejados globalmente
// ---------------------------------------------------------------------------

// Captura promesas rechazadas sin .catch() — evita fallas silenciosas
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Index] UNHANDLED REJECTION en:', promise);
  emitResult(
    false,
    { stack: reason?.stack },
    `Error asíncrono no manejado: ${reason?.message ?? String(reason)}`,
    'UnhandledRejection',
  );
  process.exit(1);
});

// Captura excepciones síncronas no capturadas
process.on('uncaughtException', (error) => {
  console.error('[Index] UNCAUGHT EXCEPTION:', error);
  emitResult(
    false,
    { stack: error.stack },
    `Excepción no capturada: ${error.message}`,
    'UncaughtException',
  );
  process.exit(1);
});

main();
