/**
 * @fileoverview Tests de autenticación OAuth 2.0 y de manejo de errores HTTP
 * del cliente de Mailchimp.
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
  createMailchimpClient,
  resolverModoAutenticacion,
  subscriberHash,
  MailchimpAuthError,
  MailchimpApiError,
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
      body: config.data,
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

const RESPUESTA_MEMBRO = {
  id: 'mem-1',
  email_address: 'usuario@ejemplo.com.co',
  status: 'subscribed',
  merge_fields: { FNAME: 'Usuario' },
  tags: [],
  unique_email_id: 'u-1',
  timestamp_opt: '2026-11-10T12:00:00Z',
  last_changed: '2026-11-10T12:00:00Z',
  list_id: 'list-1',
};

// ---------------------------------------------------------------------------
// Resolución del modo de autenticación
// ---------------------------------------------------------------------------

describe('resolverModoAutenticacion (Mailchimp)', () => {
  it('lanza MailchimpAuthError si no hay ninguna credencial', () => {
    const env = { ...process.env };
    delete process.env.MAILCHIMP_API_KEY;
    delete process.env.MAILCHIMP_ACCESS_TOKEN;
    delete process.env.MAILCHIMP_CLIENT_ID;
    delete process.env.MAILCHIMP_CLIENT_SECRET;
    delete process.env.MAILCHIMP_OAUTH_CODE;
    delete process.env.MAILCHIMP_AUTH_MODE;

    try {
      assert.throws(() => resolverModoAutenticacion(), MailchimpAuthError);
    } finally {
      process.env = env;
    }
  });

  it('detecta el modo api_key', () => {
    assert.equal(resolverModoAutenticacion({ apiKey: 'abc-us21' }), 'api_key');
  });

  it('detecta el modo oauth2 con code o access token', () => {
    assert.equal(
      resolverModoAutenticacion({ clientId: 'c', clientSecret: 's', code: 'code' }),
      'oauth2',
    );
    assert.equal(resolverModoAutenticacion({ accessToken: 'tok' }), 'oauth2');
  });
});

// ---------------------------------------------------------------------------
// Cabecera de autorización
// ---------------------------------------------------------------------------

describe('cabecera de autorización (Mailchimp)', () => {
  it('envía "apikey <key>" en modo api_key', async () => {
    const adapter = crearAdapter({ data: RESPUESTA_MEMBRO });
    const client = createMailchimpClient({
      mode: 'api_key',
      apiKey: 'clave-demo-us21',
      serverPrefix: 'us21',
      adapter,
    });

    await client.addOrUpdateMember('list-1', 'usuario@ejemplo.com.co');

    assert.equal(adapter.llamadas[0].authorization, 'apikey clave-demo-us21');
  });

  it('envía "Bearer <token>" en modo oauth2', async () => {
    const adapter = crearAdapter({ data: RESPUESTA_MEMBRO });
    const client = createMailchimpClient({
      mode: 'oauth2',
      accessToken: 'oauth-token',
      serverPrefix: 'us21',
      adapter,
    });

    assert.equal(client.modoAutenticacion, 'oauth2');

    await client.addOrUpdateMember('list-1', 'usuario@ejemplo.com.co');

    assert.equal(adapter.llamadas[0].authorization, 'Bearer oauth-token');
  });

  it('exige el datacenter en modo oauth2', () => {
    const env = { ...process.env };
    delete process.env.MAILCHIMP_SERVER_PREFIX;
    try {
      assert.throws(
        () =>
          createMailchimpClient({
            mode: 'oauth2',
            accessToken: 'oauth-token',
          }),
        MailchimpAuthError,
      );
    } finally {
      process.env = env;
    }
  });
});

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

describe('errores del cliente Mailchimp', () => {
  it('mapea 401 a MailchimpAuthError', async () => {
    const adapter = crearAdapter({ status: 401, data: { title: 'Unauthorized' }, error: true });
    const client = createMailchimpClient({
      mode: 'oauth2',
      accessToken: 'oauth-token',
      serverPrefix: 'us21',
      adapter,
    });

    await assert.rejects(
      () => client.addOrUpdateMember('list-1', 'usuario@ejemplo.com.co'),
      MailchimpAuthError,
    );
  });

  it('mapea 400 a MailchimpApiError con su statusCode', async () => {
    const adapter = crearAdapter({
      status: 400,
      data: { title: 'Invalid Resource', message: 'email inválido' },
      error: true,
    });
    const client = createMailchimpClient({
      mode: 'api_key',
      apiKey: 'clave-demo-us21',
      serverPrefix: 'us21',
      adapter,
    });

    await assert.rejects(
      () => client.addOrUpdateMember('list-1', 'usuario@ejemplo.com.co'),
      (err) => {
        assert.ok(err instanceof MailchimpApiError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.mailchimpError.title, 'Invalid Resource');
        return true;
      },
    );
  });

  it('rechaza respuestas incompletas de la API', async () => {
    const adapter = crearAdapter({ data: { id: 'mem-1' } });
    const client = createMailchimpClient({
      mode: 'api_key',
      apiKey: 'clave-demo-us21',
      serverPrefix: 'us21',
      adapter,
    });

    await assert.rejects(
      () => client.addOrUpdateMember('list-1', 'usuario@ejemplo.com.co'),
      (err) => err.name === 'ZodError',
    );
  });

  it('calcula el subscriber_hash en minúsculas', () => {
    assert.equal(
      subscriberHash('  USUARIO@Ejemplo.com.CO '),
      subscriberHash('usuario@ejemplo.com.co'),
    );
    assert.equal(subscriberHash('usuario@ejemplo.com.co').length, 32);
  });
});
