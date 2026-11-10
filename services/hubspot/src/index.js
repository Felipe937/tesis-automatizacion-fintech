/**
 * @fileoverview Punto de entrada HTTP + CLI para el módulo HubSpot.
 * Estructura coherente con services/excel-reconciler/src/index.js.
 *
 * Modo CLI: recibe un comando y argumentos por stdin o argv.
 * Modo HTTP: exporta un manejador para usar con n8n "Execute Command" o un servidor HTTP simple.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import {
  createHubSpotClient,
  HubSpotAuthError,
  HubSpotApiError,
} from './client.js';
import {
  CreateContactInputSchema,
  UpdateContactInputSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Serialización de respuesta para n8n (stdout JSON)
// ---------------------------------------------------------------------------

function emitResult(exitoso, data, errorMsg = null, errorType = null) {
  const output = exitoso
    ? { exitoso: true, data }
    : { exitoso: false, error: { tipo: errorType ?? 'Error', mensaje: errorMsg ?? 'Error desconocido' } };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// CLI: lee comando y payload desde stdin o argumentos
// ---------------------------------------------------------------------------

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
      'No se recibió payload. Ejemplo: echo \'{"command":"getContact","email":"a@b.com"}\' | node src/index.js',
    );
  }

  return new Promise((resolve, reject) => {
    let raw = '';
    const readline = await import('node:readline');
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
  console.error('[HubSpot] Cliente HubSpot API v3 — Tesis Automatización Fintech');

  try {
    const rawPayload = await readPayload();
    const { command, ...params } = rawPayload;

    const client = createHubSpotClient();

    let result;
    switch (command) {
      case 'getContact':
        result = await client.getContact(params.email);
        break;
      case 'createContact':
        result = await client.createContact(params);
        break;
      case 'updateContact':
        result = await client.updateContact(params.contactId, params.properties);
        break;
      default:
        throw new Error(`Comando desconocido: ${command}. Usa: getContact, createContact, updateContact`);
    }

    emitResult(true, result);
    console.error('[HubSpot] Operación completada exitosamente.');
  } catch (error) {
    let errorType = error.name ?? 'Error';
    if (error instanceof HubSpotAuthError) errorType = 'HubSpotAuthError';
    if (error instanceof HubSpotApiError) errorType = 'HubSpotApiError';

    emitResult(false, null, error.message, errorType);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[HubSpot] UNHANDLED REJECTION:', reason);
  emitResult(false, null, `Error asíncrono: ${reason?.message ?? String(reason)}`, 'UnhandledRejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[HubSpot] UNCAUGHT EXCEPTION:', error);
  emitResult(false, null, `Excepción: ${error.message}`, 'UncaughtException');
  process.exit(1);
});

main();