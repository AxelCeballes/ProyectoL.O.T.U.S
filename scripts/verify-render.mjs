// Aísla el cambio de Tailwind: compara el sitio actual compilando el CSS con la
// CLI contra el mismo sitio usando cdn.tailwindcss.com. El HTML es idéntico en
// las dos ramas, así que cualquier diferencia en el render viene de Tailwind y no
// de retoques de markup.
//
// BEFORE_DIR debe apuntar al sitio original: de ahí se toma el tailwind.config que
// usaba el CDN. No se compara contra su index.html a propósito: si ese archivo
// también cambió, las diferencias se mezclan y el resultado no prueba nada.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BEFORE_DIR = process.env.BEFORE_DIR;
const TMP = join(tmpdir(), 'lotus-render-verify');

if (!BEFORE_DIR || !existsSync(BEFORE_DIR)) {
  console.error('Falta BEFORE_DIR con el sitio original (para leer su tailwind.config).');
  process.exit(1);
}

const originalHtml = readFileSync(join(BEFORE_DIR, 'index.html'), 'utf8');

// El CDN de Tailwind y su config tal como estaban en el sitio original. Sin el
// <script src> la rama queda sin estilo y la comparacion no prueba nada.
const cdnTag = originalHtml.match(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/);
const configBlock = originalHtml.match(/<script>\s*tailwind\.config[\s\S]*?<\/script>/);
if (!cdnTag || !configBlock) {
  console.error('No se encontro el script del CDN y/o su tailwind.config en BEFORE_DIR.');
  process.exit(1);
}
const CDN_BLOCK = cdnTag[0] + '\n' + configBlock[0];

// La intro de video tapa toda la app y su autoplay nunca deja avanzar el tiempo
// virtual de Chrome. Se aplica a las dos ramas. El reloj se congela y las
// animaciones se detienen: si no, el header muestra la hora de cada corrida y
// dos capturas del mismo sitio no coinciden.
const FREEZE = `<style>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}</style>
<script>
(function () {
  var FIXED = new Date(2026, 0, 1, 12, 0, 0).getTime();
  var Real = Date;
  function Frozen() {
    if (arguments.length === 0) return new Real(FIXED);
    return new (Function.prototype.bind.apply(Real, [null].concat([].slice.call(arguments))))();
  }
  Frozen.prototype = Real.prototype;
  Frozen.now = function () { return FIXED; };
  Frozen.parse = Real.parse;
  Frozen.UTC = Real.UTC;
  window.Date = Frozen;
})();
</script>`;

// El CDN de Tailwind puede tardar en responder, asi que el evento load llega tarde
// y un unico setTimeout de 300 ms se queda corto: la rama con CDN se capturaba
// Todavia en la pantalla de espera. Se reintenta hasta que finishIntro exista.
const BYPASS = `<script>
(function () {
  var probe = new URLSearchParams(location.search).get('__probe');
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (typeof finishIntro === 'function') {
      try { finishIntro(); } catch (e) {}
    }
    if (probe && tries % 5 === 0) {
      try { eval(probe); } catch (e) { document.title = 'probe-error: ' + e.message; }
    }
    if (tries >= 60) {
      clearInterval(timer);
      document.title = 'probe-settled:' + tries;
    }
  }, 100);
})();
</script>`;

function prepare(html) {
  return html
    .replace(/<source src="[^"]*\.mp4"[^>]*>/g, '')
    .replace('preload="auto"', 'preload="none"')
    .replace('<head>', `<head>${FREEZE}`)
    .replace('</body>', `${BYPASS}</body>`);
}

function stageCdn() {
  const dest = join(TMP, 'cdn');
  rmSync(dest, { recursive: true, force: true });
  cpSync(ROOT, dest, {
    recursive: true,
    filter: (p) => !/node_modules|[\\/]\.git|scripts|src|package\.json|\.vercel/.test(p),
  });
  const file = join(dest, 'index.html');
  const html = readFileSync(file, 'utf8')
    // Se saca el CSS compilado y se devuelve el CDN con su config original.
    .replace(/<link[^>]*assets\/lotus\.css[^>]*>/g, '')
    .replace('</head>', `${CDN_BLOCK}</head>`);
  writeFileSync(file, prepare(html));
  return dest;
}

function stageBuild() {
  const dest = join(TMP, 'build');
  rmSync(dest, { recursive: true, force: true });
  cpSync(ROOT, dest, {
    recursive: true,
    filter: (p) => !/node_modules|[\\/]\.git|scripts|src|package\.json|\.vercel/.test(p),
  });
  writeFileSync(join(dest, 'index.html'), prepare(readFileSync(join(dest, 'index.html'), 'utf8')));
  return dest;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve(dir, port) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = join(dir, url === '/' ? 'index.html' : url);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream', 'Content-Length': body.length });
      res.end(body);
    } catch { res.writeHead(404).end('no'); }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

// spawnSync bloquearia el event loop y el servidor de este mismo proceso nunca
// aceptaria la conexion de Chrome: el screenshot se queda colgado para siempre.
function capture(url, out) {
  return new Promise((ok, fail) => {
    const child = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
      '--force-device-scale-factor=1', '--window-size=1280,900', '--virtual-time-budget=6000',
      `--screenshot=${out}`, url,
    ], { stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); fail(new Error('Chrome no termino a tiempo')); }, 45000);
    child.on('error', (e) => { clearTimeout(timer); fail(e); });
    child.on('exit', () => {
      clearTimeout(timer);
      if (existsSync(out)) ok(readFileSync(out));
      else fail(new Error(`Chrome no genero ${out}`));
    });
  });
}

// Descomprime PNG y deshace los filtros para comparar pixeles de verdad: dos PNG
// identicos en pantalla pueden diferir en casi todos los bytes por compresion.
function decodePng(buf) {
  let offset = 8, width = 0, height = 0, channels = 4;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('profundidad no soportada');
      if (data[12] !== 0) throw new Error('PNG entrelazado no soportado');
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!channels) throw new Error('colorType no soportado');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      if (filter === 0) cur[x] = v;
      else if (filter === 1) cur[x] = (v + a) & 0xff;
      else if (filter === 2) cur[x] = (v + b) & 0xff;
      else if (filter === 3) cur[x] = (v + ((a + b) >> 1)) & 0xff;
      else {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        cur[x] = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
  }
  return { width, height, channels, data: out };
}

function compare(aBuf, bBuf, tolerance = 8) {
  const a = decodePng(aBuf), b = decodePng(bBuf);
  if (a.width !== b.width || a.height !== b.height) return { error: `${a.width}x${a.height} vs ${b.width}x${b.height}` };
  const total = a.width * a.height;
  const ch = a.channels;
  let differing = 0, maxDelta = 0;
  const transitions = new Map();
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * ch;
      const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (d > maxDelta) maxDelta = d;
      if (d > tolerance) {
        differing++;
        const key = `${a.data[i]},${a.data[i + 1]},${a.data[i + 2]} -> ${b.data[i]},${b.data[i + 1]},${b.data[i + 2]}`;
        transitions.set(key, (transitions.get(key) || 0) + 1);
      }
    }
  }
  return { total, differing, ratio: differing / total, maxDelta, top: [...transitions].sort((p, q) => q[1] - p[1]).slice(0, 3) };
}

// `max` es el techo tolerado por pantalla, medido sobre esta misma comparacion y con
// margen. La medicion es determinista (dos capturas de la misma pagina dan 0 pixeles
// distintos), asi que los margenes son generosos y cualquier lectura alta es una
// regresion real. Estado actual: 0.029% / 0.040% / 0.006% / 0.143%, que es
// antialiasing de texto y el borde de 1px de las sombras shadow-2xs (ver el bloque
// de sombras en src/tailwind.css: el CDN de v3 no las definiia, asi que ahi son una
// diferencia consentingemente introducida, no una regresion).
const SCREENS = [
  { name: '1-espera-nfc', go: '', max: 0.08 },
  { name: '2-menu-operario', go: 'goToScreen(2)', max: 0.08 },
  { name: '3-escaneo', go: 'goToScreen(3)', max: 0.08 },
  { name: '4-inventario', go: 'openToolStatus()', max: 0.3 },
];

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const cdn = stageCdn();
const build = stageBuild();
const serverCdn = await serve(cdn, 8731);
const serverBuild = await serve(build, 8732);

const TOLERANCE = Number(process.env.TOLERANCE || 8);
let failed = 0;

try {
  for (const screen of SCREENS) {
    const probe = encodeURIComponent(screen.go);
    const a = await capture(`http://127.0.0.1:8731/?__probe=${probe}`, join(TMP, `cdn-${screen.name}.png`));
    const b = await capture(`http://127.0.0.1:8732/?__probe=${probe}`, join(TMP, `build-${screen.name}.png`));
    const r = compare(a, b, TOLERANCE);

    if (r.error) { failed++; console.log(`ERR  ${screen.name}: ${r.error}`); continue; }
    const pct = (r.ratio * 100).toFixed(3);
    const limit = screen.max * 100;
    const ok = r.ratio <= screen.max;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'DIF '} ${screen.name.padEnd(18)} ${pct.padStart(7)}% distintos (max ${limit}%)  maxDelta=${r.maxDelta}`);
    if (!ok && r.top.length) {
      for (const [k, n] of r.top) console.log(`        ${String(n).padStart(6)} px  ${k}`);
    }
  }
} finally {
  serverCdn.close();
  serverBuild.close();
}

console.log(`\ncapturas en ${TMP}`);
console.log(failed === 0
  ? 'el CSS compilado renderiza igual que el CDN dentro de los umbrales'
  : `${failed} pantalla(s) fuera de umbral`);
process.exit(failed === 0 ? 0 : 1);