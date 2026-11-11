/**
 * @fileoverview Datos sintéticos de demostración del dashboard ejecutivo.
 *
 * ⚠️ IMPORTANTE — Estos valores NO son resultados empíricos.
 *
 * Sirven para validar el cableado del componente (CLI, HTTP, workflow, Excel)
 * sin depender de un piloto con datos reales. Todo informe generado con ellos
 * se marca con `fuenteDatos: 'sintetico'` y `datosSinteticos: true`, y el
 * sello del libro Excel lo declara de forma explícita.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

/**
 * Genera el conjunto de datos sintéticos de demostración.
 * @returns {{leads: object[], campanas: object[], metricasCampanas: object[], citas: object[], inversiones: object[]}}
 */
export function generarDatosSinteticos() {
  const leads = [
    { id_lead: 1, estado: 'nuevo' },
    { id_lead: 2, estado: 'prospecto' },
    { id_lead: 3, estado: 'cita_pendiente' },
    { id_lead: 4, estado: 'cita_confirmada' },
    { id_lead: 5, estado: 'cliente' },
    { id_lead: 6, estado: 'cliente' },
    { id_lead: 7, estado: 'inactivo' },
    { id_lead: 8, estado: 'nuevo' },
    { id_lead: 9, estado: 'prospecto' },
    { id_lead: 10, estado: 'cita_confirmada' },
  ];

  const campanas = [
    {
      id_campaign: 1,
      nombre: 'Bienvenida Noviembre',
      estado: 'completada',
      suscriptores: 12,
    },
    {
      id_campaign: 2,
      nombre: 'Onboarding Clientes',
      estado: 'activa',
      suscriptores: 5,
    },
    {
      id_campaign: 3,
      nombre: 'Reactivación Inactivos',
      estado: 'pendiente',
      suscriptores: 0,
    },
  ];

  const metricasCampanas = [
    { id_campaign: 1, enviadas: 150, tasaApertura: 34.5, clicsGenerados: 28 },
    { id_campaign: 2, enviadas: 89, tasaApertura: 42.1, clicsGenerados: 19 },
    { id_campaign: 3, enviadas: 0, tasaApertura: 0, clicsGenerados: 0 },
  ];

  const citas = [
    {
      id_appointment: 101,
      id_lead: 3,
      nombreLead: 'Lead Demo 3',
      fecha_hora_inicio: '2026-11-09T10:00:00Z',
      fecha_hora_fin: '2026-11-09T11:00:00Z',
      enlace_calendly: 'https://calendly.com/asesor/reunion-101',
      estado: 'confirmada',
    },
    {
      id_appointment: 102,
      id_lead: 8,
      nombreLead: 'Lead Demo 8',
      fecha_hora_inicio: '2026-11-10T14:30:00Z',
      fecha_hora_fin: '2026-11-10T15:00:00Z',
      enlace_calendly: 'https://calendly.com/asesor/reunion-102',
      estado: 'confirmada',
    },
    {
      id_appointment: 103,
      id_lead: 1,
      nombreLead: 'Lead Demo 1',
      fecha_hora_inicio: '2026-11-11T09:00:00Z',
      estado: 'pendiente',
    },
  ];

  const inversiones = [
    { id_investment: 1, monto: 5000000, estado: 'activa', fecha_registro: '2026-10-15T08:00:00Z' },
    { id_investment: 2, monto: 3000000, estado: 'activa', fecha_registro: '2026-10-20T08:00:00Z' },
    { id_investment: 3, monto: 2000000, estado: 'vencida', fecha_registro: '2026-09-10T08:00:00Z' },
    { id_investment: 4, monto: 4000000, estado: 'activa', fecha_registro: '2026-11-01T08:00:00Z' },
    { id_investment: 5, monto: 1500000, estado: 'cancelada', fecha_registro: '2026-10-05T08:00:00Z' },
  ];

  return { leads, campanas, metricasCampanas, citas, inversiones };
}
