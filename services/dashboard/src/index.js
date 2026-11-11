/**
 * @fileoverview Punto de entrada CLI para el generador de dashboard ejecutivo.
 *
 * Recibe parámetros por stdin o por archivo (--payload), valida con Zod,
 * calcula los cuatro bloques del dashboard (§4.4 de la tesis) y emite un
 * informe JSON en stdout. Si se indica `excelDriveItemId`, actualiza el libro
 * Excel en OneDrive mediante Microsoft Graph API (reutilizando el cliente de
 * excel-reconciler a través de graphClientAdapter.js).
 *
 * Modo CLI (datos reales desde PostgreSQL):
 *   echo '{"workflowId":"dashboard-ejecutivo","periodoInicio":"...","periodoFin":"...",
 *         "fuenteDatos":"postgres"}' | node src/index.js
 *
 * Modo CLI (demostración con datos sintéticos):
 *   echo '{"workflowId":"dashboard-ejecutivo","periodoInicio":"...","periodoFin":"...",
 *         "fuenteDatos":"sintetico"}' | node src/index.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import {
  generarDashboardDesdeEntrada,
  generarDashboardYActualizarExcel,
  DashboardValidationError,
  DashboardExcelError,
} from './service.js';
import { PostgresSourceError } from './postgresSource.js';

// ---------------------------------------------------------------------------
// Serialización de respuesta (stdout JSON)
// ---------------------------------------------------------------------------

/**
 * Emite el resultado en stdout con un formato estable para n8n.
 * @param {boolean} exitoso - Indicador de éxito
 * @param {object|null} data - Datos del informe
 * @param {string|null} errorMsg - Mensaje de error
 * @param {string|null} errorType - Tipo de error
 */
function emitResult(exitoso, data, errorMsg = null, errorType = null) {
  const output = exitoso
    ? { exitoso: true, data }
    : { exitoso: false, error: { tipo: errorType ?? 'Error', mensaje: errorMsg ?? 'Error desconocido' } };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Lectura de payload desde stdin o archivo
// ---------------------------------------------------------------------------

/**
 * Lee el payload JSON desde `--payload <archivo>` o desde stdin.
 * @returns {Promise<object>} Payload parseado
 */
async function readPayload() {
  const args = process.argv.slice(2);
  const payloadFlagIndex = args.indexOf('--payload');

  if (payloadFlagIndex !== -1 && args[payloadFlagIndex + 1]) {
    const filePath = args[payloadFlagIndex + 1];
    const fs = await import('node:fs');
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`No se pudo leer el archivo "${filePath}": ${error.message}`);
    }
  }

  if (process.stdin.isTTY) {
    throw new Error(
      'No se recibió payload. ' +
        'Ejemplo: echo \'{"workflowId":"dashboard-ejecutivo",' +
        '"periodoInicio":"2026-11-02T00:00:00Z","periodoFin":"2026-11-08T23:59:59Z",' +
        '"fuenteDatos":"sintetico"}\' | node src/index.js',
    );
  }

  const readline = await import('node:readline');
  return new Promise((resolve, reject) => {
    let raw = '';
    const rl = readline.createInterface({ input: process.stdin });

    rl.on('line', (line) => { raw += line; });
    rl.on('close', () => {
      if (!raw.trim()) {
        reject(new Error('El payload recibido está vacío.'));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`El payload no es JSON válido: ${error.message}`));
      }
    });
    rl.on('error', (error) => {
      reject(new Error(`Error leyendo stdin: ${error.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Main CLI
// ---------------------------------------------------------------------------

async function main() {
  console.error('[Dashboard] Generador de Dashboard Ejecutivo — Tesis Automatización Fintech');

  try {
    const rawPayload = await readPayload();

    const actualizarExcel =
      typeof rawPayload.excelDriveItemId === 'string' &&
      rawPayload.excelDriveItemId.length > 0 &&
      rawPayload.actualizarExcel !== false;

    if (!actualizarExcel) {
      const dashboard = await generarDashboardDesdeEntrada(rawPayload);
      emitResult(true, dashboard);
      console.error(
        `[Dashboard] Informe generado (origen: ${dashboard.fuenteDatos}). No se actualizó OneDrive.`,
      );
      return;
    }

    // Actualizar Excel requiere el cliente Graph autenticado con MSAL.
    const { createGraphClient } = await import('./graphClientAdapter.js');
    const graphClient = createGraphClient({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      tenantId: process.env.MICROSOFT_TENANT_ID,
    });

    const { dashboard, excel } = await generarDashboardYActualizarExcel(rawPayload, {
      graphClient,
    });

    emitResult(true, { ...dashboard, excelActualizado: excel });
    console.error('[Dashboard] Libro Excel actualizado en OneDrive.');
  } catch (error) {
    const errorType =
      error instanceof DashboardValidationError
        ? 'DashboardValidationError'
        : error instanceof DashboardExcelError
          ? 'DashboardExcelError'
          : error instanceof PostgresSourceError
            ? 'PostgresSourceError'
            : (error.name ?? 'Error');
    emitResult(false, null, error.message, errorType);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[Dashboard] UNHANDLED REJECTION:', reason);
  emitResult(false, null, `Error asíncrono: ${reason?.message ?? String(reason)}`, 'UnhandledRejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[Dashboard] UNCAUGHT EXCEPTION:', error);
  emitResult(false, null, `Excepción: ${error.message}`, 'UncaughtException');
  process.exit(1);
});

main();
