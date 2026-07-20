import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface PlaybookSummary {
  key: string;
  name: string;
  description: string;
  actionCount: number;
}

export default function Playbooks() {
  const { data: playbooks = [], isLoading, isError, refetch } = useQuery<PlaybookSummary[]>({
    queryKey: ["playbooks-catalog"],
    queryFn: () => fetch("/api/playbooks/catalog").then((r) => r.json()),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground font-mono">Loading...</div>;
  if (isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive font-mono">Failed to load playbooks.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="font-mono text-xs">
          <RefreshCw className="size-3 mr-1.5" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold font-mono">Playbooks</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">
          Event-driven action graphs that define how engagements run.
        </p>
      </div>

      {playbooks.length === 0 ? (
        <p className="text-sm text-muted-foreground font-mono">No playbooks found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {playbooks.map((pb) => (
            <Link
              key={pb.key}
              to={`/playbooks/${pb.key}`}
              className="block border border-border rounded-lg p-4 hover:border-pk-amber/30 transition-colors group"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-sm font-semibold text-foreground group-hover:text-pk-amber transition-colors">
                  {pb.name}
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                  built-in
                </span>
              </div>
              <p className="text-xs text-muted-foreground font-mono leading-relaxed mb-3">
                {pb.description}
              </p>
              <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
                <span className="text-pk-amber font-semibold">{pb.actionCount} actions</span>
                <span>read-only</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
