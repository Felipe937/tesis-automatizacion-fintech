/**
 * @fileoverview Motor de conciliación financiera.
 *
 * Lógica central que compara transacciones del portafolio de inversión
 * provenientes de n8n contra los registros existentes en Excel/OneDrive,
 * identificando discrepancias, transacciones faltantes y registros huérfanos.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 *
 * Algoritmo de conciliación:
 *  1. Normalizar ambas fuentes (n8n payload + Excel) a un formato canónico
 *  2. Construir índices hash por ID de transacción para búsqueda O(1)
 *  3. Clasificar cada transacción en: COINCIDE, DISCREPANCIA, SOLO_EN_N8N, SOLO_EN_EXCEL
 *  4. Para discrepancias, detallar campo a campo qué valores difieren
 *  5. Calcular métricas de resumen del portafolio (posición neta, P&L, etc.)
 *  6. Retornar resultado consolidado estructurado para consumo de n8n
 */

import Decimal from 'decimal.js';

// ---------------------------------------------------------------------------
// Configuración de Decimal.js para aritmética financiera
// La aritmética de punto flotante IEEE 754 NO es apta para dinero.
// 0.1 + 0.2 === 0.30000000000000004 en JavaScript nativo.
// ---------------------------------------------------------------------------
Decimal.set({
  precision: 28,       // 28 dígitos significativos (más que suficiente para COP)
  rounding: Decimal.ROUND_HALF_EVEN, // Banker's rounding (estándar financiero)
  toExpNeg: -9,
  toExpPos: 21,
});

// ---------------------------------------------------------------------------
// Constantes de clasificación de conciliación
// ---------------------------------------------------------------------------
export const ReconciliationStatus = Object.freeze({
  /** Las dos fuentes coinciden dentro de la tolerancia permitida */
  COINCIDE: 'COINCIDE',
  /** Existe en ambas fuentes pero hay al menos un campo diferente */
  DISCREPANCIA: 'DISCREPANCIA',
  /** Transacción en el payload de n8n pero NO en el Excel */
  SOLO_EN_N8N: 'SOLO_EN_N8N',
  /** Transacción en el Excel pero NO en el payload de n8n (posible transacción perdida) */
  SOLO_EN_EXCEL: 'SOLO_EN_EXCEL',
});

// Campos numéricos que se comparan con tolerancia (evitar falsos positivos por redondeo)
const NUMERIC_FIELDS = [
  'cantidad',
  'precioUnitario',
  'valorBruto',
  'comisiones',
  'impuestos',
  'valorNeto',
  'tasaCambio',
];

// Campos que, si difieren, se consideran errores críticos de conciliación
const CRITICAL_FIELDS = ['operacion', 'ticker', 'valorNeto', 'estado'];

// ---------------------------------------------------------------------------
// Transformaciones y normalización de datos
// ---------------------------------------------------------------------------

/**
 * Convierte una fila cruda de Excel (array de celdas) en un objeto
 * normalizado usando la fila de headers como mapa de índices.
 *
 * Excel puede devolver números donde se esperan strings y fechas en formato
 * serial de Excel (días desde 1900-01-01), por lo que se aplican coerciones.
 *
 * @param {string[]} headers    - Primera fila del Excel (nombres de columna)
 * @param {Array}    row        - Fila de datos cruda del API de Graph
 * @returns {object}            - Objeto con pares {header: valor}
 */
export function normalizeExcelRow(headers, row) {
  return headers.reduce((acc, header, index) => {
    let value = row[index] ?? null;

    // Excel almacena fechas como número serial (días desde 30-dic-1899)
    // Los detectamos comprobando si el header contiene "fecha" y el valor es numérico
    if (
      typeof value === 'number' &&
      header.toLowerCase().includes('fecha') &&
      value > 40000 // Umbral razonable para distinguir fecha de cantidad
    ) {
      // Convertir serial de Excel a fecha ISO
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const msOffset = value * 24 * 60 * 60 * 1000;
      const date = new Date(excelEpoch.getTime() + msOffset);
      value = date.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    // Normalizar strings: trim y mayúsculas para campos clave
    if (typeof value === 'string') {
      value = value.trim();
      if (['Ticker', 'Tipo_Activo', 'Operacion', 'Moneda', 'Estado'].includes(header)) {
        value = value.toUpperCase();
      }
    }

    acc[header] = value;
    return acc;
  }, {});
}

/**
 * Mapea un objeto normalizado de Excel (con nombres de columna Excel)
 * al esquema canónico del dominio (nombres en español/camelCase del schema Zod).
 *
 * Esta función actúa como adaptador entre el contrato del Excel y el
 * contrato interno de la aplicación. Si el Excel cambia de nombre de columna,
 * sólo hay que actualizar este mapa.
 *
 * @param {object} row - Fila normalizada de Excel
 * @returns {object}   - Objeto en formato canónico del dominio
 */
export function mapExcelRowToDomain(row) {
  return {
    id: String(row['ID_Transaccion'] ?? '').trim(),
    fecha: String(row['Fecha'] ?? '').trim(),
    ticker: String(row['Ticker'] ?? '').trim().toUpperCase(),
    tipoActivo: String(row['Tipo_Activo'] ?? '').trim().toUpperCase(),
    operacion: String(row['Operacion'] ?? '').trim().toUpperCase(),
    cantidad: toSafeDecimal(row['Cantidad']),
    precioUnitario: toSafeDecimal(row['Precio_Unitario']),
    valorBruto: toSafeDecimal(row['Valor_Bruto']),
    comisiones: toSafeDecimal(row['Comisiones']),
    impuestos: toSafeDecimal(row['Impuestos']),
    valorNeto: toSafeDecimal(row['Valor_Neto']),
    moneda: String(row['Moneda'] ?? 'COP').trim().toUpperCase(),
    estado: String(row['Estado'] ?? '').trim().toUpperCase(),
    corredor: String(row['Corredor'] ?? '').trim(),
    referenciaExterna: row['Referencia_Externa']
      ? String(row['Referencia_Externa']).trim()
      : null,
    notas: row['Notas'] ? String(row['Notas']).trim() : null,
  };
}

/**
 * Convierte una transacción del payload de n8n al mismo esquema canónico,
 * convirtiendo todos los valores numéricos a Decimal para comparación precisa.
 *
 * @param {object} txn - Transacción validada por Zod del payload de n8n
 * @returns {object}   - Transacción en formato canónico con Decimals
 */
export function mapN8nTransactionToDomain(txn) {
  return {
    id: txn.id,
    fecha: txn.fecha,
    ticker: txn.ticker,
    tipoActivo: txn.tipoActivo,
    operacion: txn.operacion,
    cantidad: new Decimal(txn.cantidad),
    precioUnitario: new Decimal(txn.precioUnitario),
    valorBruto: new Decimal(txn.valorBruto),
    comisiones: new Decimal(txn.comisiones ?? 0),
    impuestos: new Decimal(txn.impuestos ?? 0),
    valorNeto: new Decimal(txn.valorNeto),
    moneda: txn.moneda ?? 'COP',
    tasaCambio: new Decimal(txn.tasaCambio ?? 1),
    estado: txn.estado,
    corredor: txn.corredor,
    referenciaExterna: txn.referenciaExterna ?? null,
    notas: txn.notas ?? null,
  };
}

// ---------------------------------------------------------------------------
// Funciones de utilidad financiera
// ---------------------------------------------------------------------------

/**
 * Convierte un valor de celda de Excel a Decimal de forma segura.
 * Maneja null, strings vacíos, comas decimales y otros formatos locales.
 *
 * @param {string|number|null} value - Valor crudo de celda Excel
 * @returns {Decimal}                - Instancia Decimal (0 si no parseable)
 */
function toSafeDecimal(value) {
  if (value === null || value === undefined || value === '') {
    return new Decimal(0);
  }

  // Si ya es número JavaScript, pasarlo directamente a Decimal.
  // Evita que el procesamiento de strings corrompa el punto decimal.
  if (typeof value === 'number') {
    return new Decimal(value);
  }

  // Para strings: limpiar formato colombiano/europeo con cuidado.
  // Patrón de separador de miles: punto seguido de exactamente 3 dígitos
  // (ej: "19.250.000" → "19250000", pero "19250.50" se mantiene intacto)
  const str = String(value)
    .trim()
    .replace(/[$COP\s]/gi, '')              // Eliminar símbolo de moneda y espacios
    .replace(/\.(?=\d{3}(?:[.,]|$))/g, '') // Quitar puntos de miles (separador colombiano)
    .replace(/,(?=\d{1,2}$)/g, '.');       // Convertir coma decimal final a punto

  try {
    return new Decimal(str);
  } catch {
    console.warn(`[Reconciler] No se pudo parsear valor numérico: "${value}". Usando 0.`);
    return new Decimal(0);
  }
}

/**
 * Compara dos valores Decimal dentro de una tolerancia absoluta.
 * Usado para evitar falsos positivos por diferencias de redondeo contable.
 *
 * @param {Decimal} a           - Primer valor
 * @param {Decimal} b           - Segundo valor
 * @param {number}  tolerancia  - Diferencia máxima aceptable (en COP)
 * @returns {boolean}           - true si los valores son "iguales" dentro de la tolerancia
 */
function withinTolerance(a, b, tolerancia) {
  return a.minus(b).abs().lte(new Decimal(tolerancia));
}

/**
 * Formatea un Decimal a string con 2 decimales para incluir en reportes.
 *
 * @param {Decimal} d - Valor Decimal
 * @returns {string}  - Valor formateado con 2 decimales
 */
function formatDecimal(d) {
  return d instanceof Decimal ? d.toFixed(2) : String(d ?? 0);
}

// ---------------------------------------------------------------------------
// Motor de conciliación — función principal
// ---------------------------------------------------------------------------

/**
 * Resultado de comparar un campo específico entre las dos fuentes.
 *
 * @typedef {object} FieldDiscrepancy
 * @property {string}  campo       - Nombre del campo con discrepancia
 * @property {*}       valorN8n    - Valor en el payload de n8n
 * @property {*}       valorExcel  - Valor en el Excel de OneDrive
 * @property {boolean} esCritico   - Si este campo es crítico para la conciliación
 */

/**
 * Resultado de conciliar una transacción individual.
 *
 * @typedef {object} ReconciliationRecord
 * @property {string}              id             - ID de la transacción
 * @property {string}              status         - ReconciliationStatus
 * @property {object|null}         transaccionN8n - Datos originales del payload
 * @property {object|null}         registroExcel  - Datos del Excel
 * @property {FieldDiscrepancy[]}  discrepancias  - Lista de campos distintos
 * @property {boolean}             tieneCritico   - Hay al menos un campo crítico distinto
 * @property {string}              timestamp      - Timestamp de la conciliación
 */

/**
 * Compara campo a campo dos registros del dominio e identifica discrepancias.
 *
 * @param {object} n8nRecord     - Transacción de n8n en formato canónico
 * @param {object} excelRecord   - Registro de Excel en formato canónico
 * @param {number} toleranciaCOP - Tolerancia numérica en COP
 * @returns {FieldDiscrepancy[]} - Array de discrepancias encontradas
 */
function compareRecords(n8nRecord, excelRecord, toleranciaCOP) {
  const discrepancias = [];

  // Campos a comparar explícitamente (el resto se ignora en la conciliación)
  const fieldsToCompare = [
    'fecha', 'ticker', 'tipoActivo', 'operacion',
    'cantidad', 'precioUnitario', 'valorBruto',
    'comisiones', 'impuestos', 'valorNeto',
    'moneda', 'estado', 'corredor',
  ];

  for (const campo of fieldsToCompare) {
    const vN8n = n8nRecord[campo];
    const vExcel = excelRecord[campo];

    // Comparación de campos numéricos con tolerancia
    if (NUMERIC_FIELDS.includes(campo)) {
      const decN8n = vN8n instanceof Decimal ? vN8n : new Decimal(vN8n ?? 0);
      const decExcel = vExcel instanceof Decimal ? vExcel : new Decimal(vExcel ?? 0);

      if (!withinTolerance(decN8n, decExcel, toleranciaCOP)) {
        discrepancias.push({
          campo,
          valorN8n: formatDecimal(decN8n),
          valorExcel: formatDecimal(decExcel),
          diferencia: formatDecimal(decN8n.minus(decExcel).abs()),
          esCritico: CRITICAL_FIELDS.includes(campo),
        });
      }
      continue;
    }

    // Comparación de campos de texto (normalizar para evitar falsos por mayúsculas/espacios)
    const strN8n = String(vN8n ?? '').trim().toUpperCase();
    const strExcel = String(vExcel ?? '').trim().toUpperCase();

    if (strN8n !== strExcel) {
      discrepancias.push({
        campo,
        valorN8n: vN8n,
        valorExcel: vExcel,
        diferencia: null,
        esCritico: CRITICAL_FIELDS.includes(campo),
      });
    }
  }

  return discrepancias;
}

/**
 * Calcula métricas de resumen del portafolio sobre el conjunto de transacciones.
 * Sirve como validación cruzada (cross-check) del proceso de conciliación.
 *
 * @param {object[]} transactions - Array de transacciones en formato canónico
 * @returns {object}              - Objeto con métricas del portafolio
 */
function calcularMetricasPortafolio(transactions) {
  const metricas = {
    totalTransacciones: transactions.length,
    totalCompras: new Decimal(0),
    totalVentas: new Decimal(0),
    totalDividendos: new Decimal(0),
    totalComisiones: new Decimal(0),
    totalImpuestos: new Decimal(0),
    valorNetoTotal: new Decimal(0),
    posicionPorTicker: {},
  };

  for (const txn of transactions) {
    const valorNeto = txn.valorNeto instanceof Decimal
      ? txn.valorNeto
      : new Decimal(txn.valorNeto ?? 0);
    const comisiones = txn.comisiones instanceof Decimal
      ? txn.comisiones
      : new Decimal(txn.comisiones ?? 0);
    const impuestos = txn.impuestos instanceof Decimal
      ? txn.impuestos
      : new Decimal(txn.impuestos ?? 0);
    const cantidad = txn.cantidad instanceof Decimal
      ? txn.cantidad
      : new Decimal(txn.cantidad ?? 0);

    metricas.totalComisiones = metricas.totalComisiones.plus(comisiones);
    metricas.totalImpuestos = metricas.totalImpuestos.plus(impuestos);

    switch (txn.operacion?.toUpperCase()) {
      case 'COMPRA':
        metricas.totalCompras = metricas.totalCompras.plus(valorNeto.abs());
        // Posición por ticker: sumar cantidad en compras
        metricas.posicionPorTicker[txn.ticker] = (
          metricas.posicionPorTicker[txn.ticker] ?? new Decimal(0)
        ).plus(cantidad);
        break;
      case 'VENTA':
        metricas.totalVentas = metricas.totalVentas.plus(valorNeto.abs());
        // Posición por ticker: restar cantidad en ventas
        metricas.posicionPorTicker[txn.ticker] = (
          metricas.posicionPorTicker[txn.ticker] ?? new Decimal(0)
        ).minus(cantidad);
        break;
      case 'DIVIDENDO':
      case 'CUPON':
        metricas.totalDividendos = metricas.totalDividendos.plus(valorNeto);
        break;
    }

    metricas.valorNetoTotal = metricas.valorNetoTotal.plus(valorNeto);
  }

  // Convertir Decimals a strings para serialización JSON
  return {
    totalTransacciones: metricas.totalTransacciones,
    totalComprasCOP: formatDecimal(metricas.totalCompras),
    totalVentasCOP: formatDecimal(metricas.totalVentas),
    totalDividendosCOP: formatDecimal(metricas.totalDividendos),
    totalComisionesCOP: formatDecimal(metricas.totalComisiones),
    totalImpuestosCOP: formatDecimal(metricas.totalImpuestos),
    valorNetoTotalCOP: formatDecimal(metricas.valorNetoTotal),
    // P&L bruto = ingresos (ventas + dividendos) - egresos (compras + costos)
    pnlBrutoCOP: formatDecimal(
      metricas.totalVentas
        .plus(metricas.totalDividendos)
        .minus(metricas.totalCompras)
        .minus(metricas.totalComisiones)
        .minus(metricas.totalImpuestos),
    ),
    posicionPorTicker: Object.fromEntries(
      Object.entries(metricas.posicionPorTicker).map(([ticker, pos]) => [
        ticker,
        formatDecimal(pos),
      ]),
    ),
  };
}

// ---------------------------------------------------------------------------
// Función principal exportada
// ---------------------------------------------------------------------------

/**
 * Ejecuta el proceso completo de conciliación financiera entre el payload
 * de n8n y los registros del Excel en OneDrive.
 *
 * @param {object[]} n8nTransactions  - Transacciones validadas del payload n8n
 * @param {string[]} excelHeaders     - Fila de headers del Excel
 * @param {Array[]}  excelRawRows     - Filas de datos crudas del Excel
 * @param {object}   opciones         - Opciones de conciliación (del payload)
 * @returns {object}                  - Resultado estructurado de la conciliación
 */
export function reconcile(n8nTransactions, excelHeaders, excelRawRows, opciones) {
  const {
    toleranciaCOP = 1,
    columnaIdExcel = 'ID_Transaccion',
  } = opciones;

  const startedAt = new Date().toISOString();
  console.log(
    `[Reconciler] Iniciando conciliación: ` +
    `${n8nTransactions.length} txn de n8n vs ${excelRawRows.length} filas de Excel`,
  );

  // -------------------------------------------------------------------------
  // PASO 1: Normalizar las filas de Excel y construir índice por ID
  // -------------------------------------------------------------------------
  const excelIndex = new Map(); // Map<id, { domainRecord, rowIndex, rawRow }>

  for (let i = 0; i < excelRawRows.length; i++) {
    const rawRow = excelRawRows[i];
    const normalizedRow = normalizeExcelRow(excelHeaders, rawRow);
    const id = String(normalizedRow[columnaIdExcel] ?? '').trim();

    if (!id) {
      console.warn(
        `[Reconciler] Fila ${i + 2} del Excel (fila real ${i + 2}) ` +
        `no tiene valor en columna "${columnaIdExcel}". Se omite.`,
      );
      continue;
    }

    if (excelIndex.has(id)) {
      console.warn(
        `[Reconciler] ID duplicado en Excel: "${id}" en fila ${i + 2}. ` +
        `Se usará el primer registro encontrado.`,
      );
      continue;
    }

    excelIndex.set(id, {
      domainRecord: mapExcelRowToDomain(normalizedRow),
      rowIndex: i + 2, // +2: fila real en Excel (1 headers + 1-indexed)
      rawRow: normalizedRow,
    });
  }

  // -------------------------------------------------------------------------
  // PASO 2: Normalizar transacciones de n8n y construir índice por ID
  // -------------------------------------------------------------------------
  const n8nIndex = new Map(); // Map<id, domainRecord>

  for (const txn of n8nTransactions) {
    if (n8nIndex.has(txn.id)) {
      console.warn(
        `[Reconciler] ID duplicado en payload n8n: "${txn.id}". ` +
        `Se usará la primera ocurrencia.`,
      );
      continue;
    }
    n8nIndex.set(txn.id, mapN8nTransactionToDomain(txn));
  }

  // -------------------------------------------------------------------------
  // PASO 3: Clasificar transacciones
  // -------------------------------------------------------------------------
  const resultados = [];
  const timestamp = new Date().toISOString();

  // Universo de IDs: unión de ambos conjuntos
  const allIds = new Set([...n8nIndex.keys(), ...excelIndex.keys()]);

  for (const id of allIds) {
    const n8nRecord = n8nIndex.get(id) ?? null;
    const excelEntry = excelIndex.get(id) ?? null;

    /** @type {ReconciliationRecord} */
    const record = {
      id,
      status: null,
      transaccionN8n: n8nRecord
        ? { ...n8nRecord, valorNeto: formatDecimal(n8nRecord.valorNeto) }
        : null,
      registroExcel: excelEntry?.rawRow ?? null,
      excelRowIndex: excelEntry?.rowIndex ?? null,
      discrepancias: [],
      tieneCritico: false,
      timestamp,
    };

    if (n8nRecord && excelEntry) {
      // Transacción existe en AMBAS fuentes → comparar campo a campo
      const discrepancias = compareRecords(
        n8nRecord,
        excelEntry.domainRecord,
        toleranciaCOP,
      );

      if (discrepancias.length === 0) {
        record.status = ReconciliationStatus.COINCIDE;
      } else {
        record.status = ReconciliationStatus.DISCREPANCIA;
        record.discrepancias = discrepancias;
        record.tieneCritico = discrepancias.some((d) => d.esCritico);
      }
    } else if (n8nRecord && !excelEntry) {
      // Transacción en n8n pero NO en Excel → transacción nueva/faltante
      record.status = ReconciliationStatus.SOLO_EN_N8N;
    } else {
      // Transacción en Excel pero NO en n8n → posible registro huérfano
      record.status = ReconciliationStatus.SOLO_EN_EXCEL;
    }

    resultados.push(record);
  }

  // -------------------------------------------------------------------------
  // PASO 4: Calcular métricas de resumen
  // -------------------------------------------------------------------------
  const metricasN8n = calcularMetricasPortafolio(
    [...n8nIndex.values()],
  );
  const metricasExcel = calcularMetricasPortafolio(
    [...excelIndex.values()].map((e) => e.domainRecord),
  );

  // -------------------------------------------------------------------------
  // PASO 5: Construir el reporte final
  // -------------------------------------------------------------------------
  const countByStatus = resultados.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const resumen = {
    // Estadísticas generales
    totalIdsAnalizados: allIds.size,
    coincidencias: countByStatus[ReconciliationStatus.COINCIDE] ?? 0,
    discrepancias: countByStatus[ReconciliationStatus.DISCREPANCIA] ?? 0,
    soloEnN8n: countByStatus[ReconciliationStatus.SOLO_EN_N8N] ?? 0,
    soloEnExcel: countByStatus[ReconciliationStatus.SOLO_EN_EXCEL] ?? 0,
    conDiscrepanciaCritica: resultados.filter((r) => r.tieneCritico).length,

    // Tasas de conciliación (KPIs para el dashboard)
    tasaConciliacion: allIds.size > 0
      ? (
        ((countByStatus[ReconciliationStatus.COINCIDE] ?? 0) / allIds.size) * 100
      ).toFixed(2) + '%'
      : '0.00%',

    // Métricas financieras comparativas
    metricasN8n,
    metricasExcel,

    // Diferencia en valor neto total (indicador de integridad)
    diferenciaNeta: formatDecimal(
      new Decimal(metricasN8n.valorNetoTotalCOP)
        .minus(new Decimal(metricasExcel.valorNetoTotalCOP)),
    ),

    // Timestamps del proceso
    iniciadoEn: startedAt,
    finalizadoEn: new Date().toISOString(),
    toleranciaAplicadaCOP: toleranciaCOP,
  };

  console.log(
    `[Reconciler] Conciliación completada. ` +
    `Coincidencias: ${resumen.coincidencias} | ` +
    `Discrepancias: ${resumen.discrepancias} | ` +
    `Solo n8n: ${resumen.soloEnN8n} | ` +
    `Solo Excel: ${resumen.soloEnExcel} | ` +
    `Tasa: ${resumen.tasaConciliacion}`,
  );

  return {
    exitoso: true,
    resumen,
    resultados,
    // Sólo los registros con discrepancias para facilitar acción en n8n
    accionRequerida: resultados.filter(
      (r) =>
        r.status === ReconciliationStatus.DISCREPANCIA ||
        r.status === ReconciliationStatus.SOLO_EN_N8N,
    ),
  };
}
