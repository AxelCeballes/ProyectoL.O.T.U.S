// Prueba de comportamiento del chat en un navegador real.
//
// scripts/test-chat.mjs cubre api/chat.js con la API simulada, pero eso no toca el
// frontend. El fix del reintento (que la burbuja del usuario no quedara duplicada
// tras fallar y reintentar) estaba verificado solo con "el JS parsea", que no
// prueba nada: una funcion sintacticamente valida puede llamar a appendChatMessage
// dos veces.
//
// Aqui se stubbea fetch, se hace fallar la primera consulta, se pulsa el boton
// "Reintentar" que genera el propio codigo y se cuenta lo que queda en el DOM.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TMP = join(tmpdir(), 'lotus-chat-ui-test');

// La intro de video tapa la app y su autoplay nunca deja avanzar el reloj virtual
// de Chrome, asi que hay que saltarla igual que en verify-render.
const BYPASS = `<script>
(function () {
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (typeof finishIntro === 'function') { try { finishIntro(); } catch (e) {} }
    if (tries >= 40) clearInterval(timer);
  }, 100);
})();
</script>`;

// Un fetch falso: la primera llamada falla como una caida de red, las siguientes
// responden bien. Devolver ok:true exige que el frontendno se equivoque al leer el
// cuerpo, asi que el stub es mas exigente que un simple "no-op".
const STUB = `<script>
(function () {
  var calls = 0;
  window.__calls = function () { return calls; };
  window.fetch = function (url, opts) {
    calls++;
    if (calls === 1) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve({ reply: 'RESPUESTA DE PRUEBA' }); },
    });
  };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function userBubbles() {
    return [].filter.call(document.querySelectorAll('p'), function (p) {
      return p.className.indexOf('bg-brand-navy') !== -1;
    });
  }
  function retryButtons() {
    return [].filter.call(document.querySelectorAll('button'), function (b) {
      return b.textContent === 'Reintentar';
    });
  }
  function chatHistoryLength() {
    return typeof chatHistory === 'undefined' ? -1 : chatHistory.length;
  }

  function note(line) {
    var pre = document.getElementById('RESULT');
    if (!pre) {
      pre = document.createElement('pre');
      pre.id = 'RESULT';
      pre.style.display = 'none';
      document.body.appendChild(pre);
    }
    pre.textContent = pre.textContent ? pre.textContent + '\\n' + line : line;
    return line;
  }

  window.__run = async function () {
    note('arrancando');
    setChatOpen(true);
    note('chat abierto');
    chatInput.value = 'mensaje de prueba';
    chatForm.requestSubmit();
    note('formulario enviado');

    // Espera a que aparezca el boton de reintentar, que es la senal de que la
    // primera consulta fallo y se dibujo el error.
    for (var i = 0; i < 60 && retryButtons().length === 0; i++) await sleep(100);
    note('burbujas de usuario tras el fallo: ' + userBubbles().length);
    note('botones de reintentar tras el fallo: ' + retryButtons().length);
    note('historial tras el fallo: ' + chatHistoryLength());

    retryButtons()[0].click();
    note('reintento pulsado');

    for (var j = 0; j < 60 && window.__calls() < 2; j++) await sleep(100);
    await sleep(600);

    var after = userBubbles();
    note('llamadas a fetch: ' + window.__calls());
    note('burbujas de usuario tras el reintento: ' + after.length);
    note('texto de la burbuja de usuario: ' + (after.length ? after[0].textContent : '(ninguna)'));
    note('botones de reintentar restantes: ' + retryButtons().length);
    note('historial tras el exito: ' + chatHistoryLength());
    note('hay respuesta del asistente: ' +
      (document.getElementById('chatMessages').textContent.indexOf('RESPUESTA DE PRUEBA') !== -1));
    return true;
  };

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (typeof window.__run !== 'function') { if (tries === 19) note('window.__run no se instalo'); return; }
    if (tries < 20) return;
    clearInterval(timer);
    note('ejecutando');
    window.__run().catch(function (e) {
      note('EXCEPCION: ' + (e && e.message));
    });
  }, 100);
})();
</script>`;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };

const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  .replace(/<source src="[^"]*\.mp4"[^>]*>/g, '')
  .replace('preload="auto"', 'preload="none"')
  .replace('</body>', `${BYPASS}${STUB}</body>`);

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // El index se sirve desde memoria con la inyeccion ya aplicada. Leerlo del disco
  // serviria el archivo original y la prueba pasaria a probar el sitio sin stub,
  // sin ningun error visible.
  if (url === '/' || url === '/index.html') {
    const body = Buffer.from(html, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
    return res.end(body);
  }
  const file = join(ROOT, url);
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream', 'Content-Length': body.length });
    res.end(body);
  } catch { res.writeHead(404).end('no'); }
});
await new Promise((ok) => server.listen(8781, '127.0.0.1', ok));

function dumpDom(url) {
  return new Promise((ok, fail) => {
    const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
      '--virtual-time-budget=8000', '--enable-logging=stderr', '--log-level=0', '--dump-dom', url],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill(); fail(new Error('Chrome no termino a tiempo')); }, 60000);
    child.on('error', (e) => { clearTimeout(timer); fail(e); });
    child.on('exit', () => {
      clearTimeout(timer);
const m = out.match(/<pre[^>]*id="RESULT"[^>]*>([\s\S]*?)<\/pre>/);
      if (!m) {
        // Sin el <pre> no hay nada que assertar. Se vuelca el DOM y se signed la
        // consola del navegador: un ReferenceError dentro del script inyectado es el
        // fallo tipico, y sin esto el mensaje es indistinguible de un timeout.
        mkdirSync(TMP, { recursive: true });
        writeFileSync(join(TMP, 'dom.html'), out);
        const noise = /external_registry|HKLM|Fontconfig|GPU|dbus|voice|DevTools|bluetooth|gbm|vaapi|Vulkan|sandbox|DEPRECATED|Fallback|network_service|cert/i;
        const errs = err.split('\n')
          .filter((l) => /ERROR:CONSOLE|Uncaught|SyntaxError|ReferenceError|TypeError/i.test(l) && !noise.test(l))
          .map((l) => '    ' + l.trim());
        return fail(new Error([
          'la prueba no produjo resultado.',
          `    'RESULT' aparece en el DOM: ${/RESULT/.test(out)}`,
          `    longitud del DOM: ${out.length}`,
          errs.length ? errs.join('\n') : '    (sin errores de consola)',
          `    DOM volcado en ${join(TMP, 'dom.html')}`,
        ].join('\n')));
      }
      ok(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .split('\n').map((l) => l.trim()).filter(Boolean));
    });
  });
}

let log;
try {
  log = await dumpDom('http://127.0.0.1:8781/');
} catch (e) {
  server.close();
  console.error('  ' + e.message);
  process.exit(1);
}
server.close();

console.log('escenario: la primera consulta falla y el usuario pulsa Reintentar\n');
for (const line of log) console.log('  ' + line);

const value = (label) => {
  const line = log.find((l) => l.startsWith(label));
  return line ? Number(line.slice(label.length).trim()) : NaN;
};

// La asercion central: un solo turno del usuario en el transcript, no dos.
const failures = [];
const userAfter = value('burbujas de usuario tras el reintento:');
if (userAfter !== 1) failures.push(`esperaba 1 burbuja de usuario tras el reintento, hay ${userAfter}`);
if (value('llamadas a fetch:') !== 2) failures.push('esperaba 2 llamadas a fetch (una fallida, una reintentada)');
if (value('burbujas de usuario tras el fallo:') !== 1) failures.push('tras el fallo deberia quedar una sola burbuja de usuario');
if (value('botones de reintentar tras el fallo:') !== 1) failures.push('tras el fallo deberia haber un boton Reintentar');
if (value('botones de reintentar restantes:') !== 0) failures.push('el boton Reintentar deberia consumirse al pulsarlo');
if (value('historial tras el fallo:') !== 0) failures.push('un turno fallido no debe entrar al historial');
if (value('historial tras el exito:') !== 2) failures.push('tras el exito el historial deberia tener 2 turnos (user + assistant)');
if (log.find((l) => l.startsWith('hay respuesta del asistente: '))?.slice(-4) !== 'true') {
  failures.push('la respuesta del asistente no llego a pintarse');
}
const bubbleText = log.find((l) => l.startsWith('texto de la burbuja de usuario: '))?.slice('texto de la burbuja de usuario: '.length);
if (bubbleText !== 'mensaje de prueba') failures.push(`la burbuja de usuario quedo con el texto "${bubbleText}"`);

console.log('');
if (failures.length) {
  for (const f of failures) console.log('  FALLA: ' + f);
  process.exit(1);
}
console.log('  ok: el reintento no duplica la burbuja del usuario y el historial queda consistente');