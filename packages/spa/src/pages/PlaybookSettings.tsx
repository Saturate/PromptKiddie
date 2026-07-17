import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Playbook { id: string; name: string; engagementType: string; isDefault: boolean }

export default function PlaybookSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [selected, setSelected] = useState<string | null>(searchParams.get("id"));

  useEffect(() => {
    fetch("/api/playbooks").then((r) => r.json()).then(setPlaybooks).catch(() => {});
  }, []);

  const handleSelect = (id: string) => {
    setSelected(id);
    setSearchParams({ id });
  };

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <h1 className="text-xl font-bold font-mono">Playbook Templates</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {playbooks.map((pb) => (
          <Card
            key={pb.id}
            className={`cursor-pointer transition-colors ${selected === pb.id ? "border-pk-amber" : ""}`}
            onClick={() => handleSelect(pb.id)}
          >
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold">{pb.name}</span>
                {pb.isDefault && <span className="font-mono text-[10px] text-pk-amber">default</span>}
              </div>
              <p className="font-mono text-xs text-muted-foreground mt-1">{pb.engagementType}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono">Editor</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-xs text-muted-foreground">
              Playbook graph editor will be migrated in a follow-up. Use the CLI for now:
              <code className="block mt-2 bg-background border border-border rounded px-3 py-2 text-pk-amber">
                pk playbook export {selected} -o playbook.md
              </code>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
