// api/chat.js — Función de Vercel (va en la RAÍZ del proyecto, no dentro de src/)
// Requiere la variable de entorno ANTHROPIC_API_KEY en Vercel.

const MODEL = "claude-haiku-4-5-20251001"; // rápido y económico para un chat de ayuda
const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY = 10;

const SYSTEM_PROMPT = `Sos el asistente del sistema L.O.T.U.S, una aplicación web de registro de trabajadores por NFC y control de pañol de herramientas por código de barras.
Ayudás a operarios y administradores a entender cómo usar el sistema: fichaje de ingreso y egreso con tarjeta NFC, retiro y devolución de herramientas, estados de las herramientas (disponible, en uso, en mantenimiento) y el historial.
Respondé siempre en español rioplatense, de forma breve y clara (máximo 4 o 5 oraciones).
No tenés acceso a los datos reales del sistema (personal, herramientas, historial). Si te piden datos concretos, explicá dónde consultarlos en la aplicación.
Si la consulta no tiene relación con L.O.T.U.S, decí amablemente que solo podés ayudar con el sistema.
No inventes funciones que no conozcas.`;

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Falta ANTHROPIC_API_KEY en el servidor" });
  }

  const { message, history } = req.body ?? {};
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Mensaje vacío" });
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
    });

    if (!response.ok) {
      console.error("Anthropic API:", response.status, await response.text());
      return res.status(502).json({ error: "Error al consultar el modelo" });
    }

    const data = await response.json();
    const reply = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return res.status(200).json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
