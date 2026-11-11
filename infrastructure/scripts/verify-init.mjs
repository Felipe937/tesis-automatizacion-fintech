/**
 * @fileoverview Verificación de la inicialización del esquema de PostgreSQL.
 *
 * Levanta un contenedor efímero de PostgreSQL 16 (la versión declarada en
 * docker-compose.yml), aplica `init.sql` DOS veces para comprobar que es
 * idempotente, y valida:
 *   - que las seis entidades del MER existen con sus restricciones;
 *   - que los ENUMs tienen los valores esperados;
 *   - que los índices se crean;
 *   - que las tablas internas de n8n no sonaffected por el script;
 *   - que una segunda ejecución no destruye datos.
 *
 * Uso:  node infrastructure/scripts/verify-init.mjs
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const aqui = dirname(fileURLToPath(import.meta.url));
const INIT_SQL = join(aqui, '..', 'config', 'postgres', 'init.sql');
const CONTENEDOR = 'tesis-verify-init';
const PUERTO = 55432;
const USUARIO = 'n8n_user';
const BASE = 'n8n_fintech';
const PASSWORD = 'clave-de-verificacion-temporal';

/**
 * Ejecuta un comando y devuelve su salida.
 * @param {string} comando - Comando a ejecutar
 * @param {string[]} args - Argumentos
 * @param {object} [opciones] - Opciones de child_process (p.ej. {input})
 * @returns {string} Salida estándar
 */
function ejecutar(comando, args, opciones = {}) {
  return execFileSync(comando, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opciones,
  });
}

/**
 * Ejecuta una consulta SQL dentro del contenedor y devuelve la salida.
 * @param {string} sql - Consulta SQL
 * @returns {string} Salida de la consulta
 */
function consultar(sql) {
  return ejecutar(
    'docker',
    [
      'exec',
      '-e',
      `PGPASSWORD=${PASSWORD}`,
      CONTENEDOR,
      'psql',
      '-U',
      USUARIO,
      '-d',
      BASE,
      '-t',
      '-A',
      '-c',
      sql,
    ],
  ).trim();
}

/**
 * Aplica un archivo SQL dentro del contenedor con ON_ERROR_STOP.
 * @param {string} sql - Contenido SQL
 * @returns {void}
 */
function aplicarSql(sql) {
  ejecutar(
    'docker',
    [
      'exec',
      '-e',
      `PGPASSWORD=${PASSWORD}`,
      '-i',
      CONTENEDOR,
      'psql',
      '-U',
      USUARIO,
      '-d',
      BASE,
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: sql },
  );
}

let fallos = 0;

/**
 * Comprueba una condición y registra el resultado.
 * @param {string} descripcion - Descripción de la comprobación
 * @param {boolean} condicion - Resultado esperado
 * @param {string} [detalle] - Detalle adicional
 */
function comprobar(descripcion, condicion, detalle = '') {
  if (condicion) {
    console.log(`  OK    ${descripcion}`);
  } else {
    console.error(`  FALLA ${descripcion} ${detalle}`);
    fallos += 1;
  }
}

console.log('== Verificación de init.sql sobre PostgreSQL 16 (contenedor efímero) ==');

ejecutar('docker', ['rm', '-f', CONTENEDOR]);
ejecutar('docker', [
  'run',
  '-d',
  '--name',
  CONTENEDOR,
  '-e',
  `POSTGRES_USER=${USUARIO}`,
  '-e',
  `POSTGRES_PASSWORD=${PASSWORD}`,
  '-e',
  `POSTGRES_DB=${BASE}`,
  '-p',
  `${PUERTO}:5432`,
  'postgres:16-alpine',
]);

// Espera a que PostgreSQL acepte conexiones.
let listo = false;
for (let i = 0; i < 60 && !listo; i += 1) {
  try {
    consultar('SELECT 1');
    listo = true;
  } catch {
    try {
      ejecutar('docker', ['logs', CONTENEDOR]);
    } catch {
      // El contenedor puede no tener logs todavía.
    }
  }
}

if (!listo) {
  console.error('No se pudo iniciar el contenedor de PostgreSQL para la verificación.');
  ejecutar('docker', ['rm', '-f', CONTENEDOR]);
  process.exit(1);
}

try {
  const sql = readFileSync(INIT_SQL, 'utf8');

  console.log('\n-- Primera aplicación de init.sql --');
  aplicarSql(sql);
  console.log('  (aplicado sin errores)');

  console.log('\n-- Comprobaciones del esquema --');

  const tablas = consultar(
    "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public'",
  );
  comprobar(
    'se crean las seis entidades del MER',
    ['lead', 'campaign', 'appointment', 'investment', 'automation_log', 'campaign_lead'].every((t) =>
      tablas.split(',').includes(t),
    ),
    `-> ${tablas}`,
  );

  const enums = consultar(
    "SELECT string_agg(typname, ',' ORDER BY typname) FROM pg_type WHERE typtype='e' AND typnamespace='public'::regnamespace",
  );
  comprobar(
    'se crean los cinco tipos ENUM del MER',
    ['lead_estado', 'campaign_estado', 'appointment_estado', 'investment_estado', 'log_estado'].every((e) =>
      enums.split(',').includes(e),
    ),
    `-> ${enums}`,
  );

  const valores = consultar(
    "SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname='lead_estado'",
  );
  comprobar(
    'lead_estado tiene los seis estados del MER',
    valores === 'nuevo,prospecto,cita_pendiente,cita_confirmada,cliente,inactivo',
    `-> ${valores}`,
  );

  const indices = consultar(
    "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'idx_%'",
  );
  comprobar('se crean los índices del esquema', Number(indices) >= 12, `-> ${indices} índices`);

  const fk = consultar(
    "SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace",
  );
  comprobar(
    'se crean las claves foráneas del MER',
    Number(fk) === 4,
    `-> ${fk} claves foráneas (appointment, investment, campaign_lead×2)`,
  );

  const uniques = consultar(
    "SELECT count(*) FROM pg_constraint WHERE contype='u' AND connamespace='public'::regnamespace",
  );
  comprobar(
    'se crean las restricciones UNIQUE',
    Number(uniques) >= 3,
    `-> ${uniques} (correo_electronico, id_hubspot, id_mailchimp)`,
  );

  const timezone = consultar('SHOW timezone');
  comprobar('la base de datos usa America/Bogota', timezone === 'America/Bogota', `-> ${timezone}`);

  const migraciones = consultar('SELECT version FROM schema_migrations ORDER BY version');
  comprobar(
    'se registra la migración en schema_migrations',
    migraciones.includes('001_init_mer'),
    `-> ${migraciones}`,
  );

  console.log('\n-- Datos de prueba y reejecución (idempotencia) --');
  consultar(
    "INSERT INTO lead (nombre, correo_electronico, estado) VALUES ('Prueba Persistencia', 'persistencia@ejemplo.co', 'nuevo')",
  );
  const antes = consultar('SELECT count(*) FROM lead');

  aplicarSql(sql);

  const despues = consultar('SELECT count(*) FROM lead');
  comprobar(
    'la segunda ejecución de init.sql no borra datos',
    antes === despues && Number(despues) === 1,
    `-> antes=${antes} después=${despues}`,
  );

  const enumsFinales = consultar(
    "SELECT count(*) FROM pg_type WHERE typtype='e' AND typnamespace='public'::regnamespace",
  );
  comprobar(
    'la segunda ejecución no duplica los ENUMs',
    Number(enumsFinales) === 5,
    `-> ${enumsFinales}`,
  );

  console.log('\n-- Tablas internas de n8n --');
  const n8n = consultar(
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('workflow_entity','credentials_entity','execution_entity')",
  );
  comprobar(
    'init.sql no crea tablas internas de n8n',
    Number(n8n) === 0,
    `-> ${n8n} tablas internas presentes (0 = correcto)`,
  );
} finally {
  ejecutar('docker', ['rm', '-f', CONTENEDOR]);
}

console.log('');
if (fallos === 0) {
  console.log('RESULTADO: todas las comprobaciones de init.sql pasaron.');
  process.exit(0);
} else {
  console.error(`RESULTADO: ${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
