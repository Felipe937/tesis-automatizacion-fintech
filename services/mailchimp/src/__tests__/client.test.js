/**
 * @fileoverview Tests unitarios para el cliente Mailchimp API v3.
 * Usa el test runner nativo de Node.js (node --test) y mocks de axios.
 * Todos los datos son sintéticos. No se realizan llamadas reales a Mailchimp.
 *
 * Ejecución: node --test src/__tests__/client.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMailchimpClient,
  subscriberHash,
  getServerPrefix,
  MailchimpAuthError,
  MailchimpApiError,
} from '../client.js';

// ---------------------------------------------------------------------------
// Tests de utilidades puras
// ---------------------------------------------------------------------------

describe('subscriberHash', () => {
  it('calcula el MD5 hash del email en minúsculas', () => {
    const hash = subscriberHash('Usuario@Ejemplo.com.co');
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 32); // MD5 = 32 hex chars
    // El mismo email en mayúsculas/minúsculas debe dar el mismo hash
    assert.equal(subscriberHash('USUARIO@EJEMPLO.COM.CO'), hash);
  });
});

describe('getServerPrefix', () => {
  it('extrae el prefijo del servidor de la API Key', () => {
    assert.equal(getServerPrefix('abc123-def456-us21'), 'us21');
    assert.equal(getServerPrefix('key-xyz-us1'), 'us1');
  });

  it('lanza MailchimpAuthError si la API Key no tiene prefijo', () => {
    assert.throws(() => getServerPrefix('sincochete'), MailchimpAuthError);
  });
});

// ---------------------------------------------------------------------------
// Tests de creación del cliente
// ---------------------------------------------------------------------------

describe('createMailchimpClient', () => {
  it('lanza MailchimpAuthError si no hay API key', () => {
    const prevKey = process.env.MAILCHIMP_API_KEY;
    delete process.env.MAILCHIMP_API_KEY;

    assert.throws(() => createMailchimpClient(), MailchimpAuthError);

    if (prevKey) process.env.MAILCHIMP_API_KEY = prevKey;
    else delete process.env.MAILCHIMP_API_KEY;
  });

  it('crea una instancia con API key válida', () => {
    const client = createMailchimpClient({ apiKey: 'testkey123-us21' });
    assert.ok(client);
    assert.equal(typeof client.addOrUpdateMember, 'function');
    assert.equal(typeof client.addTag, 'function');
  });
});

// ---------------------------------------------------------------------------
// Tests de validación de entrada (Zod)
// ---------------------------------------------------------------------------

describe('validación de entrada (Zod)', () => {
  const client = createMailchimpClient({ apiKey: 'testkey123-us21' });

  it('addOrUpdateMember requiere email válido', async () => {
    await assert.rejects(
      () => client.addOrUpdateMember('lista1', 'no-email'),
      (err) => err.name === 'ZodError',
    );
  });

  it('addTag requiere tag no vacío', async () => {
    await assert.rejects(
      () => client.addTag('lista1', 'a@b.com', ''),
      (err) => err.name === 'ZodError',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests de mapeo de errores de API
// ---------------------------------------------------------------------------

describe('mapeo de errores Mailchimp', () => {
  it('MailchimpAuthError tiene nombre correcto', () => {
    const err = new MailchimpAuthError('api key inválida');
    assert.equal(err.name, 'MailchimpAuthError');
    assert.equal(err.message, 'api key inválida');
  });

  it('MailchimpApiError expone statusCode y mailchimpError', () => {
    const cause = new Error('network');
    const err = new MailchimpApiError('fallo', 500, { title: 'Server Error' }, cause);
    assert.equal(err.name, 'MailchimpApiError');
    assert.equal(err.statusCode, 500);
    assert.equal(err.mailchimpError.title, 'Server Error');
    assert.equal(err.cause, cause);
  });
});
