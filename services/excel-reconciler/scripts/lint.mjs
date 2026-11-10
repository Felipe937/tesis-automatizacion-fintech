/**
 * Lint portable (Windows/Linux) para `node --check`.
 * Recorre src/ recursivamente y valida la sintaxis de cada .js.
 * Sale con código 1 si algún archivo falla.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = collect('src');
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  } catch {
    failed += 1;
  }
}
if (failed) {
  console.error(`[lint] ${failed} archivo(s) con errores de sintaxis`);
  process.exit(1);
}
console.log(`[lint] OK — ${files.length} archivos verificados`);
