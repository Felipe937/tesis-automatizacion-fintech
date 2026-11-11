/**
 * @fileoverview Tests unitarios para el generador de dashboard ejecutivo.
 * Todos los datos son sintéticos. No se lee de PostgreSQL ni de Graph API.
 *
 * Ejecución: node --test src/__tests__/dashboard.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularLeadsPorEtapa,
  calcularCampañasMailchimp,
  calcularCitasSemana,
  calcularResumenFinanciero,
  generarDashboard,
  ETAPAS_LEAD,
} from '../dashboard.js';

// ---------------------------------------------------------------------------
// Bloque a: Leads por etapa
// ---------------------------------------------------------------------------

describe('calcularLeadsPorEtapa', () => {
  it('incluye todas las etapas del MER con cero cuando no hay leads', () => {
    const resultado = calcularLeadsPorEtapa([]);
    ETAPAS_LEAD.forEach((etapa) => {
      assert.ok(etapa in resultado, `Falta la etapa ${etapa}`);
      assert.equal(resultado[etapa], 0);
    });
    assert.equal(resultado.total, 0);
  });

  it('cuenta correctamente leads por etapa', () => {
    const leads = [
      { estado: 'nuevo' },
      { estado: 'nuevo' },
      { estado: 'prospecto' },
      { estado: 'cliente' },
      { estado: 'cliente' },
      { estado: 'cliente' },
    ];
    const resultado = calcularLeadsPorEtapa(leads);
    assert.equal(resultado.nuevo, 2);
    assert.equal(resultado.prospecto, 1);
    assert.equal(resultado.cliente, 3);
    assert.equal(resultado.total, 6);
    assert.equal(resultado.cita_pendiente, 0);
    assert.equal(resultado.inactivo, 0);
  });

  it('ignora estados no definidos en el MER', () => {
    const leads = [
      { estado: 'nuevo' },
      { estado: 'estado_inexistente' },
    ];
    const resultado = calcularLeadsPorEtapa(leads);
    assert.equal(resultado.nuevo, 1);
    assert.equal(resultado.total, 2); // total cuenta todos los leads
  });
});

// ---------------------------------------------------------------------------
// Bloque b: Campañas Mailchimp
// ---------------------------------------------------------------------------

describe('calcularCampañasMailchimp', () => {
  it('retorna array vacío si no hay campañas', () => {
    const resultado = calcularCampañasMailchimp([], []);
    assert.deepEqual(resultado, []);
  });

  it('asigna métricas cero cuando una campaña no tiene métricas', () => {
    const campañas = [{ id_campaign: 1, nombre: 'Test', estado: 'activa' }];
    const resultado = calcularCampañasMailchimp(campañas, []);
    assert.equal(resultado[0].enviadas, 0);
    assert.equal(resultado[0].tasaApertura, 0);
    assert.equal(resultado[0].clicsGenerados, 0);
  });

  it('combina campañas con sus métricas correctamente', () => {
    const campañas = [
      { id_campaign: 1, nombre: 'Bienvenida', estado: 'completada' },
      { id_campaign: 2, nombre: 'Onboarding', estado: 'activa' },
    ];
    const metricas = [
      { id_campaign: 1, enviadas: 100, tasaApertura: 40.5, clicsGenerados: 15 },
      { id_campaign: 2, enviadas: 50, tasaApertura: 30.0, clicsGenerados: 5 },
    ];
    const resultado = calcularCampañasMailchimp(campañas, metricas);
    assert.equal(resultado[0].enviadas, 100);
    assert.equal(resultado[0].tasaApertura, 40.5);
    assert.equal(resultado[1].enviadas, 50);
    assert.equal(resultado[1].clicsGenerados, 5);
  });
});

// ---------------------------------------------------------------------------
// Bloque c: Citas semanal
// ---------------------------------------------------------------------------

describe('calcularCitasSemana', () => {
  const citas = [
    {
      id_appointment: 1,
      id_lead: 1,
      nombreLead: 'Juan',
      fecha_hora_inicio: '2026-11-09T10:00:00Z',
      estado: 'confirmada',
    },
    {
      id_appointment: 2,
      id_lead: 2,
      nombreLead: 'María',
      fecha_hora_inicio: '2026-11-10T14:00:00Z',
      estado: 'confirmada',
    },
    {
      id_appointment: 3,
      id_lead: 3,
      nombreLead: 'Pedro',
      fecha_hora_inicio: '2026-11-12T09:00:00Z',
      estado: 'pendiente',
    },
    {
      id_appointment: 4,
      id_lead: 4,
      nombreLead: 'Ana',
      fecha_hora_inicio: '2026-11-16T10:00:00Z',
      estado: 'confirmada',
    },
  ];

  it('filtra solo citas confirmadas en la semana', () => {
    const resultado = calcularCitasSemana(
      citas,
      '2026-11-09T00:00:00Z',
      '2026-11-15T23:59:59Z',
    );
    assert.equal(resultado.length, 2);
    // Las citas pendientes se filtran antes del mapeo, no aparecen en la salida
    const ids = resultado.map((c) => c.id_appointment);
    assert.ok(ids.includes(1));
    assert.ok(ids.includes(2));
    assert.ok(!ids.includes(3)); // pendiente, excluida
    assert.ok(!ids.includes(4)); // fuera de rango, excluida
  });

  it('excluye citas fuera del rango de fechas', () => {
    const resultado = calcularCitasSemana(
      citas,
      '2026-11-09T00:00:00Z',
      '2026-11-15T23:59:59Z',
    );
    const ids = resultado.map((c) => c.id_appointment);
    assert.ok(!ids.includes(3), 'La cita pendiente no debe incluirse');
    assert.ok(!ids.includes(4), 'La cita de la semana siguiente no debe incluirse');
  });

  it('retorna array vacío si no hay citas en el periodo', () => {
    const resultado = calcularCitasSemana(
      citas,
      '2026-11-01T00:00:00Z',
      '2026-11-05T23:59:59Z',
    );
    assert.deepEqual(resultado, []);
  });
});

// ---------------------------------------------------------------------------
// Bloque d: Resumen financiero
// ---------------------------------------------------------------------------

describe('calcularResumenFinanciero', () => {
  const inversiones = [
    { monto: 5000000, estado: 'activa', fecha_registro: '2026-10-15T08:00:00Z' },
    { monto: 3000000, estado: 'activa', fecha_registro: '2026-10-20T08:00:00Z' },
    { monto: 2000000, estado: 'vencida', fecha_registro: '2026-09-10T08:00:00Z' },
    { monto: 4000000, estado: 'activa', fecha_registro: '2026-11-01T08:00:00Z' },
    { monto: 1500000, estado: 'cancelada', fecha_registro: '2026-10-05T08:00:00Z' },
  ];

  it('calcula saldo total de inversiones activas', () => {
    const resultado = calcularResumenFinanciero(inversiones, '2026-11-10T12:00:00Z');
    // 5,000,000 + 3,000,000 + 4,000,000 = 12,000,000
    assert.equal(resultado.saldoTotalInversionesActivas, 12000000);
  });

  it('calcula operaciones del mes actual (noviembre 2026)', () => {
    const resultado = calcularResumenFinanciero(inversiones, '2026-11-10T12:00:00Z');
    // Solo la inversión del 2026-11-01 es de noviembre
    assert.equal(resultado.numeroOperacionesMesActual, 1);
  });

  it('calcula variación porcentual respecto al mes anterior', () => {
    // Octubre: 3 operaciones (05, 15 y 20 oct). Noviembre: 1 operación (01 nov).
    // Variación: (1 - 3) / 3 * 100 = -66.67%
    const resultado = calcularResumenFinanciero(inversiones, '2026-11-10T12:00:00Z');
    assert.equal(resultado.variacionPorcentualMesAnterior, -66.67);
  });

  it('maneja variación cuando no hay operaciones mes anterior', () => {
    const inversionesNov = [
      { monto: 1000000, estado: 'activa', fecha_registro: '2026-11-01T08:00:00Z' },
    ];
    const resultado = calcularResumenFinanciero(
      inversionesNov,
      '2026-11-10T12:00:00Z',
    );
    // De 0 a 1 operación = +100%
    assert.equal(resultado.variacionPorcentualMesAnterior, 100);
    assert.equal(resultado.numeroOperacionesMesActual, 1);
  });
});

// ---------------------------------------------------------------------------
// Dashboard completo
// ---------------------------------------------------------------------------

describe('generarDashboard', () => {
  const datos = {
    workflowId: 'dashboard-ejecutivo',
    periodoInicio: '2026-11-02T00:00:00Z',
    periodoFin: '2026-11-08T23:59:59Z',
    leads: [
      { estado: 'nuevo' },
      { estado: 'cliente' },
      { estado: 'cita_pendiente' },
    ],
    campañas: [
      { id_campaign: 1, nombre: 'Test', estado: 'activa' },
    ],
    metricasCampañas: [
      { id_campaign: 1, enviadas: 50, tasaApertura: 25.0, clicsGenerados: 5 },
    ],
    citas: [
      {
        id_appointment: 1,
        id_lead: 1,
        nombreLead: 'Usuario',
        fecha_hora_inicio: '2026-11-05T10:00:00Z',
        estado: 'confirmada',
      },
    ],
    inversiones: [
      { monto: 1000000, estado: 'activa', fecha_registro: '2026-11-01T08:00:00Z' },
    ],
  };

  it('genera un informe con los cuatro bloques', () => {
    const resultado = generarDashboard({
      ...datos,
      fechaActual: '2026-11-10T12:00:00Z',
      datosSinteticos: true,
    });

    assert.equal(resultado.workflowId, 'dashboard-ejecutivo');
    assert.ok(resultado.fechaActualizacion);
    assert.equal(resultado.periodo.inicio, datos.periodoInicio);
    assert.equal(resultado.periodo.fin, datos.periodoFin);

    // Bloque a
    assert.ok('leadsPorEtapa' in resultado);
    assert.equal(resultado.leadsPorEtapa.total, 3);

    // Bloque b
    assert.ok(Array.isArray(resultado.campañasMailchimp));
    assert.equal(resultado.campañasMailchimp.length, 1);

    // Bloque c
    assert.ok(Array.isArray(resultado.citasSemana));
    assert.equal(resultado.citasSemana.length, 1);

    // Bloque d
    assert.ok('resumenFinanciero' in resultado);
    assert.equal(resultado.resumenFinanciero.saldoTotalInversionesActivas, 1000000);

    // Marcado como sintético
    assert.equal(resultado.datosSinteticos, true);
  });

  it('incluye fecha y hora de última actualización', () => {
    const fechaActual = '2026-11-10T12:00:00Z';
    const resultado = generarDashboard({
      ...datos,
      fechaActual,
      datosSinteticos: true,
    });
    assert.equal(resultado.fechaActualizacion, fechaActual);
  });
});