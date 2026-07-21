const SEV_COLORS: Record<string, { dot: string; text: string; badge: string }> = {
  critical: { dot: "bg-severity-critical", text: "text-severity-critical", badge: "bg-severity-critical text-white" },
  high: { dot: "bg-severity-high", text: "text-severity-high", badge: "bg-severity-high text-black" },
  medium: { dot: "bg-severity-medium", text: "text-severity-medium", badge: "bg-severity-medium text-black" },
  low: { dot: "bg-severity-low", text: "text-severity-low", badge: "bg-severity-low text-white" },
  info: { dot: "bg-severity-info", text: "text-severity-info", badge: "bg-severity-info text-white" },
};

export function SeverityDot({ severity }: { severity: string }) {
  const c = SEV_COLORS[severity];
  return (
    <span className="flex items-center gap-1.5 font-mono text-xs">
      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${c?.dot ?? "bg-zinc-500"}`} />
      <span className={c?.text ?? "text-muted-foreground"}>{severity}</span>
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const c = SEV_COLORS[severity];
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono font-medium ${c?.badge ?? "bg-zinc-500 text-white"}`}>
      {severity}
    </span>
  );
}
