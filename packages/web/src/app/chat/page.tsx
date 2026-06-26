"use client";

import { useChat } from "ai/react";
import { useState } from "react";

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: "/api/chat",
    maxSteps: 10,
  });
  const [showTools, setShowTools] = useState(false);

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold">PromptKiddie Chat</h1>
          <p className="text-sm text-muted-foreground">AI pentesting assistant with engagement tools</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showTools}
            onChange={(e) => setShowTools(e.target.checked)}
            className="rounded"
          />
          Show tool calls
        </label>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground mt-20">
            <p className="text-xl mb-2">Ready to hack.</p>
            <p className="text-sm">Try: &quot;Create a CTF engagement for THM Clocky&quot;</p>
            <p className="text-sm">Or: &quot;Show me all engagements&quot;</p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id}>
            {m.role === "user" ? (
              <div className="flex justify-end">
                <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-[80%]">
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ) : (
              <div className="flex justify-start">
                <div className="space-y-2 max-w-[80%]">
                  {m.parts?.map((part, i) => {
                    if (part.type === "text" && part.text) {
                      return (
                        <div key={i} className="bg-muted rounded-lg px-4 py-2">
                          <p className="whitespace-pre-wrap">{part.text}</p>
                        </div>
                      );
                    }
                    if (part.type === "tool-invocation" && showTools) {
                      return (
                        <div key={i} className="bg-muted/50 border rounded-lg px-3 py-2 text-xs font-mono">
                          <span className="text-muted-foreground">tool: </span>
                          <span className="text-blue-500">{part.toolInvocation.toolName}</span>
                          {part.toolInvocation.state === "result" && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-muted-foreground">result</summary>
                              <pre className="mt-1 overflow-x-auto text-xs">
                                {JSON.stringify(part.toolInvocation.result, null, 2)?.slice(0, 500)}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-2 animate-pulse">Thinking...</div>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive rounded-lg px-4 py-2 text-sm">
            Error: {error.message}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t px-6 py-3 flex gap-3 shrink-0">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Ask PromptKiddie..."
          className="flex-1 bg-muted rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-primary text-primary-foreground rounded-lg px-6 py-2 text-sm font-medium disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
