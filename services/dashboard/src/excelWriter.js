/**
 * @fileoverview Escritura del dashboard ejecutivo en un libro Excel de OneDrive.
 *
 * DISEÑO (ver docs/DESIGN.md — alineado con el mockup «Dashboard Ejecutivo —
 * Asesor Fintech», §4.4 de la tesis IS25237):
 *   - Cabecera con el título, las pestañas del mockup y el periodo de consulta.
 *   - Indicadores clave de gestión (KPI) en banda horizontal.
 *   - Cuatro bloques de §4.4 (seguimiento comercial, campañas Mailchimp,
 *     citas del periodo y resumen financiero).
 *   - Monitoreo de integraciones y control de actualización.
 *   - Jerarquía de tres niveles: título → encabezado de sección → encabezado de
 *     columna → dato. Cada nivel se distingue por peso tipográfico y color, no
 *     por decoración.
 *   - Una sola retícula de 8 columnas (A–H) para toda la hoja.
 *   - Las cifras se alinean a la derecha; los textos a la izquierda.
 *   - Formatos numéricos consistentes: separador de miles, porcentaje con el
 *     símbolo, moneda COP y fechas legibles dd/mm/aaaa hh:mm.
 *   - Paleta restringida (tinta, gris, superficie y bordes). El único color con
 *     significado semántico es el del sello "DATOS REALES / DATOS SINTÉTICOS".
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

// ---------------------------------------------------------------------------
// Tokens de diseño
// ---------------------------------------------------------------------------

/** Paleta y formatos del dashboard (sincronizados con docs/DESIGN.md). */
export const TOKENS = Object.freeze({
  color: {
    /** Tinta principal (títulos) */
    tinta: '#0A2540',
    /** Texto secundario (subtítulos, etiquetas) */
    tintaSecundaria: '#425466',
    /** Texto atenuado (notas) */
    tintaAtenuada: '#6B7785',
    /** Superficie de encabezados de sección */
    superficie: '#F6F9FC',
    /** Línea divisoria */
    borde: '#D1D5DB',
    /** Sello de datos reales */
    real: '#0E7C66',
    /** Sello de datos sintéticos */
    sintetico: '#B45309',
    /** Estado correcto (monitoreo de integraciones) */
    correcto: '#0E7C66',
  },
  fuente: {
    nombre: 'Calibri',
    tamTitulo: 16,
    tamSubtitulo: 10,
    tamSeccion: 11,
    tamColumna: 10,
    tamDato: 10,
  },
  formato: {
    /** Entero con separador de miles */
    entero: '#,##0',
    /** Decimal con separador de miles */
    decimal: '#,##0.00',
    /** Porcentaje (el valor ya viene en unidades de porcentaje) */
    porcentaje: '0.00"%"',
    /** Variación porcentual con signo explícito */
    variacion: '+0.00"%";-0.00"%"',
    /** Monto en pesos colombianos */
    montoCop: '#,##0" COP"',
    /** Latencia en milisegundos */
    milisegundos: '#,##0" ms"',
    /** Fecha y hora legible */
    fechaHora: 'dd/mm/yyyy hh:mm',
    /** Fecha legible */
    fecha: 'dd/mm/yyyy',
  },
  columnas: 8,
  anchos: [200, 160, 120, 120, 140, 120, 140, 120],
});

/** Pestañas del mockup, representadas como etiquetas de navegación. */
export const PESTANAS = ['Inicio', 'Leads', 'Citas', 'Inversiones', 'Reportes'];

// ---------------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------------

/**
 * Convierte una fecha ISO 8601 a número serial de Excel, expresado en hora
 * local de Bogotá (UTC-5, sin horario de verano).
 *
 * @param {string|null|undefined} iso - Fecha en ISO 8601
 * @returns {number|null} Número serial de Excel o null si no hay fecha
 */
export function isoANumeroSerialExcel(iso, timeZone = 'America/Bogota') {
  if (!iso) return null;

  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return null;

  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instante);

  const valor = (tipo) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);

  const anio = valor('year');
  const mes = valor('month');
  const dia = valor('day');
  // `hour` puede venir como 24 en algunos entornos al medianoche.
  const hora = valor('hour') % 24;
  const minuto = valor('minute');
  const segundo = valor('second');

  const dias = Date.UTC(anio, mes - 1, dia);
  const epochExcel = Date.UTC(1899, 11, 30); // Falso cero de Excel (sistema 1900)
  const diasDesdeEpoch = (dias - epochExcel) / 86_400_000;

  return diasDesdeEpoch + (hora * 3600 + minuto * 60 + segundo) / 86_400;
}

/**
 * Formatea un número con separador de miles para textos (no celdas).
 * @param {number} valor - Valor a formatear
 * @returns {string} Texto con separador de miles
 */
export function formatearMiles(valor) {
  if (typeof valor !== 'number' || Number.isNaN(valor)) return '—';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(valor);
}

/**
 * Formatea un instante ISO como fecha legible en hora de Bogotá.
 * @param {string|null|undefined} iso - Fecha en ISO 8601
 * @returns {string} Fecha `dd/mm/aaaa` o cadena vacía
 */
export function formatearFecha(iso, timeZone = 'America/Bogota') {
  if (!iso) return '';
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instante);
}

// ---------------------------------------------------------------------------
// Construcción de la matriz de valores
// ---------------------------------------------------------------------------

/**
 * Construye la matriz de valores del dashboard y registra la posición de cada
 * sección para poder aplicar después el formato.
 *
 * @param {object} dashboard - Informe del dashboard (DashboardOutputSchema)
 * @returns {{filas: Array<Array<any>>, secciones: Array<object>}}
 */
export function construirMatrizDashboard(dashboard) {
  const filas = [];
  const secciones = [];

  /**
   * Añade una fila y devuelve su índice (1-based, como en Excel).
   * @param {Array<any>} valores - Valores de la fila
   * @param {object} [meta] - Metadatos de la fila
   * @returns {number} Número de fila (1-based)
   */
  function agregarFila(valores, meta = {}) {
    filas.push(valores);
    const numero = filas.length;
    if (meta.tipo) {
      secciones.push({ ...meta, fila: numero });
    }
    return numero;
  }

  const kpis = dashboard.kpis ?? {};
  const financiero = dashboard.resumenFinanciero ?? {};

  // --- Cabecera -----------------------------------------------------------
  agregarFila(['EXCEL / ONEDRIVE'], { tipo: 'kicker' });
  agregarFila(['DASHBOARD EJECUTIVO — ASESOR FINTECH'], { tipo: 'titulo' });
  agregarFila([PESTANAS.join('   ·   ')], { tipo: 'pestanas' });
  agregarFila([]);

  // --- Periodo de consulta ------------------------------------------------
  agregarFila(['PERIODO DE CONSULTA'], { tipo: 'seccion', hastaColumna: 8 });
  agregarFila(
    [
      'Periodo',
      `${formatearFecha(dashboard.periodo.inicio)} — ${formatearFecha(dashboard.periodo.fin)}`,
      'Todos los estados',
      '',
      '',
      '',
      '',
      'Actualizar datos',
    ],
    { tipo: 'dato' },
  );
  agregarFila([]);

  // --- Indicadores clave de gestión --------------------------------------
  agregarFila(['INDICADORES CLAVE DE GESTIÓN (KPIs)'], {
    tipo: 'seccion',
    hastaColumna: 8,
  });
  agregarFila(
    [
      'Leads registradas',
      kpis.leadsRegistradas ?? 0,
      'Citas agendadas',
      kpis.citasAgendadas ?? 0,
      'Inversiones registradas',
      kpis.inversionesRegistradas ?? 0,
      'Conversión',
      kpis.conversionPorcentaje ?? 0,
    ],
    {
      tipo: 'kpi',
      formatosPorColumna: {
        2: TOKENS.formato.entero,
        4: TOKENS.formato.entero,
        6: TOKENS.formato.entero,
        8: TOKENS.formato.porcentaje,
      },
    },
  );
  agregarFila([]);

  // --- Bloque A: seguimiento comercial -----------------------------------
  agregarFila(['BLOQUE A — SEGUIMIENTO COMERCIAL (LEADS POR ETAPA)'], {
    tipo: 'seccion',
    hastaColumna: 8,
  });
  agregarFila(
    ['Estado del lead', 'Etapa comercial', 'Cantidad', 'Participación'],
    { tipo: 'columna', hastaColumna: 4 },
  );

  (dashboard.seguimientoComercial ?? []).forEach((fila) => {
    agregarFila(
      [fila.estado, fila.etapaComercial, fila.cantidad, fila.participacionPorcentaje],
      {
        tipo: 'dato',
        formatosPorColumna: {
          3: TOKENS.formato.entero,
          4: TOKENS.formato.porcentaje,
        },
      },
    );
  });
  agregarFila([]);

  // --- Bloque B: campañas Mailchimp --------------------------------------
  agregarFila(['BLOQUE B — CAMPAÑAS MAILCHIMP'], {
    tipo: 'seccion',
    hastaColumna: 8,
  });
  agregarFila(
    ['Campaña', 'Estado', 'Suscriptores', 'Enviadas', 'Tasa apertura', 'Clics'],
    { tipo: 'columna', hastaColumna: 6 },
  );

  const conMetricas = dashboard.metricasMailchimpDisponibles !== false;
  dashboard.campañasMailchimp.forEach((campana) => {
    agregarFila(
      [
        campana.nombre,
        campana.estado,
        campana.suscriptores ?? 0,
        conMetricas ? campana.enviadas : 'n/d',
        conMetricas ? campana.tasaApertura : 'n/d',
        conMetricas ? campana.clicsGenerados : 'n/d',
      ],
      {
        tipo: 'dato',
        formatosPorColumna: {
          3: TOKENS.formato.entero,
          4: TOKENS.formato.entero,
          5: TOKENS.formato.porcentaje,
          6: TOKENS.formato.entero,
        },
      },
    );
  });
  agregarFila([]);

  // --- Bloque C: citas del periodo ---------------------------------------
  agregarFila(['BLOQUE C — CITAS DEL PERIODO'], {
    tipo: 'seccion',
    hastaColumna: 8,
  });
  agregarFila(['Lead', 'Inicio', 'Fin', 'Enlace'], {
    tipo: 'columna',
    hastaColumna: 4,
  });

  dashboard.citasSemana.forEach((cita) => {
    agregarFila(
      [
        cita.nombreLead,
        isoANumeroSerialExcel(cita.fecha_hora_inicio),
        isoANumeroSerialExcel(cita.fecha_hora_fin),
        cita.enlace_calendly ?? '—',
      ],
      { tipo: 'dato', columnasFecha: [2, 3] },
    );
  });
  agregarFila([]);

  // --- Bloque D: resumen financiero --------------------------------------
  agregarFila(['BLOQUE D — RESUMEN FINANCIERO'], {
    tipo: 'seccion',
    hastaColumna: 8,
  });
  agregarFila(['Tipo de información', 'Valor'], { tipo: 'columna', hastaColumna: 2 });
  agregarFila(
    ['Monto acumulado (saldo de inversiones activas)', financiero.montoAcumulado ?? 0],
    { tipo: 'dato', formatosPorColumna: { 2: TOKENS.formato.montoCop } },
  );
  agregarFila(
    ['Total de operaciones', financiero.totalOperaciones ?? 0],
    { tipo: 'dato', formatosPorColumna: { 2: TOKENS.formato.entero } },
  );
  agregarFila(
    ['Operaciones pendientes', financiero.operacionesPendientes ?? 0],
    { tipo: 'dato', formatosPorColumna: { 2: TOKENS.formato.entero } },
  );
  agregarFila(
    ['Operaciones completadas', financiero.operacionesCompletadas ?? 0],
    { tipo: 'dato', formatosPorColumna: { 2: TOKENS.formato.entero } },
  );
  agregarFila(
    ['Operaciones canceladas', financiero.operacionesCanceladas ?? 0],
    { tipo: 'dato', formatosPorColumna: { 2: TOKENS.formato.entero } },
  );
  agregarFila(
    ['Operaciones del mes actual', financiero.numeroOperacionesMesActual ?? 0],
    { tipo: 'dato', formatosPorColumna: { 2: TOKENS.formato.entero } },
  );
  agregarFila(
    ['Variación % frente al mes anterior', financiero.variacionPorcentualMesAnterior ?? 0],
    { tipo: 'dato', formatosPorColumna: { 2: TOKENS.formato.variacion } },
  );
  agregarFila([]);

  // --- Monitoreo de integraciones ----------------------------------------
  agregarFila(['MONITOREO DE INTEGRACIONES'], { tipo: 'seccion', hastaColumna: 8 });
  agregarFila(['Plataforma', 'Última sincronización', 'Estado'], {
    tipo: 'columna',
    hastaColumna: 3,
  });

  (dashboard.monitoreoIntegraciones ?? []).forEach((fila) => {
    agregarFila(
      [
        fila.plataforma,
        fila.ultimaSincronizacion ? isoANumeroSerialExcel(fila.ultimaSincronizacion) : '—',
        fila.estado,
      ],
      { tipo: 'dato', columnasFecha: [2] },
    );
  });
  agregarFila([]);

  // --- Control de actualización ------------------------------------------
  agregarFila(['CONTROL DE ACTUALIZACIÓN'], { tipo: 'seccion', hastaColumna: 8 });
  agregarFila(
    [
      'Última actualización',
      dashboard.controlActualizacion?.ultimaActualizacion
        ? isoANumeroSerialExcel(dashboard.controlActualizacion.ultimaActualizacion)
        : '—',
      'Estado general',
      dashboard.controlActualizacion?.estadoGeneral ?? '—',
    ],
    { tipo: 'dato', columnasFecha: [2] },
  );
  agregarFila(
    [
      'Origen de los datos',
      dashboard.datosSinteticos
        ? 'SINTÉTICOS (demostración — no son resultados empíricos)'
        : 'REALES (PostgreSQL · MER)',
    ],
    { tipo: 'sello' },
  );
  agregarFila([]);

  // --- Notas --------------------------------------------------------------
  const notas = Array.isArray(dashboard.advertencias) ? dashboard.advertencias : [];
  if (notas.length > 0) {
    agregarFila(['NOTAS'], { tipo: 'seccion', hastaColumna: 8 });
    notas.forEach((nota) => {
      agregarFila([nota], { tipo: 'nota' });
    });
  }

  return { filas, secciones };
}

// ---------------------------------------------------------------------------
// Escritura en OneDrive vía Microsoft Graph
// ---------------------------------------------------------------------------

/**
 * Convierte un índice de columna (1-based) a letra de columna de Excel.
 * @param {number} indice - Índice de columna (1 = A)
 * @returns {string} Letra de columna ('A', 'B', ... 'Z', 'AA', ...)
 */
export function columnaALetra(indice) {
  let resultado = '';
  let n = indice - 1;
  do {
    resultado = String.fromCharCode(65 + (n % 26)) + resultado;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return resultado;
}

/**
 * Escribe el dashboard en una hoja de Excel de OneDrive.
 *
 * Primero escribe los valores y después aplica el formato en un conjunto
 * reducido de llamadas dirigidas (una por nivel jerárquico y por rango de
 * cifras), para no generar tráfico innecesario contra la API de Graph.
 *
 * @param {object} graphClient - Cliente Graph (de graphClientAdapter.js)
 * @param {object} params - Parámetros
 * @param {string} params.driveItemId - ID del archivo Excel en OneDrive
 * @param {string} params.worksheetName - Nombre de la hoja
 * @param {object} params.dashboard - Informe del dashboard
 * @returns {Promise<{filasEscritas: number, secciones: number}>} Resumen de la escritura
 * @throws {Error} Si el cliente Graph no es válido
 */
export async function escribirDashboardEnExcel(graphClient, { driveItemId, worksheetName, dashboard }) {
  if (!graphClient || typeof graphClient.updateRange !== 'function') {
    throw new Error('Se requiere un cliente Graph válido para actualizar Excel');
  }

  const { filas, secciones } = construirMatrizDashboard(dashboard);
  const totalFilas = filas.length;
  const totalColumnas = TOKENS.columnas;

  // 1. Valores -----------------------------------------------------------
  const rangoValores = `A1:${columnaALetra(totalColumnas)}${totalFilas}`;
  await graphClient.updateRange(driveItemId, worksheetName, rangoValores, filas);

  // 2. Formato -----------------------------------------------------------
  const color = TOKENS.color;
  const fuente = TOKENS.fuente;

  const formatoBase = {
    font: { name: fuente.nombre, size: fuente.tamDato, color: color.tintaSecundaria },
    verticalAlignment: 'center',
  };

  /**
   * Aplica un formato a un rango.
   * @param {string} rango - Dirección del rango (A1:B2)
   * @param {object} formato - Objeto de formato (RangeFormat)
   * @returns {Promise<void>}
   */
  const aplicar = (rango, formato) =>
    graphClient.updateRange(driveItemId, worksheetName, rango, undefined, formato);

  // 2.1 Antetítulo y título
  const kicker = secciones.find((s) => s.tipo === 'kicker');
  if (kicker) {
    await aplicar(`A${kicker.fila}:${columnaALetra(totalColumnas)}${kicker.fila}`, {
      ...formatoBase,
      font: { name: fuente.nombre, size: fuente.tamSubtitulo, bold: true, color: color.tintaAtenuada },
    });
  }

  const titulo = secciones.find((s) => s.tipo === 'titulo');
  if (titulo) {
    await aplicar(`A${titulo.fila}:${columnaALetra(totalColumnas)}${titulo.fila}`, {
      ...formatoBase,
      font: { name: fuente.nombre, size: fuente.tamTitulo, bold: true, color: color.tinta },
      verticalAlignment: 'center',
      rowHeight: 26,
    });
  }

  // 2.2 Pestañas de navegación
  const pestanas = secciones.find((s) => s.tipo === 'pestanas');
  if (pestanas) {
    await aplicar(`A${pestanas.fila}:${columnaALetra(totalColumnas)}${pestanas.fila}`, {
      ...formatoBase,
      font: { name: fuente.nombre, size: fuente.tamSubtitulo, color: color.tintaSecundaria },
      borders: [{ edge: 'Bottom', style: 'Continuous', color: color.borde }],
    });
  }

  // 2.3 Encabezados de sección
  for (const seccion of secciones.filter((s) => s.tipo === 'seccion')) {
    const hasta = columnaALetra(seccion.hastaColumna ?? totalColumnas);
    await aplicar(`A${seccion.fila}:${hasta}${seccion.fila}`, {
      ...formatoBase,
      font: { name: fuente.nombre, size: fuente.tamSeccion, bold: true, color: color.tinta },
      fill: { color: color.superficie },
      borders: [{ edge: 'Bottom', style: 'Continuous', color: color.borde }],
      rowHeight: 20,
    });
  }

  // 2.4 Encabezados de columna
  for (const seccion of secciones.filter((s) => s.tipo === 'columna')) {
    const hasta = columnaALetra(seccion.hastaColumna ?? totalColumnas);
    await aplicar(`A${seccion.fila}:${hasta}${seccion.fila}`, {
      ...formatoBase,
      font: { name: fuente.nombre, size: fuente.tamColumna, bold: true, color: color.tinta },
      fill: { color: color.superficie },
      borders: [{ edge: 'Bottom', style: 'Continuous', color: color.borde }],
      rowHeight: 18,
    });
  }

  // 2.5 Cifras: alineación a la derecha y formato numérico por columna
  const filasDato = secciones.filter((s) => s.tipo === 'dato' || s.tipo === 'kpi');

  const grupos = new Map();
  filasDato.forEach((seccion) => {
    const formatos = seccion.formatosPorColumna ?? {};
    Object.entries(formatos).forEach(([columna, formato]) => {
      const clave = `${columna}::${formato}`;
      if (!grupos.has(clave)) {
        grupos.set(clave, { columna: Number(columna), formato, filas: [] });
      }
      grupos.get(clave).filas.push(seccion.fila);
    });
  });

  for (const grupo of grupos.values()) {
    const letra = columnaALetra(grupo.columna);
    const numeros = [...grupo.filas].sort((a, b) => a - b);

    // Se fusionan filas contiguas en un mismo rango.
    let inicio = numeros[0];
    let fin = numeros[0];
    const rangos = [];
    for (let i = 1; i <= numeros.length; i += 1) {
      const actual = numeros[i];
      if (actual === fin + 1) {
        fin = actual;
      } else {
        rangos.push([inicio, fin]);
        inicio = actual;
        fin = actual;
      }
    }
    rangos.push([inicio, fin]);

    for (const [desde, hasta] of rangos) {
      await aplicar(`${letra}${desde}:${letra}${hasta}`, {
        ...formatoBase,
        font: { name: fuente.nombre, size: fuente.tamDato, color: color.tintaSecundaria },
        horizontalAlignment: 'right',
        numberFormat: grupo.formato,
      });
    }
  }

  // 2.6 Fechas
  for (const seccion of filasDato.filter((s) => s.columnasFecha)) {
    for (const columna of seccion.columnasFecha) {
      const letra = columnaALetra(columna);
      await aplicar(`${letra}${seccion.fila}:${letra}${seccion.fila}`, {
        ...formatoBase,
        font: { name: fuente.nombre, size: fuente.tamDato, color: color.tintaSecundaria },
        horizontalAlignment: 'right',
        numberFormat: TOKENS.formato.fechaHora,
      });
    }
  }

  // 2.7 Sello de origen (real / sintético)
  const sello = secciones.find((s) => s.tipo === 'sello');
  if (sello) {
    await aplicar(`A${sello.fila}:${columnaALetra(totalColumnas)}${sello.fila}`, {
      ...formatoBase,
      font: {
        name: fuente.nombre,
        size: fuente.tamSubtitulo,
        bold: true,
        color: dashboard.datosSinteticos ? color.sintetico : color.real,
      },
    });
  }

  // 2.8 Notas
  for (const seccion of secciones.filter((s) => s.tipo === 'nota')) {
    await aplicar(`A${seccion.fila}:${columnaALetra(totalColumnas)}${seccion.fila}`, {
      ...formatoBase,
      font: {
        name: fuente.nombre,
        size: fuente.tamSubtitulo,
        italic: true,
        color: color.tintaAtenuada,
      },
      wrapText: true,
    });
  }

  // 2.9 Anchos de columna
  for (let i = 0; i < TOKENS.anchos.length; i += 1) {
    const letra = columnaALetra(i + 1);
    await aplicar(`${letra}1:${letra}${totalFilas}`, {
      ...formatoBase,
      columnWidth: TOKENS.anchos[i],
    });
  }

  return { filasEscritas: totalFilas, secciones: secciones.length };
}
