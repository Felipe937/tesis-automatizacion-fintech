/**
 * @fileoverview Fuente de datos real del dashboard ejecutivo.
 *
 * Lee de PostgreSQL las entidades del MER que alimentan los cuatro bloques
 * del dashboard (§4.4 de la tesis):
 *
 *   lead            → Bloque a (leads por etapa del ciclo comercial)
 *   appointment     → Bloque c (citas de la semana)
 *   campaign        → Bloque b (campañas de Mailchimp)
 *   campaign_lead   → Bloque b (suscriptores por campaña)
 *   investment      → Bloque d (resumen financiero)
 *   automation_log  → Trazabilidad de automatizaciones del periodo
 *
 * Todas las consultas usan parámetros ($1, $2, …): no hay interpolación de
 * strings, por lo que no existe riesgo de inyección SQL.
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import pg from 'pg';

const { Pool } = pg;

/**
 * Error de acceso a PostgreSQL (conexión, credenciales o consulta).
 */
export class PostgresSourceError extends Error {
  /**
   * @param {string} message - Descripción del error
   * @param {Error} [cause] - Error original
   */
  constructor(message, cause = null) {
    super(message);
    this.name = 'PostgresSourceError';
    this.cause = cause;
  }
}

/**
 * Construye la configuración del pool de PostgreSQL.
 *
 * Prioridad: `connectionString` > variables de entorno POSTGRES_*.
 *
 * @param {object} [config] - Configuración opcional
 * @returns {object} Configuración lista para `pg.Pool`
 * @throws {PostgresSourceError} Si falta la configuración mínima
 */
export function construirConfigPool(config = {}) {
  const env = process.env;

  if (config.connectionString) {
    return { connectionString: config.connectionString };
  }

  const host = config.host ?? env.POSTGRES_HOST;
  const database = config.database ?? env.POSTGRES_DB;
  const user = config.user ?? env.POSTGRES_USER;
  const password = config.password ?? env.POSTGRES_PASSWORD;

  const faltantes = [];
  if (!host) faltantes.push('POSTGRES_HOST');
  if (!database) faltantes.push('POSTGRES_DB');
  if (!user) faltantes.push('POSTGRES_USER');
  if (!password) faltantes.push('POSTGRES_PASSWORD');

  if (faltantes.length > 0) {
    throw new PostgresSourceError(
      `Configuración incompleta de PostgreSQL: faltan ${faltantes.join(', ')}. ` +
        'Define la variable de entorno o provee la cadena de conexión.',
    );
  }

  return {
    host,
    port: Number(config.port ?? env.POSTGRES_PORT ?? 5432),
    database,
    user,
    password,
    ssl: env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}

/**
 * Crea un pool de conexiones a PostgreSQL.
 *
 * @param {object} [config] - Configuración opcional
 * @param {Function} [poolFactory] - Fábrica de pools inyectable (para pruebas)
 * @returns {object} Pool de PostgreSQL
 */
export function crearPool(config = {}, poolFactory = null) {
  const poolConfig = construirConfigPool(config);

  if (poolFactory) {
    return poolFactory(poolConfig);
  }

  return new Pool({
    ...poolConfig,
    max: Number(process.env.POSTGRES_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * Ejecuta una consulta parametrizada y devuelve sus filas.
 * @private
 */
async function consultar(pool, sql, parametros) {
  try {
    const resultado = await pool.query(sql, parametros);
    return resultado?.rows ?? [];
  } catch (error) {
    throw new PostgresSourceError(`Fallo la consulta a PostgreSQL: ${error.message}`, error);
  }
}

/**
 * Consulta los seis conjuntos de datos del MER para el dashboard.
 *
 * @param {object} params - Parámetros
 * @param {object} params.pool - Pool de PostgreSQL
 * @param {string} [params.schema='public'] - Schema de las tablas de negocio
 * @param {string} params.periodoInicio - Inicio del periodo (ISO 8601)
 * @param {string} params.periodoFin - Fin del periodo (ISO 8601)
 * @returns {Promise<object>} Datos del dashboard listos para el cálculo
 * @throws {PostgresSourceError} Si alguna consulta falla
 */
export async function consultarDatosDashboard({
  pool,
  schema = 'public',
  periodoInicio,
  periodoFin,
}) {
  // --- Bloque a: leads captados en el periodo -----------------------------
  const leads = await consultar(
    pool,
    `SELECT id_lead, nombre, estado, fecha_registro, fecha_ultima_actualizacion
       FROM "${schema}".lead
      WHERE fecha_registro >= $1 AND fecha_registro <= $2
      ORDER BY id_lead`,
    [periodoInicio, periodoFin],
  );

  // --- Bloque c: citas agendadas en el periodo ---------------------------
  const citas = await consultar(
    pool,
    `SELECT a.id_appointment,
            a.id_lead,
            l.nombre AS nombre_lead,
            a.fecha_hora_inicio,
            a.fecha_hora_fin,
            a.enlace_calendly,
            a.estado
       FROM "${schema}".appointment a
       LEFT JOIN "${schema}".lead l ON l.id_lead = a.id_lead
      WHERE a.fecha_hora_inicio >= $1 AND a.fecha_hora_inicio <= $2
      ORDER BY a.fecha_hora_inicio`,
    [periodoInicio, periodoFin],
  );

  // --- Bloque b: campañas y suscriptores (campaign + campaign_lead) -----
  const campanas = await consultar(
    pool,
    `SELECT c.id_campaign, c.nombre, c.estado, c.id_mailchimp,
            COUNT(cl.id_lead)::int AS suscriptores
       FROM "${schema}".campaign c
       LEFT JOIN "${schema}".campaign_lead cl ON cl.id_campaign = c.id_campaign
      GROUP BY c.id_campaign, c.nombre, c.estado, c.id_mailchimp
      ORDER BY c.id_campaign`,
    [],
  );

  // --- Bloque d: inversiones (histórico completo para el resumen) ------
  const inversiones = await consultar(
    pool,
    `SELECT id_investment, id_lead, monto, tipo_instrumento, fecha_registro, estado
       FROM "${schema}".investment
      ORDER BY fecha_registro`,
    [],
  );

  // --- Trazabilidad: ejecuciones del periodo (automation_log) -----------
  const ejecuciones = await consultar(
    pool,
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE estado = 'exito')::int AS exitos,
            COUNT(*) FILTER (WHERE estado = 'error')::int AS errores,
            COUNT(*) FILTER (WHERE estado = 'advertencia')::int AS advertencias,
            COALESCE(SUM(registros_procesados), 0)::int AS registros_procesados,
            AVG(latencia_ms)::numeric AS latencia_media_ms
       FROM "${schema}".automation_log
      WHERE timestamp_inicio >= $1 AND timestamp_inicio <= $2`,
    [periodoInicio, periodoFin],
  );

  // --- Monitoreo de integraciones: última ejecución por workflow -------
  const ultimasEjecuciones = await consultar(
    pool,
    `SELECT DISTINCT ON (workflow_id)
            workflow_id,
            timestamp_inicio,
            estado
       FROM "${schema}".automation_log
      WHERE timestamp_inicio >= $1 AND timestamp_inicio <= $2
      ORDER BY workflow_id, timestamp_inicio DESC`,
    [periodoInicio, periodoFin],
  );

  return {
    leads: leads.map((fila) => ({
      id_lead: Number(fila.id_lead),
      estado: fila.estado,
      fecha_registro: aIso(fila.fecha_registro),
    })),
    campanas: campanas.map((fila) => ({
      id_campaign: Number(fila.id_campaign),
      nombre: fila.nombre,
      estado: fila.estado,
      id_mailchimp: fila.id_mailchimp ?? null,
      suscriptores: Number(fila.suscriptores ?? 0),
    })),
    citas: citas.map((fila) => ({
      id_appointment: Number(fila.id_appointment),
      id_lead: Number(fila.id_lead),
      nombreLead: fila.nombre_lead ?? '(sin nombre)',
      fecha_hora_inicio: aIso(fila.fecha_hora_inicio),
      fecha_hora_fin: aIso(fila.fecha_hora_fin),
      enlace_calendly: fila.enlace_calendly ?? null,
      estado: fila.estado,
    })),
    inversiones: inversiones.map((fila) => ({
      id_investment: Number(fila.id_investment),
      monto: Number(fila.monto ?? 0),
      estado: fila.estado,
      fecha_registro: aIso(fila.fecha_registro),
    })),
    ejecuciones: ultimasEjecuciones.map((fila) => ({
      workflow_id: fila.workflow_id,
      timestamp_inicio: aIso(fila.timestamp_inicio),
      estado: fila.estado,
    })),
    resumenAutomatizaciones: ejecuciones[0]
      ? {
          totalEjecuciones: Number(ejecuciones[0].total ?? 0),
          ejecucionesExitosas: Number(ejecuciones[0].exitos ?? 0),
          ejecucionesConError: Number(ejecuciones[0].errores ?? 0),
          ejecucionesConAdvertencia: Number(ejecuciones[0].advertencias ?? 0),
          registrosProcesados: Number(ejecuciones[0].registros_procesados ?? 0),
          latenciaMediaMs:
            ejecuciones[0].latencia_media_ms === null ||
            ejecuciones[0].latencia_media_ms === undefined
              ? null
              : Number(ejecuciones[0].latencia_media_ms),
        }
      : {
          totalEjecuciones: 0,
          ejecucionesExitosas: 0,
          ejecucionesConError: 0,
          ejecucionesConAdvertencia: 0,
          registrosProcesados: 0,
          latenciaMediaMs: null,
        },
  };
}

/**
 * Normaliza un valor temporal de PostgreSQL a ISO 8601.
 * @private
 * @param {Date|string|null} valor - Valor de la base de datos
 * @returns {string|null} Cadena ISO 8601 o null
 */
function aIso(valor) {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

/**
 * Libera los recursos del pool.
 * @param {object} pool - Pool de PostgreSQL
 * @returns {Promise<void>}
 */
export async function cerrarPool(pool) {
  if (pool && typeof pool.end === 'function') {
    await pool.end();
  }
}
