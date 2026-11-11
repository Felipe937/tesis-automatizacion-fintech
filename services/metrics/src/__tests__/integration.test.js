/**
 * @fileoverview Prueba de integración con PostgreSQL real y el esquema del MER.
 *
 * Cubre el camino completo de los dos componentes que consumen la base de
 * datos de negocio:
 *
 *   - `metrics`: lee `automation_log` y calcula los indicadores VD1/VD2.
 *   - `dashboard`: lee `lead`, `campaign`, `campaign_lead`, `appointment`,
 *     `investment` y `automation_log`, y calcula los cuatro bloques de §4.4.
 *
 * Los datos sembrados son **sintéticos**: no se usa información de personas
 * reales ni del piloto.
 *
 * La prueba se **omite** si no se define `INTEGRATION_PG_URL` (por ejemplo, en
 * una ejecución local sin base de datos). En CI se ejecuta contra un
 * PostgreSQL efímero.
 *
 * Ejecución:
 *   INTEGRATION_PG_URL=postgresql://user:pass@127.0.0.1:5432/n8n_fintech_test \
 *     node --test src/__tests__/integration.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import pg from 'pg';

import { generarInformeMetricas } from '../service.js';

// El servicio de dashboard vive en otro paquete del repositorio. Se carga de
// forma diferida y tolerante: si sus dependencias no están instaladas (por
// ejemplo, al ejecutar `npm test` dentro de un solo paquete), las pruebas del
// dashboard se omiten con una explicación en lugar de romper el fichero
// completo. En CI se instalan ambos paquetes para que la cobertura sea completa.
let dashboardService = null;
let dashboardNoDisponible = null;

try {
  dashboardService = await import('../../../dashboard/src/service.js');
} catch (error) {
  dashboardNoDisponible = error;
}

const MOTIVO_SKIP_DASHBOARD = dashboardService
  ? false
  : `dependencias del paquete dashboard no disponibles: ${dashboardNoDisponible?.message}`;

const URL_PG = process.env.INTEGRATION_PG_URL ?? '';
const INIT_SQL = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'infrastructure',
  'config',
  'postgres',
  'init.sql',
);

const PERIODO_INICIO = '2026-11-02T00:00:00.000Z';
const PERIODO_FIN = '2026-11-08T23:59:59.000Z';

let pool;

/**
 * Siembra el MER con datos sintéticos y deterministas.
 * @returns {Promise<void>}
 */
async function sembrar() {
  await pool.query('TRUNCATE lead, campaign, appointment, investment, automation_log, campaign_lead RESTART IDENTITY CASCADE');

  await pool.query(
    `INSERT INTO lead (id_lead, nombre, correo_electronico, telefono, estado, fecha_registro, fecha_ultima_actualizacion)
     VALUES (1, 'Lead Demo 1', 'demo1@ejemplo.co', '+57 300 000 0001', 'nuevo',        $1, $1),
            (2, 'Lead Demo 2', 'demo2@ejemplo.co', '+57 300 000 0002', 'cita_confirmada', $2, $2),
            (3, 'Lead Demo 3', 'demo3@ejemplo.co', '+57 300 000 0003', 'cliente',      $3, $3)`,
    [PERIODO_INICIO, PERIODO_INICIO, PERIODO_INICIO],
  );

  await pool.query(
    `INSERT INTO appointment (id_appointment, id_lead, fecha_hora_inicio, fecha_hora_fin, enlace_calendly, estado)
     VALUES (10, 2, $1, $2, 'https://calendly.com/demo/10', 'confirmada'),
            (11, 1, $3, $4, 'https://calendly.com/demo/11', 'pendiente')`,
    [PERIODO_INICIO, PERIODO_INICIO, '2026-11-20T10:00:00.000Z', '2026-11-20T11:00:00.000Z'],
  );

  await pool.query(
    `INSERT INTO campaign (id_campaign, nombre, estado, id_mailchimp)
     VALUES (1, 'Campaña Demo', 'activa', 'mc-demo-1')`,
  );

  await pool.query(
    `INSERT INTO campaign_lead (id_campaign, id_lead) VALUES (1, 1), (1, 2)`,
  );

  await pool.query(
    `INSERT INTO investment (id_investment, id_lead, monto, tipo_instrumento, fecha_registro, estado)
     VALUES (1, 3, 2500000, 'FONDO', $1, 'activa'),
            (2, 3, 1500000, 'FONDO', $2, 'vencida')`,
    [PERIODO_INICIO, '2026-10-01T10:00:00.000Z'],
  );

  // 30 ejecuciones: 27 successes, 2 errors, 1 warning.
  const filas = [];
  for (let i = 0; i < 30; i += 1) {
    const estado = i < 27 ? 'exito' : i < 29 ? 'error' : 'advertencia';
    filas.push(
      `('captura-leads', $1::timestamptz, $2::timestamptz, '${estado}', ${i % 5}, ${100 + i * 10}, NULL)`,
    );
  }
  await pool.query(
    `INSERT INTO automation_log
       (workflow_id, timestamp_inicio, timestamp_fin, estado, registros_procesados, latencia_ms, mensaje_error)
     VALUES ${filas.join(', ')}`,
    [PERIODO_INICIO, PERIODO_INICIO],
  );
}

describe(
  'Integración con PostgreSQL (esquema real del MER)',
  { skip: URL_PG ? false : 'requiere INTEGRATION_PG_URL' },
  () => {
    before(async () => {
      pool = new pg.Pool({ connectionString: URL_PG, max: 2 });
      await pool.query(readFileSync(INIT_SQL, 'utf8'));
      await sembrar();
    });

    after(async () => {
      if (pool) await pool.end();
    });

    it('el componente de métricas calcula sobre las filas reales de automation_log', async () => {
      const informe = await generarInformeMetricas(
        {
          workflowId: 'captura-leads',
          periodoInicio: PERIODO_INICIO,
          periodoFin: PERIODO_FIN,
          lineaBaseTiempoManualSegundos: 1,
          lineaBaseTasaErrorManual: 10,
          fuenteDatos: 'postgres',
        },
        { poolFactory: () => pool },
      );

      assert.equal(informe.fuenteDatos, 'postgres');
      assert.equal(informe.datosSinteticos, false);
      assert.equal(informe.observacionesUsadas, 30);
      assert.equal(informe.metricas.totalExitos, 27);
      assert.equal(informe.metricas.totalErrores, 2);
      assert.equal(informe.metricas.totalAdvertencias, 1);
      assert.equal(informe.metricas.tasaErrorPorcentaje, 6.67);
      assert.equal(informe.metricas.mediaLatenciaMs, 245);
      assert.equal(informe.conclusionDefinitiva, true);
      assert.equal(informe.advertenciaDatosInsuficientes, undefined);
    });

    it('el componente de métricas excluye las ejecuciones de otro workflow', async () => {
      await pool.query(
        `INSERT INTO automation_log (workflow_id, timestamp_inicio, estado, latencia_ms)
         VALUES ('otro-workflow', $1::timestamptz, 'error', 10)`,
        [PERIODO_INICIO],
      );

      const informe = await generarInformeMetricas(
        {
          workflowId: 'captura-leads',
          periodoInicio: PERIODO_INICIO,
          periodoFin: PERIODO_FIN,
          lineaBaseTiempoManualSegundos: 1,
          lineaBaseTasaErrorManual: 10,
          fuenteDatos: 'postgres',
        },
        { poolFactory: () => pool },
      );

      assert.equal(informe.observacionesUsadas, 30);
      assert.equal(informe.metricas.totalErrores, 2);

      await pool.query(
        `DELETE FROM automation_log WHERE workflow_id = 'otro-workflow'`,
      );
    });

    it(
      'el componente de dashboard calcula los cuatro bloques desde el MER',
      { skip: MOTIVO_SKIP_DASHBOARD },
      async () => {
        if (!dashboardService) return;
        const { generarDashboardDesdeEntrada } = dashboardService;

        const dashboard = await generarDashboardDesdeEntrada(
          {
            workflowId: 'dashboard-ejecutivo',
            periodoInicio: PERIODO_INICIO,
            periodoFin: PERIODO_FIN,
            fuenteDatos: 'postgres',
          },
          { poolFactory: () => pool, fechaActual: '2026-11-10T12:00:00.000Z' },
        );

        // Bloque a: leads captados en el periodo
        assert.equal(dashboard.leadsPorEtapa.total, 3);
        assert.equal(dashboard.leadsPorEtapa.nuevo, 1);
        assert.equal(dashboard.leadsPorEtapa.cita_confirmada, 1);
        assert.equal(dashboard.leadsPorEtapa.cliente, 1);

        // Bloque b: campañas y suscriptores desde campaign_lead
        assert.equal(dashboard.campañasMailchimp.length, 1);
        assert.equal(dashboard.campañasMailchimp[0].suscriptores, 2);

        // Bloque c: citas confirmadas dentro del periodo
        assert.equal(dashboard.citasSemana.length, 1);
        assert.equal(dashboard.citasSemana[0].nombreLead, 'Lead Demo 2');

        // Bloque d: saldo de inversiones activas
        assert.equal(dashboard.resumenFinanciero.saldoTotalInversionesActivas, 2500000);

        // Trazabilidad
        assert.equal(dashboard.resumenAutomatizaciones.totalEjecuciones, 30);
        assert.equal(dashboard.resumenAutomatizaciones.ejecucionesConError, 2);

        // KPIs del mockup §4.4
        assert.equal(dashboard.kpis.leadsRegistradas, 3);
        assert.equal(dashboard.kpis.citasAgendadas, 1);
        assert.equal(dashboard.kpis.inversionesRegistradas, 1);
        assert.equal(dashboard.kpis.conversionPorcentaje, 33.33);

        // Seguimiento comercial: etapas comerciales y participación
        const comercial = dashboard.seguimientoComercial;
        assert.equal(
          comercial.find((f) => f.estado === 'cliente').etapaComercial,
          'Convertido',
        );
        assert.equal(comercial.find((f) => f.estado === 'cliente').cantidad, 1);
        assert.equal(
          comercial.find((f) => f.estado === 'cliente').participacionPorcentaje,
          33.33,
        );
        assert.equal(
          comercial.find((f) => f.estado === 'inactivo').participacionPorcentaje,
          0,
        );

        // Monitoreo de integraciones y control de actualización
        const hubspot = dashboard.monitoreoIntegraciones.find(
          (f) => f.plataforma === 'HubSpot CRM',
        );
        assert.equal(hubspot.estado, 'Correcto');
        assert.ok(hubspot.ultimaSincronizacion);
        assert.equal(
          dashboard.controlActualizacion.estadoGeneral,
          'Sincronización correcta',
        );

        assert.equal(dashboard.fuenteDatos, 'postgres');
        assert.equal(dashboard.datosSinteticos, false);
      },
    );

    it(
      'el dashboard distingue los datos reales de los sintéticos',
      { skip: MOTIVO_SKIP_DASHBOARD },
      async () => {
        if (!dashboardService) return;
        const { generarDashboardDesdeEntrada } = dashboardService;

        const dashboard = await generarDashboardDesdeEntrada(
          {
            workflowId: 'dashboard-ejecutivo',
            periodoInicio: PERIODO_INICIO,
            periodoFin: PERIODO_FIN,
            fuenteDatos: 'sintetico',
          },
          { fechaActual: '2026-11-10T12:00:00.000Z' },
        );

        assert.equal(dashboard.fuenteDatos, 'sintetico');
        assert.equal(dashboard.datosSinteticos, true);
        assert.equal(dashboard.leadsPorEtapa.total, 10);
      },
    );
  },
);
