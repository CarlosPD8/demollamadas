# Demo agente IA inmobiliaria

Demo web de un agente telefonico IA para inmobiliarias usando OpenAI Realtime por WebRTC. No usa Twilio ni llamadas reales: el navegador toma tu microfono y habla con el modelo en tiempo real.

## Instalacion

```bash
npm install
```

## Ejecutar

```bash
npm run dev
```

Vite mostrara una URL local, normalmente:

```text
http://localhost:5173
```

Abrela en el navegador y pulsa **Iniciar llamada**.

## Variables de entorno

Copia `.env.example` a `.env`:

```bash
cp .env.example .env
```

En PowerShell:

```powershell
Copy-Item .env.example .env
```

Configura:

```env
PORT=5173
OPENAI_API_KEY=tu_clave
OPENAI_REALTIME_MODEL=gpt-realtime-mini
OPENAI_REALTIME_VOICE=marin
```

## Que incluye

- Pantalla principal tipo call center.
- Estado de llamada: esperando, llamada activa y cita agendada.
- Temporizador.
- Voz del agente con OpenAI Realtime.
- Captura de tu microfono con WebRTC.
- Input para simular respuestas del cliente.
- Botones rapidos para completar la demo.
- Historial de conversacion estilo transcript.
- Panel lateral de lead en tiempo real.
- Tarjeta final de cita agendada.
- Diseno responsive.

## Flujo de la demo

El asistente virtual pregunta solo:

1. Si el cliente desea comprar o vender.
2. Nombre.
3. Telefono.

Al final confirma la cita y muestra el resumen comercial.

## No usa Twilio

Esta version no recibe llamadas telefonicas reales. Sirve para ensenar el flujo y el valor del agente sin contratar telefonia ni configurar webhooks.

## Como conectarlo mas adelante con Twilio/OpenAI Realtime

Una version real podria anadir:

- Backend Node.js con Express o Fastify.
- Endpoint `POST /voice` que devuelva TwiML con `<Connect><Stream>`.
- WebSocket `/media-stream` para recibir audio de Twilio Media Streams.
- Conexion servidor a servidor con OpenAI Realtime API.
- Mapeo de audio:
  - Twilio `media.payload` a OpenAI `input_audio_buffer.append`.
  - OpenAI audio delta a Twilio `media.payload`.
- Persistencia real de leads en CRM, base de datos o Google Sheets.

La interfaz de esta demo podria mantenerse como panel comercial o dashboard interno mientras el backend real gestiona las llamadas.
