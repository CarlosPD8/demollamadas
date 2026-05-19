import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";

const PORT = Number(process.env.PORT || 5173);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "FGY2WhTYpPnrIDTdsKH5";

if (!OPENAI_API_KEY) {
  console.error("ERROR: falta OPENAI_API_KEY en .env");
  process.exit(1);
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
8. financing — si necesita financiacion bancaria (usa exactamente: "Si" o "No")

REGLAS:
- Al inicio saluda brevemente y pregunta si quiere comprar o vender.
- Avanza de un dato cada vez. En cuanto el usuario responda, llama INMEDIATAMENTE a registrar_campo y luego haz la siguiente pregunta.
- Para el telefono: pide que lo diga cifra a cifra. Cuando tengas los 9 digitos, registralos sin espacios ni guiones.
- Si una respuesta no es clara, pide que la repita de forma breve y educada.
- Sin palabras de relleno: nada de "perfecto", "por supuesto", "con mucho gusto", "desde luego", "claro".
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

const fieldInstructions = {
  operation: `El usuario responde si quiere COMPRAR o VENDER una propiedad inmobiliaria.
Responde ÚNICAMENTE con una de estas palabras exactas: Comprar | Vender
Si el mensaje es ruido, silencio, palabras sueltas sin sentido ("eh", "um", "ah", "si", "no", "vale", "hola", "bueno", "mira"), o no menciona compra ni venta → responde exactamente: (vacío)
Ejemplos válidos:
  "quiero comprar un piso" → Comprar
  "vender mi casa" → Vender
  "comprar" → Comprar
  "vender" → Vender
Ejemplos inválidos → (vacío):
  "si" | "bueno" | "vale" | "eh" | "no sé" | "perdona" | cualquier texto que no mencione comprar o vender`,

  name: `El usuario dice su nombre propio.
Extrae ÚNICAMENTE el nombre propio de la persona, sin saludos, sin puntuación extra.
Si el texto contiene SOLO palabras de relleno ("si", "sí", "no", "vale", "bueno", "mira", "hola", "claro", "eh", "um", "ah", "ay", "bien", "pues", "oye"), o es muy corto (menos de 2 letras), o es ruido → responde exactamente: (vacío)
Si hay un número en el texto → (vacío)
Ejemplos válidos:
  "me llamo María García" → María García
  "soy Juan" → Juan
  "Carlos López" → Carlos López
  "Ana" → Ana
Ejemplos inválidos → (vacío):
  "si" | "no" | "vale" | "eh" | "bueno" | "hola" | "123" | "mm" | texto con números`,

  phone: `El usuario está dictando su número de teléfono español cifra a cifra o en grupos.
Convierte palabras numéricas (uno, dos, tres…) a dígitos. Ignora espacios y pausas.
Responde ÚNICAMENTE los 9 dígitos consecutivos, sin espacios ni guiones.
Si no hay exactamente 9 dígitos identificables en el mensaje → responde exactamente: (vacío)
Ejemplos válidos:
  "seis tres uno dos tres cuatro cinco seis siete" → 631234567
  "699 12 34 56" → 699123456
  "6 nueve nueve 1 2 3 4 5 6" → 699123456
Ejemplos inválidos → (vacío):
  "si" | "no" | "mañana" | cualquier texto sin 9 dígitos identificables`,

  zone: `El usuario dice el nombre de la zona, barrio, ciudad o municipio donde se ubica o busca la propiedad.
Responde ÚNICAMENTE el nombre del lugar, sin artículos innecesarios, sin frases extra.
Si el texto es ruido, una interjección, no menciona ningún lugar ("si", "no", "vale", "eh", "um", "no sé", "aquí"), o no hay un lugar identificable → responde exactamente: (vacío)
Si solo hay números sin nombre → (vacío)
Ejemplos válidos:
  "en el centro de Madrid" → Madrid centro
  "busco en Chamberí" → Chamberí
  "Sevilla, zona norte" → Sevilla norte
  "Getafe" → Getafe
Ejemplos inválidos → (vacío):
  "si" | "no" | "aquí" | "no lo sé" | "eh" | "um" | solo números`,

  propertyType: `El usuario dice qué tipo de propiedad es o busca: piso, apartamento, casa, chalet, adosado, local, oficina, garaje, trastero, finca, villa, etc.
Responde ÚNICAMENTE el tipo de propiedad mencionado, en una o dos palabras.
Si el texto es ruido, interjección, o no identifica ningún tipo de propiedad → responde exactamente: (vacío)
Ejemplos válidos:
  "busco un piso" → piso
  "tengo una casa con jardín" → casa
  "es un local comercial" → local comercial
  "chalet adosado" → chalet adosado
Ejemplos inválidos → (vacío):
  "si" | "no" | "algo" | "una cosa" | "eh" | "no sé" | ruido`,

  price: `El usuario menciona un precio aproximado en euros.
Convierte el número (incluyendo palabras como "doscientos mil", "medio millón") al formato: 200.000 euros
Responde ÚNICAMENTE en ese formato. Si el precio no está claro o no hay número identificable → responde exactamente: (vacío)
Ejemplos válidos:
  "unos 250.000 euros" → 250.000 euros
  "doscientos mil euros" → 200.000 euros
  "medio millón" → 500.000 euros
  "sobre los 150 mil" → 150.000 euros
  "300000" → 300.000 euros
Ejemplos inválidos → (vacío):
  "si" | "no sé" | "barato" | "caro" | "algo" | texto sin número ni mención de precio`,

  availability: `El usuario indica cuándo tiene disponibilidad para ser contactado o para visitar la propiedad.
Resume en pocas palabras claras la disponibilidad mencionada.
Si el texto es ruido, interjección, o no hay información de disponibilidad → responde exactamente: (vacío)
Ejemplos válidos:
  "por las tardes entre semana" → tardes entre semana
  "los fines de semana" → fines de semana
  "cuando quieran" → cualquier momento
  "mañana por la tarde" → mañana por la tarde
  "a partir de las 5" → a partir de las 17:00
Ejemplos inválidos → (vacío):
  "si" | "no sé" | "eh" | "um" | "vale" | respuestas sin información de horario`,

  financing: `El usuario responde si necesita financiación bancaria.
Responde ÚNICAMENTE: Sí | No
Si el mensaje es ruido, interjección, o no queda claro si necesita o no financiación → responde exactamente: (vacío)
Ejemplos válidos (Sí):
  "sí necesito financiación" → Sí
  "necesito hipoteca" → Sí
  "sí, me hace falta" → Sí
Ejemplos válidos (No):
  "no, ya tengo el dinero" → No
  "al contado" → No
  "ya cuento con financiación propia" → No
  "no necesito" → No
Ejemplos inválidos → (vacío):
  "si" (sin contexto de financiación) | "eh" | "um" | "vale" | respuestas ambiguas`
};

app.post("/extract", async (req, res) => {
  const { field, transcript } = req.body || {};
  if (!transcript || !field) return res.json({ value: "" });
  const instruction = fieldInstructions[field];
  if (!instruction) return res.json({ value: "" });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: transcript }
        ],
        max_tokens: 60,
        temperature: 0
      })
    });
    const data = await response.json();
    const raw = (data.choices?.[0]?.message?.content || "").trim();
    const value = raw === "(vacío)" || raw === "(vacio)" ? "" : raw;
    res.json({ value });
  } catch {
    res.json({ value: "" });
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
