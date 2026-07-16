import { useState, useEffect, useRef, useCallback } from "react";

interface PkEvent {
  engagementId?: string;
  type: string;
  payload: Record<string, unknown>;
  source?: string;
  createdAt?: string;
}

export function useEventStream(engagementId?: string) {
  const [events, setEvents] = useState<PkEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  const connect = useCallback(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const base = import.meta.env.VITE_API_URL
      ? import.meta.env.VITE_API_URL.replace(/^http/, "ws")
      : `${proto}//${location.host}`;
    const params = new URLSearchParams();
    if (engagementId) params.set("engagementId", engagementId);
    const url = `${base}/ws/events?${params}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // Auth via first message if API key is configured
      const apiKey = import.meta.env.VITE_API_KEY;
      if (apiKey) ws.send(JSON.stringify({ key: apiKey }));
      setConnected(true);
      retryRef.current = 0;
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "authenticated") return;
        const event = msg as PkEvent;
        setEvents((prev) => [...prev.slice(-200), event]);
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      const delay = Math.min(1000 * 2 ** retryRef.current, 30000);
      retryRef.current++;
      setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, [engagementId]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}
