/**
 * @fileoverview Punto de entrada CLI para el generador de dashboard ejecutivo.
 *
 * Recibe parámetros por stdin o por archivo (--payload), valida con Zod,
 * calcula los cuatro bloques del dashboard (§4.4 de la tesis) y emite un
 * informe JSON en stdout. Puede opcionalmente actualizar un libro Excel en
 * OneDrive mediante Microsoft Graph API (reutilizando graphClient de
 * excel-reconciler).
 *
 * Modo CLI:
 *   echo '{"workflowId":"dashboard-ejecutivo","periodoInicio":"...","periodoFin":"...","datosSinteticos":true}' | node src/index.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import {
  DashboardInputSchema,
} from './schemas.js';
import {
  generarDashboard,
  ETAPAS_LEAD,
} from './dashboard.js';

// ---------------------------------------------------------------------------
// Serialización de respuesta (stdout JSON)
// ---------------------------------------------------------------------------

function emitResult(exitoso, data, errorMsg = null, errorType = null) {
  const output = exitoso
    ? { exitoso: true, data }
    : { exitoso: false, error: { tipo: errorType ?? 'Error', mensaje: errorMsg ?? 'Error desconocido' } };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Lectura de payload desde stdin o archivo
// ---------------------------------------------------------------------------

async function readPayload() {
  const args = process.argv.slice(2);
  const payloadFlagIndex = args.indexOf('--payload');

  if (payloadFlagIndex !== -1 && args[payloadFlagIndex + 1]) {
    const filePath = args[payloadFlagIndex + 1];
    const fs = await import('node:fs');
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`No se pudo leer el archivo "${filePath}": ${error.message}`);
    }
  }

  if (process.stdin.isTTY) {
    throw new Error(
      'No se recibió payload. Ejemplo: echo \'{"workflowId":"dashboard-ejecutivo","periodoInicio":"2026-11-02T00:00:00Z","periodoFin":"2026-11-08T23:59:59Z","datosSinteticos":true}\' | node src/index.js',
    );
  }

  const readline = await import('node:readline');
  return new Promise((resolve, reject) => {
    let raw = '';
    const rl = readline.createInterface({ input: process.stdin });

    rl.on('line', (line) => { raw += line; });
    rl.on('close', () => {
      if (!raw.trim()) {
        reject(new Error('El payload recibido está vacío.'));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`El payload no es JSON válido: ${error.message}`));
      }
    });
    rl.on('error', (error) => {
      reject(new Error(`Error leyendo stdin: ${error.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Datos sintéticos para pruebas de desarrollo
// ---------------------------------------------------------------------------

function generarDatosSinteticos() {
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

  const campañas = [
    { id_campaign: 1, nombre: 'Bienvenida Noviembre', estado: 'completada' },
    { id_campaign: 2, nombre: 'Onboarding Clientes', estado: 'activa' },
    { id_campaign: 3, nombre: 'Reactivación Inactivos', estado: 'pendiente' },
  ];

  const metricasCampañas = [
    { id_campaign: 1, enviadas: 150, tasaApertura: 34.5, clicsGenerados: 28 },
    { id_campaign: 2, enviadas: 89, tasaApertura: 42.1, clicsGenerados: 19 },
    { id_campaign: 3, enviadas: 0, tasaApertura: 0, clicsGenerados: 0 },
  ];

  const citas = [
    {
      id_appointment: 101,
      id_lead: 3,
      nombreLead: 'María García',
      fecha_hora_inicio: '2026-11-09T10:00:00Z',
      fecha_hora_fin: '2026-11-09T11:00:00Z',
      enlace_calendly: 'https://calendly.com/asesor/reunion-101',
      estado: 'confirmada',
    },
    {
      id_appointment: 102,
      id_lead: 8,
      nombreLead: 'Carlos López',
      fecha_hora_inicio: '2026-11-10T14:30:00Z',
      fecha_hora_fin: '2026-11-10T15:00:00Z',
      enlace_calendly: 'https://calendly.com/asesor/reunion-102',
      estado: 'confirmada',
    },
    {
      id_appointment: 103,
      id_lead: 1,
      nombreLead: 'Ana Rodríguez',
      fecha_hora_inicio: '2026-11-11T09:00:00Z',
      estado: 'pendiente',
    },
  ];

  const inversiones = [
    { id_investment: 1, monto: 5000000, estado: 'activa', fecha_registro: '2026-10-15T08:00:00Z' },
    { id_investment: 2, monto: 3000000, estado: 'activa', fecha_registro: '2026-10-20T08:00:00Z' },
    { id_investment: 3, monto: 2000000, estado: 'vencida', fecha_registro: '2026-09-10T08:00:00Z' },
    { id_investment: 4, monto: 4000000, estado: 'activa', fecha_registro: '2026-11-01T08:00:00' },
    { id_investment: 5, monto: 1500000, estado: 'cancelada', fecha_registro: '2026-10-05T08:00:00Z' },
  ];

  return { leads, campañas, metricasCampañas, citas, inversiones };
}

// ---------------------------------------------------------------------------
// Actualizar libro Excel en OneDrive vía Microsoft Graph API
// ---------------------------------------------------------------------------

/**
 * Escribe el dashboard en una hoja de Excel en OneDrive usando Graph API.
 * Reutiliza createGraphClient de excel-reconciler (sin duplicar código).
 *
 * @param {object} graphClient - Cliente Graph ya autenticado
 * @param {string} driveItemId - ID del archivo Excel en OneDrive
 * @param {string} worksheetName - Nombre de la hoja
 * @param {object} dashboard - Datos del dashboard
 * @returns {Promise<void>}
 */
async function actualizarExcel(graphClient, driveItemId, worksheetName, dashboard) {
  if (!graphClient || typeof graphClient.readWorksheetData !== 'function') {
    throw new Error('Se requiere un cliente Graph válido para actualizar Excel');
  }

  const fechaActualizacion = new Date(dashboard.fechaActualizacion).toISOString();

  // Construir filas de datos para cada bloque
  const filas = [];

  // Encabezado general
  filas.push(['DASHBOARD EJECUTIVO — FINTECH']);
  filas.push([`Fecha de actualización: ${fechaActualizacion}`]);
  filas.push([`Periodo: ${dashboard.periodo.inicio} al ${dashboard.periodo.fin}`]);
  filas.push([]);

  // Bloque a: Leads por etapa
  filas.push(['BLOQUE A — Leads por etapa del ciclo comercial']);
  filas.push(['Etapa', 'Cantidad']);
  Object.entries(dashboard.leadsPorEtapa).forEach(([etapa, cantidad]) => {
    if (etapa !== 'total') {
      filas.push([etapa, cantidad]);
    }
  });
  filas.push(['TOTAL', dashboard.leadsPorEtapa.total]);
  filas.push([]);

  // Bloque b: Campañas Mailchimp
  filas.push(['BLOQUE B — Campañas Mailchimp']);
  filas.push(['Campaña', 'Estado', 'Enviadas', 'Tasa Apertura (%)', 'Clics']);
  dashboard.campañasMailchimp.forEach((c) => {
    filas.push([
      c.nombre,
      c.estado,
      c.enviadas,
      c.tasaApertura,
      c.clicsGenerados,
    ]);
  });
  filas.push([]);

  // Bloque c: Citas semana
  filas.push(['BLOQUE C — Citas confirmadas (semana)']);
  filas.push(['Lead', 'Fecha y hora inicio', 'Fecha y hora fin', 'Enlace Calendly']);
  dashboard.citasSemana.forEach((c) => {
    filas.push([
      c.nombreLead,
      c.fecha_hora_inicio,
      c.fecha_hora_fin ?? '',
      c.enlace_calendly ?? '',
    ]);
  });
  filas.push([]);

  // Bloque d: Resumen financiero
  filas.push(['BLOQUE D — Resumen financiero']);
  filas.push(['Indicador', 'Valor']);
  filas.push(['Saldo total inversiones activas (COP)', dashboard.resumenFinanciero.saldoTotalInversionesActivas]);
  filas.push(['Operaciones mes actual', dashboard.resumenFinanciero.numeroOperacionesMesActual]);
  filas.push(['Variación % mes anterior', dashboard.resumenFinanciero.variacionPorcentualMesAnterior]);

  // Escribir al rango A1 del libro Excel
  const rangeAddress = `A1:E${filas.length}`;
  await graphClient.updateRange(driveItemId, worksheetName, rangeAddress, filas);
}

// ---------------------------------------------------------------------------
// Main CLI
// ---------------------------------------------------------------------------

async function main() {
  console.error('[Dashboard] Generador de Dashboard Ejecutivo — Tesis Automatización Fintech');

  try {
    const rawPayload = await readPayload();

    // Validar entrada con Zod
    const input = DashboardInputSchema.parse(rawPayload);

    // Obtener datos: sintéticos para pruebas, o reales en producción
    let datos;
    if (input.datosSinteticos) {
      datos = generarDatosSinteticos();
      console.error('[Dashboard] Usando datos sintéticos para pruebas de desarrollo.');
    } else {
      throw new Error(
        'Modo de datos reales no implementado aún. Use datosSinteticos: true para pruebas.',
      );
    }

    // Generar el dashboard
    const dashboard = generarDashboard({
      workflowId: input.workflowId,
      periodoInicio: input.periodoInicio,
      periodoFin: input.periodoFin,
      leads: datos.leads,
      campañas: datos.campañas,
      metricasCampañas: datos.metricasCampañas,
      citas: datos.citas,
      inversiones: datos.inversiones,
      fechaActual: new Date().toISOString(),
      datosSinteticos: true,
    });

    // Opcional: actualizar Excel en OneDrive vía Graph API
    if (input.excelDriveItemId) {
      const { createGraphClient } = await import('./graphClientAdapter.js');
      const graphClient = createGraphClient({
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        tenantId: process.env.MICROSOFT_TENANT_ID,
      });

      await actualizarExcel(
        graphClient,
        input.excelDriveItemId,
        input.excelWorksheetName,
        dashboard,
      );
      console.error('[Dashboard] Libro Excel actualizado en OneDrive.');
    }

    // Emitir informe JSON
    emitResult(true, dashboard);

    console.error('[Dashboard] Informe generado exitosamente.');
  } catch (error) {
    let errorType = error.name ?? 'Error';
    emitResult(false, null, error.message, errorType);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[Dashboard] UNHANDLED REJECTION:', reason);
  emitResult(false, null, `Error asíncrono: ${reason?.message ?? String(reason)}`, 'UnhandledRejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[Dashboard] UNCAUGHT EXCEPTION:', error);
  emitResult(false, null, `Excepción: ${error.message}`, 'UncaughtException');
  process.exit(1);
});

main();