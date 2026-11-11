/**
 * @fileoverview Punto de entrada HTTP + CLI para el módulo Calendly.
 * Estructura coherente con services/excel-reconciler/src/index.js.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import {
  createCalendlyClient,
  validateCalendlyWebhook,
  parseCalendlyWebhookPayload,
  CalendlyAuthError,
  CalendlyApiError,
  CalendlyWebhookValidationError,
} from './client.js';

function emitResult(exitoso, data, errorMsg = null, errorType = null) {
  const output = exitoso
    ? { exitoso: true, data }
    : { exitoso: false, error: { tipo: errorType ?? 'Error', mensaje: errorMsg ?? 'Error desconocido' } };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

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
        'Ejemplo: echo \'{"command":"getEvent","uri":"https://api.calendly.com/scheduled_events/uuid"}\' ' +
        '| node src/index.js',
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

async function main() {
  console.error('[Calendly] Cliente Calendly API v2 — Tesis Automatización Fintech');

  try {
    const rawPayload = await readPayload();
    const { command, ...params } = rawPayload;

    switch (command) {
      case 'getEvent': {
        const client = createCalendlyClient();
        const result = await client.getEvent(params.uri);
        emitResult(true, result);
        break;
      }
      case 'getInvitee': {
        const client = createCalendlyClient();
        const result = await client.getInvitee(params.uri);
        emitResult(true, result);
        break;
      }
      case 'validateWebhook': {
        const result = validateCalendlyWebhook(
          params.payload,
          params.signature,
          params.secret,
        );
        emitResult(true, { valid: result });
        break;
      }
      case 'parseWebhook': {
        const result = parseCalendlyWebhookPayload(params.payload);
        emitResult(true, result);
        break;
      }
      default:
        throw new Error(
          `Comando desconocido: ${command}. Usa: getEvent, getInvitee, validateWebhook, parseWebhook`,
        );
    }

    console.error('[Calendly] Operación completada exitosamente.');
  } catch (error) {
    let errorType = error.name ?? 'Error';
    if (error instanceof CalendlyAuthError) errorType = 'CalendlyAuthError';
    if (error instanceof CalendlyApiError) errorType = 'CalendlyApiError';
    if (error instanceof CalendlyWebhookValidationError) errorType = 'CalendlyWebhookValidationError';

    emitResult(false, null, error.message, errorType);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[Calendly] UNHANDLED REJECTION:', reason);
  emitResult(false, null, `Error asíncrono: ${reason?.message ?? String(reason)}`, 'UnhandledRejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[Calendly] UNCAUGHT EXCEPTION:', error);
  emitResult(false, null, `Excepción: ${error.message}`, 'UncaughtException');
  process.exit(1);
});

main();
