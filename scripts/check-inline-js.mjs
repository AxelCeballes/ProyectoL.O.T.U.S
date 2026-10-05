// Extrae los <script> inline de index.html y los valida con node --check.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const html = readFileSync('index.html', 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'lotus-js-'));

let n = 0;
let failed = 0;

for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="module")[^>]*>([\s\S]*?)<\/script>/gi)) {
  n += 1;
  const file = join(dir, `inline-${n}.js`);
  writeFileSync(file, m[1]);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`script inline #${n}: OK (${m[1].split('\n').length} líneas)`);
  } catch (err) {
    failed += 1;
    console.log(`script inline #${n}: FALLA`);
    console.log(String(err.stderr).split('\n').slice(0, 12).join('\n'));
  }
}

console.log(failed ? `\n${failed} script(s) con error de sintaxis` : `\n${n} script(s) inline, todos válidos`);
process.exitCode = failed ? 1 : 0;
