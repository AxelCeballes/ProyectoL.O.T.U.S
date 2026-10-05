// Verifica que reemplazar el CDN de Tailwind por el CSS compilado no cambie el
// render. Levanta la version "antes" (CDN) y la "despues" (CSS compilado),
// captura cada pantalla con Chrome headless y compara los PNG byte a byte.
//
// Uso: node scripts/verify-render.mjs
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, cpSync, mkdirSync, rmSync, existsSync, readFileSync as rf } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BEFORE_DIR = process.env.BEFORE_DIR;
const AFTER_DIR = process.env.AFTER_DIR || resolve('.');

if (!BEFORE_DIR) {
  console.error('Falta BEFORE_DIR (la copia con el CDN de Tailwind).');
  process.exit(2);
}

const TMP = join(tmpdir(), 'lotus-render-verify');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// La intro de video tapa toda la app, sus fotogramas varyan entre corridas y el
// autoplay bloquea el avance del tiempo virtual de Chrome headless. Se aplica
// el mismo tratamiento a las dos copias: sin <source> y sin preload. El script
// de bypass salta la intro; el parametro __probe lleva cada copia a una pantalla.
const BYPASS = `<script>
window.addEventListener('load', () => setTimeout(() => {
  finishIntro();
  var probe = new URLSearchParams(location.search).get('__probe');
  if (probe) { try { eval(probe); } catch (e) { document.title = 'probe-error: ' + e.message; } }
}, 300));
</script>`;

function stage(srcDir, name) {
  const dest = join(TMP, name);
  cpSync(srcDir, dest, {
    recursive: true,
    filter: (p) => !/node_modules|\.git|scripts|src|package\.json|\.vercel/.test(p),
  });
  const file = join(dest, 'index.html');
  const html = readFileSync(file, 'utf8')
    .replace(/<source src="[^"]*\.mp4"[^>]*>/g, '')
    .replace('preload="auto"', 'preload="none"')
    .replace('</body>', `${BYPASS}</body>`);
  writeFileSync(file, html);
  return dest;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function serve(dir, port) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    let file = join(dir, path === '/' ? 'index.html' : path);
    try {
      const body = rf(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('no');
    }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

const beforeDir = stage(BEFORE_DIR, 'before');
const afterDir = stage(AFTER_DIR, 'after');

const PORT_BEFORE = 8731;
const PORT_AFTER = 8732;
const serverBefore = await serve(beforeDir, PORT_BEFORE);
const serverAfter = await serve(afterDir, PORT_AFTER);

const SCREENS = [
  { name: '1-espera-nfc', go: '' },
  { name: '2-menu-operario', go: 'goToScreen(2)' },
  { name: '3-escaneo', go: 'goToScreen(3)' },
  { name: '4-inventario', go: 'openToolStatus()' },
];

function shoot(port, screen, out) {
  const url = `http://127.0.0.1:${port}/?__probe=${encodeURIComponent(screen.go || '')}`;
  const result = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--mute-audio',
      '--disable-extensions',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=1280,900',
      `--screenshot=${out}`,
      url,
    ],
    { stdio: 'ignore', timeout: 40000 }
  );
  if (result.error) throw result.error;
  if (!existsSync(out)) throw new Error(`Chrome no-genero la captura de ${screen.name}`);
  return rf(out);
}

let same = 0;
let diff = 0;
const rows = [];

for (const screen of SCREENS) {
  const a = shoot(PORT_BEFORE, screen, join(TMP, `before-${screen.name}.png`));
  const b = shoot(PORT_AFTER, screen, join(TMP, `after-${screen.name}.png`));
  const equal = a.equals(b);
  equal ? (same += 1) : (diff += 1);
  rows.push({ pantalla: screen.name, resultado: equal ? 'identico' : 'DIFIERE', bytesAntes: a.length, bytesDespues: b.length });
}

serverBefore.close();
serverAfter.close();

console.table(rows);
console.log(`\n${same} pantalla(s) identicas, ${diff} diferente(s)`);
console.log(`Capturas en: ${TMP}`);
process.exitCode = diff ? 1 : 0;
