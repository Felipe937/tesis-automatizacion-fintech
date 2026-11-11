/**
 * @fileoverview Punto de entrada CLI para el componente de métricas.
 *
 * Recibe parámetros por stdin o por archivo (--payload) y produce un informe
 * de métricas VD1/VD2 en formato JSON (stdout) y texto plano (stderr).
 *
 * Modo CLI (datos reales desde PostgreSQL):
 *   echo '{"workflowId":"captura-leads","periodoInicio":"...","periodoFin":"...",
 *         "fuenteDatos":"postgres","lineaBaseTiempoManualSegundos":120,
 *         "lineaBaseTasaErrorManual":5}' | node src/index.js
 *
 * Modo CLI (demostración con datos sintéticos):
 *   echo '{"workflowId":"captura-leads","periodoInicio":"...","periodoFin":"...",
 *         "fuenteDatos":"sintetico","lineaBaseTiempoManualSegundos":120,
 *         "lineaBaseTasaErrorManual":5}' | node src/index.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { generarInformeMetricas, MetricsValidationError } from './service.js';
import { generarInformeTexto } from './calculator.js';
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
        'Ejemplo: echo \'{"workflowId":"captura-leads",' +
        '"periodoInicio":"2026-11-02T00:00:00Z","periodoFin":"2026-11-08T23:59:59Z",' +
        '"lineaBaseTiempoManualSegundos":120,"lineaBaseTasaErrorManual":5}\' | node src/index.js',
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
  console.error('[Metrics] Componente de Métricas VD1/VD2 — Tesis Automatización Fintech');

  try {
    const rawPayload = await readPayload();

    const informe = await generarInformeMetricas(rawPayload);

    // Emitir informe JSON (stdout)
    emitResult(true, informe);

    // Emitir informe de texto plano a stderr para no contaminar stdout
    const texto = generarInformeTexto(
      {
        metricas: informe.metricas,
        comparacionVD1: informe.comparacionVD1,
        comparacionVD2: informe.comparacionVD2,
        comparacionVD2Registros: informe.comparacionVD2Registros,
        conclusionHipotesis: informe.conclusionHipotesis,
        conclusionDefinitiva: informe.conclusionDefinitiva,
        advertenciaDatosInsuficientes: informe.advertenciaDatosInsuficientes,
        advertenciaPeriodoSinRegistros: informe.advertenciaPeriodoSinRegistros,
      },
      informe.periodo.inicio,
      informe.periodo.fin,
      informe.workflowId,
      informe.datosSinteticos,
    );
    console.error('\n' + texto + '\n');

    console.error(
      `[Metrics] Informe generado exitosamente (origen: ${informe.fuenteDatos}).`,
    );
  } catch (error) {
    const errorType =
      error instanceof MetricsValidationError
        ? 'MetricsValidationError'
        : error instanceof PostgresSourceError
          ? 'PostgresSourceError'
          : (error.name ?? 'Error');
    emitResult(false, null, error.message, errorType);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[Metrics] UNHANDLED REJECTION:', reason);
  emitResult(false, null, `Error asíncrono: ${reason?.message ?? String(reason)}`, 'UnhandledRejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[Metrics] UNCAUGHT EXCEPTION:', error);
  emitResult(false, null, `Excepción: ${error.message}`, 'UncaughtException');
  process.exit(1);
});

main();
