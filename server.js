import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";

const PORT = Number(process.env.PORT || 5173);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "dNjJKg63Fr5AXwIdkATa";

if (!OPENAI_API_KEY) {
  console.error("ERROR: falta OPENAI_API_KEY en .env");
  process.exit(1);
}
if (!ELEVENLABS_API_KEY) {
  console.warn("AVISO: falta ELEVENLABS_API_KEY en .env — el audio del agente no funcionara");
}

const app = express();

app.use(express.json({ type: "application/json", limit: "32kb" }));
app.use(express.text({ type: ["application/sdp", "text/plain"] }));

const ttsCache = new Map();
function cacheTts(key, audio) {
  if (ttsCache.size >= 50) ttsCache.delete(ttsCache.keys().next().value);
  ttsCache.set(key, audio);
}

const realtimeSession = {
  type: "realtime",
  model: OPENAI_REALTIME_MODEL,
  instructions: `
Eres Avancia, la asistente virtual de una inmobiliaria espanola. Hablas en espanol de Espana con voz calida, profesional y natural.

Tu mision: cualificar a la persona que llama recogiendo 8 datos en conversacion fluida.

DATOS A RECOGER en este orden:
1. operation — si quiere COMPRAR o VENDER (usa exactamente: "Comprar" o "Vender")
2. name — nombre completo del cliente
3. phone — telefono de contacto de 9 digitos (pidelo cifra a cifra)
4. zone — zona o municipio donde se ubica o busca la propiedad
5. propertyType — tipo de propiedad (piso, casa, chalet, local, etc.)
6. price — precio aproximado (formato: "200.000 euros")
7. availability — cuando puede ser contactado o visitar la propiedad
8. financing — si necesita financiacion bancaria. Pregunta unicamente: "¿Necesita financiacion?" Interpreta la respuesta del cliente y registra el valor tu mismo.

REGLAS:
- Espera siempre a que el cliente hable antes de responder. Nunca inicies tu respuesta sin que haya un turno del cliente.
- Avanza de un dato cada vez. En cuanto el usuario responda, llama INMEDIATAMENTE a registrar_campo y luego haz la siguiente pregunta.
- Para el telefono: pide que lo diga cifra a cifra. Cuando tengas los 9 digitos, registralos sin espacios ni guiones.
- Si una respuesta no es clara, pide que la repita de forma breve y educada.
- Sin palabras de relleno: nada de "perfecto", "estupendo", "genial", "por supuesto", "con mucho gusto", "desde luego", "claro", "de acuerdo".
- Nunca añadas opciones al final de una pregunta. Está PROHIBIDO terminar frases con "¿sí o no?", "¿verdad?", "¿correcto?" o similares.
- NUNCA indiques al cliente con qué palabras debe responder. No digas "responda con Sí o No", "diga Sí o No", ni nada parecido.
- Nunca des ejemplos ni formatos en las preguntas. Está PROHIBIDO usar "por ejemplo".
- Frases cortas y directas, un turno cada vez.
- Cuando hayas registrado los 8 campos, despidete indicando que un asesor se pondra en contacto pronto.
  `.trim(),
  tools: [
    {
      type: "function",
      name: "registrar_campo",
      description: "Registra un campo del lead cuando el usuario lo ha proporcionado claramente.",
      parameters: {
        type: "object",
        properties: {
          campo: {
            type: "string",
            enum: ["operation", "name", "phone", "zone", "propertyType", "price", "availability", "financing"],
            description: "Identificador del campo a registrar"
          },
          valor: {
            type: "string",
            description: "Valor proporcionado por el usuario para ese campo"
          }
        },
        required: ["campo", "valor"]
      }
    }
  ],
  tool_choice: "auto",
  audio: {
    input: {
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 200,
        silence_duration_ms: 600
      },
      transcription: {
        model: "gpt-4o-mini-transcribe"
      }
    },
    output: {
      voice: OPENAI_REALTIME_VOICE
    }
  }
};

app.post("/session", async (req, res) => {
  if (!req.body) return res.status(400).send("Falta SDP offer");

  const formData = new FormData();
  formData.set("sdp", req.body);
  formData.set("session", JSON.stringify(realtimeSession));

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: formData
    });

    const answer = await response.text();
    if (!response.ok) {
      console.error("OpenAI Realtime error:", response.status, answer);
      return res.status(response.status).send(answer);
    }

    res.type("application/sdp").send(answer);
  } catch (error) {
    console.error("No se pudo crear la sesion Realtime:", error);
    res.status(500).send("No se pudo crear la sesion Realtime");
  }
});

app.post("/tts", async (req, res) => {
  const input = req.body?.input;
  if (!input || typeof input !== "string" || !input.trim()) {
    return res.status(400).send("Falta texto para sintetizar");
  }
  if (!ELEVENLABS_API_KEY) {
    return res.status(500).send("Falta ELEVENLABS_API_KEY");
  }

  const cacheKey = `${ELEVENLABS_VOICE_ID}:${input}`;
  const cachedAudio = ttsCache.get(cacheKey);
  if (cachedAudio) {
    return res.type("audio/mpeg").send(cachedAudio);
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
    res.type("audio/mpeg").send(audio);
  } catch (error) {
    console.error("No se pudo generar audio TTS:", error);
    res.status(500).send("No se pudo generar audio TTS");
  }
});

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa"
});

app.use(vite.middlewares);

app.listen(PORT, () => {
  console.log(`Demo Realtime lista en http://127.0.0.1:${PORT}`);
});
