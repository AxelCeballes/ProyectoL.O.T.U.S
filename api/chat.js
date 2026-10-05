// api/chat.js — Función serverless de Vercel para el asistente de ayuda del kiosco.
//
// Variables de entorno (Settings > Environment Variables en Vercel):
//   ANTHROPIC_API_KEY  (obligatoria, secreta)
//   ANTHROPIC_MODEL    (opcional) — por defecto claude-sonnet-5-5
//   ANTHROPIC_EFFORT   (opcional) — low | medium | high. Por defecto "low".
//   CHAT_RATE_LIMIT    (opcional) — consultas por minuto y por IP. Por defecto 12.

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const TIMEOUT_MS = 20000;

// Se leen por request, no al cargar el módulo: en serverless la instancia se
// reutiliza entre invocaciones y así el comportamiento queda determinado por
// el entorno en el momento de la llamada.
const model = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const effort = () => process.env.ANTHROPIC_EFFORT || "low";
const rateLimitPerMin = () => Number(process.env.CHAT_RATE_LIMIT) || 12;

const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY = 10;
// Holgado a propósito: en Sonnet 5.5 los tokens de thinking cuentan para
// max_tokens. Con 500 la respuesta visible podía quedar truncada.
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
  DEVOLUCIÓN: "Devolución de Herramienta",
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

const SYSTEM_PROMPT = `Sos el asistente de ayuda del kiosco L.O.T.U.S. de un pañol industrial.
El sistema tiene cuatro pantallas: (1) esperando la tarjeta NFC del operario, (2) menú del operario para elegir Retiro o Devolución, (3) escaneo del código de barras de la herramienta con la pistola láser, y (4) estado de herramientas con buscador y filtros.
Ayudás al operario a entender el flujo, dónde está cada opción en pantalla y qué hacer si algo no responde.

Respondé siempre en español rioplatense, con voseo, de forma breve y clara: máximo 4 o 5 oraciones.

Importante sobre los datos: esta aplicación es una demostración. El inventario y las reparaciones son datos de ejemplo guardados en el navegador, no hay base de datos ni servidor de inventario. No affirmes que podés consultar movimientos, personal o herramientas reales, y no inventes datos que no estén en pantalla. Si te piden un dato real, decí dónde se ve en el kiosco.

Si la consulta no tiene relación con L.O.T.U.S., decí amablemente que solo podés ayudar con el sistema.
No inventes funciones que no conozcas.`;

// ------------------------------------------------------------------
// Validación del historial. Además de filtrar, garantiza que la primera
// mensagem sea del usuario: la API de Anthropic rechaza con 400 un
// historial que empiece en assistant, y el endpoint es público.
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

function sendJson(res, status, payload, headers = {}) {
  res.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  return res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Método no permitido" }, { Allow: "POST" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[chat] ANTHROPIC_API_KEY no está definida en el entorno del servidor.");
    return sendJson(res, 503, {
      error: "El asistente no está configurado. Revisá ANTHROPIC_API_KEY en Vercel.",
    });
  }

  const { message, history, context } = req.body ?? {};
  if (typeof message !== "string" || !message.trim()) {
    return sendJson(res, 400, { error: "Escribí una consulta antes de enviarla." });
  }

  const limit = checkRateLimit(clientIp(req));
  if (!limit.allowed) {
    return sendJson(
      res,
      429,
      { error: "Demasiadas consultas seguidas. Esperá un momento e intentá de nuevo." },
      { "Retry-After": String(limit.retryAfter) }
    );
  }

  const screenContext = cleanContext(context);
  const messages = [
    ...cleanHistory(history),
    { role: "user", content: message.trim().slice(0, MAX_MESSAGE_LENGTH) },
  ];

  const activeModel = model();

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: activeModel,
        max_tokens: MAX_TOKENS,
        system: screenContext ? `${SYSTEM_PROMPT}\n\nContexto del kiosco ahora mismo:\n${screenContext}` : SYSTEM_PROMPT,
        messages,
        // Sonnet 5.5 tiene thinking adaptativo por defecto y esos tokens
        // consumen max_tokens. "between_tools" es el nivel más bajo y evita
        // que el razonamiento se coma el presupuesto de la respuesta.
        thinking: { type: "between_tools" },
        output_config: { effort: effort() },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // Loguear el cuerpo real del error: sin esto no se puede diagnosticar
      // una 401 por clave mal cargada ni una 400 por parámetro inválido.
      const detail = (await response.text().catch(() => "")).slice(0, 800);
      console.error(`[chat] Anthropic respondió ${response.status}: ${detail}`);

      if (response.status === 429) {
        return sendJson(res, 429, { error: "El asistente está ocupado. Probá de nuevo en un momento." });
      }
      if (response.status >= 500) {
        return sendJson(res, 502, { error: "El asistente no está disponible. Probá de nuevo." });
      }
      return sendJson(res, 502, { error: "No se pudo obtener una respuesta del asistente." });
    }

    const data = await response.json();
    // Los bloques de texto de un mismo mensaje son segmentos contiguos: se
    // concatenan sin separador para no partir la frase con un salto de línea.
    const reply = Array.isArray(data.content)
      ? data.content
          .filter((block) => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("")
          .trim()
      : "";

    if (!reply) {
      console.error(
        `[chat] La respuesta no contenía texto. stop_reason=${data.stop_reason ?? "desconocido"} ` +
          `model=${data.model ?? activeModel} usage=${JSON.stringify(data.usage ?? {})}`
      );
      return sendJson(res, 502, { error: "El asistente no devolvió una respuesta. Probá de nuevo." });
    }

    return sendJson(res, 200, { reply });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    console.error(`[chat] falló la consulta${timedOut ? " por timeout" : ""}:`, error);
    return sendJson(
      res,
      502,
      {
        error: timedOut
          ? "El asistente tardó demasiado. Probá de nuevo."
          : "No se pudo conectar con el asistente. Probá de nuevo.",
      }
    );
  }
};
