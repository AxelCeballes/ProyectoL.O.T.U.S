// Servidor local para probar el canal de ayuda sin desplegar.
//
// npm run dev solo vigila el CSS: abrir index.html por file:// hace que el fetch a
// /api/chat falle por CORS y no hay nada que responda. Este servidor publica el
// sitio y le pasa las peticiones de /api/chat al mismo handler que usa Vercel, asi
// que lo que se prueba en local es el mismo codigo que va a produccion.
//
// La clave se lee de .env.local (esta en .gitignore). En Vercel no hace falta:
// alla las variables se definen en el panel del proyecto.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname, extname, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { createFalmetWorkbook } from './excel-export.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const require = createRequire(import.meta.url);
// Los datos viven en data/ por defecto. LOTUS_DATA_DIR permite apuntar a otra
// carpeta, que es lo que usan las pruebas para no tocar el inventario ni los
// registros reales del taller.
const DATA_DIR = process.env.LOTUS_DATA_DIR ? resolve(process.env.LOTUS_DATA_DIR) : join(ROOT, 'data');
const DATA_FILE = join(DATA_DIR, 'tools.json');
const SEED_FILE = join(ROOT, 'scripts', 'semilla-inventario.json');
const EXCEL_FILE = join(DATA_DIR, 'falmet-inventario.xlsx');
const PURCHASES_FILE = join(DATA_DIR, 'purchases.json');
const SHIFTS_FILE = join(DATA_DIR, 'shifts.json');
let writeQueue = Promise.resolve();
let purchaseQueue = Promise.resolve();
let shiftQueue = Promise.resolve();

// Los pedidos de compra no son herramientas: van a su propio archivo para que
// el Excel del inventario no los mezcle con las máquinas del taller.
async function readPurchases() {
  try {
    const data = JSON.parse(await fs.readFile(PURCHASES_FILE, 'utf8'));
    if (Array.isArray(data)) return data;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return [];
}

async function writePurchases(purchases) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${PURCHASES_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(purchases, null, 2));
  await fs.rename(tmp, PURCHASES_FILE);
}

function mutatePurchases(change) {
  purchaseQueue = purchaseQueue.catch(() => {}).then(async () => {
    const purchases = await readPurchases();
    const result = await change(purchases);
    await writePurchases(purchases);
    return result;
  });
  return purchaseQueue;
}

// Misma comparacion que purchases-store.js: "Disco de corte" y "disco de corte"
// son el mismo pedido. Si no coinciden, el pañol compra el doble.
function purchaseKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Sin esto el inventario compartido arranca vacio y el sitio muestra cero
// herramientas, que es peor que no tener servidor: el panel parece roto y el
// bot responde que no hay nada. La semilla es una copia de SEED_TOOLS de
// repairs-store.js, que no se puede importar aca porque ese modulo lee
// location.protocol al cargarse.
async function seedTools() {
  try {
    return JSON.parse(await fs.readFile(SEED_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readTools() {
  try {
    const tools = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    if (Array.isArray(tools) && tools.length) return tools;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const seed = await seedTools();
  if (seed.length) {
    await saveTools(seed);
    console.log(`Inventario vacio: se cargaron ${seed.length} herramientas de scripts/semilla-inventario.json`);
  }
  return seed;
}

async function saveTools(tools) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const json = `${JSON.stringify(tools, null, 2)}\n`;
  const workbook = createFalmetWorkbook(tools);
  const jsonTmp = `${DATA_FILE}.tmp`;
  const xlsxTmp = `${EXCEL_FILE}.tmp`;
  await Promise.all([fs.writeFile(jsonTmp, json), fs.writeFile(xlsxTmp, workbook)]);
  await fs.rename(jsonTmp, DATA_FILE);
  await fs.rename(xlsxTmp, EXCEL_FILE);
}

function mutateTools(change) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const tools = await readTools();
    const result = await change(tools);
    await saveTools(tools);
    return result;
  });
  return writeQueue;
}

function adminAuthorized(req) {
  const expected = process.env.ADMIN_TOKEN;
  const received = String(req.headers['x-admin-token'] ?? '');
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1024 * 1024) throw Object.assign(new Error('La solicitud es demasiado grande.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('El cuerpo JSON no es válido.'), { status: 400 }); }
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

// ---------- Entradas y salidas de personal ----------
async function readShifts() {
  try {
    const data = JSON.parse(await fs.readFile(SHIFTS_FILE, 'utf8'));
    if (Array.isArray(data)) return data;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return [];
}

async function writeShifts(shifts) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${SHIFTS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(shifts, null, 2));
  await fs.rename(tmp, SHIFTS_FILE);
}

function mutateShifts(change) {
  shiftQueue = shiftQueue.catch(() => {}).then(async () => {
    const shifts = await readShifts();
    const result = await change(shifts);
    await writeShifts(shifts);
    return result;
  });
  return shiftQueue;
}

// Misma comparación que people-store.js: "Juan Pérez" y "JUAN PEREZ" son la
// misma persona. Sin esto, dos mayúsculas darían dos entradas abiertas.
function personKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function handleShifts(req, res, url) {
  // El fichaje es el kiosco: la entrada y la salida se marcan con el NFC o el
  // botón del panel, sin pedir token. Borrar un registro (limpieza) sí exige
  // el token de admin, porque borrar la trazabilidad no es una marca.
  const anonimo = req.method === 'GET' || req.method === 'POST' ||
    (req.method === 'PATCH' && /^\/api\/shifts\/[^/]+$/.test(url.pathname));
  if (!anonimo && !adminAuthorized(req)) return json(res, 401, { error: 'Token de administrador inválido o falta ADMIN_TOKEN en el servidor.' });
  try {
    if (url.pathname === '/api/shifts' && req.method === 'GET') {
      return json(res, 200, await readShifts());
    }
    if (url.pathname === '/api/shifts' && req.method === 'POST') {
      const input = await readBody(req);
      const name = String(input.name ?? '').replace(/\s+/g, ' ').trim();
      if (!name || name.length > 80) return json(res, 400, { error: 'Falta el nombre de la persona.' });
      const shift = await mutateShifts((shifts) => {
        // Ya está adentro: no se abre una segunda jornada para la misma persona.
        const abierta = shifts.find((s) => s.exitAt === null && personKey(s.name) === personKey(name));
        if (abierta) {
          throw Object.assign(new Error(`${abierta.name} ya está adentro desde ${new Date(abierta.entryAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}.`), { status: 409 });
        }
        const nuevo = { id: `LOTUS-E${randomUUID().slice(0, 8).toUpperCase()}`, name, entryAt: Date.now(), exitAt: null, updatedAt: Date.now() };
        shifts.push(nuevo);
        return nuevo;
      });
      return json(res, 201, shift);
    }
    const match = url.pathname.match(/^\/api\/shifts\/([^/]+)$/);
    if (match && req.method === 'PATCH') {
      const id = decodeURIComponent(match[1]);
      const input = await readBody(req);
      if (input.kind !== 'out') return json(res, 400, { error: 'Operación no reconocida.' });
      const updated = await mutateShifts((shifts) => {
        const shift = shifts.find((s) => s.id === id);
        if (!shift) throw Object.assign(new Error('Ese registro de entrada no existe.'), { status: 404 });
        if (shift.exitAt !== null) throw Object.assign(new Error(`${shift.name} ya había salido.`), { status: 409 });
        shift.exitAt = Date.now();
        shift.updatedAt = Date.now();
        return shift;
      });
      return json(res, 200, updated);
    }
    if (match && req.method === 'DELETE') {
      const id = decodeURIComponent(match[1]);
      const deleted = await mutateShifts((shifts) => {
        const index = shifts.findIndex((s) => s.id === id);
        if (index < 0) throw Object.assign(new Error('Ese registro de entrada no existe.'), { status: 404 });
        return shifts.splice(index, 1)[0];
      });
      return json(res, 200, deleted);
    }
    return json(res, 405, { error: 'Método no permitido.' });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Error interno.' });
  }
}

async function handlePurchases(req, res, url) {
  // Leer la lista de pedidos es público (lo hace el chat y el panel); anotar o
  // cambiar pedidos es escritura y exige el token de admin.
  if (req.method !== 'GET' && !adminAuthorized(req)) return json(res, 401, { error: 'Token de administrador inválido o falta ADMIN_TOKEN en el servidor.' });
  const PURCHASE_STATUSES = ['pending', 'ordered', 'received'];
  try {
    if (url.pathname === '/api/purchases' && req.method === 'GET') {
      return json(res, 200, await readPurchases());
    }
    if (url.pathname === '/api/purchases' && req.method === 'POST') {
      const input = await readBody(req);
      const name = String(input.name ?? '').trim();
      const quantity = Number(input.quantity);
      const status = PURCHASE_STATUSES.includes(input.status) ? input.status : 'pending';
      if (!name || name.length > 120) return json(res, 400, { error: 'El nombre del pedido no es válido.' });
      if (!Number.isFinite(quantity) || quantity < 1 || quantity > 999) {
        return json(res, 400, { error: 'La cantidad tiene que estar entre 1 y 999.' });
      }
      const item = await mutatePurchases((purchases) => {
        // Fusiona con el pedido abierto del mismo artículo en vez de duplicar.
        const existing = purchases.find((p) => p.status !== 'received' && purchaseKey(p.name) === purchaseKey(name));
        if (existing) {
          existing.quantity = Math.min(existing.quantity + Math.round(quantity), 999);
          existing.updatedAt = Date.now();
          return existing;
        }
        const nuevo = {
          id: `LOTUS-P${randomUUID().slice(0, 8).toUpperCase()}`,
          name,
          category: String(input.category ?? '').trim().slice(0, 80) || 'Consumibles',
          quantity: Math.round(quantity),
          note: String(input.note ?? '').trim().slice(0, 300),
          status,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        purchases.push(nuevo);
        return nuevo;
      });
      return json(res, 201, item);
    }
    const match = url.pathname.match(/^\/api\/purchases\/([^/]+)$/);
    if (match && req.method === 'PATCH') {
      const id = decodeURIComponent(match[1]);
      const input = await readBody(req);
      if (!PURCHASE_STATUSES.includes(input.status)) return json(res, 400, { error: 'El estado del pedido no es válido.' });
      const updated = await mutatePurchases((purchases) => {
        const found = purchases.find((p) => p.id === id);
        if (!found) throw Object.assign(new Error('El pedido no existe.'), { status: 404 });
        found.status = input.status;
        found.updatedAt = Date.now();
        return found;
      });
      return json(res, 200, updated);
    }
    if (match && req.method === 'DELETE') {
      const id = decodeURIComponent(match[1]);
      const deleted = await mutatePurchases((purchases) => {
        const index = purchases.findIndex((p) => p.id === id);
        if (index < 0) throw Object.assign(new Error('El pedido no existe.'), { status: 404 });
        return purchases.splice(index, 1)[0];
      });
      return json(res, 200, deleted);
    }
    return json(res, 405, { error: 'Método no permitido.' });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Error interno.' });
  }
}

async function handleTools(req, res, url) {
  // Consultar inventario y bajar el Excel es público: el kiosco y el chat los
  // leen sin pedir token. Modificar (altas, bajas, movimientos) es escritura
  // y exige el token de admin.
  if (req.method !== 'GET' && !adminAuthorized(req)) return json(res, 401, { error: 'Token de administrador inválido o falta ADMIN_TOKEN en el servidor.' });
  try {
    if (url.pathname === '/api/tools/excel' && req.method === 'GET') {
      const bytes = existsSync(EXCEL_FILE) ? await fs.readFile(EXCEL_FILE) : createFalmetWorkbook(await readTools());
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="falmet-inventario.xlsx"',
        'Cache-Control': 'no-store',
      });
      res.end(bytes);
      return;
    }
    if (url.pathname === '/api/tools' && req.method === 'GET') return json(res, 200, await readTools());
    if (url.pathname === '/api/tools' && req.method === 'POST') {
      const input = await readBody(req);
      const id = String(input.id ?? '').trim();
      const name = String(input.name ?? '').trim();
      const category = String(input.category ?? '').trim();
      const status = String(input.status ?? 'available');
      if (!id || id.length > 64 || !name || name.length > 120 || category.length > 80 || !['available', 'in_use', 'maintenance'].includes(status)) {
        return json(res, 400, { error: 'El ID, nombre, categoría o estado no son válidos.' });
      }
      const tool = await mutateTools((tools) => {
        if (tools.some((item) => String(item.id).toLowerCase() === id.toLowerCase())) throw Object.assign(new Error('Ya existe una herramienta con ese ID.'), { status: 409 });
        const item = { id, name, category, status, repairs: [] };
        tools.push(item);
        return item;
      });
      return json(res, 201, tool);
    }
    // Horario de la herramienta: cuándo salió del pañol y cuándo entró.
    const mov = url.pathname.match(/^\/api\/tools\/([^/]+)\/movement$/);
    if (mov && req.method === 'PATCH') {
      const id = decodeURIComponent(mov[1]);
      const input = await readBody(req);
      const kind = input.kind;
      if (kind !== 'out' && kind !== 'in') return json(res, 400, { error: 'El tipo de movimiento no es válido.' });
      const tool = await mutateTools((tools) => {
        const item = tools.find((t) => t.id === id);
        if (!item) throw Object.assign(new Error('La herramienta no existe.'), { status: 404 });
        const out = Number(item.lastOutAt) > 0 ? Number(item.lastOutAt) : 0;
        const volvio = Number(item.lastInAt) > 0 ? Number(item.lastInAt) : 0;
        const fuera = item.status === 'in_use' || (out > 0 && out >= volvio);
        if (kind === 'out' && fuera) throw Object.assign(new Error(`${item.name} ya está prestada.`), { status: 409 });
        if (kind === 'in' && !fuera) throw Object.assign(new Error(out ? `${item.name} ya está en el pañol.` : `${item.name} nunca salió.`), { status: 409 });
        const ahora = Date.now();
        if (kind === 'out') {
          item.lastOutAt = ahora;
          item.status = 'in_use';
        } else {
          item.lastInAt = ahora;
          item.status = 'available';
        }
        item.updatedAt = ahora;
        return item;
      });
      return json(res, 200, tool);
    }

    const match = url.pathname.match(/^\/api\/tools\/([^/]+)(?:\/repairs)?$/);
    if (match && req.method === 'DELETE' && !url.pathname.endsWith('/repairs')) {
      const id = decodeURIComponent(match[1]);
      const deleted = await mutateTools((tools) => {
        const index = tools.findIndex((tool) => tool.id === id);
        if (index < 0) throw Object.assign(new Error('La herramienta no existe.'), { status: 404 });
        return tools.splice(index, 1)[0];
      });
      return json(res, 200, deleted);
    }
    if (match && req.method === 'POST' && url.pathname.endsWith('/repairs')) {
      const input = await readBody(req);
      const date = String(input.date ?? '');
      const reason = String(input.reason ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || !reason || reason.length > 300) {
        return json(res, 400, { error: 'La fecha o el motivo de la reparación no son válidos.' });
      }
      const tool = await mutateTools((tools) => {
        const item = tools.find((entry) => entry.id === decodeURIComponent(match[1]));
        if (!item) throw Object.assign(new Error('La herramienta no existe.'), { status: 404 });
        item.repairs ??= [];
        item.repairs.push({ id: randomUUID(), date, reason, technician: String(input.technician ?? '').trim().slice(0, 80), notes: String(input.notes ?? '').trim().slice(0, 500), createdAt: Date.now() });
        if (input.markAvailable !== false && item.status === 'maintenance') item.status = 'available';
        return item;
      });
      return json(res, 201, tool);
    }
    return json(res, 404, { error: 'Ruta no encontrada.' });
  } catch (error) {
    console.error('[tools] No se pudo guardar:', error);
    return json(res, error.status ?? 500, { error: error.status ? error.message : 'No se pudo guardar el inventario y el Excel.' });
  }
}

// --- .env.local -------------------------------------------------------------
// Parser minimo a proposito: se evita agregar una dependencia (dotenv) por un
// archivo de seis lineas. Ignora lineas en blanco, comentarios yexports.
function loadEnvFile() {
  const file = join(ROOT, '.env.local');
  if (!existsSync(file)) return false;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Las variables ya presentes en el entorno ganan: es lo que hace Vercel.
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

const hasEnvFile = loadEnvFile();

// --- shim de req/res --------------------------------------------------------
// El handler esta escrito para el runtime de Vercel: espera req.body ya parseado y
// res.status().json(). En node plano no existen, asi que se/arellenan.
function adaptNodeRequest(req, bodyText) {
  req.body = {};
  if (bodyText) {
    try { req.body = JSON.parse(bodyText); }
    catch { req.body = {}; }
  }
  return req;
}

function decorateResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    const body = JSON.stringify(payload);
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(body);
    return res;
  };
  return res;
}

const handler = require(join(ROOT, 'api', 'chat.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/tools')) {
    await handleTools(req, res, url);
    return;
  }

  if (url.pathname.startsWith('/api/purchases')) {
    await handlePurchases(req, res, url);
    return;
  }

  if (url.pathname.startsWith('/api/shifts')) {
    await handleShifts(req, res, url);
    return;
  }

  if (url.pathname === '/api/chat') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      adaptNodeRequest(req, Buffer.concat(chunks).toString('utf8'));
      decorateResponse(res);
      Promise.resolve(handler(req, res)).catch((error) => {
        console.error('[dev] el handler lanzo:', error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        res.end(JSON.stringify({ error: 'Error interno del servidor local.' }));
      });
    });
    return;
  }

  let file;
  try {
    file = resolve(ROOT, `.${url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)}`);
  } catch {
    res.writeHead(400);
    res.end('solicitud invalida');
    return;
  }
  const relativePath = relative(ROOT, file);
  const segments = relativePath.split(sep);
  if (relativePath.startsWith('..') || isAbsolute(relativePath) || segments.some((part) => part.startsWith('.') || ['data', 'node_modules'].includes(part))) {
    res.writeHead(404);
    res.end('no encontrado');
    return;
  }
  try {
    const body = readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('no encontrado');
  }
});

server.listen(PORT, HOST, () => {
  // El proveedor y el nombre de la clave se leen del handler, no se hardcodean:
  // cambiarlos en otro lado dejaba el arranque mintiendo sobre el estado real.
  const provider = (process.env.CHAT_PROVIDER || 'gemini').toLowerCase();
  const keyName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY';
  const key = process.env[keyName];

  console.log(`L.O.T.U.S. en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Proveedor del asistente: ${provider}`);
  console.log('');

  if (key) {
    console.log(`${keyName} cargada desde ${hasEnvFile ? '.env.local' : 'el entorno'} (${key.length} caracteres).`);
    console.log('El canal de ayuda deberia responder.');
  } else {
    console.log(`FALTA ${keyName}: el chat va a responder 503.`);
    console.log('');
    console.log('Para que responda:');
    console.log(`  1. Copi\u00e1 .env.example a .env.local  (o cre\u00e1 .env.local con esa l\u00ednea)`);
    console.log(`  2. Peg\u00e1 tu clave de ${provider === 'anthropic' ? 'Anthropic' : 'Google AI Studio'} ah\u00ed`);
    console.log('  3. Reinici\u00e1 con npm start');
    console.log('');
    console.log('.env.local est\u00e1 en .gitignore, as\u00ed que la clave no se sube al repositorio.');
    if (!hasEnvFile) console.log('Adem\u00e1s, no existe .env.local todav\u00eda.');
  }
  if (process.env.ADMIN_TOKEN) {
    console.log('Inventario compartido y Excel habilitados; los datos se guardan en data/.');
  } else {
    console.log('FALTA ADMIN_TOKEN: configurá un token secreto en .env.local para habilitar inventario y Excel.');
  }
});
