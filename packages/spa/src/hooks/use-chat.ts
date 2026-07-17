import { useState, useCallback } from "react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: string; text?: string; toolName?: string; state?: string; result?: unknown }>;
}

type ChatStatus = "idle" | "submitted" | "streaming";

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  const sendMessage = useCallback(async (msg: { role: string; parts: Array<{ type: string; text: string }> }) => {
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      parts: msg.parts,
    };
    setMessages((prev) => [...prev, userMsg]);
    setStatus("submitted");
    setError(null);

    try {
      const base = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n"),
          })),
        }),
      });

      if (!res.ok) throw new Error(`Chat error: ${res.status}`);

      setStatus("streaming");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let text = "";
      const assistantId = `a-${Date.now()}`;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const without = prev.filter((m) => m.id !== assistantId);
            return [...without, { id: assistantId, role: "assistant", parts: [{ type: "text", text }] }];
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setStatus("idle");
    }
  }, [messages]);

  return { messages, sendMessage, status, error };
}
