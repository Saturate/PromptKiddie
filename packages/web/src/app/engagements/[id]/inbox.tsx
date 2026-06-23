"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { sendInboxMessage } from "./actions";

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  author: string;
  body: string;
  status: string;
  createdAt: string;
}

export function Inbox({ engagementId }: { engagementId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages?engagementId=${engagementId}`);
      if (res.ok) setMessages(await res.json());
    } catch { /* retry next cycle */ }
  }, [engagementId]);

  useEffect(() => {
    fetchMessages();

    const es = new EventSource(`/api/messages/stream?engagementId=${engagementId}`);
    es.onopen = () => setLive(true);
    es.onmessage = () => { fetchMessages(); };
    es.onerror = () => { setLive(false); };

    // polling fallback when SSE is disconnected
    const interval = setInterval(() => {
      if (!live) fetchMessages();
    }, 5000);

    return () => { es.close(); clearInterval(interval); };
  }, [engagementId, fetchMessages, live]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body) return;
    setSending(true);
    setInput("");
    await sendInboxMessage(engagementId, body);
    await fetchMessages();
    setSending(false);
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="row">
        <h3>Inbox</h3>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: live ? "var(--accent)" : "var(--text-dim)",
            marginLeft: 6,
          }}
          title={live ? "Live (SSE connected)" : "Polling"}
        />
      </div>

      <div
        style={{
          marginTop: 8,
          maxHeight: 360,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "8px 0",
        }}
      >
        {messages.length === 0 && (
          <p className="dim" style={{ fontSize: "0.8rem" }}>
            No messages yet. Send one to the orchestrator below.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: m.direction === "inbound" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                background:
                  m.direction === "inbound"
                    ? "var(--accent-dim)"
                    : "var(--bg-hover)",
                border: `1px solid ${m.direction === "inbound" ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--radius)",
                padding: "6px 10px",
                maxWidth: "75%",
                fontSize: "0.9rem",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {m.body}
            </div>
            <span
              className="dim"
              style={{ fontSize: "0.7rem", marginTop: 2, padding: "0 4px" }}
            >
              {m.author} &middot;{" "}
              {new Date(m.createdAt).toLocaleTimeString()}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: 8, marginTop: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          type="text"
          placeholder="Type a message..."
          autoComplete="off"
          disabled={sending}
          style={{
            flex: 1,
            padding: "8px 12px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--text)",
            fontFamily: "var(--mono)",
            fontSize: "0.9rem",
          }}
        />
        <button
          type="submit"
          disabled={sending}
          style={{
            padding: "8px 16px",
            background: "var(--accent-dim)",
            color: "var(--accent)",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius)",
            cursor: "pointer",
            fontFamily: "var(--mono)",
            fontSize: "0.9rem",
          }}
        >
          {sending ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
