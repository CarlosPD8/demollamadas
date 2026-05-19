const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!OPENAI_API_KEY) return res.status(500).json({ value: "" });

  const body = await readJsonBody(req);
  const { field, transcript } = body || {};
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
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}
