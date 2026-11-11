#!/usr/bin/env node
/**
 * Lint compartido del proyecto (portable Windows/Linux/macOS).
 *
 * Objetivo: `npm run lint` debe revisar REALMENTE los archivos, no imprimir un
 * placeholder. No se introducen dependencias externas (ni ESLint) para no
 * incrementar la superficie de dependencias del prototipo; se valida:
 *
 *   1. Sintaxis JS/MJS (node --check)            → error
 *   2. Sentencias `debugger` residuales           → error
 *   3. `.only` en archivos de prueba              → error
 *   4. Secretos con pinta de literales            → error
 *   5. Espacios finales / newline final / líneas  → advertencia
 *      excesivamente largas
 *
 * Uso:
 *   node scripts/lint.mjs [dir ...]     (por defecto: src)
 *
 * MIT License
 * Copyright (c) 2026 Tesis Automatización Fintech — Colombia
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const MAX_LINE_LENGTH = 140;

// ---------------------------------------------------------------------------
// Recorrido de archivos
// ---------------------------------------------------------------------------

/**
 * Recorre un directorio y devuelve los archivos .js/.mjs que contiene.
 * @param {string} dir - Directorio raíz del recorrido
 * @returns {string[]} Rutas absolutas de los archivos JavaScript
 */
export function collectJsFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reglas de contenido
// ---------------------------------------------------------------------------

/**
 * Patrones que delatan credenciales escritas literalmente en el código.
 * Se buscan cadenas, no identificadores: el valor concreto nunca se imprime.
 *
 * `esSecretoReal` descarta los falsos positivos: un valor que sólo parece el
 * *nombre* de una variable de entorno (`'MICROSOFT_CLIENT_SECRET'`) no es una
 * credencial.
 */
const SECRET_PATTERNS = [
  { name: 'HubSpot Private App Token', regex: /pat-(na1|eu1)-[A-Za-z0-9_-]{10,}/g },
  { name: 'OpenAI-style API key', regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'Bearer token literal', regex: /Bearer\s+[A-Za-z0-9._-]{24,}/g },
  { name: 'Client secret literal', regex: /clientSecret\s*[:=]\s*['"]([^'"]{12,})['"]/g },
  { name: 'Password literal', regex: /(?:password|clave)\s*[:=]\s*['"]([^'"]{8,})['"]/gi },
  { name: 'Private key block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

/**
 * Indica si el valor encontrado es realmente una credencial.
 * @param {string} valor - Valor capturado por el patrón
 * @returns {boolean} true si parece una credencial
 */
function esSecretoReal(valor) {
  if (!valor) return true;
  // Nombre de variable de entorno (MICROSOFT_CLIENT_SECRET), no un secreto.
  if (/^[A-Z][A-Z0-9_]*$/.test(valor)) return false;
  // Marcadores de posición explícitos.
  if (/^(REEMPLAZAR|PLACEHOLDER|CHANGEME|TODO|<.*>|\.\.\.)/i.test(valor)) return false;
  return true;
}

/**
 * Aplica las reglas de contenido sobre el texto de un archivo.
 * @param {string} text - Contenido del archivo
 * @param {string} filePath - Ruta del archivo (para mensajes)
 * @returns {{errors: string[], warnings: string[]}}
 */
export function analyzeContent(text, filePath) {
  const errors = [];
  const warnings = [];
  const lines = text.split(/\r?\n/);
  const isTest = /(__tests__|\.test\.|\.spec\.)/.test(filePath);

  if (/^\s*debugger\s*;?\s*$/m.test(text)) {
    errors.push('sentencia `debugger` residual');
  }

  if (isTest && /\.(only)\s*\(/.test(text)) {
    errors.push('`.only()` en archivo de pruebas (deja el resto de la suite sin ejecutar)');
  }

  for (const { name, regex } of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    let coincidencia = regex.exec(text);
    let detectado = false;
    while (coincidencia !== null) {
      const valor = coincidencia[1] ?? coincidencia[0];
      if (esSecretoReal(valor)) {
        detectado = true;
        break;
      }
      coincidencia = regex.exec(text);
    }
    regex.lastIndex = 0;
    if (detectado) {
      errors.push(`posible credencial literal (${name})`);
    }
  }

  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      warnings.push(`línea ${index + 1}: espacios finales`);
    }
    if (line.length > MAX_LINE_LENGTH) {
      warnings.push(`línea ${index + 1}: excede ${MAX_LINE_LENGTH} caracteres`);
    }
  });

  if (text.length > 0 && !text.endsWith('\n')) {
    warnings.push('falta newline al final del archivo');
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

/**
 * Ejecuta el lint sobre los directorios indicados.
 * @param {string[]} dirs - Directorios a revisar
 * @returns {number} Código de salida (0 = sin errores)
 */
export function runLint(dirs) {
  const roots = dirs.length > 0 ? dirs : ['src'];
  let fileCount = 0;
  let errorCount = 0;
  let warningCount = 0;

  for (const root of roots) {
    const files = collectJsFiles(root);
    for (const file of files) {
      fileCount += 1;
      const rel = relative(process.cwd(), file).split(sep).join('/');
      const fileErrors = [];
      const fileWarnings = [];

      // 1. Sintaxis
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      } catch (error) {
        const detail = (error.stderr?.toString() ?? error.message)
          .split('\n')
          .filter((l) => l.trim())
          .slice(0, 3)
          .join(' | ');
        fileErrors.push(`error de sintaxis: ${detail}`);
      }

      // 2-5. Contenido
      let text = '';
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        fileErrors.push('no se pudo leer el archivo');
      }
      if (text) {
        const analysis = analyzeContent(text, file);
        fileErrors.push(...analysis.errors);
        fileWarnings.push(...analysis.warnings);
      }

      if (fileErrors.length > 0) {
        errorCount += fileErrors.length;
        console.error(`[lint] ERROR  ${rel}`);
        fileErrors.forEach((e) => console.error(`        - ${e}`));
      }
      if (fileWarnings.length > 0) {
        warningCount += fileWarnings.length;
        console.warn(`[lint] aviso  ${rel}`);
        fileWarnings.forEach((w) => console.warn(`        - ${w}`));
      }
    }
  }

  console.log(
    `[lint] ${fileCount} archivo(s) verificado(s) · ${errorCount} error(es) · ${warningCount} aviso(s)`,
  );

  return errorCount > 0 ? 1 : 0;
}

// Sólo ejecutar cuando se invoca directamente (no al importar).
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exit(runLint(process.argv.slice(2)));
}
