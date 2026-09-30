/**
 * @fileoverview Servidor HTTP interno para el servicio de conciliación.
 * Expone POST /reconcile y GET /health usando solo node:http (sin dependencias externas).
 * Autenticación por header x-api-key con timingSafeEqual.
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { URL } from 'node:url';
import { pathToFileURL } from 'node:url';

import {
  processPayload,
  loadEnvConfig,
  serializeError,
  serializeSuccess,
  ValidationError,
  ConfigurationError,
  ResourceNotFoundError,
  GraphAuthError,
  GraphApiError,
  ReconciliationError,
} from './core.js';

// ---------------------------------------------------------------------------
// Configuración del servidor
// ---------------------------------------------------------------------------

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB
const REQUEST_TIMEOUT_MS = 60_000;      // 60 segundos

let serverConfig;

/**
 * Carga configuración del servidor al inicio (fail-fast).
 * @throws {ConfigurationError} Si falta RECONCILER_API_KEY
 */
function loadServerConfig() {
  const apiKey = process.env.RECONCILER_API_KEY;
  if (!apiKey) {
    throw new ConfigurationError(
      'Variable de entorno RECONCILER_API_KEY no configurada. ' +
      'El servidor no puede arrancar sin una API key válida.',
    );
  }
  return {
    apiKey: Buffer.from(apiKey, 'utf-8'),
    envConfig: loadEnvConfig(),
  };
}

// ---------------------------------------------------------------------------
// Utilidades HTTP
// ---------------------------------------------------------------------------

/**
 * Parsea el body de la request con límite de tamaño.
 * Corta la lectura al superar el límite sin acumular más chunks.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        // Rechazar inmediatamente sin leer más
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { statusCode: 413 }));
        req.resume(); // consumir resto para limpiar socket
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * Envía respuesta JSON con headers apropiados.
 * NUNCA incluye statusCode en el cuerpo.
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {object} body
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
 * @param {string} providedKey
 * @returns {boolean}
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

// ---------------------------------------------------------------------------
// Handlers de rutas
// ---------------------------------------------------------------------------

/**
 * GET /health - Health check sin dependencias externas.
 * No requiere autenticación.
 */
async function handleHealth(req, res) {
  sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
}

/**
 * POST /reconcile - Procesa payload de conciliación.
 * Requiere header x-api-key.
 * Lee body UNA sola vez, extrae metadatos para log, llama processPayload.
 */
async function handleReconcile(req, res) {
  const startTime = Date.now();
  // Variables para log (inicializadas por si hay error temprano)
  let workflowId = 'unknown';
  let executionId = 'unknown';
  let transactionCount = 0;

  try {
    // Leer body UNA sola vez
    const bodyStr = await readBody(req);
    if (!bodyStr.trim()) {
      const serialized = serializeError(new ValidationError('Body vacío', null));
      const { statusCode, ...body } = serialized;
      sendJson(res, statusCode, body);
      return;
    }

    // Parsear JSON
    let rawPayload;
    try {
      rawPayload = JSON.parse(bodyStr);
    } catch {
      const serialized = serializeError(new ValidationError('JSON inválido', null));
      const { statusCode, ...body } = serialized;
      sendJson(res, statusCode, body);
      return;
    }

    // Extraer metadatos para log de auditoría (variables locales, NO en req)
    workflowId = rawPayload?.metadata?.workflowId ?? 'unknown';
    executionId = rawPayload?.metadata?.executionId ?? 'unknown';
    transactionCount = rawPayload?.transacciones?.length ?? 0;

    // Procesar payload
    const result = await processPayload(rawPayload, serverConfig.envConfig);
    sendJson(res, 200, serializeSuccess(result));
  } catch (error) {
    // Manejar PAYLOAD_TOO_LARGE específicamente
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

    const serialized = serializeError(error);
    // Enviar sin statusCode en el cuerpo (se usa en writeHead)
    const { statusCode, ...body } = serialized;
    sendJson(res, statusCode, body);
  } finally {
    // Log de auditoría mínimo (Ley 1581): NO payload, NO datos sensibles
    const durationMs = Date.now() - startTime;
    console.error(
      `[Server] ${req.method} ${req.url} ${res.statusCode} ${durationMs}ms ` +
      `| workflowId: ${workflowId} ` +
      `| executionId: ${executionId} ` +
      `| transacciones: ${transactionCount}`,
    );
  }
}

/**
 * Router principal.
 */
async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Request timeout
  const timeoutId = setTimeout(() => {
    if (!res.writableEnded) {
      res.destroy(new Error('REQUEST_TIMEOUT'));
    }
  }, REQUEST_TIMEOUT_MS);

  res.on('finish', () => clearTimeout(timeoutId));
  res.on('close', () => clearTimeout(timeoutId));

  try {
    // GET /health (sin auth)
    if (req.method === 'GET' && url.pathname === '/health') {
      await handleHealth(req, res);
      return;
    }

    // POST /reconcile (con auth)
    if (req.method === 'POST' && url.pathname === '/reconcile') {
      // Verificar API key
      const apiKey = req.headers['x-api-key'];
      if (!verifyApiKey(apiKey)) {
        sendJson(res, 401, {
          exitoso: false,
          timestamp: new Date().toISOString(),
          error: {
            tipo: 'Unauthorized',
            mensaje: 'API key inválida o ausente',
          },
        });
        return;
      }

      // handleReconcile lee el body y extrae metadatos
      await handleReconcile(req, res);
      return;
    }

    // 404 para rutas no encontradas
    sendJson(res, 404, {
      exitoso: false,
      timestamp: new Date().toISOString(),
      error: {
        tipo: 'NotFound',
        mensaje: 'Ruta no encontrada',
      },
    });
  } catch (error) {
    if (!res.writableEnded) {
      const serialized = serializeError(error);
      const { statusCode, ...body } = serialized;
      sendJson(res, statusCode, body);
    }
  }
}

// ---------------------------------------------------------------------------
// Arranque del servidor (NO se ejecuta al importar)
// ---------------------------------------------------------------------------

let server;

async function startServer() {
  try {
    serverConfig = loadServerConfig();
  } catch (error) {
    console.error('[Server] Error de configuración:', error.message);
    process.exit(1);
  }

  const port = parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  server = createServer(router);

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[Server] Puerto ${port} ya en uso`);
    } else {
      console.error('[Server] Error fatal:', error);
    }
    process.exit(1);
  });

  await new Promise((resolve) => {
    server.listen(port, host, () => {
      console.error(`[Server] Conciliador HTTP escuchando en http://${host}:${port}`);
      console.error('[Server] Endpoints: GET /health, POST /reconcile');
      resolve();
    });
  });

  // Manejo de señales para cierre ordenado
  const shutdown = (signal) => {
    console.error(`[Server] Señal ${signal} recibida. Cerrando servidor...`);
    server.close((err) => {
      if (err) {
        console.error('[Server] Error durante cierre:', err);
        process.exit(1);
      }
      console.error('[Server] Servidor cerrado correctamente');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// Solo arrancar si se ejecuta directamente (no al importar)
// Compatibilidad ESM: import.meta.url vs process.argv[1]
const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMainModule) {
  startServer();
}

export { startServer, router, loadServerConfig };