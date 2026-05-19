const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "dNjJKg63Fr5AXwIdkATa";

const ttsCache = new Map();
function cacheTts(key, audio) {
  if (ttsCache.size >= 50) ttsCache.delete(ttsCache.keys().next().value);
  ttsCache.set(key, audio);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Metodo no permitido");
  }
  if (!ELEVENLABS_API_KEY) {
    return res.status(500).send("Falta ELEVENLABS_API_KEY");
  }

  const body = await readJsonBody(req);
  const input = body?.input;
  if (!input || typeof input !== "string" || !input.trim()) {
    return res.status(400).send("Falta texto para sintetizar");
  }

  const cacheKey = `${ELEVENLABS_VOICE_ID}:${input}`;
  const cachedAudio = ttsCache.get(cacheKey);
  if (cachedAudio) {
    res.setHeader("Content-Type", "audio/mpeg");
    return res.status(200).send(cachedAudio);
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text: input,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.80,
          style: 0.3,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs TTS error:", response.status, errorText);
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
