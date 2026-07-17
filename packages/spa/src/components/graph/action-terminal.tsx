
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
  const prevOutputRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!containerRef.current) return;

    let cleanup: (() => void) | undefined;

    (async () => {
      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      // @ts-expect-error xterm CSS import handled by Next.js bundler
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
        prevOutputRef.current = output;
      } else {
        terminal.writeln("\x1b[2mWaiting for action output...\x1b[0m");
      }

      cleanup = () => {
        observer.disconnect();
        terminal.dispose();
        termRef.current = null;
        prevOutputRef.current = undefined;
      };
    })();

    return () => cleanup?.();
    // Re-create terminal only when the component remounts (output identity isn't stable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Append new lines when output grows (streaming mode)
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    if (output === undefined && prevOutputRef.current === undefined) return;

    if (output === undefined) {
      // Cleared: reset terminal
      term.clear();
      term.writeln("\x1b[2mWaiting for action output...\x1b[0m");
      prevOutputRef.current = undefined;
      return;
    }

    const prev = prevOutputRef.current ?? "";
    if (output === prev) return;

    if (output.startsWith(prev) && prev.length > 0) {
      // Append only the new portion
      const newContent = output.slice(prev.length);
      const lines = newContent.split("\n");
      for (const line of lines) {
        if (line) term.writeln(line);
      }
    } else {
      // Full replace
      term.clear();
      for (const line of output.split("\n")) {
        term.writeln(line);
      }
    }

    prevOutputRef.current = output;
  }, [output]);

  return (
    <div
      ref={containerRef}
      className={`rounded-lg border border-border overflow-hidden ${className ?? ""}`}
      style={{ minHeight: 200 }}
    />
  );
}
