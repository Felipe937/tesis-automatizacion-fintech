/**
 * @fileoverview Punto de entrada CLI — envoltorio delgado sobre src/core.js.
 * Conserva el mismo comportamiento y formato de salida actuales.
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import {
  processPayload,
  loadEnvConfig,
  serializeError,
  serializeSuccess,
  ValidationError,
  ConfigurationError,
  GraphAuthError,
  ResourceNotFoundError,
  GraphApiError,
  ReconciliationError,
  ExcelWriteError,
} from './core.js';

// ---------------------------------------------------------------------------
// Lectura del payload de entrada (stdin o archivo)
// ---------------------------------------------------------------------------

/**
 * Lee el payload JSON desde stdin (modo pipe) o desde archivo (--payload).
 * @returns {Promise<object>}
 * @throws {ValidationError}
 */
async function readPayload() {
  const args = process.argv.slice(2);
  const payloadFlagIndex = args.indexOf('--payload');

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

  // Modo stdin
  return new Promise((resolve, reject) => {
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
// Serialización de respuesta para n8n (stdout)
// ---------------------------------------------------------------------------

function emitResult(exitoso, data, errorMsg = null, errorType = null) {
  const output = exitoso
    ? serializeSuccess(data)
    : serializeError(new Error(errorMsg, { cause: { name: errorType } }));

  // Mantener compatibilidad con formato anterior: error.tipo, error.mensaje
  if (!exitoso) {
    output.error.tipo = errorType ?? 'Error';
    output.error.mensaje = errorMsg ?? 'Error desconocido';
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Main CLI
// ---------------------------------------------------------------------------

async function main() {
  console.error('[Index] Servicio de Conciliación Financiera — n8n/Excel');
  console.error('[Index] Tesis Automatización Fintech — Colombia | MIT License');

  try {
    // Cargar y validar configuración
    loadEnvConfig();

    // Leer payload
    const rawPayload = await readPayload();

    // Procesar (la lógica está en core.js)
    const result = await processPayload(rawPayload);

    // Emitir resultado en stdout para n8n
    emitResult(true, result);
    console.error('[Index] Proceso completado exitosamente.');
  } catch (error) {
    // Mapear errores tipados a formato de salida
    let errorMsg = error.message;
    let errorType = error.name;

    if (error instanceof ValidationError) {
      errorType = 'ValidationError';
    } else if (error instanceof ConfigurationError) {
      errorType = 'ConfigurationError';
    } else if (error instanceof ResourceNotFoundError) {
      errorType = 'ResourceNotFoundError';
    } else if (error instanceof GraphAuthError) {
      errorType = 'GraphAuthError';
      errorMsg =
        `Error de autenticación con Microsoft 365: ${error.message}. ` +
        `Verifica las credenciales en las variables de entorno.`;
    } else if (error instanceof GraphApiError) {
      errorType = 'GraphApiError';
      errorMsg = `Error en Graph API: ${error.message}`;
    } else if (error instanceof ReconciliationError) {
      errorType = 'ReconciliationError';
      errorMsg = `Error interno en el motor de conciliación: ${error.message}`;
    } else if (error instanceof ExcelWriteError) {
      errorType = 'ExcelWriteError';
    }

    emitResult(false, error, errorMsg, errorType);
    process.exit(1);
  }
}

// Manejo global de errores no capturados
process.on('unhandledRejection', (reason) => {
  console.error('[Index] UNHANDLED REJECTION:', reason);
  emitResult(
    false,
    { stack: reason?.stack },
    `Error asíncrono no manejado: ${reason?.message ?? String(reason)}`,
    'UnhandledRejection',
  );
  process.exit(1);
});

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