/**
 * @fileoverview Cliente autenticado para Mailchimp API v3.
 *
 * Autenticación: API Key en header `Authorization: apikey {key}`.
 * La API Key se lee de process.env.MAILCHIMP_API_KEY.
 * El server prefix (ej: us21) se deriva de la API Key o de MAILCHIMP_SERVER_PREFIX.
 *
 * Endpoints utilizados:
 *   PUT  /lists/{list_id}/members/{subscriber_hash}   (crear/actualizar suscriptor)
 *   POST /lists/{list_id}/members/{subscriber_hash}/tags (añadir tag)
 *
 * Reintentos: automáticos ante HTTP 429 y 5xx, máximo 3 intentos con backoff exponencial.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import axios from 'axios';
import axiosRetry from 'axios-retry';
import { createHash } from 'node:crypto';

import {
  AddOrUpdateMemberInputSchema,
  AddTagInputSchema,
  MemberResponseSchema,
  TagsResponseSchema,
} from './schemas.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

/**
 * Error de autenticación con Mailchimp (401).
 */
export class MailchimpAuthError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'MailchimpAuthError';
    this.cause = cause;
  }
}

/**
 * Error de API de Mailchimp (otros códigos HTTP).
 */
export class MailchimpApiError extends Error {
  constructor(message, statusCode, mailchimpError, cause) {
    super(message);
    this.name = 'MailchimpApiError';
    this.statusCode = statusCode;
    this.mailchimpError = mailchimpError;
    this.cause = cause;
  }
}

/**
 * Calcula el MD5 hash del email en minúsculas, usado como subscriber_hash
 * en los endpoints de miembros de Mailchimp.
 *
 * @param {string} email - Correo electrónico
 * @returns {string} Hash MD5 hexadecimal (32 caracteres)
 */
export function subscriberHash(email) {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * Obtiene el server prefix (ej: us21) de una API Key de Mailchimp.
 * El formato de la clave es: <key>-<prefix> (ej: abc123-us21).
 *
 * @param {string} apiKey - API Key de Mailchimp
 * @returns {string} Server prefix
 */
export function getServerPrefix(apiKey) {
  const parts = apiKey.split('-');
  if (parts.length < 2) {
    throw new MailchimpAuthError(
      'API Key de Mailchimp inválida. Formato esperado: <key>-<prefix> (ej: abc123-us21).',
    );
  }
  return parts[parts.length - 1];
}

/**
 * Construye y devuelve un cliente configurado para Mailchimp API v3.
 *
 * @param {object} config - Configuración del cliente
 * @param {string} [config.apiKey] - API Key de Mailchimp. Si no se pasa,
 *   se lee de process.env.MAILCHIMP_API_KEY.
 * @param {string} [config.serverPrefix] - Prefijo del servidor (us21, etc.).
 *   Si no se pasa, se deriva de la API Key.
 * @returns {object} Instancia del cliente Mailchimp
 * @throws {MailchimpAuthError} Si no se configura ninguna API Key
 */
export function createMailchimpClient(config = {}) {
  const apiKey = config.apiKey || process.env.MAILCHIMP_API_KEY;

  if (!apiKey) {
    throw new MailchimpAuthError(
      'No se configuró MAILCHIMP_API_KEY. ' +
        'Define la variable de entorno con una API Key válida de Mailchimp.',
    );
  }

  const serverPrefix = config.serverPrefix || getServerPrefix(apiKey);
  const BASE_URL = `https://${serverPrefix}.api.mailchimp.com/3.0`;

  const httpClient = axios.create({
    baseURL: BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `apikey ${apiKey}`,
    },
  });

  // Reintentos automáticos con backoff exponencial para 429 y 5xx
  axiosRetry(httpClient, {
    retries: MAX_RETRIES,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) =>
      axiosRetry.isNetworkError(error) ||
      axiosRetry.isRetryableError(error) ||
      (error?.response?.status >= 500 && error?.response?.status < 600) ||
      error?.response?.status === 429,
    onRetry: (retryCount, error) => {
      console.warn(
        `[MailchimpClient] Reintento ${retryCount}/${MAX_RETRIES} para ${error.config?.url}. ` +
          `Error: ${error.message}`,
      );
    },
  });

  /**
   * Ejecuta una petición a Mailchimp y mapea errores a excepciones tipadas.
   * @private
   */
  async function request(method, endpoint, data = undefined) {
    try {
      const response = await httpClient.request({ method, url: endpoint, data });
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      const mailchimpError = error?.response?.data;

      if (status === 401) {
        throw new MailchimpAuthError(
          `Acceso denegado a Mailchimp API (HTTP 401). ` +
            `Verifica la API Key y los permisos de la cuenta.`,
          error,
        );
      }

      throw new MailchimpApiError(
        `Error en Mailchimp API [${method.toUpperCase()} ${endpoint}] HTTP ${status ?? 'N/A'}: ${mailchimpError?.title ?? mailchimpError?.message ?? error.message}`,
        status,
        mailchimpError,
        error,
      );
    }
  }

  return {
    /**
     * Crea o actualiza un suscriptor en una lista de Mailchimp.
     * Utiliza PUT /lists/{list_id}/members/{subscriber_hash} (upsert).
     *
     * @param {string} listId - ID de la lista de Mailchimp
     * @param {string} email - Correo electrónico del suscriptor
     * @param {object} data - Datos del suscriptor
     * @param {object} [data.mergeFields] - Campos de combinación (FNAME, LNAME, PHONE, ...)
     * @param {'subscribed'|'unsubscribed'|'cleaned'|'pending'} [data.status] - Estado de suscripción (default: 'subscribed')
     * @param {string[]} [data.tags] - Tags para etiquetar al suscriptor
     * @returns {Promise<object>} Suscriptor creado o actualizado
     * @throws {MailchimpAuthError} Si la API Key es inválida
     * @throws {MailchimpApiError} Por errores de red o API de Mailchimp
     */
    async addOrUpdateMember(listId, email, data = {}) {
      const input = AddOrUpdateMemberInputSchema.parse({ listId, email, ...data });
      const hash = subscriberHash(input.email);

      console.log(
        `[MailchimpClient] addOrUpdateMember: ${input.email} en lista ${input.listId}`,
      );

      const response = await request('put', `/lists/${input.listId}/members/${hash}`, {
        email_address: input.email,
        status: input.status,
        merge_fields: input.mergeFields,
        tags: input.tags.map((tag) => ({ name: tag, status: 'active' })),
      });

      return MemberResponseSchema.parse(response);
    },

    /**
     * Añade un tag a un suscriptor existente en una lista de Mailchimp.
     * Utiliza POST /lists/{list_id}/members/{subscriber_hash}/tags.
     *
     * @param {string} listId - ID de la lista de Mailchimp
     * @param {string} email - Correo electrónico del suscriptor
     * @param {string} tag - Tag a añadir (ej: 'nuevo', 'onboarding', 'bienvenida')
     * @returns {Promise<object>} Resultado de la operación de tag
     * @throws {MailchimpAuthError} Si la API Key es inválida
     * @throws {MailchimpApiError} Por errores de red o API de Mailchimp
     */
    async addTag(listId, email, tag) {
      const input = AddTagInputSchema.parse({ listId, email, tag });
      const hash = subscriberHash(input.email);

      console.log(
        `[MailchimpClient] addTag: ${input.email} → tag "${input.tag}" en lista ${input.listId}`,
      );

      const response = await request('post', `/lists/${input.listId}/members/${hash}/tags`, {
        tags: [{ name: input.tag, status: 'active' }],
      });

      return TagsResponseSchema.parse(response);
    },
  };
}