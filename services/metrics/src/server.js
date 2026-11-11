/**
 * @fileoverview Servidor HTTP interno del componente de métricas.
 *
 * Expone:
 *   GET  /health   → estado del servicio (sin autenticación)
 *   POST /metrics  → calcula el informe VD1/VD2 (requiere header x-api-key)
 *
 * Se usa node:http sin dependencias externas, igual que el servicio
 * excel-reconciler, para mantener coherencia arquitectónica y no ampliar la
 * superficie de dependencias del prototipo.
 *
 * El orquestador (n8n) es el único consumidor previsto: nunca se expone este
 * servicio a la red pública (ver docker-compose.yml).
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { URL } from 'node:url';
import { pathToFileURL } from 'node:url';

import { generarInformeMetricas, MetricsValidationError } from './service.js';
import { PostgresSourceError } from './postgresSource.js';

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB
const REQUEST_TIMEOUT_MS = 60_000;      // 60 segundos

let serverConfig;

/**
 * Carga la configuración del servidor al inicio (fail-fast).
 * @returns {{apiKey: Buffer}} Configuración del servidor
 * @throws {Error} Si falta METRICS_API_KEY
 */
function loadServerConfig() {
  const apiKey = process.env.METRICS_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Variable de entorno METRICS_API_KEY no configurada. ' +
        'El servidor no puede arrancar sin una API key válida.',
    );
  }
  return { apiKey: Buffer.from(apiKey, 'utf-8') };
}

/**
 * Lee el body de la request con límite de tamaño.
 * @param {import('node:http').IncomingMessage} req - Petición entrante
 * @returns {Promise<string>} Cuerpo de la petición
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { statusCode: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * Envía una respuesta JSON con headers apropiados.
 * @param {import('node:http').ServerResponse} res - Respuesta
 * @param {number} statusCode - Código HTTP
 * @param {object} body - Cuerpo de la respuesta
 */
function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

/**
 * Verifica el header x-api-key con comparación en tiempo constante.
 * @param {string} providedKey - Valor recibido en el header
 * @returns {boolean} true si la clave coincide
 */
function verifyApiKey(providedKey) {
  if (!providedKey) return false;
  const providedBuffer = Buffer.from(providedKey, 'utf-8');
  if (providedBuffer.length !== serverConfig.apiKey.length) {
    timingSafeEqual(Buffer.alloc(serverConfig.apiKey.length), serverConfig.apiKey);
    return false;
  }
  return timingSafeEqual(providedBuffer, serverConfig.apiKey);
}

/**
 * GET /health — health check sin dependencias externas.
 * @param {import('node:http').IncomingMessage} req - Petición
 * @param {import('node:http').ServerResponse} res - Respuesta
 */
function handleHealth(req, res) {
  sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
}

/**
 * POST /metrics — valida el payload, resuelve los datos y devuelve el informe.
 * @param {import('node:http').IncomingMessage} req - Petición
 * @param {import('node:http').ServerResponse} res - Respuesta
 */
async function handleMetrics(req, res) {
  const startTime = Date.now();
  let workflowId = 'unknown';

  try {
    const bodyStr = await readBody(req);
    if (!bodyStr.trim()) {
      sendJson(res, 400, {
        exitoso: false,
        timestamp: new Date().toISOString(),
        error: { tipo: 'ValidationError', mensaje: 'Body vacío' },
      });
      return;
    }

    let rawPayload;
    try {
      rawPayload = JSON.parse(bodyStr);
    } catch {
      sendJson(res, 400, {
        exitoso: false,
        timestamp: new Date().toISOString(),
        error: { tipo: 'ValidationError', mensaje: 'JSON inválido' },
      });
      return;
    }

    workflowId = rawPayload?.workflowId ?? 'unknown';

    const informe = await generarInformeMetricas(rawPayload);

    sendJson(res, 200, {
      exitoso: true,
      timestamp: new Date().toISOString(),
      ...informe,
    });
  } catch (error) {
    if (error.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, {
        exitoso: false,
        timestamp: new Date().toISOString(),
        error: {
          tipo: 'PayloadTooLarge',
          mensaje: 'El cuerpo de la petición excede el límite de 1 MB',
        },
      });
      return;
    }

    const esValidacion = error instanceof MetricsValidationError;
    const esPostgres = error instanceof PostgresSourceError;
    const statusCode = esValidacion ? 400 : esPostgres ? 502 : 500;

    sendJson(res, statusCode, {
      exitoso: false,
      timestamp: new Date().toISOString(),
      error: {
        tipo: error.name ?? 'Error',
        mensaje: error.message,
        ...(esValidacion && error.detalles ? { detalles: error.detalles } : {}),
      },
    });
  } finally {
    // Log de auditoría mínimo (Ley 1581): sin payload ni datos personales.
    const durationMs = Date.now() - startTime;
    console.error(
      `[MetricsServer] POST /metrics ${res.statusCode} ${durationMs}ms | workflowId: ${workflowId}`,
    );
  }
}

/**
 * Router principal del servidor.
 * @param {import('node:http').IncomingMessage} req - Petición
 * @param {import('node:http').ServerResponse} res - Respuesta
 */
async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const timeoutId = setTimeout(() => {
    if (!res.writableEnded) {
      res.destroy(new Error('REQUEST_TIMEOUT'));
    }
  }, REQUEST_TIMEOUT_MS);

  res.on('finish', () => clearTimeout(timeoutId));
  res.on('close', () => clearTimeout(timeoutId));

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      handleHealth(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/metrics') {
      const apiKey = req.headers['x-api-key'];
      if (!verifyApiKey(apiKey)) {
        sendJson(res, 401, {
          exitoso: false,
          timestamp: new Date().toISOString(),
          error: { tipo: 'Unauthorized', mensaje: 'API key inválida o ausente' },
        });
        return;
      }
      await handleMetrics(req, res);
      return;
    }

    sendJson(res, 404, {
      exitoso: false,
      timestamp: new Date().toISOString(),
      error: { tipo: 'NotFound', mensaje: 'Ruta no encontrada' },
    });
  } catch (error) {
    if (!res.writableEnded) {
      sendJson(res, 500, {
        exitoso: false,
        timestamp: new Date().toISOString(),
        error: { tipo: error.name ?? 'Error', mensaje: error.message },
      });
    }
  }
}

/**
 * Arranca el servidor HTTP.
 * @returns {Promise<import('node:http').Server>} Servidor iniciado
 */
async function startServer() {
  try {
    serverConfig = loadServerConfig();
  } catch (error) {
    console.error('[MetricsServer] Error de configuración:', error.message);
    process.exit(1);
  }

  const port = parseInt(process.env.PORT ?? '3001', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  const server = createServer(router);

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[MetricsServer] Puerto ${port} ya en uso`);
    } else {
      console.error('[MetricsServer] Error fatal:', error);
    }
    process.exit(1);
  });

  await new Promise((resolve) => {
    server.listen(port, host, () => {
      console.error(`[MetricsServer] Métricas escuchando en http://${host}:${port}`);
      console.error('[MetricsServer] Endpoints: GET /health, POST /metrics');
      resolve();
    });
  });

  const shutdown = (signal) => {
    console.error(`[MetricsServer] Señal ${signal} recibida. Cerrando servidor...`);
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// Sólo arrancar si se ejecuta directamente (no al importar).
const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMainModule) {
  startServer();
}

export { startServer, router, loadServerConfig };
