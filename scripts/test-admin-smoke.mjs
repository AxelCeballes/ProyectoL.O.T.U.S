// Carga la página real en Chrome sin instrumentar nada y mira si el panel
// admin llegó a armar sus pestañas. Si admin-panel.js tirara un error al
// importarse, no habría ningún .lap__nav en el DOM.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TMP = join(tmpdir(), 'lotus-admin-smoke');
const URL = process.argv[2] ?? 'http://127.0.0.1:3000/';

const args = [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-background-networking', '--disable-sync',
  '--user-data-dir=' + TMP,
  '--virtual-time-budget=8000', '--timeout=15000', '--dump-dom', URL,
];

const chrome = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'ignore'] });
let dom = '';
chrome.stdout.on('data', (c) => (dom += c));

const timer = setTimeout(() => chrome.kill(), 30000);

chrome.on('close', () => {
  clearTimeout(timer);
  const espera = [
    ['login de admin', /Acceso de administrador/],
    ['pestaña Herramientas', /data-view="tools"/],
    ['pestaña Reparaciones', /data-view="history"/],
    ['pestaña Compras', /data-view="purchases"/],
    ['pestaña Personal', /data-view="shifts"/],
    ['disparador del panel', /lap-launcher/],
  ];
  let fallas = 0;
  for (const [nombre, re] of espera) {
    const ok = re.test(dom);
    if (!ok) fallas++;
    console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${nombre}`);
  }
  console.log(`  DOM recibido: ${dom.length} bytes`);
  if (fallas) {
    console.log(`\n${fallas} PROBLEMA(S)`);
    process.exit(1);
  }
  console.log('\nel panel admin se arma en Chrome');
});
