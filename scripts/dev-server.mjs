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
import { createRequire } from 'node:module';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const require = createRequire(import.meta.url);

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

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  if (url === '/api/chat') {
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

  const file = join(ROOT, url === '/' ? 'index.html' : url);
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

server.listen(PORT, '127.0.0.1', () => {
  // El proveedor y el nombre de la clave se leen del handler, no se hardcodean:
  // cambiarlos en otro lado dejaba el arranque mintiendo sobre el estado real.
  const provider = (process.env.CHAT_PROVIDER || 'gemini').toLowerCase();
  const keyName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY';
  const key = process.env[keyName];

  console.log(`L.O.T.U.S. en http://127.0.0.1:${PORT}`);
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
});