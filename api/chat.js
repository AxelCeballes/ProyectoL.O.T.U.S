const MODEL = "claude-haiku-4-5-20251001";
const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY = 10;

const SYSTEM_PROMPT = `Sos el asistente de ayuda de la demo L.O.T.U.S., una pantalla para simular el ingreso con NFC, el retiro y la devolución de herramientas por código de barras, y consultar un inventario de ejemplo.
Ayudás a entender ese flujo y dónde están sus opciones en la pantalla.
Respondé siempre en español rioplatense, de forma breve y clara (máximo 4 o 5 oraciones).
La aplicación usa datos ficticios: no registra movimientos reales ni se conecta a una base de datos. No afirmes que podés consultar personal, herramientas o movimientos reales.
Si la consulta no tiene relación con L.O.T.U.S., decí amablemente que solo podés ayudar con la demo.
No inventes funciones que no conozcas.`;

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
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
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "El asistente todavía no está configurado." });
  }

  const { message, history } = req.body ?? {};
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Escribí una consulta antes de enviarla." });
  }

  const messages = [
    ...cleanHistory(history),
    { role: "user", content: message.trim().slice(0, MAX_MESSAGE_LENGTH) },
  ];

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.error("Anthropic API request failed with status:", response.status);
      return res.status(502).json({ error: "No se pudo consultar al asistente. Probá de nuevo." });
    }

    const data = await response.json();
    const reply = Array.isArray(data.content)
      ? data.content
          .filter((block) => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("\n")
          .trim()
      : "";

    if (!reply) {
      console.error("Anthropic API response did not contain text.");
      return res.status(502).json({ error: "El asistente no devolvió una respuesta. Probá de nuevo." });
    }

    return res.status(200).json({ reply });
  } catch (error) {
    console.error("Chat request failed:", error);
    return res.status(502).json({ error: "No se pudo conectar con el asistente. Probá de nuevo." });
  }
};
