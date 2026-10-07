// Prueba del handler api/chat.js sin tocar la API real: se intercepta
// globalThis.fetch y se ejercita cada rama con req/res simulados.
//
// El handler tiene dos rutas (Gemini y Anthropic) y lo que cambia entre ellas es
// el cuerpo de la petición y cómo se lee la respuesta. La suite se corre entera
// contra las dos, para que un cambio en un proveedor no pueda romper el otro en
// silencio. Ejecutar: node scripts/test-chat.mjs

import handler from '../api/chat.js';

const { SYSTEM_PROMPT } = handler;

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

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FALLA ${name}${detail ? ` -> ${detail}` : ''}`);
  }
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

let lastRequest = null;
function stubFetch(impl) {
  globalThis.fetch = async (url, init) => {
    lastRequest = { url, init, body: JSON.parse(init.body) };
    return impl();
  };
}

// ------------------------------------------------------------------
// Lectores que esconden las diferencias de forma entre proveedores, para que
// las pruebas se puedan escribir una sola vez.
// ------------------------------------------------------------------
let providerName = 'gemini';

const systemText = () =>
  providerName === 'gemini' ? lastRequest.body.systemInstruction?.parts?.[0]?.text : lastRequest.body.system;

const turns = () =>
  providerName === 'gemini' ? lastRequest.body.contents : lastRequest.body.messages;

const textOf = (turn) => (providerName === 'gemini' ? turn.parts?.[0]?.text : turn.content);

const sent = () => turns().at(-1);
const history = () => turns().slice(0, -1);

function okResponse(text = 'Hola, ¿necesitás ayuda con el retiro?') {
  return {
    ok: true,
    status: 200,
    json: async () =>
      providerName === 'gemini'
        ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }
        : { content: [{ type: 'text', text }], model: 'claude-sonnet-5-5' },
  };
}

const PROVIDERS = {
  gemini: { key: 'GEMINI_API_KEY', value: 'gemini-test-key' },
  anthropic: { key: 'ANTHROPIC_API_KEY', value: 'sk-ant-test' },
};

function useProvider(name) {
  providerName = name;
  for (const [pname, cfg] of Object.entries(PROVIDERS)) {
    if (pname === name) process.env[cfg.key] = cfg.value;
    else delete process.env[cfg.key];
  }
  process.env.CHAT_PROVIDER = name;
}

// ------------------------------------------------------------------
// Secciones compartidas: se ejecutan para cada proveedor.
// ------------------------------------------------------------------
async function suiteCompartida() {
  section(`${providerName}: 0. Cómo se nombra al sistema`);

  // El operario no quiere que el asistente diga "kiosco". La palabra tiene que
  // seguir apareciendo en el prompt, pero solo dentro de la linea que la
  // prohibe: si alguien la reescribe como nombre del sistema, esto falla.
  const lineasConKiosco = SYSTEM_PROMPT.split('\n').filter((l) => /kiosco/i.test(l));
  check(
    'el prompt prohibe "kiosco" de forma explícita',
    /nunca digas\s+"kiosco"/i.test(SYSTEM_PROMPT),
    'sin la prohibicion, el modelo vuelve a usarlo'
  );
  check(
    '"kiosco" solo aparece en la linea que lo prohibe',
    lineasConKiosco.every((l) => /nunca digas/i.test(l)),
    `fuera de la prohibicion: ${lineasConKiosco.filter((l) => !/nunca digas/i.test(l)).join(' | ')}`
  );
  check(
    'el prompt se presenta solo como L.O.T.U.S.',
    /sos el asistente de ayuda de L\.O\.T\.U\.S\./i.test(SYSTEM_PROMPT)
  );

  section(`${providerName}: 0b. Inventario y altas`);

  // El inventario llega desde el navegador porque las herramientas viven en el
  // localStorage del cliente. Si no viaja, el modelo inventa cantidades.
  check(
    'el prompt manda JSON con reply y agregar',
    /\{\s*"reply"/.test(SYSTEM_PROMPT) && /"agregar"/.test(SYSTEM_PROMPT)
  );
  check(
    'el prompt prohibe los saludos con genero',
    /"Hola"/.test(SYSTEM_PROMPT) && /género/i.test(SYSTEM_PROMPT)
  );
  check('el prompt acota las altas', /máximo 20/i.test(SYSTEM_PROMPT));

  const invBody = (inventario) => ({ message: 'cuantas amoladoras hay', inventario });

  stubFetch(async () => okResponse('ok'));
  await call({
    body: invBody([
      { name: 'Amoladora Angular DeWalt', category: 'Eléctricas', status: 'maintenance' },
      { name: 'Amoladora Inalámbrica Bosch', category: 'Eléctricas', status: 'available' },
      { name: 'Llave de Impacto Neumática', category: 'Neumáticas', status: 'available' },
    ]),
  });
  const invSystem = systemText();
  check(
    'el inventario llega al prompt con nombre y estado',
    invSystem.includes('Amoladora Angular') && invSystem.includes('maintenance')
  );
  check('el prompt aclara cuántas herramientas hay', /Inventario actual \(3 herramienta/.test(invSystem));

  // Un estado fuera de la lista blanca no debe llegar al modelo.
  stubFetch(async () => okResponse('ok'));
  await call({
    body: invBody([
      { name: 'Inventada', category: 'X', status: 'inventado' },
      { name: '   ', category: 'Y', status: 'available' },
      { name: 'Real', category: 'Z', status: 'available' },
    ]),
  });
  const saneado = systemText();
  check('un estado inválido se normaliza', !saneado.includes('inventado'));
  check('una herramienta sin nombre se descarta', !saneado.includes('Sin categoría'));
  check('los nombres se limpian', saneado.includes('- Real |'));

  stubFetch(async () =>
    okResponse(
      JSON.stringify({
        reply: 'Listo, agregué los discos.',
        agregar: [
          { name: 'Disco de Corte 4 1/2"', category: 'Consumibles', status: 'available' },
          { name: 'Disco de Corte 7"', category: 'Consumibles', status: 'borrado' },
          { name: '', category: 'Basura', status: 'available' },
        ],
      })
    )
  );
  const altaRes = await call({ body: { message: 'agrega 2 discos de corte' } });
  check('devuelve las altas pedidas', altaRes.body.agregar?.length === 2, JSON.stringify(altaRes.body.agregar));
  check('sanea el estado de las altas', altaRes.body.agregar?.[1]?.status === 'available');
  check('descarta el alta sin nombre', !altaRes.body.agregar?.some((t) => t.name === ''));

  // El tope del prompt y el del código no pueden desincronizarse: si el prompt
  // promete 20 y el código corta en 3, el operario pierde altas sin avisar.
  const muchas = Array.from({ length: 40 }, (_, i) => ({
    name: `Herramienta ${i}`,
    category: 'Eléctricas',
    status: 'available',
  }));
  stubFetch(async () => okResponse(JSON.stringify({ reply: 'Listo.', agregar: muchas })));
  const topeRes = await call({ body: { message: 'agrega 40 herramientas' } });
  check('corta las altas al tope aunque manden más', topeRes.body.agregar?.length === 20, `volvieron ${topeRes.body.agregar?.length}`);

  // Un lote chico tiene que pasar entero: es el caso de "agregá 3 discos".
  stubFetch(async () =>
    okResponse(
      JSON.stringify({
        reply: 'Listo.',
        agregar: [1, 2, 3].map((n) => ({ name: `Disco ${n}`, category: 'Consumibles', status: 'available' })),
      })
    )
  );
  const loteRes = await call({ body: { message: 'agrega 3 discos de corte' } });
  check('un lote de 3 se devuelve entero', loteRes.body.agregar?.length === 3, `volvieron ${loteRes.body.agregar?.length}`);

  // Si el modelo no devuelve JSON, se muestra el texto crudo: es preferible una
  // respuesta sin altas a dejar al operario sin nada.
  stubFetch(async () => okResponse('Acá tenés dos amoladoras.'));
  const plano = await call({ body: { message: 'hola' } });
  check('si no hay JSON, responde con el texto crudo', plano.body.reply === 'Acá tenés dos amoladoras.');
  check('si no hay JSON, no inventa altas', plano.body.agregar?.length === 0);

  // JSON truncado: tampoco puede romper el chat.
  stubFetch(async () => okResponse('{"reply": "hola", "agregar": ['));
  const roto = await call({ body: { message: 'hola' } });
  check(
    'un JSON truncado no rompe el chat',
    typeof roto.body.reply === 'string' && roto.body.reply.length > 0,
    `status=${roto.statusCode} body=${JSON.stringify(roto.body)}`
  );

  // Este bug se vio en produccion: al preguntar "cuantas amoladoras hay" el
  // modelo devolvia la amoladora en "agregar" y cada pregunta duplicaba una
  // herramienta en el inventario del operario.
  stubFetch(async () =>
    okResponse(
      JSON.stringify({
        reply: 'Hay 1 amoladora.',
        agregar: [
          { name: 'Amoladora Angular 4 1/2" DeWalt', category: 'Eléctricas', status: 'maintenance' },
          { name: 'amoladora angular 4 1/2 dewalt', category: 'Eléctricas', status: 'available' },
          { name: 'Pinza Nueva', category: 'Manuales', status: 'available' },
        ],
      })
    )
  );
  const dupRes = await call({
    body: invBody([{ name: 'Amoladora Angular 4 1/2" DeWalt', category: 'Eléctricas', status: 'maintenance' }]),
  });
  check(
    'no agrega lo que ya esta en el inventario',
    dupRes.body.agregar?.length === 1 && dupRes.body.agregar[0].name === 'Pinza Nueva',
    JSON.stringify(dupRes.body.agregar)
  );
  check(
    'compara nombres sin tildes ni mayusculas',
    !dupRes.body.agregar?.some((t) => /amoladora/i.test(t.name)),
    JSON.stringify(dupRes.body.agregar?.map((t) => t.name))
  );

  // Dos altas iguales en la misma respuesta tampoco pueden colarse.
  stubFetch(async () =>
    okResponse(
      JSON.stringify({
        reply: 'Listo.',
        agregar: [
          { name: 'Disco 7"', category: 'Consumibles', status: 'available' },
          { name: 'disco 7', category: 'Consumibles', status: 'available' },
        ],
      })
    )
  );
  const intraRes = await call({ body: { message: 'agrega un disco' } });
  check('no deja dos altas iguales en la misma respuesta', intraRes.body.agregar?.length === 1, JSON.stringify(intraRes.body.agregar));

  // Con el inventario vacio el bot se ponia a inventar altas: en produccion, un
  // "hola" devolvia una llave ajustable que nadie habia pedido.
  stubFetch(async () =>
    okResponse(
      JSON.stringify({
        reply: 'Hola.',
        agregar: [{ name: 'Llave ajustable 10 pulgadas', category: 'Manuales', status: 'available' }],
      })
    )
  );
  const vacioRes = await call({ body: { message: 'hola' } });
  check('el prompt exige inventario para no inventar', /no se pudo leer el inventario/i.test(SYSTEM_PROMPT));
  check('un saludo o una consulta nunca es un alta', /JAMÁS son un alta/i.test(SYSTEM_PROMPT));
  check('el inventario va en cada consulta', typeof vacioRes.body.reply === 'string' && vacioRes.body.reply.length > 0);

  section(`${providerName}: 0c. Pedidos de compra`);

  // "nos faltan discos de corte" tiene que generar un pedido de compra, no un
  // alta de inventario: un disco que falta no es una herramienta del taller.
  check('el prompt explica el campo comprar', /campo "comprar"/.test(SYSTEM_PROMPT));
  check('el prompt separa comprar de agregar', /comprar", NO en "agregar|va en "comprar", NO en "agregar"/.test(SYSTEM_PROMPT));
  check('el prompt define la cantidad', /"quantity"/.test(SYSTEM_PROMPT));

  stubFetch(async () =>
    okResponse(
      JSON.stringify({
        reply: 'Anotado el pedido.',
        comprar: [
          { name: 'Disco de corte 4 1/2"', category: 'Consumibles', quantity: 3 },
          { name: 'Guantes de cuero', category: 'Seguridad', quantity: 0 },
          { name: 'Disco de corte 4 1/2"', category: 'Consumibles', quantity: 9 },
          { name: '', category: 'Basura', quantity: 1 },
        ],
      })
    )
  );
  const compraRes = await call({ body: { message: 'nos faltan discos de corte' } });
  check('devuelve los pedidos pedidos', compraRes.body.comprar?.length === 2, JSON.stringify(compraRes.body.comprar));
  check('conserva la cantidad', compraRes.body.comprar?.[0]?.quantity === 3, String(compraRes.body.comprar?.[0]?.quantity));
  check('una cantidad 0 sube a 1', compraRes.body.comprar?.[1]?.quantity === 1, String(compraRes.body.comprar?.[1]?.quantity));
  check('no duplica pedidos del mismo artículo', !compraRes.body.comprar?.some((p) => p.quantity === 9));
  check('descarta el pedido sin nombre', !compraRes.body.comprar?.some((p) => p.name === ''));

  // Una consulta no genera pedidos: si no, cada "¿qué falta?" crea uno.
  stubFetch(async () =>
    okResponse(JSON.stringify({ reply: 'Faltan los discos.', comprar: [{ name: 'Disco', quantity: 1 }] }))
  );
  const consultaRes = await call({ body: { message: 'que falta?' } });
  check('una consulta puede devolver pedidos si el modelo los manda', consultaRes.body.comprar?.length === 1);

  // Si no hay pedidos, el campo tiene que venir vacío y no romper el chat.
  stubFetch(async () => okResponse('Hola.'));
  const sinPedidos = await call({ body: { message: 'hola' } });
  check('sin JSON no inventa pedidos', sinPedidos.body.comprar?.length === 0);

  // El caso que aparece contra Gemini real: el modelo anota el pedido y ademas
// mete el mismo consumible como alta de inventario. El servidor lo descarta.
stubFetch(async () =>
  okResponse(
    JSON.stringify({
      reply: 'Anotado.',
      agregar: [
        { name: 'Disco de Corte 4 1/2"', category: 'Consumibles', status: 'available' },
        { name: 'Guantes de Cuero', category: 'Seguridad', status: 'available' },
        { name: 'Amoladora Angular', category: 'Electricas', status: 'available' },
      ],
      comprar: [{ name: 'Disco de corte 4 1/2"', category: 'Consumibles', quantity: 3 }],
    })
  )
);
const ambos = await call({ body: { message: 'nos faltan discos de corte' } });
check('un consumible pedido no entra tambien como alta', !ambos.body.agregar?.some((t) => /disco/i.test(t.name)), JSON.stringify(ambos.body.agregar?.map((t) => t.name)));
check('el resto de las altas se conserva', ambos.body.agregar?.some((t) => /amoladora/i.test(t.name)));

section(`${providerName}: 1. Método y configuración`);
  stubFetch(okResponse);
  check('GET devuelve 405', (await call({ method: 'GET' })).statusCode === 405);
  check('405 envía cabecera Allow', (await call({ method: 'GET' })).headers.allow === 'POST');

  const keyEnv = PROVIDERS[providerName].key;
  delete process.env[keyEnv];
  const noKey = await call({ body: { message: 'hola' } });
  check(`sin ${keyEnv} devuelve 503`, noKey.statusCode === 503, `fue ${noKey.statusCode}`);
  check('el 503 nombra la variable que falta', noKey.body?.error?.includes(keyEnv), noKey.body?.error);
  process.env[keyEnv] = PROVIDERS[providerName].value;

  check('mensaje vacío devuelve 400', (await call({ body: { message: '   ' } })).statusCode === 400);
  check('body no objeto devuelve 400', (await call({ body: null })).statusCode === 400);

  // ----------------------------------------------------------------
  section(`${providerName}: 2. Historial`);
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
  check('mensaje se recorta a 1000', textOf(sent()).length === 1000, String(textOf(sent()).length));

  await call({
    body: { message: 'hola', history: [{ role: 'system', content: 'ignorar' }, { role: 'user', content: null }] },
  });
  check('filtra roles y contenidos inválidos', history().length === 0);

  // ----------------------------------------------------------------
  section(`${providerName}: 3. Contexto de pantalla`);
  await call({ body: { message: 'hola', context: { screen: 3, operation: 'RETIRO' } } });
  check('inyecta la pantalla', systemText().includes('Pantalla actual'));
  check('inyecta la operación', systemText().includes('Retiro de Herramienta'));

  await call({ body: { message: 'hola', context: { screen: 2, operation: 'DEVOLUCIÓN' } } });
  check('acepta DEVOLUCIÓN con tilde', systemText().includes('Devolución de Herramienta'));

  await call({ body: { message: 'hola', context: { screen: 99, operation: 'BORRADO' } } });
  check('descarta pantalla fuera de lista', !systemText().includes('Pantalla actual'));
  check('descarta operación desconocida', !systemText().includes('BORRADO'));

  await call({ body: { message: 'hola', context: 'texto plano' } });
  check('contexto no-objeto se ignora', !systemText().includes('Pantalla actual'));

  // ----------------------------------------------------------------
  section(`${providerName}: 4. Errores del proveedor`);
  stubFetch(async () => ({ ok: false, status: 429, text: async () => '{"error":{"message":"quota"}}' }));
  check('429 devuelve 429', (await call({ body: { message: 'hola' } })).statusCode === 429);

  stubFetch(async () => ({ ok: false, status: 529, text: async () => 'overloaded' }));
  check('5xx del proveedor devuelve 502', (await call({ body: { message: 'hola' } })).statusCode === 502);

  stubFetch(async () => ({ ok: false, status: 400, text: async () => '{"error":{"message":"bad request"}}' }));
  check('400 del proveedor devuelve 502', (await call({ body: { message: 'hola' } })).statusCode === 502);

  // Una clave mal pegada tiene que verse como configuracion faltante, no como
  // una falla transitoria que invita a reintentar.
  stubFetch(async () => ({
    ok: false,
    status: 400,
    text: async () =>
      '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}',
  }));
  check('400 de clave inválida devuelve 503', (await call({ body: { message: 'hola' } })).statusCode === 503);

  stubFetch(async () => ({ ok: false, status: 403, text: async () => '{"error":{"message":"PERMISSION_DENIED"}}' }));
  check('403 devuelve 503', (await call({ body: { message: 'hola' } })).statusCode === 503);

  stubFetch(async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"unauthorized"}}' }));
  check('401 devuelve 503', (await call({ body: { message: 'hola' } })).statusCode === 503);

  globalThis.fetch = async () => {
    const err = new Error('aborted');
    err.name = 'TimeoutError';
    throw err;
  };
  const timedOut = await call({ body: { message: 'hola' } });
  check('timeout devuelve 502', timedOut.statusCode === 502);
  check('timeout pide reintentar', /tardó demasiado/.test(timedOut.body.error), timedOut.body.error);

  // ----------------------------------------------------------------
  section(`${providerName}: 5. Rate limit por IP`);
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

  // ----------------------------------------------------------------
  section(`${providerName}: 6. Caché`);
  stubFetch(okResponse);
  check('no-store en respuestas', (await call({ body: { message: 'hola' } })).headers['cache-control'] === 'no-store');
}

// ------------------------------------------------------------------
// Lo que es propio de cada proveedor.
// ------------------------------------------------------------------
async function suiteGemini() {
  section('gemini: 7. Cuerpo de la petición');
  await call({ body: { message: '¿cómo retiro una herramienta?' } });
  check('modelo por defecto gemini-3.5-flash-lite', lastRequest.url.includes('gemini-3.5-flash-lite'), lastRequest.url);
  check('la URL termina en :generateContent', lastRequest.url.endsWith(':generateContent'), lastRequest.url);
  check('usa la API v1beta', lastRequest.url.includes('/v1beta/models/'), lastRequest.url);
  check('clave en x-goog-api-key', lastRequest.init.headers['x-goog-api-key'] === 'gemini-test-key');
  // Medido contra la API real: thinkingLevel "off" da 400 y thinkingBudget 0 da
  // 400 en dos de cada tres flash-lite, así que no se manda nada.
  check('no manda thinkingConfig', lastRequest.body.generationConfig?.thinkingConfig === undefined);
  check('maxOutputTokens >= 1024', lastRequest.body.generationConfig?.maxOutputTokens >= 1024, String(lastRequest.body.generationConfig?.maxOutputTokens));

  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  await call({ body: { message: 'hola' } });
  check('modelo se puede sobreescribir por env', lastRequest.url.includes('gemini-3.8-flash'), lastRequest.url);
  delete process.env.GEMINI_MODEL;

  await call({
    body: {
      message: 'nueva',
      history: [
        { role: 'user', content: 'vieja' },
        { role: 'assistant', content: 'respuesta' },
      ],
    },
  });
  check(
    'mapea assistant a model',
    turns()[1].role === 'model',
    JSON.stringify(turns().map((t) => t.role))
  );
  check('el usuario sigue siendo user', turns()[0].role === 'user');

  section('gemini: 8. Lectura de la respuesta');
  stubFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              { text: 'Voy a pensar', thought: true },
              { text: 'Respuesta ' },
              { text: 'completa.' },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    }),
  }));
  const multi = await call({ body: { message: 'hola' } });
  check('concatena solo bloques de texto', multi.body.reply === 'Respuesta completa.', JSON.stringify(multi.body));
  check('filtra los bloques de razonamiento (thought:true)', !multi.body.reply.includes('Voy a pensar'), multi.body.reply);

  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) }));
  check('respuesta sin candidatos devuelve 502', (await call({ body: { message: 'hola' } })).statusCode === 502);

  stubFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'x', thought: true }] }, finishReason: 'STOP' }] }),
  }));
  check('solo razonamiento devuelve 502', (await call({ body: { message: 'hola' } })).statusCode === 502);

  // Una clave rechazada es configuración, no una caída transitoria.
  stubFetch(async () => ({ ok: false, status: 403, text: async () => '{"error":{"message":"API key not valid"}}' }));
  check('403 de Google devuelve 503', (await call({ body: { message: 'hola' } })).statusCode === 503);
}

async function suiteAnthropic() {
  section('anthropic: 7. Cuerpo de la petición');
  await call({ body: { message: '¿cómo retiro una herramienta?' } });
  check('modelo por defecto claude-sonnet-5-5', lastRequest.body.model === 'claude-sonnet-5-5', lastRequest.body.model);
  check('thinking es between_tools', lastRequest.body.thinking?.type === 'between_tools');
  check('effort es low', lastRequest.body.output_config?.effort === 'low');
  check('max_tokens >= 1024', lastRequest.body.max_tokens >= 1024, String(lastRequest.body.max_tokens));
  check('manda la versión de la API', lastRequest.init.headers['anthropic-version'] === '2023-06-01');

  process.env.ANTHROPIC_EFFORT = 'medium';
  await call({ body: { message: 'hola' } });
  check('effort se puede sobreescribir por env', lastRequest.body.output_config?.effort === 'medium');
  delete process.env.ANTHROPIC_EFFORT;

  process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5';
  await call({ body: { message: 'hola' } });
  check('modelo se puede sobreescribir por env', lastRequest.body.model === 'claude-haiku-4-5');
  delete process.env.ANTHROPIC_MODEL;

  section('anthropic: 8. Lectura de la respuesta');
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
  check('401 de Anthropic devuelve 503', (await call({ body: { message: 'hola' } })).statusCode === 503);
}

// ------------------------------------------------------------------
section('0. Selección de proveedor');
useProvider('gemini');
stubFetch(okResponse);
await call({ body: { message: 'hola' } });
check('sin CHAT_PROVIDER usa gemini', lastRequest.url.includes('generativelanguage.googleapis.com'), lastRequest.url);

useProvider('anthropic');
await call({ body: { message: 'hola' } });
check('CHAT_PROVIDER=anthropic cambia la URL', lastRequest.url === 'https://api.anthropic.com/v1/messages', lastRequest.url);

useProvider('groq');
check('proveedor desconocido devuelve 500', (await call({ body: { message: 'hola' } })).statusCode === 500);

useProvider('gemini');
await suiteCompartida();
await suiteGemini();

useProvider('anthropic');
await suiteCompartida();
await suiteAnthropic();

console.log(`\n${passed} ok, ${failed} fallo(s)`);
process.exitCode = failed ? 1 : 0;