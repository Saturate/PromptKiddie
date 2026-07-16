
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ActionTerminal } from "./action-terminal";
import type { ActionNodeData } from "./action-node";
import type { LiveEvent, LiveOutputLine } from "@/hooks/graph-helpers";
import { Radio } from "lucide-react";

const KIND_BADGE: Record<string, { label: string; color: string }> = {
  script: { label: "Script", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  agent: { label: "Agent", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  both: { label: "Script + Agent", color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
};

export interface ActionDetailData extends ActionNodeData {
  id: string;
  triggeredBy: string[];
  triggers: string[];
  prompt?: string;
}

interface ActionDetailProps {
  action: ActionDetailData | null;
  open: boolean;
  onClose: () => void;
  /** Live output lines filtered for this action. */
  liveOutputLines?: LiveOutputLine[];
  /** Live events where source matches this action. */
  liveEvents?: LiveEvent[];
  /** Whether we are in live mode. */
  isLive?: boolean;
}

export function ActionDetail({
  action,
  open,
  onClose,
  liveOutputLines,
  liveEvents,
  isLive,
}: ActionDetailProps) {
  if (!action) return null;
  const badge = KIND_BADGE[action.kind] ?? KIND_BADGE.script;

  // Build terminal output from live data
  const liveOutput =
    liveOutputLines && liveOutputLines.length > 0
      ? liveOutputLines.map((l) => l.line).join("\n")
      : undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[400px] sm:w-[480px] font-mono bg-card border-border overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">{action.name}</SheetTitle>
          {action.description && (
            <SheetDescription className="font-mono text-xs">
              {action.description}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.color}`}>
              {badge.label}
            </span>
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] text-red-400">
                <Radio className="size-3 animate-pulse" />
                live
              </span>
            )}
            {action.running > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-pk-amber">
                <span className="h-1.5 w-1.5 rounded-full bg-pk-amber animate-pulse" />
                {action.running} running
              </span>
            )}
            {action.eventCount > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {action.eventCount} events
              </span>
            )}
          </div>

          {action.emits.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Emits</h4>
              <div className="flex flex-wrap gap-1">
                {action.emits.map((e) => (
                  <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          {action.triggeredBy.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Triggered by events</h4>
              <div className="flex flex-wrap gap-1">
                {action.triggeredBy.map((e) => (
                  <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          {action.triggers.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Triggers actions</h4>
              <div className="flex flex-wrap gap-1">
                {action.triggers.map((name) => (
                  <span key={name} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {action.prompt && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">LLM Prompt</h4>
              <pre className="text-[10px] leading-relaxed bg-background border border-border rounded-lg p-3 whitespace-pre-wrap text-foreground/80">
                {action.prompt}
              </pre>
            </div>
          )}

          {/* Live events for this action */}
          {isLive && liveEvents && liveEvents.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Events from this action
              </h4>
              <div className="space-y-0.5 max-h-[150px] overflow-y-auto rounded-lg border border-border bg-background p-2">
                {liveEvents.map((evt, i) => {
                  const time = new Date(evt.time);
                  const ts = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}:${time.getSeconds().toString().padStart(2, "0")}`;
                  return (
                    <div
                      key={i}
                      className={`flex items-baseline gap-2 text-[10px] font-mono ${
                        i === liveEvents.length - 1 ? "text-pk-amber" : "text-muted-foreground"
                      }`}
                    >
                      <span className="text-muted-foreground/50 tabular-nums shrink-0">{ts}</span>
                      <span className="font-semibold">{evt.type}</span>
                      <span className="text-muted-foreground/60 truncate">
                        {JSON.stringify(evt.payload)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Output</h4>
            <ActionTerminal
              output={liveOutput}
              className="h-[250px]"
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
