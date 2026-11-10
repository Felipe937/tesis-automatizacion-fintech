/**
 * @fileoverview Esquemas de validación Zod para payloads de Mailchimp API v3.
 * Compatible con Zod v4 (v4.6.6+).
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas de entrada para operaciones de miembros y tags
// ---------------------------------------------------------------------------

/** Datos para crear o actualizar un suscriptor en una lista */
export const AddOrUpdateMemberInputSchema = z.object({
  /** ID de la lista de Mailchimp */
  listId: z.string().min(1, 'El ID de lista es requerido'),
  /** Correo electrónico del suscriptor */
  email: z.string().email('Email inválido'),
  /** Datos de combinación (merge fields) */
  mergeFields: z
    .object({
      FNAME: z.string().optional(),
      LNAME: z.string().optional(),
      PHONE: z.string().optional(),
      ADDRESS: z.string().optional(),
    })
    .default({}),
  /** Estado de suscripción: subscribed, unsubscribed, cleaned, pending */
  status: z.enum(['subscribed', 'unsubscribed', 'cleaned', 'pending']).default('subscribed'),
  /** Tags para etiquetar al suscriptor (ej: ['nuevo', 'cita_pendiente']) */
  tags: z.array(z.string()).default([]),
});

/** Datos para añadir un tag a un suscriptor existente */
export const AddTagInputSchema = z.object({
  /** ID de la lista de Mailchimp */
  listId: z.string().min(1, 'El ID de lista es requerido'),
  /** Correo electrónico del suscriptor */
  email: z.string().email('Email inválido'),
  /** Tag a añadir (ej: 'nuevo', 'onboarding', 'bienvenida') */
  tag: z.string().min(1, 'El tag es requerido'),
});

// ---------------------------------------------------------------------------
// Schemas de respuesta de Mailchimp API v3
// ---------------------------------------------------------------------------

/** Respuesta de crear/actualizar miembro */
export const MemberResponseSchema = z.object({
  id: z.string(),
  email_address: z.string().email(),
  status: z.string(),
  merge_fields: z.object({}).passthrough(),
  list_id: z.string(),
});

/** Respuesta de añadir/actualizar tags */
export const TagsResponseSchema = z.object({
  members: z.array(
    z.object({
      email: z.string().email(),
      tags: z.array(
        z.object({
          name: z.string(),
          status: z.enum(['active', 'inactive']),
        }),
      ),
    }),
  ),
});