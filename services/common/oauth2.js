/**
 * @fileoverview Helpers compartidos de OAuth 2.0 para los clientes de
 * integraciones externas (HubSpot, Mailchimp, Calendly).
 *
 * Este módulo NO usa dependencias externas: se apoya en el `fetch` global de
 * Node.js 18+ para no duplicar la lógica de autenticación en cada servicio ni
 * añadir paquetes innecesarios al prototipo.
 *
 * Un "token provider" expone una única operación:
 *
 *   await provider.getAccessToken() -> string
 *
 * y se encarga de:
 *   - guardar el token en caché con su expiración,
 *   - renovarlo antes de que expire (margen de seguridad),
 *   - mapear los errores del endpoint de tokens a excepciones tipadas.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

/** Margen (ms) antes de la expiración real en el que se renueva el token. */
export const DEFAULT_REFRESH_MARGIN_MS = 60_000;

/**
 * Error base de la capa OAuth 2.0.
 */
export class OAuth2Error extends Error {
  /**
   * @param {string} message - Descripción del error
   * @param {object} [details] - Contexto adicional (status, code, cause)
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'OAuth2Error';
    this.status = details.status ?? null;
    this.code = details.code ?? null;
    this.cause = details.cause ?? null;
  }
}

/**
 * El servidor de autorización rechazó la credencial del cliente
 * (client_id/client_secret incorrectos o app deshabilitada).
 */
export class OAuth2ClientError extends OAuth2Error {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'OAuth2ClientError';
  }
}

/**
 * El token de refuerzo (refresh token) dejó de ser válido: el usuario
 * revocó el consentimiento o la app perdió los permisos.
 *
 * En este caso reintentar NO sirve: hay que rehacer el flujo de autorización.
 */
export class TokenRevokedError extends OAuth2Error {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'TokenRevokedError';
  }
}

/**
 * Construye un proveedor estático: entrega siempre el mismo token.
 *
 * Se usa para tokens ya emitidos por un flujo OAuth 2.0 externo y gestionado
 * fuera del proceso (por ejemplo, Calendly OAuth 2.1 o n8n), y para credenciales
 * que no expiran (Mailchimp Marketing API).
 *
 * @param {object} config - Configuración del proveedor
 * @param {string} config.token - Token de acceso
 * @param {string} [config.label='proveedor'] - Etiqueta para los mensajes de error
 * @param {number} [config.expiresInMs] - Expiración conocida (ms desde ahora)
 * @returns {{mode: string, getAccessToken: () => Promise<string>, invalidate: () => void}}
 */
export function createStaticTokenProvider({ token, label = 'proveedor', expiresInMs = null }) {
  if (!token) {
    throw new OAuth2Error(`No se proporcionó token de acceso para ${label}.`);
  }
  const expiresAt = expiresInMs ? Date.now() + expiresInMs : null;

  return {
    mode: 'static',
    label,
    async getAccessToken() {
      if (expiresAt && Date.now() >= expiresAt) {
        throw new OAuth2Error(
          `El token de ${label} expiró. Se requiere re-autenticación.`,
          { code: 'token_expired' },
        );
      }
      return token;
    },
    invalidate() {
      /* El token estático no se puede renovar en caliente. */
    },
  };
}

/**
 * Construye un proveedor OAuth 2.0 con flujo `refresh_token`.
 *
 * Es el mecanismo server-to-server de HubSpot: la app de desarrollador recibe
 * un access token + refresh token; el refresh token se canjea por nuevos access
 * tokens (de corta duración) sin interacción del usuario.
 *
 * @param {object} config - Configuración del proveedor
 * @param {string} config.tokenEndpoint - Endpoint de tokens del proveedor
 * @param {string} config.clientId - Client ID de la app
 * @param {string} config.clientSecret - Client Secret de la app
 * @param {string} config.refreshToken - Refresh token inicial
 * @param {string} [config.redirectUri] - Redirect URI registrado (algunos la requieren)
 * @param {string} [config.scope] - Scope solicitado
 * @param {Function} [config.fetchImpl] - Implementación de fetch (para pruebas)
 * @param {number} [config.refreshMarginMs] - Margen de renovación anticipada
 * @param {string} [config.label='proveedor'] - Etiqueta para los mensajes
 * @returns {object} Proveedor de token
 */
export function createRefreshTokenProvider({
  tokenEndpoint,
  clientId,
  clientSecret,
  refreshToken,
  redirectUri,
  scope,
  fetchImpl,
  refreshMarginMs = DEFAULT_REFRESH_MARGIN_MS,
  label = 'proveedor',
}) {
  if (!tokenEndpoint || !clientId || !clientSecret || !refreshToken) {
    throw new OAuth2Error(
      `Configuración OAuth 2.0 incompleta para ${label}: se requieren ` +
        'tokenEndpoint, clientId, clientSecret y refreshToken.',
    );
  }

  const doFetch = fetchImpl ?? globalThis.fetch;
  let accessToken = null;
  let accessTokenExpiresAt = 0;

  async function requestToken() {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });
    if (redirectUri) body.set('redirect_uri', redirectUri);
    if (scope) body.set('scope', scope);

    let response;
    try {
      response = await doFetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });
    } catch (cause) {
      throw new OAuth2Error(
        `No se pudo contactar el endpoint de tokens de ${label}: ${cause.message}`,
        { cause },
      );
    }

    const payload = await safeJson(response);

    if (!response.ok) {
      throw mapTokenError(response, payload, label);
    }

    if (!payload?.access_token) {
      throw new OAuth2Error(
        `El endpoint de tokens de ${label} respondió sin access_token.`,
        { status: response.status },
      );
    }

    const expiresInMs = Number.isFinite(payload.expires_in)
      ? payload.expires_in * 1000
      : 0;

    accessToken = payload.access_token;
    accessTokenExpiresAt = expiresInMs ? Date.now() + expiresInMs : Infinity;

    return accessToken;
  }

  return {
    mode: 'refresh_token',
    label,
    async getAccessToken() {
      if (accessToken && Date.now() < accessTokenExpiresAt - refreshMarginMs) {
        return accessToken;
      }
      return requestToken();
    },
    invalidate() {
      accessToken = null;
      accessTokenExpiresAt = 0;
    },
  };
}

/**
 * Construye un proveedor OAuth 2.0 con flujo `authorization_code`.
 *
 * Mailchimp implementa el authorization code flow: el usuario autoriza en el
 * navegador, el backend intercambia el `code` por un access token y ese token
 * no expira (no hay refresh token en Mailchimp Marketing API).
 *
 * @param {object} config - Configuración del proveedor
 * @param {string} config.tokenEndpoint - Endpoint de tokens
 * @param {string} config.clientId - Client ID de la app registrada
 * @param {string} config.clientSecret - Client Secret de la app registrada
 * @param {string} config.code - Código de autorización
 * @param {string} [config.redirectUri] - Redirect URI usado en la autorización
 * @param {Function} [config.fetchImpl] - Implementación de fetch (para pruebas)
 * @param {string} [config.label='proveedor'] - Etiqueta para los mensajes
 * @returns {object} Proveedor de token
 */
export function createAuthorizationCodeProvider({
  tokenEndpoint,
  clientId,
  clientSecret,
  code,
  redirectUri,
  fetchImpl,
  label = 'proveedor',
}) {
  if (!tokenEndpoint || !clientId || !clientSecret || !code) {
    throw new OAuth2Error(
      `Configuración OAuth 2.0 incompleta para ${label}: se requieren ` +
        'tokenEndpoint, clientId, clientSecret y code.',
    );
  }

  const doFetch = fetchImpl ?? globalThis.fetch;
  let accessToken = null;

  async function requestToken() {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
    });
    if (redirectUri) body.set('redirect_uri', redirectUri);

    let response;
    try {
      response = await doFetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });
    } catch (cause) {
      throw new OAuth2Error(
        `No se pudo contactar el endpoint de tokens de ${label}: ${cause.message}`,
        { cause },
      );
    }

    const payload = await safeJson(response);

    if (!response.ok) {
      throw mapTokenError(response, payload, label);
    }

    if (!payload?.access_token) {
      throw new OAuth2Error(
        `El endpoint de tokens de ${label} respondió sin access_token.`,
        { status: response.status },
      );
    }

    accessToken = payload.access_token;
    return accessToken;
  }

  return {
    mode: 'authorization_code',
    label,
    async getAccessToken() {
      if (accessToken) return accessToken;
      return requestToken();
    },
    invalidate() {
      accessToken = null;
    },
  };
}

/**
 * Lee el cuerpo de una respuesta como JSON sin lanzar ante cuerpos vacíos.
 * @param {Response} response - Respuesta HTTP
 * @returns {Promise<object|null>} Cuerpo parseado o null
 */
async function safeJson(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Traduce la respuesta de error de un endpoint de tokens a una excepción tipada.
 * @param {Response} response - Respuesta HTTP con error
 * @param {object|null} payload - Cuerpo ya parseado
 * @param {string} label - Etiqueta del proveedor
 * @returns {OAuth2Error} Excepción tipada
 */
function mapTokenError(response, payload, label) {
  const code = payload?.error ?? null;
  const description = payload?.error_description ?? payload?.error ?? '';
  const message =
    `Fallo la autenticación OAuth 2.0 en ${label} (HTTP ${response.status}` +
    `${code ? `, ${code}` : ''}): ${description || 'sin detalle'}`;

  if (response.status === 401) {
    return new OAuth2ClientError(message, { status: response.status, code });
  }

  if (response.status === 400 && (code === 'invalid_grant' || code === 'invalid_token')) {
    return new TokenRevokedError(
      `${message}. Hay que repetir el flujo de autorización del usuario.`,
      { status: response.status, code },
    );
  }

  return new OAuth2Error(message, { status: response.status, code });
}
