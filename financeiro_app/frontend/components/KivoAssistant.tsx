"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { KivoRobotBuddy, type BuddyPose } from "./KivoRobotBuddy";

type KivoAssistantProps = {
  username: string;
};

type ChatMessage = {
  id: number;
  role: "user" | "bot";
  text: string;
};

type AssistantPhase = "dock" | "emerging" | "open" | "thinking" | "closing";

const EMERGE_MS = 580;
const CLOSE_MS = 520;
const THINK_MS = 2800;

export function KivoAssistant({ username }: KivoAssistantProps) {
  const [phase, setPhase] = useState<AssistantPhase>("dock");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [msgId, setMsgId] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const thinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayName = username.trim() || "você";

  const panelVisible = phase === "emerging" || phase === "open" || phase === "thinking" || phase === "closing";
  const chatActive = phase === "open" || phase === "thinking";

  const buddyPose: BuddyPose =
    phase === "thinking" ? "thinking" : phase === "dock" || phase === "closing" ? "docked" : phase === "emerging" ? "idle" : "peek";

  const seedWelcome = () => {
    setMessages([
      {
        id: 0,
        role: "bot",
        text: `Oi, ${displayName}! Sou o assistente do KIVO. Manda uma mensagem — em breve respondo com IA de verdade; por enquanto eu finjo que penso andando por aí.`,
      },
    ]);
    setMsgId(1);
  };

  const openAssistant = () => {
    if (phase !== "dock") return;
    if (messages.length === 0) seedWelcome();
    setPhase("emerging");
  };

  const closeAssistant = () => {
    if (phase === "dock" || phase === "closing") return;
    if (thinkTimerRef.current) {
      clearTimeout(thinkTimerRef.current);
      thinkTimerRef.current = null;
    }
    setPhase("closing");
  };

  useEffect(() => {
    if (phase !== "emerging") return;
    const timer = setTimeout(() => setPhase("open"), EMERGE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "closing") return;
    const timer = setTimeout(() => setPhase("dock"), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!panelVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAssistant();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelVisible]);

  useEffect(() => {
    if (!chatActive) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if ((target as Element).closest?.(".kivo-assistant-buddy-btn")) return;
      closeAssistant();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [chatActive]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, phase]);

  useEffect(() => {
    return () => {
      if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current);
    };
  }, []);

  const handleBuddyClick = () => {
    if (phase === "dock") openAssistant();
    else if (phase === "open" || phase === "thinking") closeAssistant();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || phase !== "open") return;

    const userId = msgId;
    setMsgId((n) => n + 1);
    setMessages((prev) => [...prev, { id: userId, role: "user", text }]);
    setDraft("");
    setPhase("thinking");

    thinkTimerRef.current = setTimeout(() => {
      const botId = userId + 1;
      setMsgId((n) => Math.max(n, botId + 1));
      setMessages((prev) => [
        ...prev,
        {
          id: botId,
          role: "bot",
          text: `Entendi: “${text}”. Quando a API do GPT estiver ligada, respondo de forma completa. Por ora foi só um teste do meu modo pensante.`,
        },
      ]);
      setPhase("open");
      thinkTimerRef.current = null;
    }, THINK_MS);
  };

  return (
    <div className={`kivo-assistant kivo-assistant--${phase}`} aria-live="polite">
      {panelVisible && (
        <div
          ref={panelRef}
          id="kivo-assistant-panel"
          className="kivo-assistant-panel"
          role="dialog"
          aria-labelledby="kivo-assistant-title"
          aria-modal="true"
        >
          <header className="kivo-assistant-header">
            <div>
              <p id="kivo-assistant-title" className="kivo-assistant-title">
                Assistente KIVO
              </p>
              <p className="kivo-assistant-badge">
                {phase === "thinking" ? "Pensando…" : "Prévia do chat"}
              </p>
            </div>
            <button type="button" className="kivo-assistant-close" onClick={closeAssistant} aria-label="Fechar assistente">
              ×
            </button>
          </header>

          <div ref={messagesRef} className="kivo-assistant-messages">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`kivo-assistant-bubble ${
                  msg.role === "user" ? "kivo-assistant-bubble--user" : "kivo-assistant-bubble--bot"
                }`}
              >
                <p>{msg.text}</p>
              </div>
            ))}
            {phase === "thinking" && (
              <div className="kivo-assistant-bubble kivo-assistant-bubble--bot kivo-assistant-bubble--typing">
                <span className="kivo-assistant-typing" aria-label="Digitando">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
          </div>

          <form className="kivo-assistant-compose" onSubmit={handleSubmit} aria-label="Enviar mensagem ao assistente">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Escreva sua mensagem…"
              disabled={phase !== "open"}
              autoComplete="off"
            />
            <button type="submit" disabled={phase !== "open" || !draft.trim()}>
              Enviar
            </button>
          </form>
        </div>
      )}

      <div className="kivo-assistant-stage">
        {phase === "thinking" && (
          <span className="kivo-assistant-thought" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}

        <div className="kivo-assistant-buddy-slot">
          <button
            type="button"
            className="kivo-assistant-buddy-btn"
            onClick={handleBuddyClick}
            aria-expanded={chatActive}
            aria-controls="kivo-assistant-panel"
            aria-label={
              phase === "dock"
                ? "Chamar assistente KIVO"
                : phase === "thinking"
                  ? "Assistente pensando"
                  : "Fechar assistente KIVO"
            }
            disabled={phase === "emerging" || phase === "closing"}
          >
            <KivoRobotBuddy pose={buddyPose} className="kivo-assistant-buddy-svg" />
          </button>
          {(phase === "dock" || phase === "closing") && (
            <div className="kivo-assistant-dock-shelf" aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  );
}
