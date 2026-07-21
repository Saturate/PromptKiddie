const PHASE_COLORS: Record<string, string> = {
  scoping: "text-zinc-400",
  recon: "text-blue-400",
  enum: "text-purple-400",
  exploit: "text-red-400",
  postexploit: "text-orange-400",
  report: "text-emerald-400",
};

export function PhaseText({ phase }: { phase: string }) {
  return (
    <span className={`font-mono text-xs ${PHASE_COLORS[phase] ?? "text-muted-foreground"}`}>
      {phase}
    </span>
  );
}
