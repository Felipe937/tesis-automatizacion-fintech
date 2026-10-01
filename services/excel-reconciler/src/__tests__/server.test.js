/**
 * @fileoverview Tests de integración para el servidor HTTP (src/server.js).
 * Usa node:test nativo (Node 20+), levanta servidor en puerto efímero.
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, createServer } from 'node:http';
import { startServer, router, loadServerConfig } from '../server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Hace una petición HTTP y devuelve { statusCode, body, headers }.
 * @param {object} options - { method, path, headers, body }
 * @param {number} port
 * @returns {Promise<{ statusCode: number, body: object, headers: object }>}
 */
function request(options, port) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let body;
          try {
            body = data ? JSON.parse(data) : {};
          } catch {
            body = data;
          }
          resolve({ statusCode: res.statusCode, body, headers: res.headers });
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('Request timeout'));
      reject(new Error('Request timeout'));
    });

    if (options.body !== undefined) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

/**
 * Encuentra un puerto libre.
 * @returns {Promise<number>}
 */
function getFreePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_API_KEY = 'test-api-key-1234567890abcdef1234567890abcdef'; // 64 chars

const MINIMAL_PAYLOAD = {
  metadata: {
    workflowId: 'test-workflow-123',
    executionId: 'test-execution-456',
    timestamp: '2026-09-30T12:00:00.000Z',
    fuente: 'MANUAL',
    schemaVersion: '1.0',
  },
  excelTarget: {
    driveItemId: 'test-drive-item-id',
    worksheetName: 'Portafolio',
  },
  transacciones: [
    {
      id: 'TXN-001',
      fecha: '2026-09-28',
      ticker: 'TEST',
      tipoActivo: 'ACCION',
      operacion: 'COMPRA',
      cantidad: 100,
      precioUnitario: 1000,
      valorBruto: 100000,
      comisiones: 100,
      impuestos: 200,
      valorNeto: -100300,
      moneda: 'COP',
      tasaCambio: 1,
      corredor: 'TEST',
      estado: 'EJECUTADA',
    },
  ],
  opciones: {
    toleranciaCOP: 1,
    crearFaltantes: false,
    actualizarDiscrepancias: false,
    columnaIdExcel: 'ID_Transaccion',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HTTP Server — src/server.js', () => {
  let port;
  let server;
  let baseUrl;

  before(async () => {
    port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    // Configurar variables de entorno para el servidor de test
    process.env.RECONCILER_API_KEY = VALID_API_KEY;
    process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
    process.env.MICROSOFT_CLIENT_SECRET = 'test-client-secret';
    process.env.MICROSOFT_TENANT_ID = 'test-tenant-id';
    process.env.PORT = String(port);
    process.env.HOST = '127.0.0.1';

    // Levantar servidor en background
    server = await startServer();

    // Esperar a que el servidor esté listo
    await new Promise((resolve, reject) => {
      const check = setInterval(async () => {
        try {
          const res = await fetch(`${baseUrl}/health`);
          if (res.ok) {
            clearInterval(check);
            resolve();
          }
        } catch {
          // Server not ready yet
        }
      }, 50);
      setTimeout(() => {
        clearInterval(check);
        reject(new Error('Server did not start in time'));
      }, 5000);
    });
  });

  after(async () => {
    // Cerrar servidor
    if (server) {
      await new Promise((resolve) => {
        server.close((err) => {
          if (err) console.error('[Test] Error cerrando servidor:', err);
          resolve();
        });
        // Force close after 2s
        setTimeout(resolve, 2000);
      });
    }
    // Limpiar env vars
    delete process.env.RECONCILER_API_KEY;
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    delete process.env.MICROSOFT_TENANT_ID;
  });

  describe('GET /health', () => {
    it('responde 200 con {status:"ok"} sin requerir API key', async () => {
      const res = await request({ method: 'GET', path: '/health' }, port);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.status, 'ok');
      assert.ok(res.body.timestamp);
    });
  });

  describe('POST /reconcile — Autenticación', () => {
    it('responde 401 sin header x-api-key', async () => {
      const res = await request(
        { method: 'POST', path: '/reconcile', body: MINIMAL_PAYLOAD },
        port,
      );
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.exitoso, false);
      assert.equal(res.body.error.tipo, 'Unauthorized');
      assert.ok(res.body.error.mensaje);
      assert.ok(!res.body.statusCode, 'El cuerpo NO debe contener statusCode');
    });

    it('responde 401 con x-api-key incorrecta', async () => {
      const res = await request(
        {
          method: 'POST',
          path: '/reconcile',
          headers: { 'x-api-key': 'wrong-key' },
          body: MINIMAL_PAYLOAD,
        },
        port,
      );
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error.tipo, 'Unauthorized');
    });
  });

  describe('POST /reconcile — Validación de entrada', () => {
    it('responde 400 con body vacío', async () => {
      const res = await request(
        {
          method: 'POST',
          path: '/reconcile',
          headers: { 'x-api-key': VALID_API_KEY },
          body: '',
        },
        port,
      );
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.exitoso, false);
      assert.equal(res.body.error.tipo, 'ValidationError');
      assert.ok(!res.body.statusCode);
    });

    it('responde 400 con JSON inválido', async () => {
      const res = await request(
        {
          method: 'POST',
          path: '/reconcile',
          headers: { 'x-api-key': VALID_API_KEY },
          body: '{not valid json',
        },
        port,
      );
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.tipo, 'ValidationError');
      assert.ok(!res.body.statusCode);
    });

    it('responde 400 con JSON que no cumple el schema (faltan campos requeridos)', async () => {
      const res = await request(
        {
          method: 'POST',
          path: '/reconcile',
          headers: { 'x-api-key': VALID_API_KEY },
          body: { metadata: {} }, // payload incompleto
        },
        port,
      );
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.exitoso, false);
      assert.equal(res.body.error.tipo, 'ValidationError');
      assert.ok(!res.body.statusCode, 'No debe colgarse, debe responder 400');
    });
  });

  describe('POST /reconcile — Límites', () => {
    it('responde 413 con body > 1 MB', async () => {
      // Crear payload > 1 MB: cada transacción ~500 bytes, necesitamos ~5000+
      const singleTxn = MINIMAL_PAYLOAD.transacciones[0];
      const largePayload = {
        ...MINIMAL_PAYLOAD,
        transacciones: Array(10000).fill(singleTxn).map((t, i) => ({ ...t, id: `TXN-${i}` })),
      };
      const res = await request(
        {
          method: 'POST',
          path: '/reconcile',
          headers: { 'x-api-key': VALID_API_KEY },
          body: largePayload,
        },
        port,
      );
      assert.equal(res.statusCode, 413);
      assert.equal(res.body.exitoso, false);
      assert.equal(res.body.error.tipo, 'PayloadTooLarge');
      assert.ok(!res.body.statusCode);
    });
  });

  describe('POST /reconcile — Petición válida (schema OK, sin Microsoft)', () => {
    it('responde en < 5s con 400/502 (ConfigurationError o GraphAuthError) pero NO cuelga', async () => {
      const start = Date.now();
      const res = await request(
        {
          method: 'POST',
          path: '/reconcile',
          headers: { 'x-api-key': VALID_API_KEY },
          body: MINIMAL_PAYLOAD,
        },
        port,
      );
      const elapsed = Date.now() - start;

      // Debe responder rápido (no timeout de 60s)
      assert.ok(elapsed < 5000, `Petición tardó ${elapsed}ms, debe ser < 5000ms`);

      // Con credenciales ficticias, fallará en GraphAuthError (502) o ConfigurationError (500)
      // Lo importante es que NO cuelgue y responda con estructura correcta
      assert.ok([500, 502].includes(res.statusCode), `Status inesperado: ${res.statusCode}`);
      assert.equal(res.body.exitoso, false);
      assert.ok(res.body.error.tipo);
      assert.ok(res.body.error.mensaje);
      assert.ok(!res.body.statusCode, 'El cuerpo NO debe contener statusCode');
    });
  });

  describe('Rutas inexistentes', () => {
    it('responde 404', async () => {
      const res = await request(
        { method: 'GET', path: '/no-existe' },
        port,
      );
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error.tipo, 'NotFound');
    });
  });
});