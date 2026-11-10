/**
 * @fileoverview Esquemas de validación Zod para payloads de HubSpot API v3.
 * Compatible con Zod v4 (v4.6.6+).
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enumeraciones del dominio de leads (según MER Cap. IV de la tesis)
// ---------------------------------------------------------------------------

/** Estados válidos de un lead en el sistema (tabla lead.estado) */
export const LeadEstadoEnum = z.enum([
  'nuevo',
  'prospecto',
  'cita_pendiente',
  'cita_confirmada',
  'cliente',
  'inactivo',
]);

// ---------------------------------------------------------------------------
// Schemas de entrada/salida para operaciones de contacto
// ---------------------------------------------------------------------------

/** Datos para crear un contacto en HubSpot (propiedades personalizadas) */
export const CreateContactInputSchema = z.object({
  /** Nombre del contacto */
  firstname: z.string().min(1, 'El nombre es requerido'),
  /** Apellido del contacto */
  lastname: z.string().min(1, 'El apellido es requerido'),
  /** Correo electrónico único */
  email: z.string().email('Email inválido'),
  /** Teléfono de contacto */
  phone: z.string().optional(),
  /** Estado del lead según el MER de la tesis */
  estado: LeadEstadoEnum.default('nuevo'),
});

/** Datos para actualizar un contacto existente */
export const UpdateContactInputSchema = z.object({
  /** ID interno de HubSpot del contacto */
  contactId: z.string().min(1, 'El ID de contacto es requerido'),
  /** Propiedades a actualizar (subconjunto opcional) */
  properties: z
    .object({
      firstname: z.string().min(1).optional(),
      lastname: z.string().min(1).optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      estado: LeadEstadoEnum.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'Al menos una propiedad debe proporcionarse para actualizar',
    }),
});

// ---------------------------------------------------------------------------
// Schemas de respuesta de HubSpot API v3
// ---------------------------------------------------------------------------

/** Respuesta de búsqueda de contacto por email (HubSpot CRM search API) */
export const ContactSearchResponseSchema = z.object({
  /** Resultados de la búsqueda */
  results: z.array(
    z.object({
      /** ID interno de HubSpot */
      id: z.string(),
      /** Propiedades del contacto */
      properties: z.object({
        firstname: z.string().optional(),
        lastname: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        estado: z.string().optional(),
      }),
    }),
  ),
  /** Total de resultados encontrados */
  total: z.number().optional(),
  /** Paginación */
  paging: z.object({}).optional(),
});

/** Respuesta de creación de contacto */
export const ContactCreateResponseSchema = z.object({
  id: z.string(),
  properties: z.object({
    firstname: z.string(),
    lastname: z.string(),
    email: z.string(),
    phone: z.string().optional(),
    estado: z.string().optional(),
  }),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  archived: z.boolean().optional(),
});

/** Respuesta de actualización de contacto */
export const ContactUpdateResponseSchema = z.object({
  id: z.string(),
  properties: z.object({}).passthrough(),
  updatedAt: z.string().datetime().optional(),
  archived: z.boolean().optional(),
});