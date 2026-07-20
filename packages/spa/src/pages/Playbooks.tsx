import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PlaybookSummary {
  key: string;
  name: string;
  description: string;
  actionCount: number;
}

export default function Playbooks() {
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/playbooks/catalog")
      .then((r) => r.json())
      .then((data) => setPlaybooks(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold font-mono">Playbooks</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">
          Event-driven action graphs that define how engagements run.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground font-mono">Loading...</p>
      ) : playbooks.length === 0 ? (
        <p className="text-sm text-muted-foreground font-mono">No playbooks found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {playbooks.map((pb) => (
            <Link key={pb.key} to={`/playbooks/${pb.key}`} className="group">
              <Card className="h-full transition-colors group-hover:border-pk-amber/40">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-mono">{pb.name}</CardTitle>
                    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                      built-in
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground font-mono leading-relaxed mb-3">
                    {pb.description}
                  </p>
                  <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
                    <span className="text-pk-amber font-semibold">{pb.actionCount} actions</span>
                    <span>read-only</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
