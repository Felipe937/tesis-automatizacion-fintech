/**
 * @fileoverview Esquemas de validación Zod para el componente de dashboard ejecutivo.
 * Compatible con Zod v4 (v4.6.6+).
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Esquemas de entrada
// ---------------------------------------------------------------------------

/** Parámetros de entrada para generar el dashboard ejecutivo */
export const DashboardInputSchema = z.object({
  /** ID del workflow que solicita el dashboard */
  workflowId: z.string().min(1, 'El workflowId es requerido'),

  /** Fecha y hora de inicio del periodo (ISO 8601) */
  periodoInicio: z.string().datetime('La fecha de inicio debe ser ISO 8601 válida'),

  /** Fecha y hora de fin del periodo (ISO 8601) */
  periodoFin: z.string().datetime('La fecha de fin debe ser ISO 8601 válida'),

  /** Si true, usa datos sintéticos para pruebas de desarrollo (default: true) */
  datosSinteticos: z.boolean().default(true),

  /** Ruta del libro Excel en OneDrive (DriveItem ID) para actualizar */
  excelDriveItemId: z.string().optional(),

  /** Nombre de la hoja de cálculo dentro del libro Excel */
  excelWorksheetName: z.string().default('Dashboard Ejecutivo'),
});

// ---------------------------------------------------------------------------
// Esquemas de salida del dashboard
// ---------------------------------------------------------------------------

/** Bloque a: leads por etapa del ciclo comercial */
export const LeadsPorEtapaSchema = z.object({
  nuevo: z.number().int().nonnegative(),
  prospecto: z.number().int().nonnegative(),
  cita_pendiente: z.number().int().nonnegative(),
  cita_confirmada: z.number().int().nonnegative(),
  cliente: z.number().int().nonnegative(),
  inactivo: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

/** Bloque b: campaña de Mailchimp */
export const CampañaMailchimpSchema = z.object({
  id_campaign: z.number().int().positive(),
  nombre: z.string(),
  estado: z.string(),
  enviadas: z.number().int().nonnegative(),
  tasaApertura: z.number().nonnegative().max(100),
  clicsGenerados: z.number().int().nonnegative(),
});

/** Bloque c: cita confirmada para el calendario semanal */
export const CitaSemanalSchema = z.object({
  id_appointment: z.number().int().positive(),
  id_lead: z.number().int().positive(),
  nombreLead: z.string(),
  fecha_hora_inicio: z.string().datetime(),
  fecha_hora_fin: z.string().datetime().optional(),
  enlace_calendly: z.string().url().optional(),
});

/** Bloque d: resumen financiero */
export const ResumenFinancieroSchema = z.object({
  saldoTotalInversionesActivas: z.number().nonnegative(),
  numeroOperacionesMesActual: z.number().int().nonnegative(),
  variacionPorcentualMesAnterior: z.number(),
});

/** Informe completo del dashboard ejecutivo */
export const DashboardOutputSchema = z.object({
  /** ID del workflow que generó el dashboard */
  workflowId: z.string(),
  /** Fecha y hora de última actualización (ISO 8601) */
  fechaActualizacion: z.string().datetime(),
  /** Periodo medido */
  periodo: z.object({
    inicio: z.string().datetime(),
    fin: z.string().datetime(),
  }),
  /** Bloque a: gráfico de barras — leads por etapa */
  leadsPorEtapa: LeadsPorEtapaSchema,
  /** Bloque b: tabla de campañas Mailchimp */
  campañasMailchimp: z.array(CampañaMailchimpSchema),
  /** Bloque c: calendario semanal de citas confirmadas */
  citasSemana: z.array(CitaSemanalSchema),
  /** Bloque d: resumen financiero */
  resumenFinanciero: ResumenFinancieroSchema,
  /** Indica si los datos son sintéticos (para pruebas) */
  datosSinteticos: z.boolean().default(false),
});