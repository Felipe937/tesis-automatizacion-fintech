/**
 * @fileoverview Fuente de datos real del componente de métricas.
 *
 * Lee las ejecuciones registradas en `automation_log` (PostgreSQL) para el
 * periodo y workflow solicitados. Esta es la única vía por la que el
 * componente puede producir indicadores EMPÍRICOS: cualquier otro modo se
 * marca explícitamente como sintético.
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
 * Construye la configuración del pool de PostgreSQL a partir de la
 * configuración explícita y de las variables de entorno.
 *
 * Prioridad: `connectionString` > variables de entorno POSTGRES_*.
 *
 * @param {object} [config] - Configuración opcional (esquema PostgresConfigSchema)
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
        'Define la variable de entorno o provide la cadena de conexión.',
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
 * @param {object} [poolFactory] - Fábrica de pools inyectable (para pruebas)
 * @returns {object} Pool de conexiones
 * @throws {PostgresSourceError} Si la configuración es inválida
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
 * Consulta las ejecuciones de `automation_log` para un periodo y workflow.
 *
 * SQL parametrizado ($1, $2, $3): no hay interpolación de strings, por lo que
 * no existe riesgo de inyección SQL desde n8n.
 *
 * @param {object} params - Parámetros de la consulta
 * @param {object} params.pool - Pool de PostgreSQL
 * @param {string} params.schema - Schema de las tablas de negocio
 * @param {string} params.periodoInicio - Inicio del periodo (ISO 8601)
 * @param {string} params.periodoFin - Fin del periodo (ISO 8601)
 * @param {string} [params.workflowId] - Filtro por workflow (opcional)
 * @returns {Promise<Array<object>>} Ejecuciones normalizadas
 * @throws {PostgresSourceError} Si la consulta falla
 */
export async function consultarEjecutions({ pool, schema = 'public', periodoInicio, periodoFin, workflowId = null }) {
  // El valor centinela 'todos' significa "sin filtro por workflow".
  const filtro = workflowId && workflowId !== 'todos' ? workflowId : null;

  const consulta = `
    SELECT workflow_id,
           timestamp_inicio,
           timestamp_fin,
           estado,
           registros_procesados,
           latencia_ms
      FROM "${schema}".automation_log
     WHERE timestamp_inicio >= $1
       AND timestamp_inicio <= $2
       AND ($3::text IS NULL OR workflow_id = $3)
     ORDER BY timestamp_inicio ASC
  `;

  let resultado;
  try {
    resultado = await pool.query(consulta, [periodoInicio, periodoFin, filtro]);
  } catch (error) {
    throw new PostgresSourceError(
      `No se pudo consultar automation_log en el periodo ${periodoInicio} – ${periodoFin}: ${error.message}`,
      error,
    );
  }

  return (resultado?.rows ?? []).map((fila) => ({
    workflow_id: fila.workflow_id,
    timestamp_inicio:
      fila.timestamp_inicio instanceof Date
        ? fila.timestamp_inicio.toISOString()
        : fila.timestamp_inicio ?? null,
    timestamp_fin:
      fila.timestamp_fin instanceof Date ? fila.timestamp_fin.toISOString() : fila.timestamp_fin ?? null,
    estado: fila.estado,
    registros_procesados: Number(fila.registros_procesados ?? 0),
    latencia_ms:
      fila.latencia_ms === null || fila.latencia_ms === undefined
        ? null
        : Number(fila.latencia_ms),
  }));
}

/**
 * Libera los recursos del pool (cierre ordenado).
 * @param {object} pool - Pool de PostgreSQL
 * @returns {Promise<void>}
 */
export async function cerrarPool(pool) {
  if (pool && typeof pool.end === 'function') {
    await pool.end();
  }
}
