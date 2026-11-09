/**
 * @fileoverview Módulo de integración con Mailchimp (API v3).
 *
 * Proporciona funciones para gestionar suscriptores, listas (audiencias)
 * y tags en Mailchimp. Permite agregar prospectos capturados desde Calendly
 * o HubSpot a las listas de email marketing y gestionar las secuencias
 * de comunicación del embudo de ventas.
 *
 * API Reference: https://mailchimp.com/developer/marketing/api/
 * Autenticación: API Key (Basic Auth con usuario 'anystring')
 *
 * @module integrations/mailchimp
 * @author Felipe — Tesis Automatización Fintech
 * @version 1.0.0
 * @license MIT
 *
 * Universidad Manuela Beltrán (UMB) · IS25237
 */

// =============================================================================
// Constantes de configuración
// =============================================================================

/**
 * Construye la URL base de la API de Mailchimp según el prefijo del servidor.
 *
 * @param {string} serverPrefix - Prefijo del servidor (ej: 'us21').
 * @returns {string} URL base de la API.
 */
function getMailchimpApiBase(serverPrefix) {
  return `https://${serverPrefix}.api.mailchimp.com/3.0`;
}

/** Tipos de suscriptor válidos en Mailchimp */
const SUBSCRIBER_STATUS = {
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed',
  CLEANED: 'cleaned',
  PENDING: 'pending',
  TRANSACTIONAL: 'transactional',
};

// =============================================================================
// Funciones de integración
// =============================================================================

/**
 * Agrega un nuevo suscriptor a una lista (audiencia) de Mailchimp.
 *
 * Si el suscriptor ya existe, actualiza sus datos y merge fields.
 * Utiliza el endpoint PUT con el hash MD5 del email para operación
 * idempotente (upsert).
 *
 * @param {Object} subscriberData - Datos del suscriptor.
 * @param {string} subscriberData.email - Email del suscriptor (obligatorio).
 * @param {string} subscriberData.firstName - Nombre (merge field FNAME).
 * @param {string} subscriberData.lastName - Apellido (merge field LNAME).
 * @param {string[]} [subscriberData.tags=[]] - Tags para segmentación.
 * @param {Object} mailchimpConfig - Configuración de Mailchimp.
 * @param {string} mailchimpConfig.apiKey - Clave API de Mailchimp.
 * @param {string} mailchimpConfig.serverPrefix - Prefijo del servidor.
 * @param {string} mailchimpConfig.defaultListId - ID de la lista por defecto.
 * @returns {Promise<Object>} Datos del suscriptor creado/actualizado con su ID.
 *
 * @example
 * const result = await addSubscriber({
 *   email: 'prospecto@ejemplo.com',
 *   firstName: 'María',
 *   lastName: 'González',
 *   tags: ['calendly', 'prospecto-calificado'],
 * }, config);
 */
async function addSubscriber(subscriberData, mailchimpConfig) {
  // TODO: Implementar llamada a PUT /3.0/lists/{list_id}/members/{subscriber_hash}
  // donde subscriber_hash = MD5(email.toLowerCase())
  //
  // Ejemplo de implementación:
  // const emailHash = crypto.createHash('md5')
  //   .update(subscriberData.email.toLowerCase())
  //   .digest('hex');
  //
  // const apiBase = getMailchimpApiBase(mailchimpConfig.serverPrefix);
  // const url = `${apiBase}/lists/${mailchimpConfig.defaultListId}/members/${emailHash}`;
  //
  // const response = await fetch(url, {
  //   method: 'PUT',
  //   headers: {
  //     'Authorization': `Basic ${Buffer.from(`anystring:${mailchimpConfig.apiKey}`).toString('base64')}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     email_address: subscriberData.email,
  //     status_if_new: SUBSCRIBER_STATUS.SUBSCRIBED,
  //     merge_fields: {
  //       FNAME: subscriberData.firstName,
  //       LNAME: subscriberData.lastName,
  //     },
  //   }),
  // });

  throw new Error('addSubscriber: No implementado. Stub de integración.');
}

/**
 * Agrega un tag a un suscriptor existente en Mailchimp.
 *
 * Los tags se usan para segmentar la audiencia y disparar
 * secuencias de email automatizadas según la etapa del embudo
 * de ventas (prospecto → cliente → inversor).
 *
 * @param {string} email - Email del suscriptor.
 * @param {string} tagName - Nombre del tag a agregar.
 * @param {Object} mailchimpConfig - Configuración de Mailchimp.
 * @param {string} mailchimpConfig.apiKey - Clave API.
 * @param {string} mailchimpConfig.serverPrefix - Prefijo del servidor.
 * @param {string} mailchimpConfig.defaultListId - ID de la lista.
 * @returns {Promise<void>}
 *
 * @example
 * await addTagToSubscriber('prospecto@ejemplo.com', 'cliente-activo', config);
 */
async function addTagToSubscriber(email, tagName, mailchimpConfig) {
  // TODO: Implementar llamada a POST /3.0/lists/{list_id}/members/{subscriber_hash}/tags
  //
  // Body: { tags: [{ name: tagName, status: 'active' }] }

  throw new Error('addTagToSubscriber: No implementado. Stub de integración.');
}

/**
 * Elimina un suscriptor de una lista de Mailchimp.
 *
 * Usado cuando un contacto solicita la eliminación de sus datos
 * (derecho de supresión — Ley 1581 de 2012, Art. 8, literal e).
 *
 * @param {string} email - Email del suscriptor a eliminar.
 * @param {Object} mailchimpConfig - Configuración de Mailchimp.
 * @param {string} mailchimpConfig.apiKey - Clave API.
 * @param {string} mailchimpConfig.serverPrefix - Prefijo del servidor.
 * @param {string} mailchimpConfig.defaultListId - ID de la lista.
 * @returns {Promise<void>}
 */
async function removeSubscriber(email, mailchimpConfig) {
  // TODO: Implementar llamada a DELETE /3.0/lists/{list_id}/members/{subscriber_hash}
  // Nota: Este endpoint elimina permanentemente al suscriptor.
  // Para cumplir con Ley 1581, registrar la solicitud de supresión antes de ejecutar.

  throw new Error('removeSubscriber: No implementado. Stub de integración.');
}

// =============================================================================
// Exportaciones
// =============================================================================

export {
  getMailchimpApiBase,
  SUBSCRIBER_STATUS,
  addSubscriber,
  addTagToSubscriber,
  removeSubscriber,
};
