import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchIcon, RefreshCwIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";

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
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <h1 className="text-xl font-bold font-mono">Knowledge Base</h1>

      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input placeholder="Search knowledge..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} className="font-mono" />
            <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <SelectTrigger className="w-32 font-mono text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hybrid">Hybrid</SelectItem>
                <SelectItem value="vector">Vector</SelectItem>
                <SelectItem value="keyword">Keyword</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={search} disabled={searching}><SearchIcon className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => (
            <Card key={r.id}>
              <CardContent className="pt-4 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">{r.source}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">score: {r.score.toFixed(3)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{r.matchType}</span>
                </div>
                <p className="font-mono text-sm whitespace-pre-wrap">{r.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <h2 className="text-lg font-bold font-mono mt-4">Sources</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sources.map((s) => (
          <Card key={s.name}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold">{s.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{s.chunks} chunks</span>
              </div>
              <p className="font-mono text-xs text-muted-foreground">{s.description}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => ingest(s.name)}><RefreshCwIcon className="h-3 w-3 mr-1" />Ingest</Button>
                {s.ingested && <Button size="sm" variant="outline" onClick={() => clearSource(s.name)}><TrashIcon className="h-3 w-3 mr-1" />Clear</Button>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
