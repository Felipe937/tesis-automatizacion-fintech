/**
 * @fileoverview Tests unitarios para el motor de conciliación financiera.
 * Usa el test runner nativo de Node.js (v20+, sin dependencias externas).
 *
 * Ejecución: node --test src/__tests__/reconciler.test.js
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcile,
  normalizeExcelRow,
  mapExcelRowToDomain,
  ReconciliationStatus,
} from '../reconciler.js';

// ---------------------------------------------------------------------------
// Helpers de fixtures para los tests
// ---------------------------------------------------------------------------

/** Headers del Excel tal como los devuelve Graph API */
const EXCEL_HEADERS = [
  'ID_Transaccion', 'Fecha', 'Ticker', 'Tipo_Activo', 'Operacion',
  'Cantidad', 'Precio_Unitario', 'Valor_Bruto', 'Comisiones', 'Impuestos',
  'Valor_Neto', 'Moneda', 'Estado', 'Corredor', 'Referencia_Externa', 'Notas',
];

/**
 * Crea una fila de Excel en el formato de array que devuelve Graph API.
 * Usa los headers como mapa de posiciones.
 */
function makeExcelRow(overrides = {}) {
  const defaults = {
    ID_Transaccion: 'TXN-001',
    Fecha: '2026-09-28',
    Ticker: 'PFBCOLOM',
    Tipo_Activo: 'ACCION',
    Operacion: 'COMPRA',
    Cantidad: 500,
    Precio_Unitario: 38500,
    Valor_Bruto: 19250000,
    Comisiones: 57750,
    Impuestos: 77000,
    Valor_Neto: -19384750,
    Moneda: 'COP',
    Estado: 'EJECUTADA',
    Corredor: 'Valores Bancolombia',
    Referencia_Externa: 'ORD-BC-20260928-77412',
    Notas: '',
  };
  const row = { ...defaults, ...overrides };
  return EXCEL_HEADERS.map((h) => row[h] ?? null);
}

/** Crea una transacción de n8n válida */
function makeN8nTransaction(overrides = {}) {
  return {
    id: 'TXN-001',
    fecha: '2026-09-28',
    ticker: 'PFBCOLOM',
    tipoActivo: 'ACCION',
    operacion: 'COMPRA',
    cantidad: 500,
    precioUnitario: 38500.00,
    valorBruto: 19250000.00,
    comisiones: 57750.00,
    impuestos: 77000.00,
    valorNeto: -19384750.00,
    moneda: 'COP',
    tasaCambio: 1,
    corredor: 'Valores Bancolombia',
    estado: 'EJECUTADA',
    referenciaExterna: 'ORD-BC-20260928-77412',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests de normalización de filas Excel
// ---------------------------------------------------------------------------

describe('normalizeExcelRow', () => {
  it('convierte array de celdas a objeto usando headers como clave', () => {
    const row = makeExcelRow();
    const result = normalizeExcelRow(EXCEL_HEADERS, row);

    assert.equal(result['ID_Transaccion'], 'TXN-001');
    assert.equal(result['Ticker'], 'PFBCOLOM');
    assert.equal(result['Cantidad'], 500);
  });

  it('convierte serial de Excel a fecha ISO para columnas con "fecha"', () => {
    // 46100 = aprox 2026-03-01 en serial Excel
    const row = makeExcelRow({ Fecha: 46100 });
    const result = normalizeExcelRow(EXCEL_HEADERS, row);

    // Debe ser una cadena de fecha ISO (YYYY-MM-DD)
    assert.match(result['Fecha'], /^\d{4}-\d{2}-\d{2}$/);
  });

  it('normaliza strings a mayúsculas para campos clave (Ticker, Estado)', () => {
    const row = makeExcelRow({ Ticker: 'pfbcolom', Estado: 'ejecutada' });
    const result = normalizeExcelRow(EXCEL_HEADERS, row);

    assert.equal(result['Ticker'], 'PFBCOLOM');
    assert.equal(result['Estado'], 'EJECUTADA');
  });

  it('retorna null para celdas vacías', () => {
    const row = makeExcelRow({ Notas: null });
    const result = normalizeExcelRow(EXCEL_HEADERS, row);
    assert.equal(result['Notas'], null);
  });
});

// ---------------------------------------------------------------------------
// Tests del motor de conciliación — casos principales
// ---------------------------------------------------------------------------

describe('reconcile — COINCIDE', () => {
  it('clasifica como COINCIDE cuando n8n y Excel son iguales', () => {
    const n8nTxns = [makeN8nTransaction()];
    const excelRows = [makeExcelRow()];

    const result = reconcile(n8nTxns, EXCEL_HEADERS, excelRows, {
      toleranciaCOP: 1,
      columnaIdExcel: 'ID_Transaccion',
    });

    assert.equal(result.exitoso, true);
    assert.equal(result.resumen.coincidencias, 1);
    assert.equal(result.resumen.discrepancias, 0);
    assert.equal(result.resultados[0].status, ReconciliationStatus.COINCIDE);
  });

  it('clasifica como COINCIDE con diferencia dentro de la tolerancia (0.50 COP)', () => {
    const n8nTxns = [makeN8nTransaction({ valorNeto: -19384750.00 })];
    const excelRows = [makeExcelRow({ Valor_Neto: -19384750.50 })]; // 0.50 COP de diferencia

    const result = reconcile(n8nTxns, EXCEL_HEADERS, excelRows, {
      toleranciaCOP: 1,
      columnaIdExcel: 'ID_Transaccion',
    });

    assert.equal(result.resumen.coincidencias, 1);
    assert.equal(result.resultados[0].status, ReconciliationStatus.COINCIDE);
  });
});

describe('reconcile — DISCREPANCIA', () => {
  it('detecta discrepancia en valorNeto fuera de tolerancia', () => {
    const n8nTxns = [makeN8nTransaction({ valorNeto: -19384750.00 })];
    const excelRows = [makeExcelRow({ Valor_Neto: -19000000.00 })]; // Diferencia de $384,750 COP

    const result = reconcile(n8nTxns, EXCEL_HEADERS, excelRows, {
      toleranciaCOP: 1,
      columnaIdExcel: 'ID_Transaccion',
    });

    assert.equal(result.resumen.discrepancias, 1);
    assert.equal(result.resultados[0].status, ReconciliationStatus.DISCREPANCIA);

    const discrepancia = result.resultados[0].discrepancias.find(
      (d) => d.campo === 'valorNeto',
    );
    assert.ok(discrepancia, 'Debe existir discrepancia en campo valorNeto');
    assert.equal(discrepancia.esCritico, true);
  });

  it('detecta discrepancia en campo de texto (ticker distinto)', () => {
    const n8nTxns = [makeN8nTransaction({ ticker: 'PFBCOLOM' })];
    const excelRows = [makeExcelRow({ Ticker: 'BCOLOMBIA' })]; // Ticker diferente

    const result = reconcile(n8nTxns, EXCEL_HEADERS, excelRows, {
      toleranciaCOP: 1,
      columnaIdExcel: 'ID_Transaccion',
    });

    const discrepancia = result.resultados[0].discrepancias.find(
      (d) => d.campo === 'ticker',
    );
    assert.ok(discrepancia);
    assert.equal(discrepancia.valorN8n, 'PFBCOLOM');
    assert.equal(discrepancia.esCritico, true);
  });

  it('marca tieneCritico=true cuando hay un campo crítico con discrepancia', () => {
    // 'operacion' es un campo crítico
    const n8nTxns = [makeN8nTransaction({ operacion: 'COMPRA' })];
    const excelRows = [makeExcelRow({ Operacion: 'VENTA' })];

    const result = reconcile(n8nTxns, EXCEL_HEADERS, excelRows, {
      toleranciaCOP: 1,
      columnaIdExcel: 'ID_Transaccion',
    });

    assert.equal(result.resultados[0].tieneCritico, true);
  });
});

describe('reconcile — SOLO_EN_N8N', () => {
  it('clasifica como SOLO_EN_N8N cuando la transacción no existe en Excel', () => {
    const n8nTxns = [makeN8nTransaction({ id: 'TXN-NUEVA-999' })];
    const excelRows = [makeExcelRow({ ID_Transaccion: 'TXN-OTRA' })]; // ID distinto

    const result = reconcile(n8nTxns, EXCEL_HEADERS, excelRows, {
      toleranciaCOP: 1,
      columnaIdExcel: 'ID_Transaccion',
    });

    const nuevaRecord = result.resultados.find((r) => r.id === 'TXN-NUEVA-999');
    assert.ok(nuevaRecord);
    assert.equal(nuevaRecord.status, ReconciliationStatus.SOLO_EN_N8N);
    assert.equal(result.resumen.soloEnN8n, 1);
  });
});

describe('reconcile — SOLO_EN_EXCEL', () => {
  it('clasifica como SOLO_EN_EXCEL cuando la transacción existe en Excel pero no en n8n', () => {
    const n8nTxns = []; // Payload vacío desde n8n (aunque Zod lo rechazaría, lo probamos internamente)
    const excelRows = [makeExcelRow({ ID_Transaccion: 'TXN-HUERFANA-001' })];

    const result = reconcile(n8nTxns, EXCEL_HEADERS, excelRows, {
      toleranciaCOP: 1,
      columnaIdExcel: 'ID_Transaccion',
    });

    const huerfana = result.resultados.find((r) => r.id === 'TXN-HUERFANA-001');
    assert.ok(huerfana);
    assert.equal(huerfana.status, ReconciliationStatus.SOLO_EN_EXCEL);
    assert.equal(result.resumen.soloEnExcel, 1);
  });
});

describe('reconcile — métricas del portafolio', () => {
  it('calcula correctamente el total de compras y la tasa de conciliación', () => {
    const n8nTxns = [
      makeN8nTransaction({ id: 'TXN-001', operacion: 'COMPRA', valorNeto: -19384750 }),
      makeN8nTransaction({ id: 'TXN-002', operacion: 'VENTA', valorNeto: 3018720, ticker: 'ISA' }),
    ];
    const excelRows = [
      makeExcelRow({ ID_Transaccion: 'TXN-001' }),
      makeExcelRow({ ID_Transaccion: 'TXN-002', Ticker: 'ISA', Operacion: 'VENTA',
        Valor_Neto: 3018720 }),
    ];

    const result = reconcile(n8nTxns, EXCEL_HEADERS, excelRows, {
      toleranciaCOP: 1,
      columnaIdExcel: 'ID_Transaccion',
    });

    // Tasa de conciliación: 2/2 = 100%
    assert.equal(result.resumen.tasaConciliacion, '100.00%');
    assert.ok(
      parseFloat(result.resumen.metricasN8n.totalComprasCOP) > 0,
      'totalCompras debe ser positivo',
    );
  });
});

describe('reconcile — IDs duplicados', () => {
  it('usa sólo la primera ocurrencia cuando hay IDs duplicados en Excel', () => {
    const n8nTxns = [makeN8nTransaction({ valorNeto: -19384750 })];
    // Dos filas con el mismo ID en Excel
    const excelRows = [
      makeExcelRow({ Valor_Neto: -19384750 }),   // Primera — coincide
      makeExcelRow({ Valor_Neto: -99999999 }),   // Segunda — diferente pero se ignora
    ];

    const result = reconcile(n8nTxns, EXCEL_HEADERS, excelRows, {
      toleranciaCOP: 1,
      columnaIdExcel: 'ID_Transaccion',
    });

    // Debe coincidir con la primera fila (no la duplicada)
    assert.equal(result.resumen.coincidencias, 1);
    assert.equal(result.resumen.discrepancias, 0);
  });
});
