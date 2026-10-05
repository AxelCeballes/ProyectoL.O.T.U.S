// Diagnóstico del canal de ayuda: lista los modelos que acepta la clave y prueba
// cuáles responden ahora mismo.
//
// Hace falta porque el free tier de Google es movido y el panorama cambia:
// gemini-2.5-flash aparece como ejemplo en el quickstart y ya responde 404
// "no longer available to new users", y los flash más nuevos devuelven 503
// "high demand". El listado dice qué modelos existen, pero incluir un modelo en
// la lista no garantiza que responda: hay que pedirle una respuesta.
//
//   node scripts/probar-modelos.mjs
//
// Requiere GEMINI_API_KEY en .env.local. No imprime la clave.
import { readFileSync } from 'node:fs';

const key = readFileSync('.env.local', 'utf8').match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) {
  console.log('Falta GEMINI_API_KEY en .env.local');
  process.exit(1);
}

const HEADERS = { 'Content-Type': 'application/json', 'x-goog-api-key': key };

// ------------------------------------------------------------------
const listado = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
  headers: HEADERS,
});

if (!listado.ok) {
  console.log(`El listado de modelos respondió ${listado.status}:`);
  console.log((await listado.text()).slice(0, 600));
  process.exit(1);
}

const { models = [] } = await listado.json();

const candidatos = models
  .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
  .map((m) => m.name.replace('models/', ''))
  // Solo la familia flash y flash-lite: para un asistente de kiosco no hace
  // falta un modelo grande, y son los que tienen capacidad en el free tier.
  .filter((n) => /^gemini-.*flash/.test(n))
  // Se descartan los de imagen, audio y los previews: no sirven para responder
  // texto y ensucian la lista (además consumen cuota de otra familia).
  .filter((n) => !/image|tts|audio|preview|omni|robotics/.test(n))
  .sort();

console.log(`La clave es válida: ${candidatos.length} modelos flash para probar\n`);

const PREGUNTA = '¿Cómo retiro una herramienta? Respondé en una oración.';

for (const model of candidatos) {
  const started = Date.now();
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: PREGUNTA }] }],
          generationConfig: { maxOutputTokens: 1024 },
        }),
      }
    );
    const data = await response.json();
    const ms = Date.now() - started;

    if (!response.ok) {
      console.log(`${model.padEnd(26)} HTTP ${String(response.status).padEnd(4)} ${data?.error?.message?.slice(0, 60)}`);
      continue;
    }

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const visible = parts.filter((p) => p.thought !== true).map((p) => p.text).join('').trim();
    const respondio = visible ? `OK ${String(ms).padStart(5)}ms` : 'OK pero SIN TEXTO';
    console.log(`${model.padEnd(26)} ${respondio}`);
  } catch (error) {
    console.log(`${model.padEnd(26)} EXCEPCIÓN  ${error.message}`);
  }
}

console.log('\nPara usar uno: ponelo en GEMINI_MODEL dentro de .env.local');