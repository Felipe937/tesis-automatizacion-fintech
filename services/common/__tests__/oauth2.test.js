/**
 * @fileoverview Tests unitarios de los helpers compartidos de OAuth 2.0.
 *
 * No se performs llamadas de red: el `fetch` se sustituye por un doble de
 * prueba que devuelve respuestas sintéticas.
 *
 * Ejecución: node --test __tests__/oauth2.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createStaticTokenProvider,
  createRefreshTokenProvider,
  createAuthorizationCodeProvider,
  OAuth2Error,
  OAuth2ClientError,
  TokenRevokedError,
} from '../oauth2.js';

/**
 * Construye un doble de fetch que devuelve una respuesta JSON controlada.
 * @param {object} opciones - {status, body}
 * @returns {Function} Función fetch de prueba
 */
function crearFetchDoble({ status = 200, body = {} } = {}) {
  const llamadas = [];
  const fn = async (url, opciones) => {
    llamadas.push({ url, opciones });
    const payload =
      status >= 200 && status < 300
        ? body
        : body && Object.keys(body).length > 0
          ? body
          : { error: 'server_error', error_description: 'fallo' };
    const texto = JSON.stringify(payload);
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return texto;
      },
    };
  };
  fn.llamadas = llamadas;
  return fn;
}

// ---------------------------------------------------------------------------
// Proveedor estático
// ---------------------------------------------------------------------------

describe('createStaticTokenProvider', () => {
  it('devuelve siempre el mismo token', async () => {
    const provider = createStaticTokenProvider({ token: 'tok-123', label: 'Proveedor' });
    assert.equal(await provider.getAccessToken(), 'tok-123');
    assert.equal(await provider.getAccessToken(), 'tok-123');
    assert.equal(provider.mode, 'static');
  });

  it('lanza si no hay token', () => {
    assert.throws(() => createStaticTokenProvider({ token: '' }), OAuth2Error);
  });

  it('lanza si el token ya expiró', async () => {
    const provider = createStaticTokenProvider({
      token: 'tok-vencido',
      expiresInMs: -1000,
    });
    await assert.rejects(() => provider.getAccessToken(), /expiró/i);
  });
});

// ---------------------------------------------------------------------------
// Proveedor con refresh_token (HubSpot)
// ---------------------------------------------------------------------------

describe('createRefreshTokenProvider', () => {
  const config = {
    tokenEndpoint: 'https://api.hubapi.com/oauth/v1/token',
    clientId: 'client-1',
    clientSecret: 'secret-1',
    refreshToken: 'refresh-1',
  };

  it('exige la configuración completa', () => {
    assert.throws(() => createRefreshTokenProvider({ ...config, refreshToken: '' }), OAuth2Error);
  });

  it('canjea el refresh token por un access token', async () => {
    const fetchDoble = crearFetchDoble({
      body: { access_token: 'access-1', expires_in: 3600 },
    });
    const provider = createRefreshTokenProvider({ ...config, fetchImpl: fetchDoble });

    assert.equal(await provider.getAccessToken(), 'access-1');
    assert.equal(fetchDoble.llamadas.length, 1);
    assert.equal(fetchDoble.llamadas[0].url, config.tokenEndpoint);
    assert.match(fetchDoble.llamadas[0].opciones.body, /grant_type=refresh_token/);
  });

  it('cachea el token y no vuelve a llamar al endpoint', async () => {
    const fetchDoble = crearFetchDoble({
      body: { access_token: 'access-1', expires_in: 3600 },
    });
    const provider = createRefreshTokenProvider({ ...config, fetchImpl: fetchDoble });

    await provider.getAccessToken();
    await provider.getAccessToken();

    assert.equal(fetchDoble.llamadas.length, 1);
  });

  it('renueva el token cuando se invalida la caché', async () => {
    const fetchDoble = crearFetchDoble({
      body: { access_token: 'access-1', expires_in: 3600 },
    });
    const provider = createRefreshTokenProvider({ ...config, fetchImpl: fetchDoble });

    await provider.getAccessToken();
    provider.invalidate();
    await provider.getAccessToken();

    assert.equal(fetchDoble.llamadas.length, 2);
  });

  it('mapea invalid_grant a TokenRevokedError', async () => {
    const fetchDoble = crearFetchDoble({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'refresh token expirado' },
    });
    const provider = createRefreshTokenProvider({ ...config, fetchImpl: fetchDoble });

    await assert.rejects(() => provider.getAccessToken(), TokenRevokedError);
  });

  it('mapea 401 a OAuth2ClientError', async () => {
    const fetchDoble = crearFetchDoble({
      status: 401,
      body: { error: 'invalid_client' },
    });
    const provider = createRefreshTokenProvider({ ...config, fetchImpl: fetchDoble });

    await assert.rejects(() => provider.getAccessToken(), OAuth2ClientError);
  });

  it('mapea errores de red a OAuth2Error', async () => {
    const provider = createRefreshTokenProvider({
      ...config,
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    await assert.rejects(() => provider.getAccessToken(), /ECONNREFUSED/);
  });

  it('lanza si la respuesta no trae access_token', async () => {
    const fetchDoble = crearFetchDoble({ body: { token_type: 'bearer' } });
    const provider = createRefreshTokenProvider({ ...config, fetchImpl: fetchDoble });

    await assert.rejects(() => provider.getAccessToken(), /access_token/);
  });
});

// ---------------------------------------------------------------------------
// Proveedor con authorization_code (Mailchimp)
// ---------------------------------------------------------------------------

describe('createAuthorizationCodeProvider', () => {
  const config = {
    tokenEndpoint: 'https://login.mailchimp.com/oauth2/token',
    clientId: 'client-2',
    clientSecret: 'secret-2',
    code: 'code-2',
  };

  it('exige la configuración completa', () => {
    assert.throws(() => createAuthorizationCodeProvider({ ...config, code: '' }), OAuth2Error);
  });

  it('intercambia el código por un access token una sola vez', async () => {
    const fetchDoble = crearFetchDoble({ body: { access_token: 'mc-token' } });
    const provider = createAuthorizationCodeProvider({ ...config, fetchImpl: fetchDoble });

    assert.equal(await provider.getAccessToken(), 'mc-token');
    assert.equal(await provider.getAccessToken(), 'mc-token');
    assert.equal(fetchDoble.llamadas.length, 1);
    assert.match(fetchDoble.llamadas[0].opciones.body, /grant_type=authorization_code/);
  });

  it('mapea un token revocado a TokenRevokedError', async () => {
    const fetchDoble = crearFetchDoble({
      status: 400,
      body: { error: 'invalid_grant' },
    });
    const provider = createAuthorizationCodeProvider({ ...config, fetchImpl: fetchDoble });

    await assert.rejects(() => provider.getAccessToken(), TokenRevokedError);
  });
});
