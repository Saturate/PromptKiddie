const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-400",
  done: "bg-blue-400",
  scoping: "bg-zinc-400",
  paused: "bg-yellow-400",
  reporting: "bg-purple-400",
  created: "bg-zinc-500",
};

export function StatusDot({ status }: { status: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-xs">
      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[status] ?? "bg-zinc-500"}`} />
      {status}
    </span>
  );
}
