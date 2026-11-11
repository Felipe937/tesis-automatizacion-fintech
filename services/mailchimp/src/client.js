/**
 * @fileoverview Cliente autenticado para Mailchimp API v3.
 *
 * Autenticación (RF-011 — la tesis exige OAuth 2.0 para Mailchimp):
 *   - `mode: 'oauth2'`  → OAuth 2.0 Authorization Code Flow.
 *                          El token se obtiene en `https://login.mailchimp.com/oauth2/token`
 *                          y se envía como `Authorization: Bearer <token>`.
 *                          Mailchimp NO expira estos tokens (no hay refresh token):
 *                          la revocación la hace el usuario que desconectó la app.
 *   - `mode: 'api_key'`  → API Key de cuenta (`Authorization: apikey <key>`).
 *                          NO es OAuth 2.0: se conserva como modo explícito y
 *                          documentado (docs/decisions.md, ADR-001).
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
import {
  createStaticTokenProvider,
  createAuthorizationCodeProvider,
  OAuth2Error,
} from '../../common/oauth2.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

/** Endpoint de tokens OAuth 2.0 de Mailchimp. */
const MAILCHIMP_TOKEN_ENDPOINT = 'https://login.mailchimp.com/oauth2/token';

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
 * Determina el modo de autenticación a partir de la configuración explícita
 * y de las variables de entorno.
 *
 * @param {object} config - Configuración recibida por el factory
 * @returns {'oauth2'|'api_key'} Modo de autenticación resuelto
 * @throws {MailchimpAuthError} Si no hay ninguna credencial utilizable
 */
export function resolverModoAutenticacion(config = {}) {
  const mode = config.mode ?? process.env.MAILCHIMP_AUTH_MODE ?? null;

  if (mode === 'oauth2' || mode === 'api_key') {
    return mode;
  }

  const clientId = config.clientId ?? process.env.MAILCHIMP_CLIENT_ID;
  const clientSecret = config.clientSecret ?? process.env.MAILCHIMP_CLIENT_SECRET;
  const code = config.code ?? process.env.MAILCHIMP_OAUTH_CODE;
  const accessToken = config.accessToken ?? process.env.MAILCHIMP_ACCESS_TOKEN;

  if ((clientId && clientSecret && code) || accessToken) {
    return 'oauth2';
  }

  const apiKey = config.apiKey ?? process.env.MAILCHIMP_API_KEY;
  if (apiKey) {
    return 'api_key';
  }

  throw new MailchimpAuthError(
    'No se configuró ninguna credencial de Mailchimp. ' +
      'Para OAuth 2.0 (RF-011) define MAILCHIMP_CLIENT_ID, MAILCHIMP_CLIENT_SECRET y ' +
      'MAILCHIMP_OAUTH_CODE (o MAILCHIMP_ACCESS_TOKEN si el token ya fue emitido); ' +
      'alternativamente define MAILCHIMP_API_KEY y acepta que NO cumple OAuth 2.0.',
  );
}

/**
 * Construye y devuelve un cliente configurado para Mailchimp API v3.
 *
 * @param {object} config - Configuración del cliente
 * @param {'oauth2'|'api_key'} [config.mode] - Modo de autenticación
 * @param {string} [config.apiKey] - API Key de cuenta (modo api_key)
 * @param {string} [config.serverPrefix] - Prefijo del servidor (us21, etc.)
 * @param {string} [config.accessToken] - Token OAuth 2.0 ya emitido
 * @param {string} [config.clientId] - Client ID de la app OAuth
 * @param {string} [config.clientSecret] - Client Secret de la app OAuth
 * @param {string} [config.code] - Código de autorización (authorization code flow)
 * @param {string} [config.redirectUri] - Redirect URI registrado
 * @param {object} [config.tokenProvider] - Proveedor de tokens inyectado (pruebas)
 * @param {Function} [config.adapter] - Adapter de axios inyectado (pruebas)
 * @returns {object} Instancia del cliente Mailchimp
 * @throws {MailchimpAuthError} Si no se configura ninguna API Key ni OAuth
 */
export function createMailchimpClient(config = {}) {
  const modo = resolverModoAutenticacion(config);

  const apiKey = config.apiKey ?? process.env.MAILCHIMP_API_KEY;
  const serverPrefix =
    config.serverPrefix ??
    process.env.MAILCHIMP_SERVER_PREFIX ??
    (modo === 'api_key' && apiKey ? getServerPrefix(apiKey) : null);

  let tokenProvider = config.tokenProvider ?? null;
  if (!tokenProvider && modo === 'oauth2') {
    const accessToken = config.accessToken ?? process.env.MAILCHIMP_ACCESS_TOKEN;
    if (accessToken) {
      tokenProvider = createStaticTokenProvider({
        token: accessToken,
        label: 'Mailchimp (OAuth 2.0)',
      });
    } else {
      tokenProvider = createAuthorizationCodeProvider({
        tokenEndpoint: config.tokenEndpoint ?? MAILCHIMP_TOKEN_ENDPOINT,
        clientId: config.clientId ?? process.env.MAILCHIMP_CLIENT_ID,
        clientSecret: config.clientSecret ?? process.env.MAILCHIMP_CLIENT_SECRET,
        code: config.code ?? process.env.MAILCHIMP_OAUTH_CODE,
        redirectUri: config.redirectUri ?? process.env.MAILCHIMP_REDIRECT_URI,
        fetchImpl: config.fetchImpl,
        label: 'Mailchimp',
      });
    }
  }

  if (!serverPrefix) {
    throw new MailchimpAuthError(
      'No se pudo determinar el server prefix (datacenter) de Mailchimp. ' +
        'En modo OAuth 2.0 el datacenter NO se puede derivar de la credencial: ' +
        'define MAILCHIMP_SERVER_PREFIX (ej: us21, el que aparece en ' +
        'https://us21.admin.mailchimp.com).',
    );
  }

  const BASE_URL = `https://${serverPrefix}.api.mailchimp.com/3.0`;

  const httpClient = axios.create({
    baseURL: BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(config.adapter ? { adapter: config.adapter } : {}),
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
   * Construye la cabecera Authorization según el modo activo.
   * @private
   * @returns {Promise<string>} Valor de la cabecera Authorization
   */
  async function authorizationHeader() {
    if (modo === 'api_key') {
      return `apikey ${apiKey}`;
    }
    try {
      const token = await tokenProvider.getAccessToken();
      return `Bearer ${token}`;
    } catch (error) {
      if (error instanceof OAuth2Error) {
        throw new MailchimpAuthError(
          `No se pudo obtener un token OAuth 2.0 de Mailchimp: ${error.message}`,
          error,
        );
      }
      throw error;
    }
  }

  /**
   * Ejecuta una petición a Mailchimp y mapea errores a excepciones tipadas.
   * @private
   */
  async function request(method, endpoint, data = undefined) {
    const authorization = await authorizationHeader();

    try {
      const response = await httpClient.request({
        method,
        url: endpoint,
        data,
        headers: { Authorization: authorization },
      });
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      const mailchimpError = error?.response?.data;

      if (status === 401) {
        throw new MailchimpAuthError(
          modo === 'api_key'
            ? 'Acceso denegado a Mailchimp API (HTTP 401). Verifica la API Key y los permisos de la cuenta.'
            : 'Acceso denegado a Mailchimp API (HTTP 401). El token OAuth 2.0 fue revocado: ' +
              'hay que rehacer el flujo de autorización.',
          error,
        );
      }

      throw new MailchimpApiError(
        `Error en Mailchimp API [${method.toUpperCase()} ${endpoint}] ` +
          `HTTP ${status ?? 'N/A'}: ` +
          `${mailchimpError?.title ?? mailchimpError?.message ?? error.message}`,
        status,
        mailchimpError,
        error,
      );
    }
  }

  return {
    /**
     * Modo de autenticación efectivo del cliente ('oauth2' | 'api_key').
     */
    modoAutenticacion: modo,

    /**
     * Server prefix (datacenter) en uso.
     */
    serverPrefix,

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
     * @throws {MailchimpAuthError} Si la credencial es inválida o fue revocada
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
     * @throws {MailchimpAuthError} Si la credencial es inválida o fue revocada
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
