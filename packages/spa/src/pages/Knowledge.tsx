import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchIcon, RefreshCwIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, SectionLabel } from "@/components/pk";

interface KnowledgeResult {
  id: string; content: string; source: string; path?: string;
  category?: string; score: number; matchType: string;
}

interface SourceInfo {
  name: string; description: string; chunks: number;
  lastIngested: string | null; ingested: boolean;
}

export default function Knowledge() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"hybrid" | "vector" | "keyword">("hybrid");
  const [results, setResults] = useState<KnowledgeResult[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    fetch("/api/knowledge/sources").then((r) => r.json()).then(setSources).catch(() => {});
  }, []);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: query, mode });
      const res = await fetch(`/api/knowledge?${params}`);
      const data = await res.json();
      setResults(data.results ?? data);
    } catch { toast.error("Search failed"); }
    setSearching(false);
  };

  const ingest = async (sourceName: string) => {
    try {
      await fetch("/api/knowledge/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: sourceName }) });
      toast.success(`Ingesting ${sourceName}...`);
    } catch { toast.error("Ingest failed"); }
  };

  const clearSource = async (name: string) => {
    try {
      await fetch(`/api/knowledge/sources/${encodeURIComponent(name)}`, { method: "DELETE" });
      toast.success(`Cleared ${name}`);
      setSources((prev) => prev.map((s) => s.name === name ? { ...s, chunks: 0, ingested: false } : s));
    } catch { toast.error("Clear failed"); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Knowledge Base" />

      <div className="border border-border rounded-lg p-4">
        <div className="flex gap-2">
          <Input placeholder="Search knowledge..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} className="font-mono" />
          <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <SelectTrigger className="w-32 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hybrid">hybrid</SelectItem>
              <SelectItem value="vector">vector</SelectItem>
              <SelectItem value="keyword">keyword</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={search} disabled={searching} size="icon" variant="default"><SearchIcon className="h-4 w-4" /></Button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => (
            <div key={r.id} className="border border-border rounded-lg p-4 space-y-1.5 hover:border-border/80 transition-colors">
              <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                <span className="text-pk-amber">{r.source}</span>
                <span>score: {r.score.toFixed(3)}</span>
                <span>{r.matchType}</span>
              </div>
              <p className="font-mono text-sm whitespace-pre-wrap leading-relaxed">{r.content}</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <SectionLabel>Sources</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sources.map((s) => (
            <div key={s.name} className="border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold">{s.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{s.chunks} chunks</span>
              </div>
              {s.description && <p className="font-mono text-xs text-muted-foreground">{s.description}</p>}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => ingest(s.name)} className="font-mono text-xs"><RefreshCwIcon className="h-3 w-3 mr-1" />Ingest</Button>
                {s.ingested && <Button size="sm" variant="outline" onClick={() => clearSource(s.name)} className="font-mono text-xs"><TrashIcon className="h-3 w-3 mr-1" />Clear</Button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
