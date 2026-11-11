/**
 * @fileoverview Tests unitarios para el cliente Calendly API v2 y validación de webhooks.
 * Usa el test runner nativo de Node.js (node --test) y mocks de axios.
 * Todos los datos son sintéticos. No se realizan llamadas reales a Calendly.
 *
 * Ejecución: node --test src/__tests__/client.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  createCalendlyClient,
  validateCalendlyWebhook,
  parseCalendlyWebhookPayload,
  CalendlyAuthError,
  CalendlyWebhookValidationError,
} from '../client.js';

// ---------------------------------------------------------------------------
// Tests de validación de webhooks HMAC
// ---------------------------------------------------------------------------

describe('validateCalendlyWebhook', () => {
  const secret = 'mi-clave-secreta-de-webhook-calendly';
  const payload = JSON.stringify({
    event: 'invitee.created',
    payload: {
      invitee: { email: 'usuario@ejemplo.com.co', first_name: 'Juan', last_name: 'Pérez' },
      event: { start_time: '2026-11-10T10:00:00Z', end_time: '2026-11-10T11:00:00Z' },
    },
  });

  it('retorna true con firma HMAC válida', () => {
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    assert.equal(validateCalendlyWebhook(payload, signature, secret), true);
  });

  it('retorna false con firma inválida', () => {
    assert.equal(validateCalendlyWebhook(payload, 'firma-invalida', secret), false);
  });

  it('lanza CalendlyWebhookValidationError si falta la firma', () => {
    assert.throws(() => validateCalendlyWebhook(payload, '', secret), CalendlyWebhookValidationError);
  });

  it('lanza CalendlyWebhookValidationError si falta el secreto', () => {
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    assert.throws(() => validateCalendlyWebhook(payload, signature, ''), CalendlyWebhookValidationError);
  });
});

// ---------------------------------------------------------------------------
// Tests de parseo de payload de webhook
// ---------------------------------------------------------------------------

describe('parseCalendlyWebhookPayload', () => {
  const payloadValido = {
    event: 'invitee.created',
    payload: {
      invitee: {
        email: 'usuario@ejemplo.com.co',
        first_name: 'Juan',
        last_name: 'Pérez',
        phone_number: '+57 300 123 4567',
        uri: 'https://api.calendly.com/scheduled_events/uuid/invitees/uuid2',
      },
      event: {
        start_time: '2026-11-10T10:00:00Z',
        end_time: '2026-11-10T11:00:00Z',
        uri: 'https://api.calendly.com/scheduled_events/uuid',
      },
    },
  };

  it('valida un payload de webhook correcto', () => {
    const resultado = parseCalendlyWebhookPayload(payloadValido);
    assert.equal(resultado.event, 'invitee.created');
    assert.equal(resultado.payload.invitee.email, 'usuario@ejemplo.com.co');
  });

  it('rechaza un payload con email inválido', () => {
    const invalido = { ...payloadValido };
    invalido.payload.invitee.email = 'no-es-un-email';
    assert.throws(() => parseCalendlyWebhookPayload(invalido), (err) => err.name === 'ZodError');
  });
});

// ---------------------------------------------------------------------------
// Tests de creación del cliente
// ---------------------------------------------------------------------------

describe('createCalendlyClient', () => {
  it('lanza CalendlyAuthError si no hay accessToken', () => {
    const prevToken = process.env.CALENDLY_API_TOKEN;
    delete process.env.CALENDLY_API_TOKEN;

    assert.throws(() => createCalendlyClient(), CalendlyAuthError);

    if (prevToken) process.env.CALENDLY_API_TOKEN = prevToken;
    else delete process.env.CALENDLY_API_TOKEN;
  });

  it('crea una instancia con token válido', () => {
    const client = createCalendlyClient({ accessToken: 'calendly-pat-test-123' });
    assert.ok(client);
    assert.equal(typeof client.getEvent, 'function');
    assert.equal(typeof client.getInvitee, 'function');
  });
});
