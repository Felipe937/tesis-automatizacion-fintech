/**
 * @fileoverview Adaptador que re-exporta el cliente de Microsoft Graph desde
 * services/excel-reconciler/src/graphClient.js.
 *
 * Este archivo NO duplica el código de graphClient.js. Simplemente re-exporta
 * la factory createGraphClient y las clases de error para que el componente
 * de dashboard reutilice el mismo mecanismo de autenticación (MSAL + Bearer
 * token + axios-retry) sin duplicar credenciales ni lógica de autenticación.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

export {
  createGraphClient,
  GraphAuthError,
  GraphApiError,
  ResourceNotFoundError,
} from '../../excel-reconciler/src/graphClient.js';