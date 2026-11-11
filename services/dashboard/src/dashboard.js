/**
 * @fileoverview Lógica pura para calcular los cuatro bloques del dashboard
 * ejecutivo del Asesor Fintech (§4.4 de la tesis IS25237).
 *
 * Bloques:
 *   a) Gráfico de barras: leads por etapa del ciclo comercial
 *   b) Tabla de campañas Mailchimp: enviadas, tasa de apertura, clics
 *   c) Calendario semanal: citas confirmadas
 *   d) Resumen financiero: saldo inversiones activas, operaciones del mes,
 *      variación % respecto al mes anterior
 *
 * Todas las funciones reciben datos como parámetros (inyectables), no leen
 * directamente de PostgreSQL ni de Graph API. Esto permite pruebas unitarias
 * con datos sintéticos y evita acoplar la lógica a infraestructura externa.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

// ---------------------------------------------------------------------------
// Bloque a: Leads por etapa del ciclo comercial
// ---------------------------------------------------------------------------

/** Etapas válidas del ciclo comercial según el MER (lead.estado) */
export const ETAPAS_LEAD = [
  'nuevo',
  'prospecto',
  'cita_pendiente',
  'cita_confirmada',
  'cliente',
  'inactivo',
];

/**
 * Calcula la distribución de leads por etapa del ciclo comercial.
 *
 * @param {Array<{ estado: string }>} leads - Array de leads con su estado
 * @returns {object} Conteo por etapa y total
 */
export function calcularLeadsPorEtapa(leads) {
  const conteo = {};
  ETAPAS_LEAD.forEach((etapa) => {
    conteo[etapa] = 0;
  });

  leads.forEach((lead) => {
    const etapa = lead.estado;
    if (conteo[etapa] !== undefined) {
      conteo[etapa] += 1;
    }
  });

  const total = leads.length;

  return {
    nuevo: conteo.nuevo,
    prospecto: conteo.prospecto,
    cita_pendiente: conteo.cita_pendiente,
    cita_confirmada: conteo.cita_confirmada,
    cliente: conteo.cliente,
    inactivo: conteo.inactivo,
    total,
  };
}

// ---------------------------------------------------------------------------
// Bloque b: Campañas Mailchimp
// ---------------------------------------------------------------------------

/**
 * Calcula la tabla de campañas Mailchimp del periodo.
 *
 * @param {Array<{ id_campaign: number, nombre: string, estado: string }>} campañas
 * @param {Array<{ id_campaign: number, enviadas: number, tasaApertura: number, clicsGenerados: number }>} metricasCampañas
 * @returns {Array<object>} Lista de campañas con sus métricas
 */
export function calcularCampañasMailchimp(campañas, metricasCampañas = []) {
  const metricasPorCampaign = {};
  metricasCampañas.forEach((m) => {
    metricasPorCampaign[m.id_campaign] = m;
  });

  return campañas.map((c) => {
    const metrica = metricasPorCampaign[c.id_campaign] || {
      enviadas: 0,
      tasaApertura: 0,
      clicsGenerados: 0,
    };
    return {
      id_campaign: c.id_campaign,
      nombre: c.nombre,
      estado: c.estado,
      enviadas: metrica.enviadas,
      tasaApertura: metrica.tasaApertura,
      clicsGenerados: metrica.clicsGenerados,
    };
  });
}

// ---------------------------------------------------------------------------
// Bloque c: Calendario semanal de citas confirmadas
// ---------------------------------------------------------------------------

/**
 * Filtra citas confirmadas que caen dentro de la semana indicada.
 *
 * @param {Array<{ id_appointment: number, id_lead: number, nombreLead: string, fecha_hora_inicio: string, fecha_hora_fin?: string, enlace_calendly?: string, estado: string }>} citas
 * @param {string} fechaInicioSemana - Inicio de la semana (ISO 8601)
 * @param {string} fechaFinSemana - Fin de la semana (ISO 8601)
 * @returns {Array<object>} Citas confirmadas en la semana
 */
export function calcularCitasSemana(citas, fechaInicioSemana, fechaFinSemana) {
  const inicio = new Date(fechaInicioSemana);
  const fin = new Date(fechaFinSemana);

  return citas
    .filter((cita) => {
      if (cita.estado !== 'confirmada') {
        return false;
      }
      const fechaCita = new Date(cita.fecha_hora_inicio);
      return fechaCita >= inicio && fechaCita <= fin;
    })
    .map((cita) => ({
      id_appointment: cita.id_appointment,
      id_lead: cita.id_lead,
      nombreLead: cita.nombreLead,
      fecha_hora_inicio: cita.fecha_hora_inicio,
      fecha_hora_fin: cita.fecha_hora_fin,
      enlace_calendly: cita.enlace_calendly,
    }));
}

// ---------------------------------------------------------------------------
// Bloque d: Resumen financiero
// ---------------------------------------------------------------------------

/**
 * Calcula el resumen financiero: saldo de inversiones activas, operaciones
 * del mes actual y variación porcentual respecto al mes anterior.
 *
 * @param {Array<{ monto: number, estado: string, fecha_registro: string }>} inversiones
 * @param {string} fechaActual - Fecha de referencia (ISO 8601)
 * @returns {object} Resumen financiero
 */
export function calcularResumenFinanciero(inversiones, fechaActual) {
  const ahora = new Date(fechaActual);
  const mesActual = ahora.getMonth();
  const anioActual = ahora.getFullYear();

  const mesAnterior = mesActual === 0 ? 11 : mesActual - 1;
  const anioMesAnterior = mesActual === 0 ? anioActual - 1 : anioActual;

  // Inversiones activas: saldo total
  const inversionesActivas = inversiones.filter(
    (inv) => inv.estado === 'activa',
  );
  const saldoTotal = inversionesActivas.reduce(
    (acc, inv) => acc + (inv.monto ?? 0),
    0,
  );

  // Operaciones del mes actual
  const operacionesMesActual = inversiones.filter((inv) => {
    const fecha = new Date(inv.fecha_registro);
    return fecha.getMonth() === mesActual && fecha.getFullYear() === anioActual;
  }).length;

  // Operaciones del mes anterior
  const operacionesMesAnterior = inversiones.filter((inv) => {
    const fecha = new Date(inv.fecha_registro);
    return (
      fecha.getMonth() === mesAnterior && fecha.getFullYear() === anioMesAnterior
    );
  }).length;

  // Variación porcentual respecto al mes anterior
  let variacionPorcentual = 0;
  if (operacionesMesAnterior > 0) {
    variacionPorcentual =
      ((operacionesMesActual - operacionesMesAnterior) /
        operacionesMesAnterior) *
      100;
  } else if (operacionesMesActual > 0) {
    variacionPorcentual = 100; // De 0 a algo es +100%
  }

  return {
    saldoTotalInversionesActivas: Math.round(saldoTotal * 100) / 100,
    numeroOperacionesMesActual: operacionesMesActual,
    variacionPorcentualMesAnterior: Math.round(variacionPorcentual * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Informe completo del dashboard
// ---------------------------------------------------------------------------

/**
 * Genera el informe completo del dashboard ejecutivo con los cuatro bloques.
 *
 * @param {object} params - Parámetros de entrada
 * @param {string} params.workflowId - ID del workflow
 * @param {string} params.periodoInicio - Inicio del periodo (ISO 8601)
 * @param {string} params.periodoFin - Fin del periodo (ISO 8601)
 * @param {Array} params.leads - Lista de leads
 * @param {Array} params.campañas - Lista de campañas
 * @param {Array} params.metricasCampañas - Métricas de campañas Mailchimp
 * @param {Array} params.citas - Lista de citas/appointments
 * @param {Array} params.inversiones - Lista de inversiones
 * @param {string} params.fechaActual - Fecha de referencia actual (ISO 8601)
 * @param {boolean} [params.datosSinteticos=false] - Datos sintéticos
 * @returns {object} Informe del dashboard válido con DashboardOutputSchema
 */
export function generarDashboard(params) {
  const {
    workflowId,
    periodoInicio,
    periodoFin,
    leads,
    campañas,
    metricasCampañas = [],
    citas,
    inversiones,
    fechaActual = new Date().toISOString(),
    datosSinteticos = false,
  } = params;

  const leadsPorEtapa = calcularLeadsPorEtapa(leads);
  const campañasMailchimp = calcularCampañasMailchimp(campañas, metricasCampañas);
  const citasSemana = calcularCitasSemana(citas, periodoInicio, periodoFin);
  const resumenFinanciero = calcularResumenFinanciero(inversiones, fechaActual);

  return {
    workflowId,
    fechaActualizacion: fechaActual,
    periodo: {
      inicio: periodoInicio,
      fin: periodoFin,
    },
    leadsPorEtapa,
    campañasMailchimp,
    citasSemana,
    resumenFinanciero,
    datosSinteticos,
  };
}