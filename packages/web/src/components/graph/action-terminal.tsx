"use client";

import { useEffect, useRef } from "react";
import type { Terminal } from "xterm";

const TERM_THEME = {
  background: "#0f1219",
  foreground: "#e5e3dd",
  cursor: "#e8a040",
  selectionBackground: "#e8a04040",
};

interface ActionTerminalProps {
  output?: string;
  className?: string;
}

export function ActionTerminal({ output, className }: ActionTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cleanup: (() => void) | undefined;

    (async () => {
      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("xterm/css/xterm.css");

      if (!containerRef.current) return;

      const terminal = new Terminal({
        theme: TERM_THEME,
        fontSize: 12,
        fontFamily: "'SF Mono', Menlo, Consolas, monospace",
        cursorBlink: false,
        disableStdin: true,
        scrollback: 10000,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();

      const observer = new ResizeObserver(() => fitAddon.fit());
      observer.observe(containerRef.current);

      termRef.current = terminal;

      if (output) {
        for (const line of output.split("\n")) {
          terminal.writeln(line);
        }
      } else {
        terminal.writeln("\x1b[2mWaiting for action output...\x1b[0m");
      }

      cleanup = () => {
        observer.disconnect();
        terminal.dispose();
        termRef.current = null;
      };
    })();

    return () => cleanup?.();
  }, [output]);

  return (
    <div
      ref={containerRef}
      className={`rounded-lg border border-border overflow-hidden ${className ?? ""}`}
      style={{ minHeight: 200 }}
    />
  );
}
