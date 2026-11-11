/**
 * @fileoverview Punto de entrada CLI para el componente de métricas.
 *
 * Recibe parámetros por stdin o por archivo (--payload) y produce un informe
 * de métricas VD1/VD2 en formato JSON y texto plano.
 *
 * Modo CLI:
 *   echo '{"workflowId":"captura-leads","periodoInicio":"...","periodoFin":"...","lineaBaseTiempoManualSegundos":120,"lineaBaseTasaErrorManual":5}' | node src/index.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import {
  MetricsInputSchema,
} from './schemas.js';
import {
  calcularMetricasWorkflow,
  generarInformeTexto,
} from './calculator.js';

// ---------------------------------------------------------------------------
// Serialización de respuesta (stdout JSON)
// ---------------------------------------------------------------------------

function emitResult(exitoso, data, errorMsg = null, errorType = null) {
  const output = exitoso
    ? { exitoso: true, data }
    : { exitoso: false, error: { tipo: errorType ?? 'Error', mensaje: errorMsg ?? 'Error desconocido' } };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Lectura de payload desde stdin o archivo
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
      'No se recibió payload. Ejemplo: echo \'{"workflowId":"captura-leads","periodoInicio":"2026-11-02T00:00:00Z","periodoFin":"2026-11-08T23:59:59Z","lineaBaseTiempoManualSegundos":120,"lineaBaseTasaErrorManual":5}\' | node src/index.js',
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

    // Validar entrada con Zod
    const input = MetricsInputSchema.parse(rawPayload);

    // Datos sintéticos de ejemplo para pruebas de desarrollo.
    // En producción, estos datos vendrían de automation_log de PostgreSQL.
    const ejecucionesSinteticas = [
      { latencia_ms: 45, estado: 'exito', registros_procesados: 10 },
      { latencia_ms: 38, estado: 'exito', registros_procesados: 8 },
      { latencia_ms: 52, estado: 'exito', registros_procesados: 12 },
      { latencia_ms: 41, estado: 'error', registros_procesados: 0 },
      { latencia_ms: 39, estado: 'exito', registros_procesados: 9 },
      { latencia_ms: 47, estado: 'exito', registros_procesados: 11 },
      { latencia_ms: 43, estado: 'exito', registros_procesados: 7 },
      { latencia_ms: 50, estado: 'error', registros_procesados: 0 },
      { latencia_ms: 44, estado: 'exito', registros_procesados: 10 },
      { latencia_ms: 40, estado: 'exito', registros_procesados: 9 },
    ];

    const lineasBase = {
      tiempoManualSegundos: input.lineaBaseTiempoManualSegundos,
      tasaErrorManual: input.lineaBaseTasaErrorManual,
      umbralObservacionesMinimo: input.umbralObservacionesMinimo,
    };

    const resultado = calcularMetricasWorkflow(ejecucionesSinteticas, lineasBase);

    const informe = {
      periodo: {
        inicio: input.periodoInicio,
        fin: input.periodoFin,
      },
      workflowId: input.workflowId,
      metricas: resultado.metricas,
      comparacionVD1: resultado.comparacionVD1,
      comparacionVD2: resultado.comparacionVD2,
      observacionesUsadas: resultado.observacionesUsadas,
      advertenciaDatosInsuficientes: resultado.advertenciaDatosInsuficientes,
      conclusionHipotesis: resultado.conclusionHipotesis,
      datosSinteticos: true,
    };

    // Emitir informe JSON
    emitResult(true, informe);

    // Emitir informe de texto plano a stderr para no contaminar stdout
    const texto = generarInformeTexto(
      resultado,
      input.periodoInicio,
      input.periodoFin,
      input.workflowId,
      true,
    );
    console.error('\n' + texto + '\n');

    console.error('[Metrics] Informe generado exitosamente.');
  } catch (error) {
    let errorType = error.name ?? 'Error';
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