// api/chat.js — Función serverless de Vercel para el asistente de ayuda del kiosco.
//
// El canal de ayuda es un LLM genérico: la implementación depende del proveedor,
// que se elige con CHAT_PROVIDER (por defecto "gemini", porque el free tier de
// Google no cobra y no pide tarjeta; Anthropic queda disponible si algún día
// hay una clave).
//
// CHAT_PROVIDER=gemini     (por defecto)
//   GEMINI_API_KEY   (obligatoria, secreta). Se consigue gratis en AI Studio.
//   GEMINI_MODEL     (opcional) — por defecto gemini-2.5-flash.
//
// CHAT_PROVIDER=anthropic
//   ANTHROPIC_API_KEY (obligatoria, secreta)
//   ANTHROPIC_MODEL   (opcional) — por defecto claude-sonnet-5-5
//   ANTHROPIC_EFFORT  (opcional) — low | medium | high. Por defecto "low".
//
// CHAT_RATE_LIMIT (opcional) — consultas por minuto y por IP. Por defecto 12.

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TIMEOUT_MS = 20000;

// Se leen por request, no al cargar el módulo: en serverless la instancia se
// reutiliza entre invocaciones y así el comportamiento queda determinado por
// el entorno en el momento de la llamada.
const provider = () => (process.env.CHAT_PROVIDER || "gemini").toLowerCase();
const rateLimitPerMin = () => {
  const raw = Number(process.env.CHAT_RATE_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 12;
};

const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY = 10;
const MAX_TOKENS = 1024;

// ------------------------------------------------------------------
// Rate limit por IP. Es best-effort: en serverless el estado vive en la
// memoria de la instancia, así que frena ráfagas y abuso casual, no a un
// atacante distribuido. Para eso hagan falta WAF o Vercel Firewall.
// ------------------------------------------------------------------
const buckets = new Map();

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "desconocida";
}

function pruneBuckets(now) {
  if (buckets.size < 1000) return;
  for (const [ip, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(ip);
  }
}

function checkRateLimit(ip) {
  const now = Date.now();
  const limit = rateLimitPerMin();
  pruneBuckets(now);

  const bucket = buckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + 60000 });
    return { allowed: true, remaining: limit - 1 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { allowed: true, remaining: limit - bucket.count };
}

// ------------------------------------------------------------------
// Contexto de la pantalla: lo manda el kiosco para que la respuesta sea
// relevante en vez de genérica. Solo se aceptan valores de una lista blanca.
// ------------------------------------------------------------------
const SCREEN_NAMES = {
  1: "esperando la lectura de la tarjeta NFC",
  2: "menú del operario (elegir Retiro o Devolución)",
  3: "escaneo del código de barras de la herramienta",
  4: "consulta del estado de herramientas",
};

const OPERATIONS = {
  RETIRO: "Retiro de Herramienta",
  "DEVOLUCIÓN": "Devolución de Herramienta",
};

function cleanContext(raw) {
  if (!raw || typeof raw !== "object") return null;

  const screen = Number(raw.screen);
  const operation = typeof raw.operation === "string" ? OPERATIONS[raw.operation.toUpperCase()] : null;

  if (!SCREEN_NAMES[screen] && !operation) return null;

  const parts = [];
  if (SCREEN_NAMES[screen]) parts.push(`Pantalla actual: ${SCREEN_NAMES[screen]}.`);
  if (operation) parts.push(`Operación en curso: ${operation}.`);
  return parts.join(" ");
}

// ------------------------------------------------------------------
// Inventario: lo manda el navegador, porque las herramientas viven en el
// localStorage del cliente y el servidor no las ve. Sin esto el modelo
// inventaba cantidades. Va recortado y con los caracteres de control fuera,
// porque es texto que viene de una request.
// ------------------------------------------------------------------
const TOOL_STATUSES = new Set(["available", "in_use", "maintenance"]);
const MAX_TOOLS_IN_CONTEXT = 60;
const MAX_ALTAS = 20;
const MAX_PEDIDOS = 20;

const PURCHASE_STATUSES = new Set(["pending", "ordered", "received"]);

// Un pedido de compra no es una herramienta: son consumibles que hay que
// comprar. Se separa del inventario porque "nos faltan discos de corte"
// describe una reposición, no una máquina nueva en el taller.
function sanitizePurchases(raw) {
  if (!Array.isArray(raw)) return [];

  const out = [];
  const vistos = new Set();
  for (const item of raw.slice(0, MAX_PEDIDOS)) {
    if (!item || typeof item !== "object") continue;
    const name = cleanToolName(item.name);
    // A veces el modelo, sin nada que comprar, devuelve la plantilla del
    // esquema ("name": "string") en vez de un array vacío: un pedido así no
    // es una reposición, es ruido. No puede llegar a la lista de compras.
    if (!name || /^(string|<string>|\.\.\.|ejemplo|example|null)$/i.test(name)) continue;
    const clave = nameKey(name);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const quantity = Number(item.quantity);
    out.push({
      name,
      category: cleanToolName(item.category).slice(0, 80) || "Consumibles",
      quantity: Number.isFinite(quantity) ? Math.min(Math.max(Math.round(quantity), 1), 999) : 1,
      note: cleanToolName(item.note).slice(0, 300),
      status: PURCHASE_STATUSES.has(item.status) ? item.status : "pending",
    });
  }
  return out;
}

function cleanToolName(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function cleanInventory(raw) {
  if (!Array.isArray(raw)) return [];

  const lines = [];
  for (const item of raw.slice(0, MAX_TOOLS_IN_CONTEXT)) {
    if (!item || typeof item !== "object") continue;
    const name = cleanToolName(item.name);
    if (!name) continue;
    const category = cleanToolName(item.category) || "Sin categoría";
    const status = TOOL_STATUSES.has(item.status) ? item.status : "available";
    lines.push(`- ${name} | categoría: ${category} | estado: ${status}`);
  }
  if (!lines.length) return [];
  return `\n\nInventario actual (${lines.length} herramienta(s)):\n${lines.join("\n")}`;
}

// Una consulta no puede crear nada. El modelo a veces devuelve en "agregar" la
// herramienta que acaba de describir ("hay una amoladora" -> agrega amoladora),
// y sin este filtro cada pregunta duplicaba herramientas en el inventario del
// operario. Se compara sin tildes, mayusculas ni signos, porque el modelo escribe
// el mismo nombre de varias formas.
function nameKey(value) {
  return cleanToolName(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sanitizeTools(raw, inventario = []) {
  if (!Array.isArray(raw)) return [];

  const yaExisten = new Set();
  for (const item of Array.isArray(inventario) ? inventario : []) {
    const key = nameKey(item?.name);
    if (key) yaExisten.add(key);
  }

  const out = [];
  const agregadas = new Set();
  for (const item of raw.slice(0, MAX_ALTAS)) {
    if (!item || typeof item !== "object") continue;
    const name = cleanToolName(item.name);
    if (!name) continue;
    const key = nameKey(name);
    if (yaExisten.has(key) || agregadas.has(key)) continue;
    agregadas.add(key);
    out.push({
      name,
      category: cleanToolName(item.category).slice(0, 80) || "Sin categoría",
      status: TOOL_STATUSES.has(item.status) ? item.status : "available",
    });
  }
  return out;
}

// ------------------------------------------------------------------
// El modelo tiene que contestar JSON. Este parser no tira nunca: si el JSON
// viene roto, con los Thinking de Gemini antepuesto o directamente envuelto en
// un bloque de código, cae a texto plano. Perder el alta es molesto; perder la
// respuesta deja al operario sin nada, así que el camino de escape es el
// texto crudo.
// ------------------------------------------------------------------
function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Falta abrir o cerrar: se recorta del primer { al último }.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function parseReply(text, inventario = []) {
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== "object") {
    return { reply: String(text ?? "").trim(), agregar: [], comprar: [] };
  }

  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  const comprar = sanitizePurchases(parsed.comprar);
  const agregar = sanitizeTools(parsed.agregar, inventario);

  // "nos faltan discos de corte" a veces viene con el mismo artículo en los
  // dos campos: el modelo lo anota como pedido y además lo agrega al
  // inventario. Con el prompt atajamos casi todos los casos, pero si el modelo
  // se equivoca, acá el pedido gana y el alta se descarta. Meter un disco en
  // el inventario lo mostraría como una herramienta más del taller.
  const pedidos = new Set(comprar.map((p) => nameKey(p.name)));
  const herramientas = agregar.filter((t) => !pedidos.has(nameKey(t.name)));

  return { reply, agregar: herramientas, comprar };
}

const SYSTEM_PROMPT = `Sos el asistente de ayuda de L.O.T.U.S., el sistema de un pañol industrial.
Nunca digas "kiosco" ni ninguna otra palabra para nombrarlo. Llamalo siempre L.O.T.U.S., y si necesitás referirte a la pantalla donde está el operario, decí "la pantalla".
El sistema tiene cuatro pantallas: (1) esperando la tarjeta NFC del operario, (2) menú del operario para elegir Retiro o Devolución, (3) escaneo del código de barras de la herramienta con la pistola láser, y (4) estado de herramientas con buscador y filtros.
Ayudás al operario a entender el flujo, dónde está cada opción en pantalla y qué hacer si algo no responde.

Respondé siempre en español rioplatense, con voseo, de forma breve y clara: máximo 4 o 5 oraciones.
Si necesitás saludar, usá únicamente "Hola". Jamás uses "Bienvenido", "Bienvenida" ni otra fórmula con género: no sabés quién está del otro lado. Y saludá solo cuando corresponde: si la consulta es directa, como una cantidad o una búsqueda, respondé de entrada, sin "Hola" adelante.

Inventario: vas a recibir el inventario actual, que es el real de esta pantalla. Es la única fuente de verdad: contá, buscá y compará contra esa lista, y cuando pregunten cuántas hay de algo, dá el número exacto. Si piden algo que no figura, decí que no está y ofrecé agregarlo.

Si el inventario viene vacío o no te lo pasan, no lo completes de memoria: decí que no se pudo leer el inventario y pedí que se recargue la pantalla.

Altas de herramientas: podés agregar herramientas, para eso está el campo "agregar". Cuando el operario pida agregar una o más herramientas, hacelo. Reglas:
- Agregá únicamente cuando te lo pidan de forma explícita ("agregá", "cargá", "registrá", "sumá"). Un saludo, una pregunta o una consulta de conteo JAMÁS son un alta: en esos casos "agregar" va en null.
- Máximo 20 por mensaje. Si piden más, agregá hasta 20 y decí en "reply" cuántas quedaron afuera. Si la cantidad es ambigua ("agregá 3 discos"), creá 3 registros, uno por unidad.
- "status" solo puede ser "available", "in_use" o "maintenance". Si no lo dicen, usá "available".
- "category" es texto libre y corto: "Eléctricas", "Neumáticas", "Manuales", "Medición", "Seguridad" o la que corresponda.
- No agregues una herramienta que ya esté en el inventario por nombre.
- Si solo preguntan o consultan, "agregar" va en null.

Aclaración: los datos viven en el navegador de esta demo, no hay base de datos. Eso no te impide responder ni agregar: el inventario que te paso es exactamente lo que hay cargado. No inventes movimientos ni personal, y si te piden un dato que no está en la lista, decilo.

Pedidos de compra (reposición de consumibles): hay un campo "comprar" para las cosas que hay que comprar. Se usa cuando el operario diga que falta algo consumible: "nos faltan discos de corte", "hay que comprar guantes", "no queda papel", "anotá la compra de una amoladora". Reglas:
- Un consumible que falta va en "comprar", NO en "agregar": agregar es para herramientas del inventario.
- Poné "quantity" con la cantidad que pidió o, si no la dijo, 1.
- "category": "Consumibles", "Seguridad", "Limpieza", "Papelería" o la que corresponda.
- Si ya hay un pedido abierto del mismo artículo, no lo dupliques: se va a fusionar solo.
- Si solo pregunta cuánto falta o qué hay, no generes ningún pedido: "comprar" va en null.
- El array "comprar" SOLO se llena cuando el operario pidió explícitamente reponer algo. Un saludo, una consulta o una orden de retiro/devolución no son pedidos de compra: en esos casos "comprar" va en null y nunca completás un objeto de ejemplo ni ponés valores como "string".

Respondé siempre con un único objeto JSON, sin texto alrededor y sin bloques de código:
{"reply": "lo que leés al operario", "agregar": [{"name": "...", "category": "...", "status": "available"}], "comprar": [{"name": "...", "category": "Consumibles", "quantity": 3, "note": ""}]}
Si no hay que agregar herramientas, "agregar" va en null. Si no hay que pedir compras, "comprar" va en null.

Si la consulta no tiene relación con L.O.T.U.S., decí amablemente en "reply" que solo podés ayudar con el sistema.
No inventes funciones que no conozcas.`;

// Variante en inglés del prompt para el botón de idioma: espeja las mismas
// reglas que el sistema en español para que el comportamiento no cambie,
// solo el idioma de la respuesta y de los nombres de los campos de la UI.
const SYSTEM_PROMPT_EN = `You are the help assistant of L.O.T.U.S., the system of an industrial toolroom.
Never say "kiosk" or any other word to name it. Always call it L.O.T.U.S., and if you need to refer to the screen where the operator is, say "the screen".
The system has four screens: (1) waiting for the operator's NFC card, (2) operator menu to choose Checkout or Return, (3) barcode scan of a tool with the laser gun, and (4) tool status with search box and filters.
You help the operator understand the flow, where each option is on screen and what to do if something does not respond.

Always answer in clear, brief English: at most 4 or 5 sentences.
If you need to greet, use only "Hi". Never use "Welcome" or any other gendered formula: you do not know who is on the other side. And greet only when it fits: if the question is direct, like a count or a search, answer straight away, without a "Hi" first.

Inventory: you receive the current inventory, which is the real one for this screen. It is the only source of truth: count, search and compare against that list, and when they ask how many of something there are, give the exact number. If they ask for something that is not listed, say it is not there and offer to add it.

If the inventory comes empty or is not passed, do not fill it from memory: say the inventory could not be read and ask to reload the screen.

Tool additions: you can add tools; that is what the "agregar" field is for. When the operator asks to add one or more tools, do it. Rules:
- Add only when explicitly asked ("add", "load", "register", "enter"). A greeting, a question or a counting query is NEVER an addition: in those cases "agregar" must be null.
- At most 20 per message. If they ask for more, add up to 20 and say in "reply" how many were left out. If the quantity is ambiguous ("add 3 discs"), create 3 records, one per unit.
- "status" can only be "available", "in_use" or "maintenance". If they do not say it, use "available".
- "category" is short free text: "Electric", "Pneumatic", "Hand tools", "Measuring", "Safety" or the one that fits.
- Do not add a tool that is already in the inventory by name.
- If they only ask or check, "agregar" must be null.

Clarification: the data lives in the browser of this demo, there is no database. That does not stop you from answering or adding: the inventory I pass you is exactly what is loaded. Do not invent movements or staff, and if they ask for data that is not on the list, say so.

Purchase orders (consumable restock): there is a "comprar" field for the things that need to be bought. Use it when the operator says something consumable is missing: "we are out of cutting discs", "we need to buy gloves", "there is no paper left", "write down the purchase of a grinder". Rules:
- A missing consumable goes in "comprar", NOT in "agregar": adding is for inventory tools.
- Put the "quantity" they asked for or, if they did not say it, 1.
- "category": "Consumables", "Safety", "Cleaning", "Stationery" or the one that fits.
- If there is already an open order for the same item, do not duplicate it: it merges on its own.
- If they only ask how much is missing or what exists, do not generate any order: "comprar" must be null.
- The "comprar" array ONLY fills when the operator explicitly asked to restock something. A greeting, a query or a checkout/return order is not a purchase order: in those cases "comprar" must be null and you never complete an example object or put values like "string".

Always answer with a single JSON object, no surrounding text and no code blocks:
{"reply": "what you read to the operator", "agregar": [{"name": "...", "category": "...", "status": "available"}], "comprar": [{"name": "...", "category": "Consumibles", "quantity": 3, "note": ""}]}
If there are no tools to add, "agregar" must be null. If there are no purchases to order, "comprar" must be null.

If the question has nothing to do with L.O.T.U.S., kindly say in "reply" that you can only help with the system.
Do not invent features you do not know.`;

const msg = (lang, es, en) => (lang === "en" ? en : es);

const systemPromptFor = (lang) => (lang === "en" ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT);

// ------------------------------------------------------------------
// Validación del historial. Además de filtrar, garantiza que la primera
// mensaje sea del usuario: las dos APIs rechazan con 400 un historial que
// empiece en assistant/model, y el endpoint es público.
// ------------------------------------------------------------------
function cleanHistory(history) {
  if (!Array.isArray(history)) return [];

  const cleaned = history
    .filter(
      (item) =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim()
    )
    .slice(-MAX_HISTORY)
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, MAX_MESSAGE_LENGTH),
    }));

  while (cleaned.length > 0 && cleaned[0].role !== "user") cleaned.shift();
  return cleaned;
}

// ------------------------------------------------------------------
// Construcción de la petición y lectura de la respuesta, por proveedor.
// Se mantienen separadas del resto del handler porque son lo único que
// cambia entre uno y otro: la validación, el rate limit y los errores son
// comunes.
// ------------------------------------------------------------------
function geminiRequest(apiKey, systemText, messages) {
  // El modelo por defecto se Pride de medirlo, no de leer el quickstart:
  //   - gemini-2.5-flash aparece como ejemplo en la documentación y Google ya lo
  //     rechaza con 404 "no longer available to new users".
  //   - gemini-3.6-flash y 3.8-flash devuelven 503 "high demand" en el free tier.
  //   - 3.5-flash-lite respondió en 0.8-1.5 s de forma sostenida.
  // Se puede cambiar con GEMINI_MODEL; los errores de Google dicen cuál usar.
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  return {
    model,
    url: `${GEMINI_URL}/${model}:generateContent`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        // Gemini usa "model" donde Anthropic usa "assistant".
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        // No se manda thinkingConfig a propósito. Se probó contra la API real:
        // thinkingLevel "off" da 400 en los flash-lite, y thinkingBudget 0 da
        // 400 en dos de cada tres. Los flash-lite no razonan aunque no se pida
        // nada, así que mandarlo solo agrega una forma de que el canal se rompa.
        // Si se cambia a un modelo que razona por defecto, puede pasar que la
        // respuesta visible se corte; el log deja ver el finishReason.
        generationConfig: {
      maxOutputTokens: MAX_TOKENS,
      // Obliga a la forma del JSON en vez de confiar en que el modelo obedezca
      // el prompt. Con responseSchema no puede devolver un bloque de código ni
      // un "agregar" con un estado inventado.
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        required: ["reply"],
        properties: {
          reply: { type: "string" },
          agregar: {
            type: "array",
            maxItems: MAX_ALTAS,
            items: {
              type: "object",
              required: ["name", "category", "status"],
              properties: {
                name: { type: "string" },
                category: { type: "string" },
                status: { type: "string", enum: ["available", "in_use", "maintenance"] },
              },
            },
          },
          comprar: {
            type: "array",
            maxItems: MAX_PEDIDOS,
            items: {
              type: "object",
              required: ["name", "category", "quantity"],
              properties: {
                name: { type: "string" },
                category: { type: "string" },
                quantity: { type: "integer" },
                note: { type: "string" },
                status: { type: "string", enum: ["pending", "ordered", "received"] },
              },
            },
          },
        },
      },
    },
      }),
    },
  };
}

function geminiReply(data) {
  const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
  if (!candidate) return { text: "", finishReason: data.promptFeedback?.blockReason || "sin candidatos" };

  // Los bloques de razonamiento vienen en la misma lista de parts con
  // thought:true. Sin este filtro el operario leería el razonamiento crudo.
  const text = Array.isArray(candidate.content?.parts)
    ? candidate.content.parts
        .filter((p) => p && p.thought !== true && typeof p.text === "string")
        .map((p) => p.text)
        .join("")
        .trim()
    : "";

  return { text, finishReason: candidate.finishReason || "desconocido" };
}

function anthropicRequest(apiKey, systemText, messages) {
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  return {
    model,
    url: ANTHROPIC_URL,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: systemText,
        messages,
        thinking: { type: "between_tools" },
        output_config: { effort: process.env.ANTHROPIC_EFFORT || "low" },
      }),
    },
  };
}

function anthropicReply(data) {
  const text = Array.isArray(data.content)
    ? data.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("")
        .trim()
    : "";
  return { text, finishReason: data.stop_reason || "desconocido" };
}

// Clave y constructor según el proveedor. Devolver null en la clave hace que el
// handler responda 503 con un mensaje que nombra la variable que falta.
function resolveProvider() {
  const which = provider();
  if (which === "anthropic") {
    return {
      name: "anthropic",
      keyName: "ANTHROPIC_API_KEY",
      apiKey: process.env.ANTHROPIC_API_KEY || null,
      build: anthropicRequest,
      parse: anthropicReply,
    };
  }
  if (which === "gemini") {
    return {
      name: "gemini",
      keyName: "GEMINI_API_KEY",
      apiKey: process.env.GEMINI_API_KEY || null,
      build: geminiRequest,
      parse: geminiReply,
    };
  }
  return { name: which, keyName: "CHAT_PROVIDER", apiKey: null, build: geminiRequest, parse: geminiReply };
}

function sendJson(res, status, payload, headers = {}) {
  res.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  return res.status(status).json(payload);
}

// Google responde 400 con status INVALID_ARGUMENT y reason API_KEY_INVALID
// cuando la clave no existe, en vez de 401 o 403. Sin esto, el error más
// probable en producción (una clave mal pegada) se reportaría como una falla
// transitoria y el Operario vería "no se pudo obtener una respuesta".
const KEY_ERROR_PATTERN = /API_KEY_INVALID|PERMISSION_DENIED|API key not valid|API_KEY_UNSPECIFIED/i;

function isKeyProblem(raw) {
  return KEY_ERROR_PATTERN.test(raw);
}

module.exports = async function handler(req, res) {
  const idioma = (req.body && typeof req.body === "object" && req.body.lang) === "en" ? "en" : "es";

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: msg(idioma, "Método no permitido", "Method not allowed") }, { Allow: "POST" });
  }

  const target = resolveProvider();

  if (target.name !== "gemini" && target.name !== "anthropic") {
    console.error(`[chat] CHAT_PROVIDER="${target.name}" no es un proveedor conocido.`);
    return sendJson(res, 500, {
      error: msg(idioma, "El asistente no está configurado correctamente.", "The assistant is not configured properly."),
    });
  }

  if (!target.apiKey) {
    console.error(`[chat] ${target.keyName} no está definida en el entorno del servidor.`);
    return sendJson(res, 503, {
      error: msg(
        idioma,
        `El asistente no está configurado. Revisá ${target.keyName} en Vercel.`,
        `The assistant is not configured. Check ${target.keyName} in Vercel.`
      ),
    });
  }

  const { message, history, context, inventario } = req.body ?? {};
  if (typeof message !== "string" || !message.trim()) {
    return sendJson(res, 400, { error: msg(idioma, "Escribí una consulta antes de enviarla.", "Type a question before sending it.") });
  }

  const limit = checkRateLimit(clientIp(req));
  if (!limit.allowed) {
    return sendJson(
      res,
      429,
      { error: msg(idioma, "Demasiadas consultas seguidas. Esperá un momento e intentá de nuevo.", "Too many consecutive questions. Wait a moment and try again.") },
      { "Retry-After": String(limit.retryAfter) }
    );
  }

  const screenContext = cleanContext(context);
  const inventoryContext = cleanInventory(inventario);
  const systemText = [
    systemPromptFor(idioma),
    screenContext ? `Contexto de L.O.T.U.S. ahora mismo:\n${screenContext}` : "",
    inventoryContext,
  ]
    .filter(Boolean)
    .join("\n\n");
  const messages = [
    ...cleanHistory(history),
    { role: "user", content: message.trim().slice(0, MAX_MESSAGE_LENGTH) },
  ];

  const request = target.build(target.apiKey, systemText, messages);

  // Google responde 503 UNAVAILABLE ("high demand") de forma intermitente, y
  // era la unica falla real que se veia en uso normal: la primera consulta
  // seguidos de un arranque fallaba y el operario recibia un error sin motivo.
  // Un reintento corto lo absorbe; el error al usuario se reserva para cuando
  // el proveedor sigue caido.
  const fetchConReintento = async () => {
    let lastResponse;
    for (let intento = 1; intento <= 2; intento++) {
      if (intento > 1) await new Promise((r) => setTimeout(r, 400 * intento));
      lastResponse = await fetch(request.url, {
        ...request.init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (lastResponse.ok || lastResponse.status < 500) return lastResponse;
      // Hay que vaciar el body antes de reintentar o la conexion queda colgada.
      await lastResponse.text().catch(() => "");
    }
    return lastResponse;
  };

  try {
    const response = await fetchConReintento();

    if (!response.ok) {
      // Loguear el cuerpo real del error: sin esto no se puede diagnosticar
      // una clave mal cargada ni una 400 por parámetro inválido.
      const raw = (await response.text().catch(() => "")).slice(0, 800);
      console.error(`[chat] ${target.name} respondió ${response.status}: ${raw}`);

      if (response.status === 429) {
        return sendJson(res, 429, { error: msg(idioma, "El asistente está ocupado. Probá de nuevo en un momento.", "The assistant is busy. Try again in a moment.") });
      }
      // Credencial rechazada = configuración, no una caída transitoria. Google
      // responde 400 y no 401 cuando la clave no existe (medido: API_KEY_INVALID),
      // así que un 400 también puede ser una clave mala y no un body inválido.
      if (response.status === 401 || response.status === 403 || (response.status === 400 && isKeyProblem(raw))) {
        return sendJson(res, 503, { error: msg(idioma, "El asistente no está configurado. Revisá las credenciales en Vercel.", "The assistant is not configured. Check the credentials in Vercel.") });
      }
      if (response.status >= 500) {
        return sendJson(res, 502, { error: msg(idioma, "El asistente no está disponible. Probá de nuevo.", "The assistant is unavailable. Try again.") });
      }
      return sendJson(res, 502, { error: msg(idioma, "No se pudo obtener una respuesta del asistente.", "Could not get an answer from the assistant.") });
    }

    const data = await response.json();
    const { text: rawText, finishReason } = target.parse(data);

    if (!rawText) {
      console.error(
        `[chat] ${target.name} no devolvió texto. finishReason=${finishReason} ` +
          `model=${request.model} usage=${JSON.stringify(data.usageMetadata ?? data.usage ?? {})}`
      );
      return sendJson(res, 502, { error: msg(idioma, "El asistente no devolvió una respuesta. Probá de nuevo.", "The assistant did not return an answer. Try again.") });
    }

    // Se le pidió JSON. Si no viene, se muestra el texto crudo como respuesta: es
    // preferible una respuesta sin altas a dejar al operario sin nada.
    const parsed = parseReply(rawText, inventario);
    if (!parsed.reply.trim()) {
      return sendJson(res, 502, { error: msg(idioma, "El asistente no devolvió una respuesta. Probá de nuevo.", "The assistant did not return an answer. Try again.") });
    }

    return sendJson(res, 200, { reply: parsed.reply, agregar: parsed.agregar, comprar: parsed.comprar });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    console.error(`[chat] falló la consulta${timedOut ? " por timeout" : ""}:`, error);
    return sendJson(
      res,
      502,
      {
        error: timedOut
          ? msg(idioma, "El asistente tardó demasiado. Probá de nuevo.", "The assistant took too long. Try again.")
          : msg(idioma, "No se pudo conectar con el asistente. Probá de nuevo.", "Could not connect to the assistant. Try again."),
      }
    );
  }
};

// Se exporta para que los tests puedan verificar el prompt sin pegarle a la API.
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
module.exports.systemPromptFor = systemPromptFor;
module.exports.sanitizePurchases = sanitizePurchases;