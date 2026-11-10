/**
 * @fileoverview Cliente autenticado para Calendly API v2 y validación de webhooks.
 *
 * Autenticación: Bearer token desde process.env.CALENDLY_API_TOKEN.
 * Validación de webhooks: HMAC SHA256 con CALENDLY_WEBHOOK_SECRET.
 *
 * Endpoints utilizados:
 *   GET /scheduled_events/{uuid}
 *   GET /scheduled_events/{uuid}/invitees/{uuid}
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import axios from 'axios';
import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  CalendlyWebhookPayloadSchema,
  EventResponseSchema,
  InviteeResponseSchema,
} from './schemas.js';

const CALENDLY_BASE_URL = 'https://api.calendly.com';
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Error de autenticación con Calendly (401/403).
 */
export class CalendlyAuthError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'CalendlyAuthError';
    this.cause = cause;
  }
}

/**
 * Error de API de Calendly (otros códigos HTTP).
 */
export class CalendlyApiError extends Error {
  constructor(message, statusCode, calendlyError, cause) {
    super(message);
    this.name = 'CalendlyApiError';
    this.statusCode = statusCode;
    this.calendlyError = calendlyError;
    this.cause = cause;
  }
}

/**
 * Error de validación de firma HMAC de webhook.
 */
export class CalendlyWebhookValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CalendlyWebhookValidationError';
  }
}

/**
 * Construye y devuelve un cliente configurado para Calendly API v2.
 *
 * @param {object} config - Configuración del cliente
 * @param {string} [config.accessToken] - Bearer token de Calendly.
 *   Si no se pasa, se lee de process.env.CALENDLY_API_TOKEN.
 * @returns {object} Instancia del cliente Calendly
 * @throws {CalendlyAuthError} Si no se configura ningún token
 */
export function createCalendlyClient(config = {}) {
  const accessToken = config.accessToken || process.env.CALENDLY_API_TOKEN;

  if (!accessToken) {
    throw new CalendlyAuthError(
      'No se configuró CALENDLY_API_TOKEN. ' +
        'Define la variable de entorno con un Personal Access Token de Calendly.',
    );
  }

  const httpClient = axios.create({
    baseURL: CALENDLY_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  /**
   * Ejecuta una petición a Calendly API y mapea errores a excepciones tipadas.
   * @private
   */
  async function request(method, endpoint) {
    try {
      const response = await httpClient.request({ method, url: endpoint });
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      const calendlyError = error?.response?.data;

      if (status === 401 || status === 403) {
        throw new CalendlyAuthError(
          `Acceso denegado a Calendly API (HTTP ${status}). ` +
            `Verifica el token de acceso.`,
          error,
        );
      }

      throw new CalendlyApiError(
        `Error en Calendly API [${method.toUpperCase()} ${endpoint}] HTTP ${status ?? 'N/A'}: ${calendlyError?.message ?? error.message}`,
        status,
        calendlyError,
        error,
      );
    }
  }

  return {
    /**
     * Obtiene los detalles de un evento programado de Calendly.
     *
     * @param {string} uri - URI completa del evento (devuelta por el webhook)
     * @returns {Promise<object>} Detalles del evento programado
     * @throws {CalendlyAuthError} Si el token es inválido
     * @throws {CalendlyApiError} Por errores de red o API de Calendly
     */
    async getEvent(uri) {
      console.log(`[CalendlyClient] getEvent: ${uri}`);
      const data = await request('get', uri);
      return EventResponseSchema.parse(data);
    },

    /**
     * Obtiene los detalles de un invitado específico de un evento.
     *
     * @param {string} uri - URI completa del invitado (devuelta por el webhook)
     * @returns {Promise<object>} Detalles del invitado
     * @throws {CalendlyAuthError} Si el token es inválido
     * @throws {CalendlyApiError} Por errores de red o API de Calendly
     */
    async getInvitee(uri) {
      console.log(`[CalendlyClient] getInvitee: ${uri}`);
      const data = await request('get', uri);
      return InviteeResponseSchema.parse(data);
    },
  };
}

/**
 * Valida la firma HMAC de un webhook entrante de Calendly.
 *
 * Calendly envía la firma en el header `X-Calendly-Signature` usando HMAC-SHA256
 * con el webhook signing key como secreto.
 *
 * @param {string} payload - Cuerpo crudo del request (string o Buffer)
 * @param {string} signature - Valor del header X-Calendly-Signature
 * @param {string} secret - Clave de firma del webhook (CALENDLY_WEBHOOK_SECRET)
 * @returns {boolean} true si la firma es válida
 * @throws {CalendlyWebhookValidationError} Si faltan parámetros
 */
export function validateCalendlyWebhook(payload, signature, secret) {
  if (!signature) {
    throw new CalendlyWebhookValidationError(
      'Falta la firma HMAC (header X-Calendly-Signature) en el webhook de Calendly.',
    );
  }

  if (!secret) {
    throw new CalendlyWebhookValidationError(
      'No se configuró CALENDLY_WEBHOOK_SECRET. No se puede validar el webhook.',
    );
  }

  const expected = createHmac('sha256', secret)
    .update(typeof payload === 'string' ? payload : Buffer.from(payload))
    .digest('hex');

  // Comparación en tiempo constante para evitar ataques de timing
  const signatureBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  if (signatureBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(signatureBuf, expectedBuf);
}

/**
 * Valida y parsea el payload de un webhook de Calendly.
 *
 * @param {object} payload - Objeto JSON del payload del webhook
 * @returns {object} Payload validado con evento e invitee
 * @throws {CalendlyWebhookValidationError} Si el payload no es válido
 */
export function parseCalendlyWebhookPayload(payload) {
  const validated = CalendlyWebhookPayloadSchema.parse(payload);
  return validated;
}