// Prueba del handler api/chat.js sin tocar la API real: se intercepta
// globalThis.fetch y se ejercita cada rama con req/res simulados.
// Ejecutar: node scripts/test-chat.mjs

import handler from '../api/chat.js';

process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

let passed = 0;
let failed = 0;

// El rate limit es por IP y las instancias se reutilizan entre invocaciones,
// así que cada sección usa una IP propia para no gastar los slots de otra.
let ipCounter = 0;
let currentIp = `10.0.0.${++ipCounter}`;

function section(title) {
  currentIp = `10.0.0.${++ipCounter}`;
  console.log(`\n${title}`);
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function call({ method = 'POST', body, headers = {} } = {}) {
  const res = mockRes();
  await handler(
    {
      method,
      body,
      headers: { 'x-forwarded-for': currentIp, ...headers },
      socket: { remoteAddress: currentIp },
    },
    res
  );
  return res;
}

// Respuesta OK por defecto del mock de Anthropic.
const okResponse = (text = 'Hola, ¿necesitás ayuda con el retiro?') => ({
  ok: true,
  status: 200,
  json: async () => ({ content: [{ type: 'text', text }], model: 'claude-sonnet-5-5' }),
});

let lastRequestBody = null;
function stubFetch(impl) {
  globalThis.fetch = async (_url, init) => {
    lastRequestBody = JSON.parse(init.body);
    return impl();
  };
}

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FALLA ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

const sent = () => lastRequestBody.messages.at(-1);
const history = () => lastRequestBody.messages.slice(0, -1);

// ------------------------------------------------------------------
section('1. Método y configuración');
stubFetch(okResponse);
check('GET devuelve 405', (await call({ method: 'GET' })).statusCode === 405);
check('405 envía cabecera Allow', (await call({ method: 'GET' })).headers.allow === 'POST');

delete process.env.ANTHROPIC_API_KEY;
const noKey = await call({ body: { message: 'hola' } });
check('sin ANTHROPIC_API_KEY devuelve 503', noKey.statusCode === 503, `fue ${noKey.statusCode}`);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

check('mensaje vacío devuelve 400', (await call({ body: { message: '   ' } })).statusCode === 400);
check('body no objeto devuelve 400', (await call({ body: null })).statusCode === 400);

// ------------------------------------------------------------------
section('2. Cuerpo de la petición a Anthropic');
await call({ body: { message: '¿cómo retiro una herramienta?' } });
check('modelo por defecto claude-sonnet-5-5', lastRequestBody.model === 'claude-sonnet-5-5', lastRequestBody.model);
check('thinking es between_tools', lastRequestBody.thinking?.type === 'between_tools');
check('effort es low', lastRequestBody.output_config?.effort === 'low');
check('max_tokens >= 1024', lastRequestBody.max_tokens >= 1024, String(lastRequestBody.max_tokens));

process.env.ANTHROPIC_EFFORT = 'medium';
await call({ body: { message: 'hola' } });
check('effort se puede sobreescribir por env', lastRequestBody.output_config?.effort === 'medium');
delete process.env.ANTHROPIC_EFFORT;

process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5';
await call({ body: { message: 'hola' } });
check('modelo se puede sobreescribir por env', lastRequestBody.model === 'claude-haiku-4-5');
delete process.env.ANTHROPIC_MODEL;

// ------------------------------------------------------------------
section('3. Historial');
await call({
  body: {
    message: 'actual',
    history: [
      { role: 'assistant', content: 'respuesta vieja' },
      { role: 'user', content: 'pregunta vieja' },
      { role: 'assistant', content: 'respuesta' },
    ],
  },
});
check('descarta el assistant inicial', history()[0]?.role === 'user', JSON.stringify(history().map((m) => m.role)));
check('conserva los turnos válidos', history().length === 2);

await call({ body: { message: 'hola', history: 'no soy un array' } });
check('historial no-array se ignora', history().length === 0);

await call({
  body: {
    message: 'hola',
    history: Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
    })),
  },
});
check('historial se recorta', history().length <= 11, String(history().length));

await call({ body: { message: 'x'.repeat(5000) } });
check('mensaje se recorta a 1000', sent().content.length === 1000, String(sent().content.length));

await call({
  body: { message: 'hola', history: [{ role: 'system', content: 'ignorar' }, { role: 'user', content: null }] },
});
check('filtra roles y contenidos inválidos', history().length === 0);

// ------------------------------------------------------------------
section('4. Contexto de pantalla');
await call({ body: { message: 'hola', context: { screen: 3, operation: 'RETIRO' } } });
check('inyecta la pantalla', lastRequestBody.system.includes('Pantalla actual'));
check('inyecta la operación', lastRequestBody.system.includes('Retiro de Herramienta'));

await call({ body: { message: 'hola', context: { screen: 2, operation: 'DEVOLUCIÓN' } } });
check('acepta DEVOLUCIÓN con tilde', lastRequestBody.system.includes('Devolución de Herramienta'));

await call({ body: { message: 'hola', context: { screen: 99, operation: 'BORRADO' } } });
check('descarta pantalla fuera de lista', !lastRequestBody.system.includes('Pantalla actual'));
check('descarta operación desconocida', !lastRequestBody.system.includes('BORRADO'));

await call({ body: { message: 'hola', context: 'texto plano' } });
check('contexto no-objeto se ignora', !lastRequestBody.system.includes('Pantalla actual'));

// ------------------------------------------------------------------
section('5. Respuestas del modelo');
stubFetch(async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    content: [
      { type: 'thinking', thinking: 'no debe aparecer' },
      { type: 'text', text: 'Respuesta ' },
      { type: 'text', text: 'completa.' },
    ],
  }),
}));
const multi = await call({ body: { message: 'hola' } });
check('concatena solo bloques de texto', multi.body.reply === 'Respuesta completa.', JSON.stringify(multi.body));

stubFetch(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ content: [{ type: 'thinking', thinking: 'solo pensar' }] }),
}));
check('respuesta sin texto devuelve 502', (await call({ body: { message: 'hola' } })).statusCode === 502);

stubFetch(async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"invalid x-api-key"}}' }));
check('401 de Anthropic devuelve 502', (await call({ body: { message: 'hola' } })).statusCode === 502);

stubFetch(async () => ({ ok: false, status: 429, text: async () => '{"type":"rate_limit_error"}' }));
check('429 de Anthropic devuelve 429', (await call({ body: { message: 'hola' } })).statusCode === 429);

stubFetch(async () => ({ ok: false, status: 529, text: async () => 'overloaded' }));
check('529 de Anthropic devuelve 502', (await call({ body: { message: 'hola' } })).statusCode === 502);

globalThis.fetch = async () => {
  const err = new Error('aborted');
  err.name = 'TimeoutError';
  throw err;
};
const timedOut = await call({ body: { message: 'hola' } });
check('timeout devuelve 502', timedOut.statusCode === 502);
check('timeout pide reintentar', /tardó demasiado/.test(timedOut.body.error), timedOut.body.error);

// ------------------------------------------------------------------
section('6. Rate limit por IP');
process.env.CHAT_RATE_LIMIT = '3';
stubFetch(okResponse);
const statuses = [];
for (let i = 0; i < 5; i += 1) {
  statuses.push((await call({ body: { message: `msg ${i}` } })).statusCode);
}
check('permite hasta el límite', statuses.slice(0, 3).every((s) => s === 200), statuses.join(','));
check('bloquea al superarlo', statuses.slice(3).every((s) => s === 429), statuses.join(','));

const limited = await call({ body: { message: 'otra' } });
check('429 envía Retry-After', Number(limited.headers['retry-after']) > 0, String(limited.headers['retry-after']));

const otherIp = await call({ body: { message: 'hola' }, headers: { 'x-forwarded-for': '9.9.9.9' } });
check('otra IP no está limitada', otherIp.statusCode === 200);
delete process.env.CHAT_RATE_LIMIT;

// ------------------------------------------------------------------
section('7. Caché y método');
stubFetch(okResponse);
check('no-store en respuestas', (await call({ body: { message: 'hola' } })).headers['cache-control'] === 'no-store');

console.log(`\n${passed} ok, ${failed} fallo(s)`);
process.exitCode = failed ? 1 : 0;
