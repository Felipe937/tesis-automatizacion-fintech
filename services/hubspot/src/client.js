/**
 * @fileoverview Cliente autenticado para HubSpot API v3 (CRM).
 *
 * Autenticación (RF-011 — la tesis exige OAuth 2.0 para HubSpot):
 *   - `mode: 'oauth2'`  → OAuth 2.0 Authorization Code + Refresh Token
 *                          (flujo server-to-server de HubSpot: el refresh token
 *                          se canjea por access tokens de corta duración y se
 *                          renueva automáticamente antes de expirar).
 *   - `mode: 'private_app'` → Private App Token (pat-na1-...) enviado como
 *                          Bearer. NO es OAuth 2.0: se conserva como modo
 *                          explícito y documentado (ver docs/decisions.md,
 *                          ADR-001), nunca se presenta como OAuth 2.0.
 *
 * Endpoints utilizados:
 *   GET  /crm/v3/objects/contacts?email=...   (búsqueda por email)
 *   POST /crm/v3/objects/contacts              (crear contacto)
 *   PATCH /crm/v3/objects/contacts/{id}        (actualizar contacto)
 *
 * Reintentos: automáticos ante HTTP 429 (rate limit) y 503 (service unavailable),
 * máximo 3 intentos con intervalo de 30s entre cada uno.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { z } from 'zod';
import axios from 'axios';
import axiosRetry from 'axios-retry';

import {
  CreateContactInputSchema,
  UpdateContactInputSchema,
  ContactSearchResponseSchema,
  ContactCreateResponseSchema,
  ContactUpdateResponseSchema,
} from './schemas.js';
import {
  createStaticTokenProvider,
  createRefreshTokenProvider,
  OAuth2Error,
  TokenRevokedError,
} from '../../common/oauth2.js';

const HUBSPOT_BASE_URL = 'https://api.hubapi.com/crm/v3/objects/contacts';

/** Endpoint de tokens de HubSpot (OAuth 2.0 — authorization code / refresh token). */
const HUBSPOT_TOKEN_ENDPOINT = 'https://api.hubapi.com/oauth/v1/token';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_INTERVAL_MS = 30_000;

/**
 * Error de autenticación con HubSpot (401/403).
 */
export class HubSpotAuthError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'HubSpotAuthError';
    this.cause = cause;
  }
}

/**
 * Error de API de HubSpot (otros códigos HTTP).
 */
export class HubSpotApiError extends Error {
  constructor(message, statusCode, hubspotError, cause) {
    super(message);
    this.name = 'HubSpotApiError';
    this.statusCode = statusCode;
    this.hubspotError = hubspotError;
    this.cause = cause;
  }
}

/**
 * Determina el modo de autenticación a partir de la configuración explícita
 * y de las variables de entorno.
 *
 * Precedencia:
 *   1. `config.mode` explícito.
 *   2. Credenciales OAuth 2.0 completas (clientId + clientSecret + refreshToken).
 *   3. `config.accessToken` o `HUBSPOT_ACCESS_TOKEN` → Private App Token.
 *
 * @param {object} config - Configuración recibida por el factory
 * @returns {'oauth2'|'private_app'} Modo de autenticación resuelto
 * @throws {HubSpotAuthError} Si no hay ninguna credencial utilizable
 */
export function resolverModoAutenticacion(config = {}) {
  const mode = config.mode ?? process.env.HUBSPOT_AUTH_MODE ?? null;

  if (mode === 'oauth2' || mode === 'private_app') {
    return mode;
  }

  const clientId = config.clientId ?? process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = config.clientSecret ?? process.env.HUBSPOT_CLIENT_SECRET;
  const refreshToken = config.refreshToken ?? process.env.HUBSPOT_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    return 'oauth2';
  }

  const accessToken = config.accessToken ?? process.env.HUBSPOT_ACCESS_TOKEN;
  if (accessToken) {
    return 'private_app';
  }

  throw new HubSpotAuthError(
    'No se configuró ninguna credencial de HubSpot. ' +
      'Para OAuth 2.0 (RF-011) define HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET y ' +
      'HUBSPOT_REFRESH_TOKEN; alternativamente define HUBSPOT_ACCESS_TOKEN ' +
      '(Private App Token) y acepta que NO cumple OAuth 2.0.',
  );
}

/**
 * Construye el proveedor de tokens según el modo resuelto.
 *
 * @param {'oauth2'|'private_app'} modo - Modo de autenticación
 * @param {object} config - Configuración del cliente
 * @returns {object} Proveedor con `getAccessToken()` e `invalidate()`
 */
function crearProveedorDeToken(modo, config) {
  if (modo === 'oauth2') {
    const clientId = config.clientId ?? process.env.HUBSPOT_CLIENT_ID;
    const clientSecret = config.clientSecret ?? process.env.HUBSPOT_CLIENT_SECRET;
    const refreshToken = config.refreshToken ?? process.env.HUBSPOT_REFRESH_TOKEN;
    const redirectUri = config.redirectUri ?? process.env.HUBSPOT_REDIRECT_URI;
    const scope = config.scope ?? process.env.HUBSPOT_SCOPES ?? undefined;

    return createRefreshTokenProvider({
      tokenEndpoint: config.tokenEndpoint ?? HUBSPOT_TOKEN_ENDPOINT,
      clientId,
      clientSecret,
      refreshToken,
      redirectUri,
      scope,
      fetchImpl: config.fetchImpl,
      label: 'HubSpot',
    });
  }

  const accessToken = config.accessToken ?? process.env.HUBSPOT_ACCESS_TOKEN;
  return createStaticTokenProvider({ token: accessToken, label: 'HubSpot (Private App)' });
}

/**
 * Construye y devuelve un cliente configurado para HubSpot API v3.
 *
 * @param {object} config - Configuración del cliente
 * @param {'oauth2'|'private_app'} [config.mode] - Modo de autenticación
 * @param {string} [config.accessToken] - Private App Token (modo private_app)
 * @param {string} [config.clientId] - Client ID de la app OAuth (modo oauth2)
 * @param {string} [config.clientSecret] - Client Secret de la app OAuth
 * @param {string} [config.refreshToken] - Refresh Token inicial
 * @param {string} [config.redirectUri] - Redirect URI registrado en la app
 * @param {object} [config.tokenProvider] - Proveedor de tokens inyectado (pruebas)
 * @param {Function} [config.adapter] - Adapter de axios inyectado (pruebas)
 * @returns {object} Instancia del cliente HubSpot
 * @throws {HubSpotAuthError} Si no se configura ninguna credencial
 */
export function createHubSpotClient(config = {}) {
  const modo = resolverModoAutenticacion(config);
  const tokenProvider =
    config.tokenProvider ?? crearProveedorDeToken(modo, config);

  const httpClient = axios.create({
    baseURL: HUBSPOT_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(config.adapter ? { adapter: config.adapter } : {}),
  });

  // Reintentos automáticos con backoff fijo de 30s para 429 y 503
  axiosRetry(httpClient, {
    retries: MAX_RETRIES,
    retryDelay: () => RETRY_INTERVAL_MS,
    retryCondition: (error) =>
      axiosRetry.isNetworkError(error) ||
      axiosRetry.isRetryableError(error) ||
      error?.response?.status === 429 ||
      error?.response?.status === 503,
    onRetry: (retryCount, error) => {
      console.warn(
        `[HubSpotClient] Reintento ${retryCount}/${MAX_RETRIES} para ${error.config?.url}. ` +
          `Error: ${error.message}`,
      );
    },
  });

  /**
   * Obtiene el token de acceso vigente del proveedor activo.
   * @private
   * @returns {Promise<string>} Token Bearer
   */
  async function obtenerToken() {
    try {
      return await tokenProvider.getAccessToken();
    } catch (error) {
      if (error instanceof TokenRevokedError) {
        throw new HubSpotAuthError(
          `El refresh token de HubSpot fue revocado o expiró. ` +
            `Hay que repetir el flujo OAuth 2.0 de autorización. Detalle: ${error.message}`,
          error,
        );
      }
      if (error instanceof OAuth2Error) {
        throw new HubSpotAuthError(
          `No se pudo obtener un token OAuth 2.0 de HubSpot: ${error.message}`,
          error,
        );
      }
      throw error;
    }
  }

  /**
   * Ejecuta una petición a HubSpot y mapea errores a excepciones tipadas.
   * Si el token es rechazado (401) y el proveedor puede renovarlo, se
   * invalida la caché y se reintenta una sola vez.
   * @private
   */
  async function request(method, endpoint, data = undefined, reintento = true) {
    const token = await obtenerToken();

    try {
      const response = await httpClient.request({
        method,
        url: endpoint,
        data,
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      const hubspotError = error?.response?.data;

      if (status === 401 && reintento) {
        // El token pudo expirar: se invalida y se reintenta una vez.
        tokenProvider.invalidate?.();
        return request(method, endpoint, data, false);
      }

      if (status === 401 || status === 403) {
        throw new HubSpotAuthError(
          `Acceso denegado a HubSpot API (HTTP ${status}). ` +
            `Verifica el token y los scopes de la app OAuth 2.0 ` +
            `(crm.objects.contacts.read/write).`,
          error,
        );
      }

      throw new HubSpotApiError(
        `Error en HubSpot API [${method.toUpperCase()} ${endpoint}] HTTP ${status ?? 'N/A'}: ${hubspotError?.message ?? error.message}`,
        status,
        hubspotError,
        error,
      );
    }
  }

  return {
    /**
     * Modo de autenticación efectivo del cliente ('oauth2' | 'private_app').
     * Permite auditar en runtime qué mecanismo está en uso.
     */
    modoAutenticacion: modo,

    /**
     * Busca un contacto en HubSpot por su dirección de correo electrónico.
     * Utiliza el endpoint de búsqueda con filtro ?email=...
     *
     * @param {string} email - Correo electrónico del contacto a buscar
     * @returns {Promise<Array<object>>} Lista de contactos encontrados (usualmente 0 o 1)
     * @throws {HubSpotAuthError} Si el token es inválido o fue revocado
     * @throws {HubSpotApiError} Por errores de red o API de HubSpot
     */
    async getContact(email) {
      const parsed = z.string().email().parse(email);
      console.log(`[HubSpotClient] Buscando contacto por email: ${parsed}`);

      const data = await request('get', `?email=${encodeURIComponent(parsed)}`);
      const validated = ContactSearchResponseSchema.parse(data);
      return validated.results;
    },

    /**
     * Crea un nuevo contacto en HubSpot con nombre, email, teléfono y estado.
     *
     * @param {object} data - Datos del contacto
     * @param {string} data.firstname - Nombre
     * @param {string} data.lastname - Apellido
     * @param {string} data.email - Correo electrónico
     * @param {string} [data.phone] - Teléfono
     * @param {'nuevo'|'prospecto'|'cita_pendiente'|'cita_confirmada'|'cliente'|'inactivo'} [data.estado]
     *   Estado del lead (default: 'nuevo')
     * @returns {Promise<object>} Contacto creado con su ID de HubSpot
     * @throws {HubSpotApiError} Si el email ya existe o hay error de API
     */
    async createContact(data) {
      const input = CreateContactInputSchema.parse(data);
      console.log(`[HubSpotClient] Creando contacto: ${input.email}`);

      const response = await request('post', '', {
        properties: {
          firstname: input.firstname,
          lastname: input.lastname,
          email: input.email,
          phone: input.phone ?? '',
          estado: input.estado,
        },
      });

      return ContactCreateResponseSchema.parse(response);
    },

    /**
     * Actualiza las propiedades de un contacto existente en HubSpot.
     *
     * @param {string} contactId - ID interno de HubSpot del contacto
     * @param {object} data - Datos a actualizar
     * @param {object} data.properties - Propiedades a modificar
     * @returns {Promise<object>} Contacto actualizado
     * @throws {HubSpotApiError} Si el contacto no existe (404) o hay error de API
     */
    async updateContact(contactId, data) {
      const input = UpdateContactInputSchema.parse({ contactId, ...data });
      console.log(`[HubSpotClient] Actualizando contacto: ${input.contactId}`);

      const response = await request('patch', `/${input.contactId}`, {
        properties: input.properties,
      });

      return ContactUpdateResponseSchema.parse(response);
    },
  };
}
