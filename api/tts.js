const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || "marin";

const agentScript = new Set([
  "Hola gracias por contactar con nuestra inmobiliaria, podria indicarme si desea comprar o vender una propiedad.",
  "Vale muchas gracias podria indicarme su nombre.",
  "Indiquenos su numero de telefono diga los numeros de uno en uno y nos pondremos en contacto con usted.",
  "En que zona se encuentra o le interesa la propiedad.",
  "Que tipo de propiedad es o esta buscando.",
  "Podria indicarme un precio aproximado.",
  "Que disponibilidad tiene para que un asesor le contacte o pueda concertar una visita.",
  "Podria indicarnos un correo electronico de contacto.",
  "Para terminar, necesita financiacion o ya cuenta con ella.",
  "Disculpe, no he podido recoger bien el numero. Puede repetirlo de uno en uno por favor.",
  "De acuerdo tu asistencia ha sido completada se pondran en contacto contigo lo antes posible."
]);

const ttsCache = new Map();
function cacheTts(key, audio) {
  if (ttsCache.size >= 50) ttsCache.delete(ttsCache.keys().next().value);
  ttsCache.set(key, audio);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Metodo no permitido");
  }
  if (!OPENAI_API_KEY) {
    return res.status(500).send("Falta OPENAI_API_KEY");
  }

  const body = await readJsonBody(req);
  const input = body?.input;
  if (!input || typeof input !== "string") {
    return res.status(400).send("Falta texto para sintetizar");
  }
  if (!agentScript.has(input)) {
    return res.status(400).send("Texto fuera del guion permitido");
  }

  const cacheKey = JSON.stringify({ model: OPENAI_TTS_MODEL, voice: OPENAI_TTS_VOICE, input });
  const cachedAudio = ttsCache.get(cacheKey);
  if (cachedAudio) {
    res.setHeader("Content-Type", "audio/mpeg");
    return res.status(200).send(cachedAudio);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL,
        voice: OPENAI_TTS_VOICE,
        input,
        instructions:
          "Lee exactamente el texto recibido, sin anadir ni quitar palabras. Voz femenina natural de recepcionista espanola, calida, profesional y tranquila. Ritmo conversacional, nada robotico.",
        response_format: "mp3"
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI TTS error:", response.status, errorText);
      return res.status(response.status).send(errorText);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    cacheTts(cacheKey, audio);
    res.setHeader("Content-Type", "audio/mpeg");
    return res.status(200).send(audio);
  } catch (error) {
    console.error("No se pudo generar audio TTS:", error);
    return res.status(500).send("No se pudo generar audio TTS");
  }
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const text = await readTextBody(req);
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

async function readTextBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
