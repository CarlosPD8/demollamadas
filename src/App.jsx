import React, { useEffect, useMemo, useRef, useState } from "react";

const initialLead = {
  operation: "",
  name: "",
  phone: "",
  zone: "",
  propertyType: "",
  price: "",
  availability: "",
  financing: "",
  status: "esperando"
};

const LEAD_FIELDS = ["operation", "name", "phone", "zone", "propertyType", "price", "availability", "financing"];

function App() {
  const [callState, setCallState] = useState("esperando");
  const [lead, setLead] = useState(initialLead);
  const [messages, setMessages] = useState([]);
  const [seconds, setSeconds] = useState(0);
  const [connectionState, setConnectionState] = useState("desconectado");
  const transcriptRef = useRef(null);
  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const callRunIdRef = useRef(0);
  const callStateRef = useRef("esperando");
  const autoHangupRef = useRef(null);
  const elAudioRef = useRef(null);
  const processedTranscriptIdsRef = useRef(new Set());
  const processedCallIdsRef = useRef(new Set());

  const statusLabel = useMemo(() => {
    if (callState === "active") return "llamada activa";
    if (callState === "scheduled") return "cita agendada";
    return "esperando";
  }, [callState]);

  useEffect(() => {
    if (callState !== "active") return undefined;
    const timer = window.setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [callState]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (callState !== "active") return;
    if (LEAD_FIELDS.every((f) => lead[f])) {
      setLead((c) => ({ ...c, status: "cita agendada" }));
      setCallState("scheduled");
      callStateRef.current = "scheduled";
      scheduleAutoHangup();
    }
  }, [lead, callState]);

  // Limpieza al desmontar el componente
  useEffect(() => {
    return () => {
      closeRealtime();
      if (autoHangupRef.current) window.clearTimeout(autoHangupRef.current);
    };
  }, []);

  async function startCall() {
    const callRunId = callRunIdRef.current + 1;
    callRunIdRef.current = callRunId;

    try {
      setConnectionState("pidiendo microfono");
      setCallState("active");
      callStateRef.current = "active";
      setSeconds(0);
      setLead({ ...initialLead, status: "llamada activa" });
      setMessages([]);
      processedTranscriptIdsRef.current = new Set();
      processedCallIdsRef.current = new Set();

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      const dc = pc.createDataChannel("oai-events");

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        if (err.name === "NotAllowedError") throw new Error("Permiso de microfono denegado. Permite el acceso en el navegador.");
        if (err.name === "NotFoundError") throw new Error("No se encontro ningun microfono. Conecta uno e intentalo de nuevo.");
        throw err;
      }

      stream.getAudioTracks().forEach((track) => { track.enabled = false; });
      const audio = new Audio();
      audio.autoplay = true;
      audio.volume = 0; // muted — ElevenLabs handles audio output
      pc.ontrack = (event) => { audio.srcObject = event.streams[0]; };
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.addEventListener("connectionstatechange", () => {
        const state = pc.connectionState;
        if (state === "failed" || state === "disconnected") {
          setConnectionState(`conexion ${state}`);
          addSystemMessage(`Conexion WebRTC ${state === "failed" ? "fallida" : "interrumpida"}.`);
          if (state === "failed") endCall();
        }
      });

      dc.addEventListener("open", () => {
        setConnectionState("OpenAI Realtime conectado");
        stream.getAudioTracks().forEach((track) => { track.enabled = true; });
        addSystemMessage("Microfono activo. Habla con el asistente.");
        dc.send(JSON.stringify({ type: "response.create" }));
      });

      dc.addEventListener("message", (event) => handleRealtimeEvent(JSON.parse(event.data)));

      peerRef.current = pc;
      channelRef.current = dc;
      streamRef.current = stream;
      audioRef.current = audio;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      setConnectionState("negociando sesion");
      const response = await fetch("/session", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp
      });

      const answerSdp = await response.text();
      if (!response.ok) throw new Error(answerSdp || "No se pudo crear la sesion");

      if (callRunIdRef.current !== callRunId || pc.signalingState === "closed") return;

      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (error) {
      console.error(error);
      if (
        callRunIdRef.current !== callRunId ||
        error.message?.includes("signalingState is 'closed'")
      ) {
        return;
      }
      setConnectionState("error");
      addSystemMessage(`Error: ${error.message}`);
      endCall();
    }
  }

  function resetDemo() {
    closeRealtime();
    if (autoHangupRef.current) window.clearTimeout(autoHangupRef.current);
    autoHangupRef.current = null;
    setCallState("esperando");
    callStateRef.current = "esperando";
    callRunIdRef.current += 1;
    processedTranscriptIdsRef.current = new Set();
    processedCallIdsRef.current = new Set();
    setLead(initialLead);
    setMessages([]);
    setSeconds(0);
    setConnectionState("desconectado");
  }

  function endCall() {
    closeRealtime();
    if (autoHangupRef.current) window.clearTimeout(autoHangupRef.current);
    autoHangupRef.current = null;
    callRunIdRef.current += 1;
    processedTranscriptIdsRef.current = new Set();
    processedCallIdsRef.current = new Set();
    setCallState((state) => {
      const next = state === "scheduled" ? state : "esperando";
      callStateRef.current = next;
      return next;
    });
  }

  function addAgentMessage(text) {
    setMessages((items) => [...items, createMessage("agent", text)]);
  }

  function addUserMessage(text) {
    setMessages((items) => [...items, createMessage("user", text)]);
  }

  function addSystemMessage(text) {
    setMessages((items) => [...items, createMessage("system", text)]);
  }

  function sendRealtimeEvent(event) {
    if (channelRef.current?.readyState === "open") {
      channelRef.current.send(JSON.stringify(event));
    }
  }

  async function playElevenLabsAudio(text) {
    if (elAudioRef.current) {
      elAudioRef.current.pause();
      elAudioRef.current = null;
    }
    try {
      const response = await fetch("/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text })
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      elAudioRef.current = el;
      el.onended = () => { URL.revokeObjectURL(url); if (elAudioRef.current === el) elAudioRef.current = null; };
      await el.play();
    } catch (err) {
      console.warn("[tts]", err?.message || err);
    }
  }

  function handleRealtimeEvent(event) {
    if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
      if (event.item_id && processedTranscriptIdsRef.current.has(event.item_id)) return;
      if (event.item_id) processedTranscriptIdsRef.current.add(event.item_id);
      addUserMessage(event.transcript);
      return;
    }

    if (
      (event.type === "response.audio_transcript.done" ||
        event.type === "response.output_audio_transcript.done") &&
      event.transcript
    ) {
      addAgentMessage(event.transcript);
      playElevenLabsAudio(event.transcript);
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      if (elAudioRef.current) {
        elAudioRef.current.pause();
        elAudioRef.current = null;
      }
      return;
    }

    if (event.type === "response.function_call_arguments.done") {
      const callId = event.call_id;
      if (callId && processedCallIdsRef.current.has(callId)) return;
      if (callId) processedCallIdsRef.current.add(callId);
      applyLeadUpdate(event.name, event.arguments);
      acknowledgeTool(callId);
      return;
    }

    if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
      const callId = event.item.call_id;
      if (callId && processedCallIdsRef.current.has(callId)) return;
      if (callId) processedCallIdsRef.current.add(callId);
      applyLeadUpdate(event.item.name, event.item.arguments);
      acknowledgeTool(callId);
      return;
    }

    if (event.type === "error") {
      const msg = event.error?.message || "OpenAI devolvio un error.";
      console.warn("[realtime error]", event.error);
      addSystemMessage(msg);
    }
  }

  function applyLeadUpdate(toolName, argsText) {
    if (toolName !== "registrar_campo") return;
    try {
      const { campo, valor } = JSON.parse(argsText || "{}");
      if (!campo || !LEAD_FIELDS.includes(campo)) return;
      if (valor === undefined || valor === null) return;
      const cleanVal = String(valor).trim();
      if (!cleanVal) return;
      setLead((current) => ({ ...current, [campo]: cleanVal }));
    } catch (err) {
      console.warn("[registrar_campo] parse error:", err?.message || err);
    }
  }

  function acknowledgeTool(callId) {
    if (!callId) return;
    sendRealtimeEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ ok: true })
      }
    });
    sendRealtimeEvent({ type: "response.create" });
  }

  function closeRealtime() {
    if (elAudioRef.current) {
      elAudioRef.current.pause();
      elAudioRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
    channelRef.current?.close();
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    channelRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
  }

  function scheduleAutoHangup() {
    if (autoHangupRef.current) return;
    autoHangupRef.current = window.setTimeout(() => {
      closeRealtime();
      addSystemMessage("Llamada finalizada automaticamente.");
      setConnectionState("llamada finalizada automaticamente");
      autoHangupRef.current = null;
    }, 30000);
  }

  const progressPercent =
    callState === "scheduled"
      ? 100
      : Math.round((LEAD_FIELDS.filter((f) => lead[f]).length / LEAD_FIELDS.length) * 100);

  return (
    <main className="app-shell">
      <section className="topbar">
        <div className="topbar-brand">
          <img src="/logo.jpeg" alt="Logo" className="topbar-logo" />
          <div>
            <p className="eyebrow">Inbound AI desk</p>
            <h1>Demo agente IA inmobiliaria</h1>
          </div>
        </div>
        <div className={`status-pill ${callState}`}>
          <span />
          {statusLabel}
        </div>
      </section>

      <section className="dashboard">
        <div className="call-panel">
          <div className="call-header">
            <div className="agent-avatar">
              <span aria-hidden="true">AI</span>
            </div>
            <div>
              <p className="label">Recepcionista virtual</p>
              <h2>Inmobiliaria Centro</h2>
            </div>
            <div className="timer">
              <span aria-hidden="true">◷</span>
              {formatTime(seconds)}
            </div>
          </div>

          <div className="phone-stage">
            <div className="signal-ring">
              <span aria-hidden="true">☎</span>
            </div>
            <div>
              <p className="label">Estado de llamada</p>
              <strong>{statusLabel}</strong>
            </div>
            {callState === "esperando" ? (
              <button className="primary-action" onClick={startCall}>
                <span aria-hidden="true">☎</span>
                Iniciar llamada IA
              </button>
            ) : (
              <div className="call-actions">
                <button className="ghost-action" onClick={endCall}>
                  <span aria-hidden="true">■</span>
                  Colgar
                </button>
                <button className="ghost-action" onClick={resetDemo}>
                  <span aria-hidden="true">↻</span>
                  Reiniciar
                </button>
              </div>
            )}
          </div>

          <div className="progress-block">
            <div className="progress-copy">
              <span>Cualificacion del lead</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="progress-track">
              <div style={{ width: `${progressPercent}%` }} />
            </div>
            <p className="connection-copy">{connectionState}</p>
          </div>

          <div className="transcript" ref={transcriptRef}>
            {messages.length === 0 ? (
              <div className="empty-state">
                <span aria-hidden="true">✦</span>
                <p>La conversacion aparecera aqui cuando inicies la llamada.</p>
              </div>
            ) : (
              messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <span>{getMessageLabel(message.role)}</span>
                  <p>{message.text}</p>
                </article>
              ))
            )}
          </div>

          <div className="voice-note">
            <span aria-hidden="true">●</span>
            {callState === "active"
              ? "Microfono activo: responde hablando y el agente avanzara solo."
              : "Inicia la llamada para activar el microfono."}
          </div>
        </div>

        <aside className="lead-panel">
          <div className="lead-title">
            <span className="lead-icon" aria-hidden="true">▦</span>
            <div>
              <p className="label">Ficha comercial</p>
              <h2>Lead en tiempo real</h2>
            </div>
          </div>

          <LeadRow label="Tipo operacion" value={lead.operation} />
          <LeadRow label="Nombre" value={lead.name} />
          <LeadRow label="Telefono" value={lead.phone} />
          <LeadRow label="Zona" value={lead.zone} />
          <LeadRow label="Tipo propiedad" value={lead.propertyType} />
          <LeadRow label="Precio aprox." value={lead.price} />
          <LeadRow label="Disponibilidad" value={lead.availability} />
          <LeadRow label="Financiacion" value={lead.financing} />
          <LeadRow label="Estado" value={lead.status} strong />

          {callState === "scheduled" && (
            <div className="success-card">
              <span className="success-icon" aria-hidden="true">✓</span>
              <h3>Cita agendada correctamente</h3>
              <dl>
                <SummaryItem label="Nombre" value={lead.name} />
                <SummaryItem label="Telefono" value={lead.phone} />
                <SummaryItem label="Operacion" value={lead.operation} />
                <SummaryItem label="Zona" value={lead.zone} />
                <SummaryItem label="Tipo" value={lead.propertyType} />
                <SummaryItem label="Precio" value={lead.price} />
                <SummaryItem label="Disponibilidad" value={lead.availability} />
                <SummaryItem label="Financiacion" value={lead.financing} />
              </dl>
              <p>Proximo paso: Un agente humano recibira el aviso.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function LeadRow({ label, value, strong = false }) {
  return (
    <div className="lead-row">
      <span>{label}</span>
      <strong className={strong ? "lead-status" : ""}>{value || "Pendiente"}</strong>
    </div>
  );
}

function SummaryItem({ label, value }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value || "Pendiente"}</dd>
    </>
  );
}

function createMessage(role, text) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    text
  };
}

function getMessageLabel(role) {
  if (role === "agent") return "Agente IA";
  if (role === "system") return "Sistema";
  return "Cliente";
}

function formatTime(value) {
  const minutes = Math.floor(value / 60).toString().padStart(2, "0");
  const seconds = (value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default App;
