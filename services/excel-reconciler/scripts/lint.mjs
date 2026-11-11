/**
 * Lint del servicio excel-reconciler.
 *
 * La implementación vive en `services/scripts/lint.mjs` (una sola copia para
 * todo el proyecto, ver docs/decisions.md ADR-008). Este archivo se mantiene
 * como punto de entrada histórico del servicio.
 */
import { runLint } from '../../scripts/lint.mjs';

process.exit(runLint(['src']));
