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

/** Configuración de la conexión a PostgreSQL. */
export const PostgresConfigSchema = z.object({
  /** Cadena de conexión completa (postgresql://...). */
  connectionString: z.string().min(1).optional(),
  /** Host de PostgreSQL */
  host: z.string().min(1).optional(),
  /** Puerto de PostgreSQL */
  port: z.coerce.number().int().positive().optional(),
  /** Nombre de la base de datos */
  database: z.string().min(1).optional(),
  /** Usuario de la base de datos */
  user: z.string().min(1).optional(),
  /** Contraseña de la base de datos */
  password: z.string().optional(),
  /** Schema donde viven las tablas de negocio (por defecto: public) */
  schema: z.string().min(1).default('public'),
});

/** Lead del periodo (bloque a). */
export const LeadSchema = z.object({
  id_lead: z.coerce.number().int().positive(),
  estado: z.string(),
  fecha_registro: z.string().datetime().optional().nullable(),
});

/** Campaña de Mailchimp (bloque b). */
export const CampanaSchema = z.object({
  id_campaign: z.coerce.number().int().positive(),
  nombre: z.string(),
  estado: z.string(),
  id_mailchimp: z.string().optional().nullable(),
  suscriptores: z.coerce.number().int().nonnegative().default(0),
});

/** Métricas de reporte de una campaña (procedentes de la API de Mailchimp). */
export const MetricasCampanaSchema = z.object({
  id_campaign: z.coerce.number().int().positive(),
  enviadas: z.coerce.number().int().nonnegative().default(0),
  tasaApertura: z.coerce.number().nonnegative().max(100).default(0),
  clicsGenerados: z.coerce.number().int().nonnegative().default(0),
});

/** Cita del periodo (bloque c). */
export const CitaSchema = z.object({
  id_appointment: z.coerce.number().int().positive(),
  id_lead: z.coerce.number().int().positive(),
  nombreLead: z.string(),
  fecha_hora_inicio: z.string().datetime(),
  fecha_hora_fin: z.string().datetime().optional().nullable(),
  enlace_calendly: z.string().optional().nullable(),
  estado: z.string(),
});

/** Inversión registrada (bloque d). */
export const InversionSchema = z.object({
  id_investment: z.coerce.number().int().positive().optional(),
  monto: z.coerce.number().nonnegative(),
  estado: z.string(),
  fecha_registro: z.string().datetime().optional().nullable(),
});

/** Parámetros de entrada para generar el dashboard ejecutivo. */
export const DashboardInputSchema = z
  .object({
    /** ID del workflow que solicita el dashboard */
    workflowId: z.string().min(1, 'El workflowId es requerido'),

    /** Fecha y hora de inicio del periodo (ISO 8601) */
    periodoInicio: z.string().datetime('La fecha de inicio debe ser ISO 8601 válida'),

    /** Fecha y hora de fin del periodo (ISO 8601) */
    periodoFin: z.string().datetime('La fecha de fin debe ser ISO 8601 válida'),

    /**
     * Origen de los datos del dashboard.
     *   - 'postgres'  → se leen del MER en PostgreSQL (datos reales).
     *   - 'sintetico' → se usan los datos de demostración.
     */
    fuenteDatos: z.enum(['postgres', 'sintetico']).default('sintetico'),

    /**
     * @deprecated Usar `fuenteDatos`. Se mantiene por compatibilidad con el
     * contrato publicado y con las ejecuciones de prueba existentes.
     */
    datosSinteticos: z.boolean().optional(),

    /** Configuración opcional de la conexión a PostgreSQL */
    postgres: PostgresConfigSchema.optional(),

    /** Datos pre-cargados (permite tests y ejecuciones sin base de datos) */
    leads: z.array(LeadSchema).optional(),
    campanas: z.array(CampanaSchema).optional(),
    metricasCampanas: z.array(MetricasCampanaSchema).optional(),
    citas: z.array(CitaSchema).optional(),
    inversiones: z.array(InversionSchema).optional(),

    /** Ruta del libro Excel en OneDrive (DriveItem ID) para actualizar */
    excelDriveItemId: z.string().optional(),

    /** Nombre de la hoja de cálculo dentro del libro Excel */
    excelWorksheetName: z.string().default('Dashboard Ejecutivo'),

    /** Escribir el informe en OneDrive (por defecto, si hay driveItemId) */
    actualizarExcel: z.boolean().default(true),
  })
  .refine((data) => data.periodoFin >= data.periodoInicio, {
    message: 'periodoFin no puede ser anterior a periodoInicio',
    path: ['periodoFin'],
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
  /** Suscriptores registrados en `campaign_lead` para la campaña */
  suscriptores: z.number().int().nonnegative().default(0),
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
  /** Total de operaciones registradas (mockup §4.4) */
  totalOperaciones: z.number().int().nonnegative(),
  /** Monto acumulado de las inversiones activas (mockup §4.4) */
  montoAcumulado: z.number().nonnegative(),
  /** Operaciones en estado «activa» (mockup §4.4) */
  operacionesPendientes: z.number().int().nonnegative(),
  /** Operaciones en estado «vencida» (mockup §4.4) */
  operacionesCompletadas: z.number().int().nonnegative(),
  /** Operaciones en estado «cancelada» (MER, §4.3) */
  operacionesCanceladas: z.number().int().nonnegative(),
});

/** Resumen de trazabilidad de las automatizaciones del periodo (automation_log). */
export const ResumenAutomatizacionesSchema = z.object({
  totalEjecuciones: z.number().int().nonnegative(),
  ejecucionesExitosas: z.number().int().nonnegative(),
  ejecucionesConError: z.number().int().nonnegative(),
  ejecucionesConAdvertencia: z.number().int().nonnegative(),
  registrosProcesados: z.number().int().nonnegative(),
  latenciaMediaMs: z.number().nonnegative().nullable(),
});

/** Indicadores clave de gestión (KPI) del mockup §4.4. */
export const KpisSchema = z.object({
  /** Leads captados en el periodo */
  leadsRegistradas: z.number().int().nonnegative(),
  /** Citas del periodo, excluidas las canceladas */
  citasAgendadas: z.number().int().nonnegative(),
  /** Inversiones con fecha de registro dentro del periodo */
  inversionesRegistradas: z.number().int().nonnegative(),
  /** Porcentaje de leads que alcanzaron el estado «cliente» */
  conversionPorcentaje: z.number().nonnegative().max(100),
});

/** Fila del bloque «Seguimiento comercial». */
export const SeguimientoComercialSchema = z.object({
  /** Estado del MER (lead.estado) */
  estado: z.string(),
  /** Etapa comercial agregada del mockup */
  etapaComercial: z.string(),
  /** Cantidad de leads en ese estado */
  cantidad: z.number().int().nonnegative(),
  /** Participación porcentual sobre el total del embudo */
  participacionPorcentaje: z.number().nonnegative().max(100),
});

/** Fila del bloque «Monitoreo de integraciones». */
export const MonitoreoIntegracionSchema = z.object({
  /** Plataforma monitoreada */
  plataforma: z.string(),
  /** Última sincronización registrada (ISO 8601) o null si no hay ejecuciones */
  ultimaSincronizacion: z.string().datetime().nullable(),
  /** Estado de la última sincronización */
  estado: z.string(),
});

/** Bloque «Control de actualización». */
export const ControlActualizacionSchema = z.object({
  /** Fecha y hora de la última actualización del dashboard */
  ultimaActualizacion: z.string().datetime(),
  /** Estado general de las sincronizaciones */
  estadoGeneral: z.string(),
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
  /** Indicadores clave de gestión */
  kpis: KpisSchema,
  /** Bloque a: gráfico de barras — leads por etapa */
  leadsPorEtapa: LeadsPorEtapaSchema,
  /** Bloque a ampliado: estado del lead, etapa comercial y participación */
  seguimientoComercial: z.array(SeguimientoComercialSchema),
  /** Bloque b: tabla de campañas Mailchimp */
  campañasMailchimp: z.array(CampañaMailchimpSchema),
  /** Bloque c: calendario semanal de citas confirmadas */
  citasSemana: z.array(CitaSemanalSchema),
  /** Bloque d: resumen financiero */
  resumenFinanciero: ResumenFinancieroSchema,
  /** Monitoreo de integraciones (última sincronización por plataforma) */
  monitoreoIntegraciones: z.array(MonitoreoIntegracionSchema),
  /** Control de actualización del tablero */
  controlActualizacion: ControlActualizacionSchema,
  /** Trazabilidad de automatizaciones del periodo */
  resumenAutomatizaciones: ResumenAutomatizacionesSchema.optional(),
  /** Indica si las métricas de reporte de Mailchimp están disponibles */
  metricasMailchimpDisponibles: z.boolean().default(false),
  /** Origen de los datos: 'postgres' (reales) | 'sintetico' (demostración) */
  fuenteDatos: z.enum(['postgres', 'sintetico']),
  /** Indica si los datos son sintéticos (para pruebas) */
  datosSinteticos: z.boolean().default(false),
  /** Advertencias sobre la cobertura de los datos */
  advertencias: z.array(z.string()).default([]),
});
