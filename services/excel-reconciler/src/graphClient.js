/**
 * @fileoverview Cliente de Microsoft Graph API con autenticación OAuth2
 * (Client Credentials Flow) usando MSAL Node y reintentos automáticos.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 *
 * Flujo de autenticación:
 *   Azure AD App Registration → Client Credentials → Bearer Token → Graph API
 *
 * Endpoints utilizados:
 *   GET /drives/{driveId}/items/{itemId}/workbook/worksheets/{sheet}/usedRange
 *   PATCH /drives/{driveId}/items/{itemId}/workbook/worksheets/{sheet}/range(address='{addr}')
 */

import { ConfidentialClientApplication } from '@azure/msal-node';
import axios from 'axios';
import axiosRetry from 'axios-retry';

// ---------------------------------------------------------------------------
// Configuración y constantes
// ---------------------------------------------------------------------------

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

/** Scope requerido para leer/escribir archivos en OneDrive/SharePoint */
const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];

/** Tiempo máximo de espera por request a Graph API (ms) */
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Errores personalizados — evitan fallas silenciosas
// ---------------------------------------------------------------------------

/** Error de autenticación con Azure AD / MSAL */
export class GraphAuthError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'GraphAuthError';
    this.cause = cause;
  }
}

/** Error al interactuar con la API de Microsoft Graph */
export class GraphApiError extends Error {
  /**
   * @param {string} message - Descripción del error
   * @param {number} statusCode - Código HTTP de respuesta de Graph API
   * @param {object} graphError - Objeto error devuelto por Graph API
   * @param {Error} cause - Error original de axios
   */
  constructor(message, statusCode, graphError, cause) {
    super(message);
    this.name = 'GraphApiError';
    this.statusCode = statusCode;
    this.graphError = graphError;
    this.cause = cause;
  }
}

/** Error cuando no se encuentra el recurso en OneDrive */
export class ResourceNotFoundError extends Error {
  constructor(resourceId, resourceType = 'DriveItem') {
    super(`${resourceType} no encontrado en OneDrive: ${resourceId}`);
    this.name = 'ResourceNotFoundError';
    this.resourceId = resourceId;
  }
}

// ---------------------------------------------------------------------------
// Factory del cliente Graph (función pura — facilita testing con mocks)
// ---------------------------------------------------------------------------

/**
 * Construye y devuelve un cliente configurado para Microsoft Graph API.
 *
 * @param {object} config - Credenciales de la App Registration en Azure AD
 * @param {string} config.clientId     - Application (client) ID
 * @param {string} config.clientSecret - Client secret value
 * @param {string} config.tenantId     - Directory (tenant) ID
 * @returns {GraphClient} Instancia del cliente Graph
 */
export function createGraphClient(config) {
  // Validar que las credenciales estén presentes antes de continuar
  const { clientId, clientSecret, tenantId } = config;
  if (!clientId || !clientSecret || !tenantId) {
    throw new GraphAuthError(
      'Credenciales de Azure AD incompletas. ' +
      'Se requieren clientId, clientSecret y tenantId. ' +
      'Verifica las variables de entorno MICROSOFT_CLIENT_ID, ' +
      'MICROSOFT_CLIENT_SECRET y MICROSOFT_TENANT_ID.',
    );
  }

  // Aplicación confidencial MSAL (server-side, sin interacción del usuario)
  const msalApp = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    // Caché en memoria para el token (evita re-autenticar en cada llamada)
    cache: {
      cachePlugin: null, // Para producción usar Redis o Azure Key Vault
    },
  });

  // Instancia de axios con configuración base para Graph API
  const httpClient = axios.create({
    baseURL: GRAPH_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      // Consistencia en respuestas de Graph (evita redirects de versiones)
      'ConsistencyLevel': 'eventual',
    },
  });

  // Reintentos automáticos con backoff exponencial
  // Reintenta en errores de red, 429 (throttling) y 5xx (errores del servidor)
  axiosRetry(httpClient, {
    retries: 3,
    retryDelay: (retryCount, error) => {
      // Si Graph API devuelve Retry-After, respetarlo
      const retryAfter = error?.response?.headers?.['retry-after'];
      if (retryAfter) {
        const waitMs = parseInt(retryAfter, 10) * 1000;
        console.warn(`[GraphClient] Rate limited. Esperando ${waitMs}ms antes de reintentar...`);
        return waitMs;
      }
      // Backoff exponencial: 1s, 2s, 4s
      return axiosRetry.exponentialDelay(retryCount);
    },
    retryCondition: (error) =>
      axiosRetry.isNetworkError(error) ||
      axiosRetry.isRetryableError(error) ||
      error?.response?.status === 429, // Too Many Requests (throttling de Graph)
    onRetry: (retryCount, error) => {
      console.warn(
        `[GraphClient] Reintento ${retryCount}/3 para ${error.config?.url}. ` +
        `Error: ${error.message}`,
      );
    },
  });

  // ---------------------------------------------------------------------------
  // Funciones internas del cliente
  // ---------------------------------------------------------------------------

  /**
   * Obtiene un Bearer Token de Azure AD via Client Credentials Flow.
   * MSAL gestiona el caché y la renovación automática cuando el token expira.
   *
   * @returns {Promise<string>} Token de acceso Bearer
   * @throws {GraphAuthError} Si la autenticación falla
   */
  async function getAccessToken() {
    try {
      const result = await msalApp.acquireTokenByClientCredential({
        scopes: GRAPH_SCOPES,
      });

      if (!result?.accessToken) {
        throw new GraphAuthError(
          'MSAL devolvió un resultado vacío. ' +
          'Verifica los permisos de la App Registration en Azure AD ' +
          '(Files.ReadWrite.All, Sites.ReadWrite.All) y que el admin consent esté otorgado.',
        );
      }

      return result.accessToken;
    } catch (error) {
      if (error instanceof GraphAuthError) throw error;
      throw new GraphAuthError(
        `Fallo en autenticación con Azure AD: ${error.message}`,
        error,
      );
    }
  }

  /**
   * Inyecta el token Bearer en cada request y convierte errores de axios
   * en instancias de GraphApiError con contexto detallado.
   *
   * @param {string} method   - Método HTTP ('get', 'patch', 'post')
   * @param {string} endpoint - Path relativo al base URL de Graph
   * @param {object} [data]   - Cuerpo del request (para PATCH/POST)
   * @returns {Promise<any>} Datos de la respuesta de Graph API
   * @throws {ResourceNotFoundError} Si Graph devuelve 404
   * @throws {GraphApiError} Para cualquier otro error de Graph API
   */
  async function request(method, endpoint, data = undefined) {
    const token = await getAccessToken();

    try {
      const response = await httpClient.request({
        method,
        url: endpoint,
        data,
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (error) {
      // Extraer información de error del response de Graph API
      const status = error?.response?.status;
      const graphError = error?.response?.data?.error;

      // Error 404: recurso no encontrado en OneDrive
      if (status === 404) {
        const resourceId = endpoint.split('/').pop();
        throw new ResourceNotFoundError(resourceId);
      }

      // Error 401/403: problemas de permisos o token inválido
      if (status === 401 || status === 403) {
        throw new GraphAuthError(
          `Acceso denegado a Graph API (HTTP ${status}). ` +
          `Verifica que la App tenga permisos: Files.ReadWrite.All. ` +
          `Detalle: ${graphError?.message ?? error.message}`,
          error,
        );
      }

      // Cualquier otro error HTTP de Graph API
      throw new GraphApiError(
        `Error en Graph API [${method.toUpperCase()} ${endpoint}] ` +
        `HTTP ${status ?? 'N/A'}: ${graphError?.message ?? error.message}`,
        status,
        graphError,
        error,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // API pública del cliente
  // ---------------------------------------------------------------------------

  return {
    /**
     * Lee el rango usado de una hoja de cálculo Excel en OneDrive.
     * Devuelve headers (primera fila) y filas de datos por separado.
     *
     * @param {string} driveItemId   - ID del archivo en OneDrive
     * @param {string} worksheetName - Nombre de la hoja (ej: 'Portafolio')
     * @returns {Promise<{ headers: string[], rows: (string|number|null)[][] }>}
     * @throws {ResourceNotFoundError} Si el archivo o la hoja no existen
     * @throws {GraphApiError} Por errores de red o Graph API
     */
    async readWorksheetData(driveItemId, worksheetName) {
      console.log(
        `[GraphClient] Leyendo hoja "${worksheetName}" del DriveItem: ${driveItemId}`,
      );

      // Usamos /usedRange para leer sólo celdas con datos (eficiente en memoria)
      const endpoint =
        `/me/drive/items/${driveItemId}` +
        `/workbook/worksheets/${encodeURIComponent(worksheetName)}` +
        `/usedRange?$select=values,rowCount,columnCount`;

      const data = await request('get', endpoint);

      // Graph API devuelve `values` como array bidimensional de celdas
      const [headerRow, ...dataRows] = data.values ?? [];

      if (!headerRow || headerRow.length === 0) {
        throw new GraphApiError(
          `La hoja "${worksheetName}" está vacía o no tiene fila de encabezados. ` +
          `Verifica que la primera fila del Excel contenga los nombres de columna.`,
          200,
          null,
          null,
        );
      }

      return {
        headers: headerRow.map(String), // Normalizar headers a string
        rows: dataRows,
        totalRows: data.rowCount - 1,   // Sin contar la fila de headers
        totalColumns: data.columnCount,
      };
    },

    /**
     * Actualiza un rango específico de celdas en Excel.
     * Usado para marcar transacciones conciliadas o corregir discrepancias.
     *
     * @param {string} driveItemId   - ID del archivo en OneDrive
     * @param {string} worksheetName - Nombre de la hoja
     * @param {string} address       - Dirección del rango en notación A1 (ej: 'A5:P5')
     * @param {Array}  values        - Valores a escribir (array bidimensional)
     * @returns {Promise<void>}
     */
    async updateRange(driveItemId, worksheetName, address, values) {
      console.log(
        `[GraphClient] Actualizando rango ${address} en "${worksheetName}"`,
      );

      const endpoint =
        `/me/drive/items/${driveItemId}` +
        `/workbook/worksheets/${encodeURIComponent(worksheetName)}` +
        `/range(address='${address}')`;

      await request('patch', endpoint, { values });
    },

    /**
     * Añade filas nuevas al final de los datos existentes en Excel.
     * Usado cuando hay transacciones en n8n que no existen en el Excel.
     *
     * @param {string} driveItemId   - ID del archivo en OneDrive
     * @param {string} worksheetName - Nombre de la hoja
     * @param {string} tableName     - Nombre de la tabla Excel (para append seguro)
     * @param {Array}  values        - Filas a insertar (array de arrays)
     * @returns {Promise<void>}
     */
    async appendRowsToTable(driveItemId, worksheetName, tableName, values) {
      if (!tableName) {
        throw new GraphApiError(
          'appendRowsToTable requiere tableName. ' +
          'Convierte el rango en una Tabla Excel para habilitar la inserción segura.',
          null, null, null,
        );
      }

      const endpoint =
        `/me/drive/items/${driveItemId}` +
        `/workbook/worksheets/${encodeURIComponent(worksheetName)}` +
        `/tables/${encodeURIComponent(tableName)}/rows/add`;

      await request('post', endpoint, { values });
      console.log(`[GraphClient] ${values.length} fila(s) añadida(s) a la tabla "${tableName}"`);
    },
  };
}
