/**
 * @fileoverview Cliente autenticado para HubSpot API v3 (CRM).
 *
 * Autenticación: Private App Token (Bearer) configurado en variable de entorno
 * HUBSPOT_ACCESS_TOKEN, o OAuth 2.0 access token.
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

const HUBSPOT_BASE_URL = 'https://api.hubapi.com/crm/v3/objects/contacts';

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
 * Construye y devuelve un cliente configurado para HubSpot API v3.
 *
 * @param {object} config - Configuración del cliente
 * @param {string} [config.accessToken] - Token de acceso (Private App u OAuth2).
 *   Si no se pasa, se lee de process.env.HUBSPOT_ACCESS_TOKEN.
 * @returns {object} Instancia del cliente HubSpot
 * @throws {HubSpotAuthError} Si no se configura ningún token
 */
export function createHubSpotClient(config = {}) {
  const accessToken = config.accessToken || process.env.HUBSPOT_ACCESS_TOKEN;

  if (!accessToken) {
    throw new HubSpotAuthError(
      'No se configuró HUBSPOT_ACCESS_TOKEN. ' +
        'Define la variable de entorno con un Private App Token de HubSpot ' +
        '(permisos: crm.objects.contacts.read, crm.objects.contacts.write).',
    );
  }

  const httpClient = axios.create({
    baseURL: HUBSPOT_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
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
   * Ejecuta una petición a HubSpot y mapea errores a excepciones tipadas.
   * @private
   */
  async function request(method, endpoint, data = undefined) {
    try {
      const response = await httpClient.request({ method, url: endpoint, data });
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      const hubspotError = error?.response?.data;

      if (status === 401 || status === 403) {
        throw new HubSpotAuthError(
          `Acceso denegado a HubSpot API (HTTP ${status}). ` +
            `Verifica el token y los permisos de la Private App.`,
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
     * Busca un contacto en HubSpot por su dirección de correo electrónico.
     * Utiliza el endpoint de búsqueda con filtro ?email=...
     *
     * @param {string} email - Correo electrónico del contacto a buscar
     * @returns {Promise<Array<object>>} Lista de contactos encontrados (usualmente 0 o 1)
     * @throws {HubSpotAuthError} Si el token es inválido
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
     * @param {'nuevo'|'prospecto'|'cita_pendiente'|'cita_confirmada'|'cliente'|'inactivo'} [data.estado] - Estado del lead (default: 'nuevo')
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