"use client";

import { useActionState } from "react";
import { sendInboxMessage } from "./actions";

async function handleSend(
  _prev: { ok: boolean },
  formData: FormData,
): Promise<{ ok: boolean }> {
  const body = formData.get("body") as string;
  const engagementId = formData.get("engagementId") as string;
  if (!body.trim()) return { ok: false };
  await sendInboxMessage(engagementId, body);
  return { ok: true };
}

export function Inbox({ engagementId }: { engagementId: string }) {
  const [, action, pending] = useActionState(handleSend, { ok: false });

  return (
    <div className="card">
      <h3>Inbox</h3>
      <p className="dim mt-1" style={{ fontSize: "0.8rem" }}>
        Send a message to the orchestrator. It picks up inbound messages
        on its next poll cycle.
      </p>
      <form action={action} className="mt-1" style={{ display: "flex", gap: 8 }}>
        <input type="hidden" name="engagementId" value={engagementId} />
        <input
          name="body"
          type="text"
          placeholder="Type a message..."
          autoComplete="off"
          disabled={pending}
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
          disabled={pending}
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
          {pending ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
