/**
 * @fileoverview Tests del núcleo del componente de dashboard: validación de
 * entradas, datos reales desde PostgreSQL, fallos de conexión y de escritura.
 *
 * Ejecución: node --test src/__tests__/service.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generarDashboardDesdeEntrada,
  generarDashboardYActualizarExcel,
  validarEntrada,
  DashboardValidationError,
  DashboardExcelError,
} from '../service.js';
import { PostgresSourceError } from '../postgresSource.js';

const ENTRADA_BASE = {
  workflowId: 'dashboard-ejecutivo',
  periodoInicio: '2026-11-02T00:00:00.000Z',
  periodoFin: '2026-11-08T23:59:59.000Z',
};

/**
 * Crea un pool de PostgreSQL de prueba que devuelve filas según la tabla
 * consultada en el SQL.
 * @param {object} [filasPorTabla] - Mapa tabla → filas
 * @param {Error} [error] - Error a lanzar
 * @returns {object} Pool de prueba con la propiedad `consultas`
 */
function crearPoolFalso(filasPorTabla = {}, error = null) {
  const consultas = [];

  const pool = {
    consultas,
    async query(sql) {
      consultas.push(sql);
      if (error) throw error;
      // Se identifica la tabla principal de la consulta (la primera del FROM).
      const coincidencia = sql.match(/FROM\s+"[^"]+"\.(\w+)/i);
      const tabla = coincidencia ? coincidencia[1] : null;
      return { rows: tabla && filasPorTabla[tabla] ? filasPorTabla[tabla] : [] };
    },
    async end() {},
  };
  return pool;
}

// ---------------------------------------------------------------------------
// Validación de entradas
// ---------------------------------------------------------------------------

describe('validación de entradas (dashboard)', () => {
  it('rechaza una entrada sin workflowId', () => {
    assert.throws(
      () => validarEntrada({ ...ENTRADA_BASE, workflowId: '' }),
      DashboardValidationError,
    );
  });

  it('rechaza un periodo invertido', () => {
    assert.throws(
      () =>
        validarEntrada({
          ...ENTRADA_BASE,
          periodoInicio: '2026-11-08T00:00:00.000Z',
          periodoFin: '2026-11-02T00:00:00.000Z',
        }),
      DashboardValidationError,
    );
  });

  it('traduce el campo heredado datosSinteticos a fuenteDatos', () => {
    assert.equal(validarEntrada({ ...ENTRADA_BASE, datosSinteticos: true }).fuenteDatos, 'sintetico');
    assert.equal(validarEntrada({ ...ENTRADA_BASE, datosSinteticos: false }).fuenteDatos, 'postgres');
  });

  it('falla en tiempo de ejecución si no hay forma de leer PostgreSQL', async () => {
    const env = { ...process.env };
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_DB;
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;

    try {
      await assert.rejects(
        () =>
          generarDashboardDesdeEntrada({
            ...ENTRADA_BASE,
            fuenteDatos: 'postgres',
          }),
        PostgresSourceError,
      );
    } finally {
      process.env = env;
    }
  });
});

// ---------------------------------------------------------------------------
// Datos reales desde PostgreSQL
// ---------------------------------------------------------------------------

describe('datos reales del dashboard (PostgreSQL)', () => {
  const filasPorTabla = {
    lead: [
      { id_lead: 1, nombre: 'Lead A', estado: 'nuevo', fecha_registro: '2026-11-03T10:00:00.000Z' },
      { id_lead: 2, nombre: 'Lead B', estado: 'cliente', fecha_registro: '2026-11-04T10:00:00.000Z' },
    ],
    appointment: [
      {
        id_appointment: 10,
        id_lead: 1,
        nombre_lead: 'Lead A',
        fecha_hora_inicio: '2026-11-05T10:00:00.000Z',
        fecha_hora_fin: '2026-11-05T11:00:00.000Z',
        enlace_calendly: 'https://calendly.com/demo/10',
        estado: 'confirmada',
      },
    ],
    campaign: [
      {
        id_campaign: 1,
        nombre: 'Campaña Demo',
        estado: 'activa',
        id_mailchimp: 'mc-1',
        suscriptores: 7,
      },
    ],
    investment: [
      {
        id_investment: 1,
        id_lead: 2,
        monto: 2500000,
        estado: 'activa',
        fecha_registro: '2026-11-01T08:00:00.000Z',
      },
    ],
    automation_log: [
      {
        total: 12,
        exitos: 10,
        errores: 1,
        advertencias: 1,
        registros_procesados: 40,
        latencia_media_ms: '128.5000',
      },
    ],
  };

  it('calcula los cuatro bloques con datos del MER', async () => {
    const pool = crearPoolFalso(filasPorTabla);

    const dashboard = await generarDashboardDesdeEntrada(
      { ...ENTRADA_BASE, fuenteDatos: 'postgres', postgres: {} },
      { poolFactory: () => pool },
    );

    // Bloque a
    assert.equal(dashboard.leadsPorEtapa.total, 2);
    assert.equal(dashboard.leadsPorEtapa.nuevo, 1);
    assert.equal(dashboard.leadsPorEtapa.cliente, 1);

    // Bloque b
    assert.equal(dashboard.campañasMailchimp.length, 1);
    assert.equal(dashboard.campañasMailchimp[0].suscriptores, 7);
    assert.equal(dashboard.metricasMailchimpDisponibles, false);

    // Bloque c
    assert.equal(dashboard.citasSemana.length, 1);
    assert.equal(dashboard.citasSemana[0].nombreLead, 'Lead A');

    // Bloque d
    assert.equal(dashboard.resumenFinanciero.saldoTotalInversionesActivas, 2500000);

    // Trazabilidad
    assert.equal(dashboard.resumenAutomatizaciones.totalEjecuciones, 12);
    assert.equal(dashboard.resumenAutomatizaciones.ejecucionesConError, 1);
    assert.equal(dashboard.resumenAutomatizaciones.latenciaMediaMs, 128.5);

    // Marcado como real
    assert.equal(dashboard.fuenteDatos, 'postgres');
    assert.equal(dashboard.datosSinteticos, false);
  });

  it('consulta las seis entidades del MER', async () => {
    const pool = crearPoolFalso(filasPorTabla);

    await generarDashboardDesdeEntrada(
      { ...ENTRADA_BASE, fuenteDatos: 'postgres', postgres: {} },
      { poolFactory: () => pool },
    );

    const consultadas = pool.consultas.join('\n');
    assert.match(consultadas, /\.lead/);
    assert.match(consultadas, /\.appointment/);
    assert.match(consultadas, /\.campaign\b/);
    assert.match(consultadas, /\.campaign_lead/);
    assert.match(consultadas, /\.investment/);
    assert.match(consultadas, /\.automation_log/);
  });

  it('marca el informe como sintético cuando se piden datos de demostración', async () => {
    const dashboard = await generarDashboardDesdeEntrada({
      ...ENTRADA_BASE,
      fuenteDatos: 'sintetico',
    });

    assert.equal(dashboard.datosSinteticos, true);
    assert.equal(dashboard.leadsPorEtapa.total, 10);
    // El conjunto sintético incluye métricas de Mailchimp: no hay advertencia.
    assert.equal(dashboard.metricasMailchimpDisponibles, true);
    assert.equal(dashboard.advertencias.length, 0);
  });

  it('advierte cuando las métricas de reporte de Mailchimp no están disponibles', async () => {
    const dashboard = await generarDashboardDesdeEntrada(
      { ...ENTRADA_BASE, fuenteDatos: 'postgres', postgres: {} },
      { poolFactory: () => crearPoolFalso(filasPorTabla) },
    );

    assert.equal(dashboard.metricasMailchimpDisponibles, false);
    assert.equal(dashboard.advertencias.length, 1);
    assert.match(dashboard.advertencias[0], /Mailchimp/i);
  });
});

// ---------------------------------------------------------------------------
// Fallos de conexión y de escritura
// ---------------------------------------------------------------------------

describe('fallos de PostgreSQL y de OneDrive (dashboard)', () => {
  it('propaga un fallo de conexión a PostgreSQL', async () => {
    await assert.rejects(
      () =>
        generarDashboardDesdeEntrada(
          { ...ENTRADA_BASE, fuenteDatos: 'postgres', postgres: {} },
          {
            poolFactory: () => crearPoolFalso({}, new Error('ECONNREFUSED')),
          },
        ),
      PostgresSourceError,
    );
  });

  it('propaga un fallo de escritura en OneDrive como DashboardExcelError', async () => {
    const graphClient = {
      async updateRange() {
        throw new Error('Graph API 503');
      },
    };

    await assert.rejects(
      () =>
        generarDashboardYActualizarExcel(
          {
            ...ENTRADA_BASE,
            fuenteDatos: 'sintetico',
            excelDriveItemId: 'drive-item-demo',
          },
          { graphClient },
        ),
      DashboardExcelError,
    );
  });

  it('no escribe en Excel si no se indicó driveItemId', async () => {
    const { excel } = await generarDashboardYActualizarExcel(
      { ...ENTRADA_BASE, fuenteDatos: 'sintetico' },
      {},
    );

    assert.equal(excel, null);
  });

  it('exige un cliente Graph válido cuando se pide actualizar Excel', async () => {
    await assert.rejects(
      () =>
        generarDashboardYActualizarExcel(
          {
            ...ENTRADA_BASE,
            fuenteDatos: 'sintetico',
            excelDriveItemId: 'drive-item-demo',
          },
          {},
        ),
      DashboardExcelError,
    );
  });
});
