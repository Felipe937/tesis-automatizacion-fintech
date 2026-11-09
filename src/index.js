/**
 * @fileoverview Punto de entrada principal — Lógica de integración entre APIs.
 *
 * Este módulo orquesta las integraciones entre las APIs externas del sistema
 * de automatización Fintech: HubSpot CRM, Mailchimp, Calendly y OneDrive/Excel.
 *
 * Arquitectura:
 * - n8n (low-code) maneja la orquestación principal de workflows.
 * - Este módulo Node.js complementa a n8n para lógica compleja que excede
 *   las capacidades nativas de n8n (ej: conciliación financiera, validaciones
 *   avanzadas, transformaciones de datos entre APIs).
 *
 * Flujo de datos:
 *   Calendly (webhook) → n8n → [Este módulo] → HubSpot / Mailchimp / OneDrive
 *
 * Variables de entorno requeridas:
 *   - HUBSPOT_API_KEY: Token de Private App de HubSpot
 *   - MAILCHIMP_API_KEY: Clave API de Mailchimp
 *   - MAILCHIMP_SERVER_PREFIX: Prefijo del servidor Mailchimp (ej: us21)
 *   - CALENDLY_API_KEY: Token de acceso personal de Calendly
 *   - MICROSOFT_CLIENT_ID: ID de aplicación registrada en Azure AD
 *   - MICROSOFT_CLIENT_SECRET: Secreto de la aplicación Azure AD
 *   - MICROSOFT_TENANT_ID: ID del tenant de Azure AD
 *
 * @author Felipe — Tesis Automatización Fintech
 * @version 1.0.0
 * @license MIT
 * @see {@link https://github.com/Felipe937/tesis-automatizacion-fintech}
 *
 * Universidad Manuela Beltrán (UMB) · IS25237
 * Ingeniería de Software · 2026
 */

// =============================================================================
// Importaciones de módulos de integración
// =============================================================================

import { createContact, updateContactStage, searchContactByEmail } from './integrations/hubspot.js';
import { addSubscriber, addTagToSubscriber } from './integrations/mailchimp.js';
import { getScheduledEvents, verifyWebhookSignature } from './integrations/calendly.js';
import { readExcelWorksheet, updateExcelRange } from './integrations/onedrive.js';

// =============================================================================
// Configuración global
// =============================================================================

/**
 * Carga y valida las variables de entorno necesarias para las integraciones.
 * Lanza un error descriptivo si alguna variable obligatoria falta.
 *
 * @returns {Object} Objeto con la configuración validada de todas las APIs.
 * @throws {Error} Si alguna variable de entorno obligatoria no está definida.
 */
function loadIntegrationConfig() {
  const config = {
    hubspot: {
      apiKey: process.env.HUBSPOT_API_KEY,
      portalId: process.env.HUBSPOT_PORTAL_ID,
    },
    mailchimp: {
      apiKey: process.env.MAILCHIMP_API_KEY,
      serverPrefix: process.env.MAILCHIMP_SERVER_PREFIX,
      defaultListId: process.env.MAILCHIMP_LIST_ID,
    },
    calendly: {
      apiKey: process.env.CALENDLY_API_KEY,
      webhookSigningKey: process.env.CALENDLY_WEBHOOK_SIGNING_KEY,
      orgUri: process.env.CALENDLY_ORG_URI,
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      tenantId: process.env.MICROSOFT_TENANT_ID,
    },
  };

  // Validar que las credenciales críticas estén presentes
  const requiredVars = [
    ['HUBSPOT_API_KEY', config.hubspot.apiKey],
    ['MAILCHIMP_API_KEY', config.mailchimp.apiKey],
    ['CALENDLY_API_KEY', config.calendly.apiKey],
    ['MICROSOFT_CLIENT_ID', config.microsoft.clientId],
    ['MICROSOFT_CLIENT_SECRET', config.microsoft.clientSecret],
    ['MICROSOFT_TENANT_ID', config.microsoft.tenantId],
  ];

  const missing = requiredVars
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Variables de entorno faltantes: ${missing.join(', ')}. ` +
      'Configúralas en el archivo .env antes de ejecutar este módulo.'
    );
  }

  return config;
}

// =============================================================================
// Flujo 1: Captura de Lead (Calendly → HubSpot → Mailchimp)
// =============================================================================

/**
 * Procesa un webhook de Calendly para capturar un nuevo lead.
 *
 * Pasos:
 * 1. Verifica la firma del webhook de Calendly (seguridad).
 * 2. Extrae los datos del invitado (nombre, email, tipo de evento).
 * 3. Busca si el contacto ya existe en HubSpot CRM.
 * 4. Crea o actualiza el contacto en HubSpot según corresponda.
 * 5. Agrega al contacto a la lista de prospectos en Mailchimp.
 *
 * @param {Object} webhookPayload - Payload del webhook de Calendly (evento invitee.created).
 * @param {string} webhookSignature - Firma del webhook para verificación HMAC.
 * @returns {Promise<Object>} Resultado del procesamiento con IDs de HubSpot y Mailchimp.
 */
async function processLeadCapture(webhookPayload, webhookSignature) {
  const config = loadIntegrationConfig();

  // Paso 1: Verificar autenticidad del webhook
  const isValid = verifyWebhookSignature(
    webhookPayload,
    webhookSignature,
    config.calendly.webhookSigningKey
  );
  if (!isValid) {
    throw new Error('Firma del webhook de Calendly inválida. Posible intento de suplantación.');
  }

  // Paso 2: Extraer datos del invitado
  const invitee = webhookPayload.payload?.invitee;
  if (!invitee?.email) {
    throw new Error('El payload de Calendly no contiene datos del invitado.');
  }

  // Paso 3: Buscar contacto existente en HubSpot
  const existingContact = await searchContactByEmail(invitee.email, config.hubspot);

  let hubspotContactId;

  if (existingContact) {
    // Paso 4a: Actualizar contacto existente
    hubspotContactId = existingContact.id;
    await updateContactStage(hubspotContactId, 'salesqualifiedlead', config.hubspot);
    console.error(`[Lead Capture] Contacto actualizado en HubSpot: ${hubspotContactId}`);
  } else {
    // Paso 4b: Crear nuevo contacto
    const newContact = await createContact({
      email: invitee.email,
      firstName: invitee.name?.split(' ')[0] || '',
      lastName: invitee.name?.split(' ').slice(1).join(' ') || '',
      source: 'calendly',
    }, config.hubspot);
    hubspotContactId = newContact.id;
    console.error(`[Lead Capture] Nuevo contacto creado en HubSpot: ${hubspotContactId}`);
  }

  // Paso 5: Agregar a Mailchimp
  const mailchimpResult = await addSubscriber({
    email: invitee.email,
    firstName: invitee.name?.split(' ')[0] || '',
    lastName: invitee.name?.split(' ').slice(1).join(' ') || '',
    tags: ['calendly', 'prospecto-calificado'],
  }, config.mailchimp);

  console.error(`[Lead Capture] Suscriptor agregado a Mailchimp: ${mailchimpResult.id}`);

  return {
    exitoso: true,
    hubspotContactId,
    mailchimpSubscriberId: mailchimpResult.id,
    email: invitee.email,
    timestamp: new Date().toISOString(),
  };
}

// =============================================================================
// Flujo 2: Sincronización de Etapa del Pipeline (HubSpot → Mailchimp)
// =============================================================================

/**
 * Sincroniza la etapa del pipeline entre HubSpot y Mailchimp.
 * Cuando un contacto avanza de etapa en HubSpot, se actualiza su
 * pertenencia a las listas de Mailchimp correspondientes.
 *
 * @param {string} contactEmail - Email del contacto a sincronizar.
 * @param {string} newStage - Nueva etapa del pipeline en HubSpot.
 * @returns {Promise<Object>} Resultado de la sincronización.
 */
async function syncPipelineStage(contactEmail, newStage) {
  const config = loadIntegrationConfig();

  // Mapeo de etapas de HubSpot a tags de Mailchimp
  const stageTagMapping = {
    lead: 'prospecto',
    salesqualifiedlead: 'prospecto-calificado',
    opportunity: 'oportunidad',
    customer: 'cliente-activo',
  };

  const newTag = stageTagMapping[newStage];
  if (!newTag) {
    throw new Error(`Etapa de pipeline no reconocida: ${newStage}`);
  }

  // Agregar el tag correspondiente en Mailchimp
  await addTagToSubscriber(contactEmail, newTag, config.mailchimp);

  return {
    exitoso: true,
    email: contactEmail,
    newStage,
    mailchimpTag: newTag,
    timestamp: new Date().toISOString(),
  };
}

// =============================================================================
// Exportaciones
// =============================================================================

export {
  loadIntegrationConfig,
  processLeadCapture,
  syncPipelineStage,
};
