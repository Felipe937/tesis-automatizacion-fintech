/**
 * @fileoverview Tests de autenticación (OAuth 2.1 / Personal Access Token) y de
 * manejo de errores HTTP del cliente de Calendly.
 *
 * No se realizan llamadas reales: se inyecta un adapter de axios de prueba.
 *
 * Ejecución: node --test src/__tests__/oauth.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCalendlyClient,
  resolverModoAutenticacion,
  CalendlyAuthError,
  CalendlyApiError,
} from '../client.js';

/**
 * Crea un adapter de axios de prueba.
 * @param {object} opciones - {status, data, error}
 * @returns {Function} Adapter con propiedad `llamadas`
 */
function crearAdapter({ status = 200, data = {}, error = false } = {}) {
  const llamadas = [];
  const adapter = async (config) => {
    llamadas.push({
      method: config.method,
      url: config.url,
      authorization: config.headers?.Authorization,
    });
    if (error) {
      const err = new Error(`HTTP ${status}`);
      err.response = { status, data };
      err.config = config;
      throw err;
    }
    return { data, status, statusText: 'OK', headers: {}, config };
  };
  adapter.llamadas = llamadas;
  return adapter;
}

const RESPUESTA_EVENTO = {
  uri: 'https://api.calendly.com/scheduled_events/EV-1',
  name: 'Reunión de asesoría',
  status: 'active',
  start_time: '2026-11-10T14:00:00.000000Z',
  end_time: '2026-11-10T15:00:00.000000Z',
  event_type: 'https://api.calendly.com/event_types/ET-1',
  location: { type: 'google_conference' },
  invitees_counter: { total: 1, active: 1, limit: 1 },
  created_at: '2026-11-01T10:00:00.000000Z',
  updated_at: '2026-11-01T10:00:00.000000Z',
};

// ---------------------------------------------------------------------------
// Resolución del modo de autenticación
// ---------------------------------------------------------------------------

describe('resolverModoAutenticacion (Calendly)', () => {
  it('lanza CalendlyAuthError si no hay ninguna credencial', () => {
    const env = { ...process.env };
    delete process.env.CALENDLY_ACCESS_TOKEN;
    delete process.env.CALENDLY_API_TOKEN;
    delete process.env.CALENDLY_AUTH_MODE;

    try {
      assert.throws(() => resolverModoAutenticacion(), CalendlyAuthError);
    } finally {
      process.env = env;
    }
  });

  it('prefiere el token OAuth 2.1 sobre el Personal Access Token', () => {
    assert.equal(
      resolverModoAutenticacion({ accessToken: 'oauth', personalAccessToken: 'pat' }),
      'oauth2',
    );
  });

  it('usa el Personal Access Token cuando no hay token OAuth', () => {
    assert.equal(resolverModoAutenticacion({ personalAccessToken: 'pat' }), 'pat');
  });
});

// ---------------------------------------------------------------------------
// Envío del token
// ---------------------------------------------------------------------------

describe('envío del token (Calendly)', () => {
  it('envía el token OAuth 2.1 como Bearer', async () => {
    const adapter = crearAdapter({ data: RESPUESTA_EVENTO });
    const client = createCalendlyClient({
      mode: 'oauth2',
      accessToken: 'oauth-token',
      adapter,
    });

    assert.equal(client.modoAutenticacion, 'oauth2');

    const evento = await client.getEvent('https://api.calendly.com/scheduled_events/EV-1');

    assert.equal(adapter.llamadas[0].authorization, 'Bearer oauth-token');
    assert.equal(evento.status, 'active');
  });

  it('envía el Personal Access Token como Bearer', async () => {
    const adapter = crearAdapter({ data: RESPUESTA_EVENTO });
    const client = createCalendlyClient({
      mode: 'pat',
      personalAccessToken: 'pat-token',
      adapter,
    });

    await client.getEvent('https://api.calendly.com/scheduled_events/EV-1');

    assert.equal(adapter.llamadas[0].authorization, 'Bearer pat-token');
  });

  it('lanza CalendlyAuthError si el token expiró', async () => {
    const client = createCalendlyClient({
      mode: 'oauth2',
      accessToken: 'oauth-token',
      tokenExpiresInMs: -1000,
      adapter: crearAdapter(),
    });

    await assert.rejects(
      () => client.getEvent('https://api.calendly.com/scheduled_events/EV-1'),
      CalendlyAuthError,
    );
  });
});

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

describe('errores del cliente Calendly', () => {
  it('mapea 401 a CalendlyAuthError', async () => {
    const adapter = crearAdapter({ status: 401, data: { message: 'expired' }, error: true });
    const client = createCalendlyClient({
      mode: 'pat',
      personalAccessToken: 'pat-token',
      adapter,
    });

    await assert.rejects(
      () => client.getEvent('https://api.calendly.com/scheduled_events/EV-1'),
      CalendlyAuthError,
    );
  });

  it('mapea 404 a CalendlyApiError con su statusCode', async () => {
    const adapter = crearAdapter({ status: 404, data: { message: 'no existe' }, error: true });
    const client = createCalendlyClient({
      mode: 'pat',
      personalAccessToken: 'pat-token',
      adapter,
    });

    await assert.rejects(
      () => client.getEvent('https://api.calendly.com/scheduled_events/EV-1'),
      (err) => {
        assert.ok(err instanceof CalendlyApiError);
        assert.equal(err.statusCode, 404);
        return true;
      },
    );
  });

  it('rechaza respuestas incompletas de la API', async () => {
    const adapter = crearAdapter({ data: { uri: 'https://api.calendly.com/x' } });
    const client = createCalendlyClient({
      mode: 'pat',
      personalAccessToken: 'pat-token',
      adapter,
    });

    await assert.rejects(
      () => client.getEvent('https://api.calendly.com/scheduled_events/EV-1'),
      (err) => err.name === 'ZodError',
    );
  });
});
