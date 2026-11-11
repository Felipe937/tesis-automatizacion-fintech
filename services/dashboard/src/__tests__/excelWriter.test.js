/**
 * @fileoverview Tests del generador del libro Excel del dashboard ejecutivo:
 * construcción de la matriz, formatos numéricos, jerarquía visual y manejo
 * de errores de escritura en OneDrive.
 *
 * El diseño está contrastado con el mockup «Dashboard Ejecutivo — Asesor
 * Fintech» de §4.4 de la tesis IS25237.
 *
 * Ejecución: node --test src/__tests__/excelWriter.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  construirMatrizDashboard,
  escribirDashboardEnExcel,
  isoANumeroSerialExcel,
  columnaALetra,
  TOKENS,
  PESTANAS,
} from '../excelWriter.js';

/**
 * Dashboard de prueba con datos sintéticos completos.
 * @returns {object} Dashboard de prueba
 */
function dashboardDePrueba() {
  return {
    workflowId: 'dashboard-ejecutivo',
    fechaActualizacion: '2026-11-10T12:00:00.000Z',
    periodo: {
      inicio: '2026-11-02T00:00:00.000Z',
      fin: '2026-11-08T23:59:59.000Z',
    },
    kpis: {
      leadsRegistradas: 16,
      citasAgendadas: 1,
      inversionesRegistradas: 1,
      conversionPorcentaje: 6.25,
    },
    leadsPorEtapa: {
      nuevo: 2,
      prospecto: 3,
      cita_pendiente: 1,
      cita_confirmada: 4,
      cliente: 5,
      inactivo: 1,
      total: 16,
    },
    seguimientoComercial: [
      { estado: 'nuevo', etapaComercial: 'Nuevo', cantidad: 2, participacionPorcentaje: 12.5 },
      { estado: 'prospecto', etapaComercial: 'En seguimiento', cantidad: 3, participacionPorcentaje: 18.75 },
      { estado: 'cita_pendiente', etapaComercial: 'Cita agendada', cantidad: 1, participacionPorcentaje: 6.25 },
      { estado: 'cita_confirmada', etapaComercial: 'Cita agendada', cantidad: 4, participacionPorcentaje: 25 },
      { estado: 'cliente', etapaComercial: 'Convertido', cantidad: 5, participacionPorcentaje: 31.25 },
      { estado: 'inactivo', etapaComercial: '— (fuera del embudo)', cantidad: 1, participacionPorcentaje: 0 },
    ],
    campañasMailchimp: [
      {
        id_campaign: 1,
        nombre: 'Bienvenida',
        estado: 'completada',
        enviadas: 150,
        tasaApertura: 34.5,
        clicsGenerados: 28,
        suscriptores: 12,
      },
    ],
    citasSemana: [
      {
        id_appointment: 10,
        id_lead: 1,
        nombreLead: 'Lead Demo',
        fecha_hora_inicio: '2026-11-05T15:00:00.000Z',
        fecha_hora_fin: '2026-11-05T16:00:00.000Z',
        enlace_calendly: 'https://calendly.com/demo/10',
      },
    ],
    resumenFinanciero: {
      saldoTotalInversionesActivas: 12000000,
      numeroOperacionesMesActual: 4,
      variacionPorcentualMesAnterior: -25.5,
      totalOperaciones: 5,
      montoAcumulado: 12000000,
      operacionesPendientes: 3,
      operacionesCompletadas: 1,
      operacionesCanceladas: 1,
    },
    monitoreoIntegraciones: [
      {
        plataforma: 'HubSpot CRM',
        ultimaSincronizacion: '2026-11-08T09:00:00.000Z',
        estado: 'Correcto',
      },
      { plataforma: 'Mailchimp', ultimaSincronizacion: null, estado: 'Sin ejecuciones' },
    ],
    controlActualizacion: {
      ultimaActualizacion: '2026-11-10T12:00:00.000Z',
      estadoGeneral: 'Sincronización correcta',
    },
    resumenAutomatizaciones: {
      totalEjecuciones: 30,
      ejecucionesExitosas: 28,
      ejecucionesConError: 1,
      ejecucionesConAdvertencia: 1,
      registrosProcesados: 120,
      latenciaMediaMs: 145.25,
    },
    metricasMailchimpDisponibles: true,
    fuenteDatos: 'postgres',
    datosSinteticos: false,
    advertencias: [],
  };
}

/**
 * Crea un cliente Graph de prueba que registra las llamadas.
 * @param {Error} [error] - Error a lanzar en cada llamada
 * @returns {object} Cliente Graph de prueba
 */
function crearGraphClientFalso(error = null) {
  const llamadas = [];
  return {
    llamadas,
    async updateRange(driveItemId, worksheetName, address, values, format) {
      llamadas.push({ driveItemId, worksheetName, address, values, format });
      if (error) throw error;
    },
  };
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

describe('utilidades del escritor Excel', () => {
  it('convierte índices de columna a letras de Excel', () => {
    assert.equal(columnaALetra(1), 'A');
    assert.equal(columnaALetra(6), 'F');
    assert.equal(columnaALetra(8), 'H');
    assert.equal(columnaALetra(26), 'Z');
    assert.equal(columnaALetra(27), 'AA');
  });

  it('convierte una fecha ISO a número serial de Excel', () => {
    const serial = isoANumeroSerialExcel('2026-11-05T15:00:00.000Z');
    // 2026-11-05 10:00 hora Bogotá (UTC-5)
    assert.ok(serial > 46_000 && serial < 47_000);
    assert.ok(Number.isInteger(serial * 86400));
  });

  it('devuelve null si la fecha no es válida', () => {
    assert.equal(isoANumeroSerialExcel(null), null);
    assert.equal(isoANumeroSerialExcel('no-es-fecha'), null);
  });
});

// ---------------------------------------------------------------------------
// Construcción de la matriz
// ---------------------------------------------------------------------------

describe('construcción de la matriz del dashboard', () => {
  it('incluye cabecera, pestañas y periodo de consulta', () => {
    const { filas } = construirMatrizDashboard(dashboardDePrueba());

    assert.match(filas[0][0], /EXCEL \/ ONEDRIVE/);
    assert.match(filas[1][0], /DASHBOARD EJECUTIVO — ASESOR FINTECH/);
    assert.ok(filas[2].join(' ').includes('Inicio'));
    assert.ok(filas[2].join(' ').includes('Reportes'));
    assert.ok(filas.some((fila) => fila[0] === 'PERIODO DE CONSULTA'));
  });

  it('muestra el periodo como fecha legible en hora de Bogotá, no como ISO', () => {
    const { filas } = construirMatrizDashboard(dashboardDePrueba());
    const periodo = filas.find((fila) => fila[0] === 'Periodo');

    assert.ok(periodo, 'debe existir la fila de periodo');
    assert.match(periodo[1], /^\d{2}\/\d{2}\/\d{4} — \d{2}\/\d{2}\/\d{4}$/);
    assert.ok(!periodo[1].includes('T00:00:00Z'));
  });

  it('publica las pestañas del mockup', () => {
    assert.deepEqual(PESTANAS, ['Inicio', 'Leads', 'Citas', 'Inversiones', 'Reportes']);
  });

  it('incluye la banda de KPIs con los cuatro indicadores', () => {
    const { filas } = construirMatrizDashboard(dashboardDePrueba());
    const kpi = filas.find((fila) => fila[0] === 'Leads registradas');

    assert.ok(kpi, 'debe existir la fila de KPIs');
    assert.equal(kpi[1], 16);
    assert.equal(kpi[2], 'Citas agendadas');
    assert.equal(kpi[3], 1);
    assert.equal(kpi[4], 'Inversiones registradas');
    assert.equal(kpi[5], 1);
    assert.equal(kpi[6], 'Conversión');
    assert.equal(kpi[7], 6.25);
  });

  it('incluye los cuatro bloques de §4.4 con sus encabezados', () => {
    const { filas } = construirMatrizDashboard(dashboardDePrueba());
    const texto = filas.map((fila) => fila.join(' ')).join('\n');

    assert.match(texto, /BLOQUE A — SEGUIMIENTO COMERCIAL \(LEADS POR ETAPA\)/);
    assert.match(texto, /BLOQUE B — CAMPAÑAS MAILCHIMP/);
    assert.match(texto, /BLOQUE C — CITAS DEL PERIODO/);
    assert.match(texto, /BLOQUE D — RESUMEN FINANCIERO/);
    assert.match(texto, /MONITOREO DE INTEGRACIONES/);
    assert.match(texto, /CONTROL DE ACTUALIZACIÓN/);
  });

  it('escribe el seguimiento comercial con etapa y participación', () => {
    const { filas } = construirMatrizDashboard(dashboardDePrueba());
    const fila = filas.find((f) => f[0] === 'cita_confirmada');

    assert.deepEqual(fila, ['cita_confirmada', 'Cita agendada', 4, 25]);
  });

  it('incluye el estado general de control de actualización', () => {
    const { filas } = construirMatrizDashboard(dashboardDePrueba());
    const control = filas.find((fila) => fila[0] === 'Última actualización');

    assert.ok(control);
    assert.equal(control[2], 'Estado general');
    assert.equal(control[3], 'Sincronización correcta');
  });

  it('declara el origen sintético de forma explícita', () => {
    const dashboard = dashboardDePrueba();
    dashboard.datosSinteticos = true;
    dashboard.fuenteDatos = 'sintetico';

    const { filas } = construirMatrizDashboard(dashboard);
    const origen = filas.find((fila) => fila[0] === 'Origen de los datos');

    assert.match(origen[1], /SINTÉTICOS/);
    assert.match(origen[1], /no son resultados empíricos/i);
  });

  it('reporta n/d cuando no hay métricas de Mailchimp', () => {
    const dashboard = dashboardDePrueba();
    dashboard.metricasMailchimpDisponibles = false;

    const { filas } = construirMatrizDashboard(dashboard);
    const filaCampana = filas.find((fila) => fila[0] === 'Bienvenida');

    assert.equal(filaCampana[3], 'n/d');
    assert.equal(filaCampana[4], 'n/d');
    assert.equal(filaCampana[5], 'n/d');
    assert.equal(filaCampana[2], 12);
  });

  it('deja vacío un bloque sin datos (periodo sin citas)', () => {
    const dashboard = dashboardDePrueba();
    dashboard.citasSemana = [];

    const { filas } = construirMatrizDashboard(dashboard);

    assert.equal(filas.findIndex((fila) => fila[0] === 'Lead Demo'), -1);
  });

  it('escribe las notas de advertencia al final', () => {
    const dashboard = dashboardDePrueba();
    dashboard.advertencias = ['Nota de prueba para el piloto.'];

    const { filas } = construirMatrizDashboard(dashboard);

    assert.ok(filas.some((fila) => fila[0] === 'NOTAS'));
    assert.ok(filas.some((fila) => fila[0] === 'Nota de prueba para el piloto.'));
  });
});

// ---------------------------------------------------------------------------
// Escritura en OneDrive
// ---------------------------------------------------------------------------

describe('escritura del dashboard en OneDrive', () => {
  it('escribe los valores y aplica el formato jerárquico', async () => {
    const graphClient = crearGraphClientFalso();

    const resultado = await escribirDashboardEnExcel(graphClient, {
      driveItemId: 'drive-item-demo',
      worksheetName: 'Dashboard Ejecutivo',
      dashboard: dashboardDePrueba(),
    });

    assert.ok(resultado.filasEscritas > 0);

    // 1) Los valores se escriben primero, en el rango A1:H{n}.
    const primera = graphClient.llamadas[0];
    assert.equal(primera.address, `A1:H${resultado.filasEscritas}`);
    assert.ok(Array.isArray(primera.values));

    // 2) El título se formatea con jerarquía propia.
    const titulo = graphClient.llamadas.find((c) => c.address === 'A2:H2');
    assert.ok(titulo.format.font.bold);
    assert.equal(titulo.format.font.size, TOKENS.fuente.tamTitulo);

    // 3) Las secciones llevan superficie y borde inferior.
    const seccion = graphClient.llamadas.find(
      (c) => c.format?.fill && c.format?.borders?.some((b) => b.edge === 'Bottom'),
    );
    assert.ok(seccion, 'debe existir al menos un encabezado de sección con borde inferior');

    // 4) Las cifras se alinean a la derecha con formato numérico.
    const cifras = graphClient.llamadas.filter(
      (c) => c.format?.horizontalAlignment === 'right',
    );
    assert.ok(cifras.length > 0);
    const formatosUsados = new Set(cifras.map((c) => c.format.numberFormat));
    assert.ok(formatosUsados.has(TOKENS.formato.entero));
    assert.ok(formatosUsados.has(TOKENS.formato.montoCop));
    assert.ok(formatosUsados.has(TOKENS.formato.porcentaje));

    // 5) Las fechas usan formato legible dd/mm/aaaa hh:mm.
    const fechas = graphClient.llamadas.find(
      (c) => c.format?.numberFormat === TOKENS.formato.fechaHora,
    );
    assert.ok(fechas);

    // 6) Se fija el ancho de las ocho columnas.
    const anchos = graphClient.llamadas.filter((c) => c.format?.columnWidth);
    assert.equal(anchos.length, TOKENS.columnas);
  });

  it('propaga el error si la escritura en OneDrive falla', async () => {
    const graphClient = crearGraphClientFalso(new Error('Graph API 503'));

    await assert.rejects(
      () =>
        escribirDashboardEnExcel(graphClient, {
          driveItemId: 'drive-item-demo',
          worksheetName: 'Dashboard Ejecutivo',
          dashboard: dashboardDePrueba(),
        }),
      /Graph API 503/,
    );
  });

  it('exige un cliente Graph válido', async () => {
    await assert.rejects(
      () =>
        escribirDashboardEnExcel(null, {
          driveItemId: 'drive-item-demo',
          worksheetName: 'Dashboard Ejecutivo',
          dashboard: dashboardDePrueba(),
        }),
      /cliente Graph/i,
    );
  });
});
