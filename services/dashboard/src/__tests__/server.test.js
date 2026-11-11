/**
 * @fileoverview Tests del servidor HTTP del componente de dashboard.
 *
 * Se levanta el servidor real en un puerto efímero y se exercise con fetch.
 * No se realizan llamadas a Microsoft Graph ni a PostgreSQL.
 *
 * Ejecución: node --test src/__tests__/server.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server.js';

const API_KEY = 'clave-de-prueba-dashboard';

let server;
let baseUrl;

/**
 * Realiza una petición HTTP al servidor de pruebas.
 * @param {string} ruta - Ruta (ej: '/dashboard')
 * @param {object} [opciones] - {method, body, headers}
 * @returns {Promise<{status: number, body: object}>} Respuesta parseada
 */
async function petición(ruta, { method = 'GET', body, headers = {} } = {}) {
  const respuesta = await fetch(`${baseUrl}${ruta}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(body !== undefined ? { 'x-api-key': API_KEY } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const texto = await respuesta.text();
  return {
    status: respuesta.status,
    body: texto ? JSON.parse(texto) : null,
  };
}

const ENTRADA_VALIDA = {
  workflowId: 'dashboard-ejecutivo',
  periodoInicio: '2026-11-02T00:00:00.000Z',
  periodoFin: '2026-11-08T23:59:59.000Z',
  fuenteDatos: 'sintetico',
};

before(async () => {
  process.env.DASHBOARD_API_KEY = API_KEY;
  process.env.PORT = '0';
  server = await startServer();
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  if (server) server.close();
});

describe('servidor HTTP del dashboard', () => {
  it('responde /health sin autenticación', async () => {
    const { status, body } = await petición('/health');

    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });

  it('rechaza /dashboard sin API key con 401', async () => {
    const respuesta = await fetch(`${baseUrl}/dashboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ENTRADA_VALIDA),
    });

    assert.equal(respuesta.status, 401);
  });

  it('devuelve el dashboard con una entrada válida', async () => {
    const { status, body } = await petición('/dashboard', {
      method: 'POST',
      body: ENTRADA_VALIDA,
    });

    assert.equal(status, 200);
    assert.equal(body.exitoso, true);
    assert.equal(body.fuenteDatos, 'sintetico');
    assert.equal(body.datosSinteticos, true);
    assert.equal(body.leadsPorEtapa.total, 10);
    assert.ok(body.fechaActualizacion);
    assert.ok(body.periodo.inicio);
  });

  it('devuelve 400 con detalle de campos cuando la entrada es inválida', async () => {
    const { status, body } = await petición('/dashboard', {
      method: 'POST',
      body: { ...ENTRADA_VALIDA, periodoFin: 'no-es-una-fecha' },
    });

    assert.equal(status, 400);
    assert.equal(body.error.tipo, 'DashboardValidationError');
    assert.ok(body.error.detalles);
  });

  it('devuelve 400 si el body no es JSON válido', async () => {
    const respuesta = await fetch(`${baseUrl}/dashboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: '{roto',
    });

    assert.equal(respuesta.status, 400);
  });

  it('devuelve 404 para rutas desconocidas', async () => {
    const { status, body } = await petición('/otra-ruta');

    assert.equal(status, 404);
    assert.equal(body.error.tipo, 'NotFound');
  });
});
