/**
 * @fileoverview Esquemas de validación Zod para payloads de Calendly API v2
 * y para webhooks entrantes de Calendly.
 * Compatible con Zod v4 (v4.6.6+).
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas de eventos de webhook Calendly (invitee.created / invitee.canceled)
// ---------------------------------------------------------------------------

/** Payload de evento de webhook de Calendly */
export const CalendlyWebhookPayloadSchema = z.object({
  /** Tipo de evento: invitee.created, invitee.canceled, etc. */
  event: z.string(),
  /** Payload del evento */
  payload: z.object({
    /** Datos del invitado */
    invitee: z.object({
      /** Correo electrónico del invitado */
      email: z.string().email(),
      /** Nombre del invitado */
      first_name: z.string(),
      /** Apellido del invitado */
      last_name: z.string(),
      /** Número de teléfono */
      phone_number: z.string().optional(),
      /** URI del evento en Calendly */
      uri: z.string().url(),
    }),
    /** Datos del evento programado */
    event: z.object({
      /** Fecha y hora de inicio (ISO 8601) */
      start_time: z.string().datetime(),
      /** Fecha y hora de fin (ISO 8601) */
      end_time: z.string().datetime(),
      /** URI del evento */
      uri: z.string().url(),
    }),
  }),
});

// ---------------------------------------------------------------------------
// Schemas de respuestas de Calendly API v2
// ---------------------------------------------------------------------------

/** Respuesta de GET /scheduled_events/{uuid} */
export const EventResponseSchema = z.object({
  uri: z.string().url(),
  name: z.string(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  location: z.object({}).passthrough().optional(),
  invitees: z.array(z.object({})).optional(),
});

/** Respuesta de GET /scheduled_events/{uuid}/invitees/{uuid} */
export const InviteeResponseSchema = z.object({
  uri: z.string().url(),
  email: z.string().email(),
  first_name: z.string(),
  last_name: z.string(),
  phone_number: z.string().optional(),
  status: z.string(),
  created_at: z.string().datetime(),
  canceled_at: z.string().datetime().optional(),
});