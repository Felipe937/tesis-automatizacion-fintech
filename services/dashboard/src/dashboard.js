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
 * Etapas comerciales del embudo según el mockup del dashboard ejecutivo
 * (§4.4, Figura «Dashboard Ejecutivo — Asesor Fintech»): cuatro fases que
 * agregan los seis estados del MER.
 *
 * El estado `inactivo` queda **fuera del embudo**: no es una etapa comercial,
 * por lo que se reporta aparte y no altera el 100 % de la participación.
 */
export const ETAPAS_COMERCIALES = [
  { etiqueta: 'Nuevo', estados: ['nuevo'] },
  { etiqueta: 'En seguimiento', estados: ['prospecto'] },
  { etiqueta: 'Cita agendada', estados: ['cita_pendiente', 'cita_confirmada'] },
  { etiqueta: 'Convertido', estados: ['cliente'] },
];

/**
 * Plataformas cuyo estado de sincronización muestra el dashboard, con los
 * workflows de n8n que las integran (mockup, bloque «Monitoreo de integraciones»).
 */
export const PLATAFORMAS_MONITOREDAS = [
  { plataforma: 'HubSpot CRM', workflows: ['captura-leads', 'secuencias-email'] },
  { plataforma: 'Mailchimp', workflows: ['captura-leads', 'secuencias-email'] },
  { plataforma: 'Calendly', workflows: ['captura-leads'] },
  {
    plataforma: 'Excel / OneDrive',
    workflows: ['conciliacion-excel', 'alertas-financieras', 'dashboard-ejecutivo'],
  },
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
 * Calcula la tabla «Seguimiento comercial» del mockup: cada estado del MER con
 * su etapa comercial agregada, la cantidad de leads y su participación
 * porcentual sobre el total del embudo.
 *
 * El estado `inactivo` no pertenece al embudo: se informa con participación 0
 * para no alterar la suma (que debe ser 100 %).
 *
 * @param {Array<{ estado: string }>} leads - Leads del periodo
 * @returns {Array<{ estado: string, etapaComercial: string, cantidad: number, participacionPorcentaje: number }>}
 */
export function calcularSeguimientoComercial(leads) {
  const total = Array.isArray(leads) ? leads.length : 0;
  const conteo = {};
  (leads ?? []).forEach((lead) => {
    conteo[lead.estado] = (conteo[lead.estado] ?? 0) + 1;
  });

  const filas = ETAPAS_COMERCIALES.flatMap((etapa) =>
    etapa.estados.map((estado) => {
      const cantidad = conteo[estado] ?? 0;
      return {
        estado,
        etapaComercial: etapa.etiqueta,
        cantidad,
        participacionPorcentaje:
          total > 0 ? Math.round((cantidad / total) * 10000) / 100 : 0,
      };
    }),
  );

  const inactivos = conteo.inactivo ?? 0;
  filas.push({
    estado: 'inactivo',
    etapaComercial: '— (fuera del embudo)',
    cantidad: inactivos,
    participacionPorcentaje: 0,
  });

  return filas;
}

/**
 * Calcula los indicadores clave de gestión (KPI) del mockup.
 *
 * - Leads registradas: leads captados en el periodo.
 * - Citas agendadas: citas del periodo, excluidas las canceladas.
 * - Inversiones registradas: inversiones con fecha de registro en el periodo.
 * - Conversión: porcentaje de leads que alcanzaron el estado «cliente».
 *
 * @param {object} params - Parámetros
 * @param {Array<{ estado: string }>} params.leads - Leads del periodo
 * @param {Array<{ estado: string, fecha_registro: string }>} params.citas - Citas del periodo
 * @param {Array<{ fecha_registro: string }>} params.inversiones - Inversiones
 * @param {string} params.periodoInicio - Inicio del periodo (ISO 8601)
 * @param {string} params.periodoFin - Fin del periodo (ISO 8601)
 * @returns {object} Indicadores clave
 */
export function calcularKpis({ leads = [], citas = [], inversiones = [], periodoInicio, periodoFin }) {
  const totalLeads = leads.length;
  const convertidos = leads.filter((l) => l.estado === 'cliente').length;
  const citasAgendadas = citas.filter((c) => c.estado !== 'cancelada').length;
  const dentroDelPeriodo = (fecha) => {
    if (!fecha) return false;
    const instante = new Date(fecha).getTime();
    return (
      instante >= new Date(periodoInicio).getTime() &&
      instante <= new Date(periodoFin).getTime()
    );
  };

  return {
    leadsRegistradas: totalLeads,
    citasAgendadas,
    inversionesRegistradas: inversiones.filter((inv) => dentroDelPeriodo(inv.fecha_registro)).length,
    conversionPorcentaje:
      totalLeads > 0 ? Math.round((convertidos / totalLeads) * 10000) / 100 : 0,
  };
}

/**
 * Calcula el bloque «Monitoreo de integraciones» del mockup: por plataforma,
 * la fecha de la última sincronización y su estado, a partir de las
 * ejecuciones registradas en `automation_log`.
 *
 * @param {Array<{ workflow_id: string, timestamp_inicio: string, estado: string }>} ejecuciones
 * @returns {Array<{ plataforma: string, ultimaSincronizacion: string|null, estado: string }>}
 */
export function calcularMonitoreoIntegraciones(ejecuciones = []) {
  return PLATAFORMAS_MONITOREDAS.map(({ plataforma, workflows }) => {
    const propias = (ejecuciones ?? []).filter((e) => workflows.includes(e.workflow_id));
    if (propias.length === 0) {
      return { plataforma, ultimaSincronizacion: null, estado: 'Sin ejecuciones' };
    }
    const ultima = propias.reduce((max, e) =>
      new Date(e.timestamp_inicio) > new Date(max) ? e.timestamp_inicio : max,
    propias[0].timestamp_inicio);
    const estado = propias.find((e) => e.timestamp_inicio === ultima)?.estado ?? 'desconocido';
    return {
      plataforma,
      ultimaSincronizacion: ultima,
      estado: estado === 'exito' ? 'Correcto' : estado === 'advertencia' ? 'Con advertencias' : 'Con errores',
    };
  });
}

/**
 * Calcula el bloque «Control de actualización» del mockup.
 *
 * @param {Array<{ plataforma: string, estado: string }>} monitoreo
 * @param {string} fechaActualizacion - Fecha de generación del dashboard
 * @returns {{ ultimaActualizacion: string, estadoGeneral: string }}
 */
export function calcularControlActualizacion(monitoreo, fechaActualizacion) {
  const conErrores = (monitoreo ?? []).filter(
    (m) => m.estado !== 'Correcto' && m.estado !== 'Sin ejecuciones',
  );
  return {
    ultimaActualizacion: fechaActualizacion,
    estadoGeneral:
      conErrores.length === 0 ? 'Sincronización correcta' : 'Revisar sincronizaciones con errores',
  };
}

/**
 * Calcula la tabla de campañas Mailchimp del periodo.
 *
 * `enviadas`, `tasaApertura` y `clicsGenerados` son métricas de REPORTE de
 * Mailchimp (no están almacenadas en el MER): sólo se rellenan si el
 * orquestador las entrega en `metricasCampañas`. `suscriptores` sí es un dato
 * del MER: se obtiene de `campaign_lead`.
 *
 * @param {Array<{ id_campaign: number, nombre: string, estado: string, suscriptores?: number }>} campañas
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
      suscriptores: c.suscriptores ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Bloque c: Calendario semanal de citas confirmadas
// ---------------------------------------------------------------------------

/**
 * Filtra citas confirmadas que caen dentro de la semana indicada.
 *
 * @param {Array<{
 *   id_appointment: number,
 *   id_lead: number,
 *   nombreLead: string,
 *   fecha_hora_inicio: string,
 *   fecha_hora_fin?: string,
 *   enlace_calendly?: string,
 *   estado: string
 * }>} citas
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
    // Líneas del bloque «Resumen de inversiones» del mockup (§4.4)
    totalOperaciones: inversiones.length,
    montoAcumulado: Math.round(saldoTotal * 100) / 100,
    operacionesPendientes: inversiones.filter((inv) => inv.estado === 'activa').length,
    operacionesCompletadas: inversiones.filter((inv) => inv.estado === 'vencida').length,
    operacionesCanceladas: inversiones.filter((inv) => inv.estado === 'cancelada').length,
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
 * @param {'postgres'|'sintetico'} [params.fuenteDatos] - Origen de los datos
 * @param {object} [params.resumenAutomatizaciones] - Trazabilidad de automation_log
 * @param {Array} [params.ejecuciones] - Ejecuciones de automation_log (monitoreo de integraciones)
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
    fuenteDatos = datosSinteticos ? 'sintetico' : 'postgres',
    resumenAutomatizaciones = null,
    ejecuciones = [],
  } = params;

  const leadsPorEtapa = calcularLeadsPorEtapa(leads);
  const campañasMailchimp = calcularCampañasMailchimp(campañas, metricasCampañas);
  const citasSemana = calcularCitasSemana(citas, periodoInicio, periodoFin);
  const resumenFinanciero = calcularResumenFinanciero(inversiones, fechaActual);

  const seguimientoComercial = calcularSeguimientoComercial(leads);
  const kpis = calcularKpis({ leads, citas, inversiones, periodoInicio, periodoFin });
  const monitoreoIntegraciones = calcularMonitoreoIntegraciones(ejecuciones);
  const controlActualizacion = calcularControlActualizacion(
    monitoreoIntegraciones,
    fechaActual,
  );

  const metricasMailchimpDisponibles = metricasCampañas.length > 0;

  const advertencias = [];
  if (!metricasMailchimpDisponibles) {
    advertencias.push(
      'Las métricas de reporte de Mailchimp (enviadas, tasa de apertura, clics) ' +
        'no están almacenadas en el MER y no fueron provistas por el orquestador: ' +
        'se reportan como 0. El dato de suscriptores sí proviene de campaign_lead.',
    );
  }

  return {
    workflowId,
    fechaActualizacion: fechaActual,
    periodo: {
      inicio: periodoInicio,
      fin: periodoFin,
    },
    kpis,
    leadsPorEtapa,
    seguimientoComercial,
    campañasMailchimp,
    citasSemana,
    resumenFinanciero,
    monitoreoIntegraciones,
    controlActualizacion,
    ...(resumenAutomatizaciones ? { resumenAutomatizaciones } : {}),
    metricasMailchimpDisponibles,
    fuenteDatos,
    datosSinteticos: fuenteDatos === 'sintetico',
    advertencias,
  };
}
