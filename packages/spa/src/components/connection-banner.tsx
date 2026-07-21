import { useApiHealth } from "@/hooks/use-api";
import { WifiOff } from "lucide-react";

export function ConnectionBanner() {
  const { isError } = useApiHealth();
  if (!isError) return null;

  return (
    <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2 mb-4 flex items-center gap-2">
      <WifiOff className="size-4 text-destructive shrink-0" />
      <span className="font-mono text-sm text-destructive">
        API unreachable
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        Retrying automatically...
      </span>
    </div>
  );
}
