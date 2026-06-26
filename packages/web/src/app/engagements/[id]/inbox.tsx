"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { sendInboxMessage } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
    } catch {
      /* retry next cycle */
    }
  }, [engagementId]);

  useEffect(() => {
    fetchMessages();
    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch(
          `/api/messages/stream?engagementId=${engagementId}`,
          { signal: ctrl.signal },
        );
        if (!res.body) return;
        setLive(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) fetchMessages();
          }
        }
      } catch {
        // aborted or network error
      } finally {
        setLive(false);
      }
    })();

    const interval = setInterval(() => {
      if (!live) fetchMessages();
    }, 5000);

    return () => {
      ctrl.abort();
      clearInterval(interval);
    };
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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-mono">Chat</CardTitle>
          <span
            className={`h-2 w-2 rounded-full ${live ? "bg-pk-green" : "bg-muted-foreground"}`}
            title={live ? "Live (streaming)" : "Polling"}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[360px] overflow-y-auto space-y-2 py-2">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground font-mono">
              No messages yet. Send one to the orchestrator.
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.direction === "inbound" ? "items-end" : "items-start"}`}
            >
              <div
                className={`
                  max-w-[75%] rounded-lg px-3 py-2 text-sm font-mono whitespace-pre-wrap break-words
                  ${
                    m.direction === "inbound"
                      ? "bg-pk-green/15 border border-pk-green/30 text-foreground"
                      : "bg-muted border border-border text-foreground"
                  }
                `}
              >
                {m.body}
              </div>
              <span className="text-[10px] text-muted-foreground font-mono mt-0.5 px-1">
                {m.author} &middot;{" "}
                {new Date(m.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2 mt-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            autoComplete="off"
            disabled={sending}
            className="flex-1 font-mono text-sm"
          />
          <Button type="submit" disabled={sending} className="font-mono text-sm">
            {sending ? "..." : "Send"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
