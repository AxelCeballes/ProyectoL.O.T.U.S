// Prueba la pestaña de Personal y el horario de herramientas en un Chrome real,
// de punta a punta: abre el panel, se loguea, marca una entrada, le pone la
// salida, prestá y devolvé una herramienta, y verifica que todo quedó guardado
// en el servidor.
//
// Se levanta un servidor propio con LOTUS_DATA_DIR apuntando a una carpeta
// temporal: la prueba no toca el inventario ni los registros reales del taller.
// Los diálogos (prompt de token, confirm de borrado) se contestan por CDP.
//
// No hay librerías nuevas: Node trae WebSocket nativo y Chrome se maneja con
// el protocolo de depuración.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PUERTO_SERVIDOR = Number(process.env.LOTUS_UI_PORT) || 9456;
// Chrome y el servidor no pueden compartir puerto: si se pisan, Chrome se
// cierra apenas arranca y el puerto de depuración nunca queda disponible.
const PUERTO_CHROME = PUERTO_SERVIDOR + 1;
const TMP = join(tmpdir(), 'lotus-admin-ui');
const DATA_DIR = join(TMP, 'data');
const URL = `http://127.0.0.1:${PUERTO_SERVIDOR}/`;
const NOMBRE = 'Prueba de Jornada';
const CONTRASENA = 'falmet';

let fallas = 0;
const check = (nombre, ok, detalle = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${nombre}${detalle ? ` -> ${detalle}` : ''}`);
  if (!ok) fallas++;
};
const plano = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

// ---------- Preconditions ----------
function leerToken() {
  try {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8');
    return txt.match(/^\s*ADMIN_TOKEN\s*=\s*(\S+)/m)?.[1] ?? '';
  } catch {
    return '';
  }
}

const TOKEN = leerToken();
if (!TOKEN) {
  console.log('SKIP: no hay ADMIN_TOKEN en .env.local, no se puede probar el panel contra el servidor.');
  process.exit(0);
}

// ---------- Servidor de prueba ----------
rmSync(TMP, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });

let logServidor = '';
const servidor = spawn(process.execPath, [join(ROOT, 'scripts', 'dev-server.mjs')], {
  env: { ...process.env, PORT: String(PUERTO_SERVIDOR), HOST: '127.0.0.1', LOTUS_DATA_DIR: DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
servidor.stdout.on('data', (c) => (logServidor += c));
servidor.stderr.on('data', (c) => (logServidor += c));

let chrome = null;
const limpiar = () => {
  try { chrome?.kill(); } catch { /* ya murió */ }
  try { servidor.kill(); } catch { /* ya murió */ }
};
process.on('exit', limpiar);
setTimeout(() => {
  console.error('Se superó el tiempo de la prueba de UI.');
  console.error(plano(logServidor).slice(-800));
  limpiar();
  process.exit(1);
}, 240000);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarServidor() {
  const desde = Date.now();
  for (;;) {
    if (servidor.exitCode !== null) {
      throw new Error(`El servidor se cerró (${servidor.exitCode}): ${plano(logServidor).slice(-600)}`);
    }
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch { /* todavía no levantó */ }
    if (Date.now() - desde > 30000) {
      throw new Error(`El servidor no respondió en 30 s: ${plano(logServidor).slice(-600)}`);
    }
    await espera(250);
  }
}

await esperarServidor();

// ---------- Chrome ----------
chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-sync', '--disable-background-networking',
  `--user-data-dir=${TMP}`, `--remote-debugging-port=${PUERTO_CHROME}`,
  '--window-size=1400,950', URL,
], { stdio: ['ignore', 'ignore', 'ignore'] });

async function conectar() {
  const desde = Date.now();
  for (;;) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${PUERTO_CHROME}/json/list`)).json();
      const pagina = lista.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
      if (pagina?.webSocketDebuggerUrl) return pagina.webSocketDebuggerUrl;
    } catch { /* Chrome todavía no abrió el puerto */ }
    if (Date.now() - desde > 30000) throw new Error('Chrome no abrió el puerto de depuración.');
    await espera(300);
  }
}

const ws = new WebSocket(await conectar());
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let id = 0;
const pendientes = new Map();
const enviar = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pendientes.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

// Los diálogos bloquean la página: se contestan apenas llegan. El prompt
// recibe el token de admin y el confirm acepta, así el flujo sigue solo.
const dialogos = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data));
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogos.push({ type: msg.params.type, message: msg.params.message });
    enviar('Page.handleJavaScriptDialog', {
      accept: true,
      promptText: msg.params.type === 'prompt' ? TOKEN : '',
    }).catch(() => {});
    return;
  }
  if (!msg.id) return;
  const p = pendientes.get(msg.id);
  if (!p) return;
  pendientes.delete(msg.id);
  if (msg.error) p.reject(new Error(`${msg.error.message}: ${msg.error.data ?? ''}`));
  else p.resolve(msg.result);
});

await enviar('Page.enable');
await enviar('Runtime.enable');

const evaluar = async (expr) => {
  const r = await enviar('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'error al evaluar en la página'
    );
  }
  return r.result.value;
};

const hastaQue = async (expr, ms, queEspera) => {
  const desde = Date.now();
  for (;;) {
    const valor = await evaluar(expr).catch(() => null);
    if (valor) return valor;
    if (Date.now() - desde > ms) throw new Error(`Se esperaba ${queEspera} y no pasó en ${ms} ms.`);
    await espera(250);
  }
};

const ponEn = (selector, valor) => `
(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(valor)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

const filaNombre = (nombre) => `
[...document.querySelectorAll('.lap-table tbody tr')].find((f) => f.textContent.includes(${JSON.stringify(nombre)}))`;

// ---------- Prueba ----------
try {
  await hastaQue(`!!document.querySelector('.lap-launcher')`, 25000, 'el botón de administración');

  await evaluar(`document.querySelector('.lap-launcher').click()`);
  await hastaQue(`document.querySelector('.lap-auth')?.open === true`, 8000, 'el diálogo de contraseña');
  await evaluar(`${ponEn('#lap-auth-password', CONTRASENA)}; document.querySelector('.lap-auth__submit').click(); true`);

  await hastaQue(
    `document.querySelector('.lap')?.hidden === false && !!document.querySelector('.lap__nav.is-active')`,
    30000,
    'el panel abierto'
  );
  // Espera a que termine el primer refresh antes de mirar la tabla.
  await hastaQue(
    `document.querySelectorAll('.lap-table tbody tr').length > 0`,
    30000,
    'las filas del inventario'
  );

  const cabecera = await evaluar(`
    (() => {
      const error = document.querySelector('.lap__state--error');
      return {
        filas: document.querySelectorAll('.lap-table tbody tr').length,
        error: error ? error.textContent.trim() : '',
        navs: [...document.querySelectorAll('.lap__nav')].map((b) => b.textContent.trim()),
      };
    })()
  `);
  check('pide el token de admin por prompt', dialogos.some((d) => d.type === 'prompt'),
    JSON.stringify(dialogos.map((d) => d.type)));
  check('el panel abre sin error', !cabecera.error, cabecera.error);
  check('carga el inventario desde el servidor', cabecera.filas > 0, `${cabecera.filas} filas`);
  check('las cuatro pestañas están',
    ['Herramientas', 'Reparaciones', 'Compras', 'Personal'].every((n) => cabecera.navs.includes(n)),
    JSON.stringify(cabecera.navs));

  // ---------- Personal: entrada ----------
  await evaluar(`document.querySelector('[data-view="shifts"]').click()`);
  await hastaQue(`!!document.querySelector('[data-form="shift"]')`, 8000, 'la pestaña de Personal');

  await evaluar(`${ponEn('[data-form="shift"] input[name=name]', NOMBRE)};
    document.querySelector('[data-form="shift"] button[type=submit]').click(); true`);

  const conEntrada = await hastaQue(`
    (() => {
      const fila = ${filaNombre(NOMBRE)};
      return fila && fila.textContent.includes('adentro') ? fila.textContent : null;
    })()
  `, 20000, 'la fila con la entrada marcada');

  check('la entrada aparece marcada como adentro', /adentro/.test(conEntrada));
  check('muestra la hora de entrada', /\d{2}:\d{2}/.test(conEntrada), (conEntrada.match(/\d{2}:\d{2}/) ?? [''])[0]);
  check('la duración arranca en menos de 1 m', /menos de 1 m/.test(conEntrada));

  const guardado = await fetch(`${URL}api/shifts`, { headers: { 'x-admin-token': TOKEN } }).then((r) => r.json());
  const delServidor = (Array.isArray(guardado) ? guardado : []).find((s) => s.name === NOMBRE);
  check('la jornada quedó guardada en el servidor', !!delServidor,
    delServidor ? `id ${delServidor.id}` : plano(JSON.stringify(guardado)).slice(0, 120));

  // ---------- Personal: dos jornadas seguidas ----------
  await evaluar(`${ponEn('[data-form="shift"] input[name=name]', 'PRUEBA DE JORNADA')};
    document.querySelector('[data-form="shift"] button[type=submit]').click(); true`);

  const exprDuplicado = `
    (() => {
      const e = document.querySelector('[data-form="shift"] .lap-add__error');
      if (e && !e.hidden && e.textContent.trim()) return e.textContent.trim();
      const general = document.querySelector('.lap__state--error');
      return general ? 'ERROR GENERAL: ' + general.textContent.trim() : null;
    })()`;

  let duplicado = null;
  try {
    duplicado = await hastaQue(exprDuplicado, 20000, 'el aviso de jornada repetida');
  } catch {
    duplicado = null;
  }
  check('no abre dos jornadas para la misma persona', !!duplicado && /ya está adentro/i.test(duplicado),
    duplicado ?? JSON.stringify(await evaluar(`
      ({
        filas: [...document.querySelectorAll('.lap-table tbody tr')]
          .map((f) => f.textContent.replace(/\\s+/g, ' ').trim()),
        formError: document.querySelector('[data-form="shift"] .lap-add__error')?.textContent?.trim() ?? '',
        formOculto: document.querySelector('[data-form="shift"] .lap-add__error')?.hidden ?? null,
        general: document.querySelector('.lap__state--error')?.textContent?.trim() ?? '',
      })
    `)));

  // ---------- Personal: salida ----------
  await evaluar(`${filaNombre(NOMBRE)}.querySelector('[data-action="shift-out"]').click(); true`);

  const conSalida = await hastaQue(`
    (() => {
      const fila = ${filaNombre(NOMBRE)};
      return fila && !fila.textContent.includes('adentro') ? fila.textContent : null;
    })()
  `, 20000, 'la fila con la salida marcada');

  check('la salida cierra la jornada', !/adentro/.test(conSalida), plano(conSalida));
  check('queda la duración calculada', /menos de 1 m|\d+ m/.test(conSalida),
    (conSalida.match(/menos de 1 m|\d+ m/) ?? [''])[0]);

  const cerrada = (await fetch(`${URL}api/shifts`, { headers: { 'x-admin-token': TOKEN } }).then((r) => r.json()))
    .find((s) => s.name === NOMBRE);
  check('la salida quedó guardada en el servidor', !!cerrada && cerrada.exitAt !== null,
    cerrada ? `exitAt ${cerrada.exitAt}` : 'sin registro');

  // ---------- Herramientas: horario ----------
  await evaluar(`document.querySelector('[data-view="tools"]').click()`);
  const encabezado = await hastaQue(`
    (() => {
      const ths = [...document.querySelectorAll('.lap-table thead th')].map((h) => h.textContent.trim());
      return ths.includes('Horario') ? ths : null;
    })()
  `, 10000, 'la columna de horario');
  check('la tabla de herramientas tiene columna Horario', encabezado.includes('Horario'),
    JSON.stringify(encabezado));

  const idHerramienta = await hastaQue(`
    (() => {
      const fila = [...document.querySelectorAll('.lap-table tbody tr')].find((f) =>
        f.textContent.includes('Disponible') && f.querySelector('[data-action="tool-out"]'));
      return fila?.dataset.id ?? null;
    })()
  `, 10000, 'una herramienta disponible');
  const selFila = JSON.stringify(`tr[data-id="${idHerramienta}"]`);
  await evaluar(`(() => {
    const fila = document.querySelector(${selFila});
    if (!fila) return false;
    fila.querySelector('[data-action="tool-out"]')?.click();
    return true;
  })()`);

  const prestada = await hastaQue(`
    (() => {
      const fila = document.querySelector(${JSON.stringify(`tr[data-id="${idHerramienta}"]`)});
      if (!fila) return null;
      const horas = fila.querySelector('.lap-hours');
      const enUso = fila.textContent.includes('En uso');
      const entra = !!fila.querySelector('[data-action="tool-in"]');
      return enUso && entra && horas ? { horas: horas.textContent.replace(/\\s+/g, ' ').trim() } : null;
    })()
  `, 20000, 'la herramienta marcada como prestada');

  check('la herramienta pasa a En uso', prestada.horas.startsWith('sal'), prestada.horas);
  check('la hora de salida se registra', /sal \d{2}:\d{2}/.test(prestada.horas), prestada.horas);

  const herramientas = await fetch(`${URL}api/tools`, { headers: { 'x-admin-token': TOKEN } }).then((r) => r.json());
  const guardada = (Array.isArray(herramientas) ? herramientas : []).find((t) => t.id === idHerramienta);
  check('la salida quedó en el inventario del servidor', !!guardada?.lastOutAt && guardada.status === 'in_use',
    guardada ? `status ${guardada.status}` : 'sin herramienta');

  await evaluar(`(() => {
    const fila = document.querySelector(${selFila});
    if (!fila) return false;
    fila.querySelector('[data-action="tool-in"]')?.click();
    return true;
  })()`);
  let devuelta = null;
  try {
    devuelta = await hastaQue(`
      (() => {
        const fila = document.querySelector(${JSON.stringify(`tr[data-id="${idHerramienta}"]`)});
        if (!fila) return null;
        const horas = fila.querySelector('.lap-hours');
        return fila.textContent.includes('Disponible') && horas
          ? { horas: horas.textContent.replace(/\\s+/g, ' ').trim(), entra: !!fila.querySelector('[data-action="tool-in"]') }
          : null;
      })()
    `, 25000, 'la herramienta de vuelta al pañol');
  } catch (e) {
    devuelta = null;
  }

  const diagDevuelta = devuelta ?? (await evaluar(`
    (() => {
      const fila = document.querySelector(${selFila});
      return {
        error: document.querySelector('.lap__state--error')?.textContent?.trim() ?? '',
        fila: fila?.textContent.replace(/\\s+/g, ' ').trim() ?? 'sin fila',
        horas: fila?.querySelector('.lap-hours')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
        botones: fila ? [...fila.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
      };
    })()
  `));

  check('la herramienta vuelve a estar disponible',
    !!devuelta && devuelta.entra === false, JSON.stringify(diagDevuelta));
  check('la hora de entrada se registra', !!devuelta && /ent \d{2}:\d{2}/.test(devuelta.horas),
    diagDevuelta.horas);

  // ---------- Compras: el panel también las pinta ----------
  await evaluar(`document.querySelector('[data-view="purchases"]').click()`);
  const compras = await hastaQue(`!!document.querySelector('.lap__content')`, 8000, 'la pestaña de Compras');
  const textoCompras = await evaluar(`document.querySelector('.lap__content').textContent`);
  check('la pestaña de Compras carga sin error',
    compras && !/undefined|NaN/.test(textoCompras), plano(textoCompras).slice(0, 100));

  // ---------- Limpieza ----------
  await evaluar(`document.querySelector('[data-view="shifts"]').click()`);
  await hastaQue(`!!document.querySelector('[data-action="shift-delete"]')`, 10000, 'el botón de borrar');
  await evaluar(`${filaNombre(NOMBRE)}.querySelector('[data-action="shift-delete"]').click(); true`);
  await hastaQue(`!${filaNombre(NOMBRE)}`, 20000, 'la fila borrada');
  check('se puede borrar el registro de jornada', true);

  const final = await fetch(`${URL}api/shifts`, { headers: { 'x-admin-token': TOKEN } }).then((r) => r.json());
  check('y no quedó nada en el servidor',
    !(Array.isArray(final) && final.some((s) => s.name === NOMBRE)),
    `${Array.isArray(final) ? final.length : 0} registro(s)`);
} catch (e) {
  check('la prueba de UI terminó', false, e.message);
}

console.log(fallas ? `\n${fallas} PROBLEMA(S)` : '\nla pestaña de Personal anda en el navegador');
if (fallas && logServidor.trim()) console.log('\n[log del servidor]\n' + plano(logServidor).slice(-1500));
limpiar();
process.exit(fallas ? 1 : 0);
