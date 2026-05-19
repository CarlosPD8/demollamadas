import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "../public/audio");

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "UOIqAnmS11Reiei1Ytkc";

if (!API_KEY) {
  console.error("❌  Falta ELEVENLABS_API_KEY en .env");
  process.exit(1);
}

const prompts = [
  { file: "greeting",          text: "Hola gracias por contactar con nuestra inmobiliaria, podria indicarme si desea comprar o vender una propiedad." },
  { file: "ask-name",          text: "Vale muchas gracias podria indicarme su nombre." },
  { file: "ask-phone",         text: "Indiquenos su numero de telefono diga los numeros de uno en uno y nos pondremos en contacto con usted." },
  { file: "ask-zone",          text: "En que zona se encuentra o le interesa la propiedad." },
  { file: "ask-property-type", text: "Que tipo de propiedad es o esta buscando." },
  { file: "ask-price",         text: "Podria indicarme un precio aproximado." },
  { file: "ask-availability",  text: "Que disponibilidad tiene para que un asesor le contacte o pueda concertar una visita." },
  { file: "ask-financing",     text: "Para terminar, necesita financiacion o ya cuenta con ella." },
  { file: "repeat-phone",      text: "Disculpe, no he podido recoger bien el numero. Puede repetirlo de uno en uno por favor." },
  { file: "done",              text: "De acuerdo tu asistencia ha sido completada se pondran en contacto contigo lo antes posible." },
];

mkdirSync(OUTPUT_DIR, { recursive: true });

console.log(`🎙  Generando ${prompts.length} audios con voz ${VOICE_ID}...\n`);

for (const { file, text } of prompts) {
  process.stdout.write(`  → ${file}.mp3 ... `);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.3, use_speaker_boost: true }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`❌  Error ${res.status}: ${err}`);
    process.exit(1);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(OUTPUT_DIR, `${file}.mp3`), buffer);
  console.log(`✅  ${(buffer.length / 1024).toFixed(0)} KB`);
}

console.log("\n✨  Todos los audios generados en public/audio/");
console.log("   Ya puedes eliminar ELEVENLABS_API_KEY del .env si quieres.");
