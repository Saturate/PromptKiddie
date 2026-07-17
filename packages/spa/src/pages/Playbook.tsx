import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { ActionGraphView } from "@/components/graph/action-graph";
import { ActionDetail, type ActionDetailData } from "@/components/graph/action-detail";
import { fetchEngagements } from "@/api/client";

interface PlaybookInfo { key: string; name: string }
interface EngagementSummary { id: string; name: string; phase: string; group: string | null; status: string }

export default function Playbook() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [engagementId, setEngagementId] = useState<string | null>(searchParams.get("engagement"));
  const [engagements, setEngagements] = useState<EngagementSummary[]>([]);
  const [graphData, setGraphData] = useState<unknown>(null);
  const [selectedAction, setSelectedAction] = useState<ActionDetailData | null>(null);

  useEffect(() => {
    fetchEngagements().then((data) => setEngagements(data as EngagementSummary[]));
  }, []);

  useEffect(() => {
    if (!engagementId) return;
    fetch(`/api/playbook?engagement=${engagementId}`)
      .then((r) => r.json())
      .then(setGraphData)
      .catch(() => {});
  }, [engagementId]);

  const handleSelect = useCallback((id: string) => {
    setEngagementId(id);
    setSearchParams({ engagement: id });
  }, [setSearchParams]);

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold font-mono">Playbook</h1>
        <select
          className="font-mono text-sm bg-background border border-border rounded px-2 py-1"
          value={engagementId ?? ""}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="">Select engagement...</option>
          {engagements.filter((e) => e.status === "active").map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>

      {engagementId && graphData ? (
        <div className="h-[calc(100vh-200px)]">
          <ReactFlowProvider>
            <ActionGraphView
              data={graphData}
              onSelectAction={setSelectedAction}
            />
          </ReactFlowProvider>
        </div>
      ) : (
        <div className="text-center py-20">
          <p className="text-sm text-muted-foreground font-mono">
            Select an active engagement to view its playbook graph.
          </p>
        </div>
      )}
    </div>
  );
}
