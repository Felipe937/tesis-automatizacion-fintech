/**
 * @fileoverview Tests de autenticación OAuth 2.0 y de manejo de errores HTTP
 * del cliente de HubSpot.
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
  createHubSpotClient,
  resolverModoAutenticacion,
  HubSpotAuthError,
  HubSpotApiError,
} from '../client.js';
import { TokenRevokedError, OAuth2Error } from '../../../common/oauth2.js';

/**
 * Crea un adapter de axios de prueba.
 * @param {object} opciones - {status, data, error}
 * @returns {Function} Adapter con propiedad `llamadas`
 */
function crearAdapter({ status = 200, data = { results: [] }, error = false } = {}) {
  const llamadas = [];
  const adapter = async (config) => {
    llamadas.push({
      method: config.method,
      url: config.url,
      authorization: config.headers?.Authorization,
      body: config.data,
    });
    if (error) {
      const err = new Error(`HTTP ${status}`);
      err.response = { status, data };
      err.config = config;
      throw err;
    }
    return {
      data,
      status,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  adapter.llamadas = llamadas;
  return adapter;
}

// ---------------------------------------------------------------------------
// Resolución del modo de autenticación
// ---------------------------------------------------------------------------

describe('resolverModoAutenticacion (HubSpot)', () => {
  it('lanza HubSpotAuthError si no hay ninguna credencial', () => {
    const env = { ...process.env };
    delete process.env.HUBSPOT_ACCESS_TOKEN;
    delete process.env.HUBSPOT_CLIENT_ID;
    delete process.env.HUBSPOT_CLIENT_SECRET;
    delete process.env.HUBSPOT_REFRESH_TOKEN;
    delete process.env.HUBSPOT_AUTH_MODE;

    try {
      assert.throws(() => resolverModoAutenticacion(), HubSpotAuthError);
    } finally {
      process.env = env;
    }
  });

  it('detecta el modo private_app a partir del access token', () => {
    assert.equal(resolverModoAutenticacion({ accessToken: 'pat-na1-demo' }), 'private_app');
  });

  it('detecta el modo oauth2 a partir de clientId + clientSecret + refreshToken', () => {
    assert.equal(
      resolverModoAutenticacion({
        clientId: 'cid',
        clientSecret: 'sec',
        refreshToken: 'ref',
      }),
      'oauth2',
    );
  });

  it('respeta el modo explícito', () => {
    assert.equal(resolverModoAutenticacion({ mode: 'oauth2' }), 'oauth2');
    assert.equal(resolverModoAutenticacion({ mode: 'private_app' }), 'private_app');
  });
});

// ---------------------------------------------------------------------------
// Envío del token
// ---------------------------------------------------------------------------

describe('envío del token (HubSpot)', () => {
  it('envía el token OAuth 2.0 como Bearer', async () => {
    const adapter = crearAdapter({ data: { results: [] } });
    const client = createHubSpotClient({
      mode: 'oauth2',
      tokenProvider: { getAccessToken: async () => 'oauth-token', invalidate: () => {} },
      adapter,
    });

    assert.equal(client.modoAutenticacion, 'oauth2');

    await client.getContact('usuario@ejemplo.com.co');

    assert.equal(adapter.llamadas.length, 1);
    assert.equal(adapter.llamadas[0].authorization, 'Bearer oauth-token');
  });

  it('envía el Private App Token como Bearer en modo private_app', async () => {
    const adapter = crearAdapter({ data: { results: [] } });
    const client = createHubSpotClient({
      mode: 'private_app',
      accessToken: 'pat-na1-demo',
      adapter,
    });

    await client.getContact('usuario@ejemplo.com.co');

    assert.equal(adapter.llamadas[0].authorization, 'Bearer pat-na1-demo');
  });
});

// ---------------------------------------------------------------------------
// Manejo de errores
// ---------------------------------------------------------------------------

describe('errores del cliente HubSpot', () => {
  it('mapea 401 a HubSpotAuthError', async () => {
    const adapter = crearAdapter({ status: 401, data: { message: 'expired' }, error: true });
    const client = createHubSpotClient({
      mode: 'private_app',
      accessToken: 'pat-na1-demo',
      adapter,
    });

    await assert.rejects(() => client.getContact('usuario@ejemplo.com.co'), HubSpotAuthError);
  });

  it('reintenta una vez con un token renovado cuando la API devuelve 401', async () => {
    let invalidadas = 0;
    let tokenActual = 'token-caducado';
    const adapter = async (config) => {
      if (tokenActual === 'token-caducado') {
        tokenActual = 'token-nuevo';
        const err = new Error('HTTP 401');
        err.response = { status: 401, data: { message: 'expired' } };
        err.config = config;
        throw err;
      }
      return { data: { results: [] }, status: 200, statusText: 'OK', headers: {}, config };
    };

    const client = createHubSpotClient({
      mode: 'oauth2',
      tokenProvider: {
        getAccessToken: async () => tokenActual,
        invalidate: () => {
          invalidadas += 1;
        },
      },
      adapter,
    });

    const resultado = await client.getContact('usuario@ejemplo.com.co');

    assert.deepEqual(resultado, []);
    assert.equal(invalidadas, 1);
  });

  it('mapea 404 a HubSpotApiError con su statusCode', async () => {
    const adapter = crearAdapter({ status: 404, data: { message: 'no existe' }, error: true });
    const client = createHubSpotClient({
      mode: 'private_app',
      accessToken: 'pat-na1-demo',
      adapter,
    });

    await assert.rejects(
      () => client.getContact('usuario@ejemplo.com.co'),
      (err) => {
        assert.ok(err instanceof HubSpotApiError);
        assert.equal(err.statusCode, 404);
        assert.equal(err.hubspotError.message, 'no existe');
        return true;
      },
    );
  });

  it('mapea un refresh token revocado a HubSpotAuthError', async () => {
    const client = createHubSpotClient({
      mode: 'oauth2',
      tokenProvider: {
        getAccessToken: async () => {
          throw new TokenRevokedError('refresh token revocado');
        },
        invalidate: () => {},
      },
      adapter: crearAdapter(),
    });

    await assert.rejects(
      () => client.getContact('usuario@ejemplo.com.co'),
      (err) => {
        assert.ok(err instanceof HubSpotAuthError);
        assert.match(err.message, /revocado|autorización/i);
        return true;
      },
    );
  });

  it('mapea un fallo genérico de OAuth a HubSpotAuthError', async () => {
    const client = createHubSpotClient({
      mode: 'oauth2',
      tokenProvider: {
        getAccessToken: async () => {
          throw new OAuth2Error('endpoint caído');
        },
        invalidate: () => {},
      },
      adapter: crearAdapter(),
    });

    await assert.rejects(() => client.getContact('usuario@ejemplo.com.co'), HubSpotAuthError);
  });

  it('rechaza respuestas incompletas de la API', async () => {
    const adapter = crearAdapter({ data: { results: [{ id: 42 }] } });
    const client = createHubSpotClient({
      mode: 'private_app',
      accessToken: 'pat-na1-demo',
      adapter,
    });

    await assert.rejects(
      () => client.getContact('usuario@ejemplo.com.co'),
      (err) => err.name === 'ZodError',
    );
  });
});
