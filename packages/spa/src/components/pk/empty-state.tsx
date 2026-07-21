export function EmptyState({
  message,
  sub,
}: {
  message: string;
  sub?: string;
}) {
  return (
    <div className="border border-border rounded-lg p-12 text-center">
      <p className="text-sm text-muted-foreground font-mono">{message}</p>
      {sub && <p className="text-xs text-muted-foreground/50 font-mono mt-1">{sub}</p>}
    </div>
  );
}
