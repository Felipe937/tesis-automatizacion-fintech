/**
 * @fileoverview Esquemas de validación Zod para payloads entrantes de n8n
 * y para las filas crudas leídas desde Excel/OneDrive.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enumeraciones del dominio financiero
// ---------------------------------------------------------------------------

/** Tipos de activo soportados en el portafolio */
export const AssetTypeEnum = z.enum([
  'ACCION',       // Renta variable (bolsa de valores)
  'BONO',         // Renta fija (deuda pública/privada)
  'FIC',          // Fondo de Inversión Colectivo (Colombia)
  'CDT',          // Certificado de Depósito a Término
  'ETF',          // Exchange Traded Fund
  'DIVISA',       // Divisas (forex)
  'CRYPTO',       // Criptoactivos
]);

/** Estados del ciclo de vida de una transacción */
export const TransactionStatusEnum = z.enum([
  'PENDIENTE',
  'EJECUTADA',
  'FALLIDA',
  'CANCELADA',
  'PARCIAL',
]);

// ---------------------------------------------------------------------------
// Schema de cada transacción entrante (desde n8n / CRM / corredor)
// ---------------------------------------------------------------------------

/** Una transacción individual del portafolio de inversión */
export const TransactionSchema = z.object({
  /** Identificador único de la transacción (UUID v4 recomendado) */
  id: z.string().min(1, 'El ID de transacción no puede ser vacío'),

  /** Fecha de la transacción (ISO 8601: YYYY-MM-DD) */
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe tener formato YYYY-MM-DD'),

  /** Ticker o código ISIN del instrumento financiero */
  ticker: z.string().min(1).max(20).toUpperCase(),

  /** Tipo de activo financiero */
  tipoActivo: AssetTypeEnum,

  /** Tipo de operación */
  operacion: z.enum(['COMPRA', 'VENTA', 'DIVIDENDO', 'CUPON', 'REBALANCEO']),

  /** Cantidad de unidades/títulos negociados (siempre positivo) */
  cantidad: z.number().positive('La cantidad debe ser un número positivo'),

  /** Precio unitario en COP (pesos colombianos) */
  precioUnitario: z
    .number()
    .nonnegative('El precio unitario no puede ser negativo'),

  /** Valor total bruto de la transacción en COP (cantidad × precio) */
  valorBruto: z.number().nonnegative(),

  /** Comisiones y costos de transacción en COP */
  comisiones: z.number().nonnegative().default(0),

  /** Impuestos aplicados (GMF 4×1000, retenciones, etc.) en COP */
  impuestos: z.number().nonnegative().default(0),

  /** Valor neto efectivamente debitado/acreditado en COP */
  valorNeto: z.number(),

  /** Moneda de la transacción */
  moneda: z.enum(['COP', 'USD', 'EUR']).default('COP'),

  /** Tasa de cambio aplicada a COP (1 si ya está en COP) */
  tasaCambio: z.number().positive().default(1),

  /** Nombre del corredor o custodia que ejecutó la operación */
  corredor: z.string().min(1),

  /** Estado actual de la transacción */
  estado: TransactionStatusEnum,

  /** Número de cuenta o portafolio asociado */
  numeroCuenta: z.string().optional(),

  /** Referencia externa del corredor (número de orden, etc.) */
  referenciaExterna: z.string().optional(),

  /** Notas adicionales */
  notas: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Schema del payload completo que envía n8n
// ---------------------------------------------------------------------------

/** Metadatos del proceso de automatización n8n */
const N8nMetadataSchema = z.object({
  /** ID del workflow de n8n que generó este payload */
  workflowId: z.string(),
  /** ID de la ejecución específica de n8n */
  executionId: z.string(),
  /** Timestamp de cuándo n8n generó el payload (ISO 8601) */
  timestamp: z.string().datetime(),
  /** Fuente del dato (CRM, corredor, importación manual) */
  fuente: z.enum(['HUBSPOT', 'CORREDOR_API', 'MANUAL', 'CALENDLY', 'EMAIL']),
  /** Versión del schema del payload para compatibilidad hacia adelante */
  schemaVersion: z.string().default('1.0'),
});

/** Configuración del libro de Excel en OneDrive */
const ExcelTargetSchema = z.object({
  /** ID del DriveItem en OneDrive/SharePoint (obtenible via Graph API) */
  driveItemId: z.string().min(1),
  /** Nombre de la hoja de cálculo dentro del libro Excel */
  worksheetName: z.string().min(1).default('Portafolio'),
  /** Nombre de la tabla Excel (Table object) si existe, para filtros más rápidos */
  tableName: z.string().optional(),
});

/**
 * Payload principal recibido desde el orquestador n8n.
 * Este es el contrato de datos entre n8n y este servicio de conciliación.
 */
export const N8nPayloadSchema = z.object({
  /** Metadatos del proceso n8n */
  metadata: N8nMetadataSchema,

  /** Configuración del archivo Excel en OneDrive */
  excelTarget: ExcelTargetSchema,

  /** Array de transacciones a conciliar */
  transacciones: z
    .array(TransactionSchema)
    .min(1, 'El payload debe contener al menos una transacción')
    .max(5000, 'Máximo 5000 transacciones por llamada'),

  /** Configuración de conciliación */
  opciones: z
    .object({
      /** Tolerancia para diferencias de valor (en COP). Default: 1 peso */
      toleranciaCOP: z.number().nonnegative().default(1),
      /** Si true, crea filas nuevas en Excel para transacciones no encontradas */
      crearFaltantes: z.boolean().default(false),
      /** Si true, actualiza filas en Excel con discrepancias resueltas */
      actualizarDiscrepancias: z.boolean().default(false),
      /** Columna del Excel que contiene el ID único de transacción */
      columnaIdExcel: z.string().default('ID_Transaccion'),
    })
    .default({}),
});

// ---------------------------------------------------------------------------
// Schema para las filas crudas leídas desde Excel
// ---------------------------------------------------------------------------

/**
 * Fila "cruda" tal como viene del response de Microsoft Graph.
 * Las celdas de Excel pueden venir como string, number o null.
 */
export const ExcelRawRowSchema = z.object({
  ID_Transaccion: z.union([z.string(), z.number()]).nullable(),
  Fecha: z.union([z.string(), z.number()]).nullable(),
  Ticker: z.union([z.string(), z.number()]).nullable(),
  Tipo_Activo: z.union([z.string(), z.number()]).nullable(),
  Operacion: z.union([z.string(), z.number()]).nullable(),
  Cantidad: z.union([z.string(), z.number()]).nullable(),
  Precio_Unitario: z.union([z.string(), z.number()]).nullable(),
  Valor_Bruto: z.union([z.string(), z.number()]).nullable(),
  Comisiones: z.union([z.string(), z.number()]).nullable(),
  Impuestos: z.union([z.string(), z.number()]).nullable(),
  Valor_Neto: z.union([z.string(), z.number()]).nullable(),
  Moneda: z.union([z.string(), z.number()]).nullable(),
  Estado: z.union([z.string(), z.number()]).nullable(),
  Corredor: z.union([z.string(), z.number()]).nullable(),
  Referencia_Externa: z.union([z.string(), z.number()]).nullable(),
  Notas: z.union([z.string(), z.number()]).nullable(),
}).passthrough(); // Permite columnas adicionales en Excel sin fallar
