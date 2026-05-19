const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Metodo no permitido");
  }
  if (!OPENAI_API_KEY) {
    return res.status(500).send("Falta OPENAI_API_KEY");
  }

  const sdp = await readTextBody(req);
  if (!sdp) return res.status(400).send("Falta SDP offer");

  const formData = new FormData();
  formData.set("sdp", sdp);
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

    res.setHeader("Content-Type", "application/sdp");
    return res.status(200).send(answer);
  } catch (error) {
    console.error("No se pudo crear la sesion Realtime:", error);
    return res.status(500).send("No se pudo crear la sesion Realtime");
  }
}

async function readTextBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body) return String(req.body);

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
