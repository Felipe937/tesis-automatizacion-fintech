/**
 * @fileoverview Punto de entrada HTTP + CLI para el módulo Mailchimp.
 * Estructura coherente con services/excel-reconciler/src/index.js.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import {
  createMailchimpClient,
  MailchimpAuthError,
  MailchimpApiError,
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
      'No se recibió payload. Ejemplo: echo \'{"command":"addOrUpdateMember","listId":"abc","email":"a@b.com"}\' | node src/index.js',
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

async function main() {
  console.error('[Mailchimp] Cliente Mailchimp API v3 — Tesis Automatización Fintech');

  try {
    const rawPayload = await readPayload();
    const { command, ...params } = rawPayload;

    const client = createMailchimpClient();

    let result;
    switch (command) {
      case 'addOrUpdateMember':
        result = await client.addOrUpdateMember(params.listId, params.email, params);
        break;
      case 'addTag':
        result = await client.addTag(params.listId, params.email, params.tag);
        break;
      default:
        throw new Error(`Comando desconocido: ${command}. Usa: addOrUpdateMember, addTag`);
    }

    emitResult(true, result);
    console.error('[Mailchimp] Operación completada exitosamente.');
  } catch (error) {
    let errorType = error.name ?? 'Error';
    if (error instanceof MailchimpAuthError) errorType = 'MailchimpAuthError';
    if (error instanceof MailchimpApiError) errorType = 'MailchimpApiError';

    emitResult(false, null, error.message, errorType);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[Mailchimp] UNHANDLED REJECTION:', reason);
  emitResult(false, null, `Error asíncrono: ${reason?.message ?? String(reason)}`, 'UnhandledRejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[Mailchimp] UNCAUGHT EXCEPTION:', error);
  emitResult(false, null, `Excepción: ${error.message}`, 'UncaughtException');
  process.exit(1);
});

main();