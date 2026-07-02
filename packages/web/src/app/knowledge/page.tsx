"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchIcon, DatabaseIcon, BookOpenIcon, RefreshCwIcon, TrashIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";

interface KnowledgeResult {
  id: string;
  content: string;
  source: string;
  path?: string;
  category?: string;
  score: number;
  matchType: string;
}

interface SourceInfo {
  name: string;
  repo: string;
  category: string;
  description: string;
  chunks: number;
  lastIngested: string | null;
  ingested: boolean;
}

function SearchTab() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"hybrid" | "vector" | "keyword">("hybrid");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [results, setResults] = useState<KnowledgeResult[]>([]);
  const [sourceNames, setSourceNames] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((d) => setSourceNames((d.sources ?? []).map((s: { source: string }) => s.source)))
      .catch(() => {});
  }, []);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ q: query, mode, limit: "15" });
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      const res = await fetch(`/api/knowledge?${params}`);
      const data = await res.json();
      setResults(data.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query, mode, sourceFilter]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search techniques, payloads, privesc methods..."
            className="pl-10 font-mono text-sm"
            autoFocus
          />
        </div>
        <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <SelectTrigger className="w-28 font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hybrid" className="font-mono text-xs">Hybrid</SelectItem>
            <SelectItem value="keyword" className="font-mono text-xs">Keyword</SelectItem>
            <SelectItem value="vector" className="font-mono text-xs">Vector</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-44 font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="font-mono text-xs">All sources</SelectItem>
            {sourceNames.map((s) => (
              <SelectItem key={s} value={s} className="font-mono text-xs">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={search} disabled={searching || !query.trim()} className="font-mono text-sm">
          {searching ? "..." : "Search"}
        </Button>
      </div>

      {searched && results.length === 0 && !searching && (
        <div className="text-center py-8 text-muted-foreground font-mono text-sm">
          No results for &quot;{query}&quot;
        </div>
      )}

      {results.map((r) => (
        <Card key={r.id} className="bg-card/50 hover:bg-card/80 transition-colors">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-mono font-semibold text-pk-amber">{r.source}</span>
              {r.path && (
                <span className="text-xs font-mono text-muted-foreground">/ {r.path}</span>
              )}
              <span className="ml-auto text-[10px] font-mono text-muted-foreground/60">
                {r.matchType} {r.score.toFixed(4)}
              </span>
            </div>
            <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
              {r.content.length > 1000 ? r.content.slice(0, 1000) + "\n..." : r.content}
            </pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SourcesTab() {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge/sources");
      const data = await res.json();
      setSources(data.sources ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  async function pull(name: string) {
    setPulling(name);
    toast.info(`Pulling ${name}...`, { description: "This clones inside Docker and embeds all chunks. May take a few minutes." });
    try {
      const res = await fetch("/api/knowledge/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: name }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`${name} pulled successfully`);
      } else {
        toast.error(`Failed to pull ${name}`, { description: data.output?.slice(0, 200) });
      }
      await fetchSources();
    } catch (err) {
      toast.error(`Error pulling ${name}`);
    } finally {
      setPulling(null);
    }
  }

  async function clear(name: string) {
    setClearing(name);
    try {
      const res = await fetch(`/api/knowledge/sources?source=${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await res.json();
      toast.success(`Cleared ${data.cleared} chunks from ${name}`);
      await fetchSources();
    } catch {
      toast.error(`Error clearing ${name}`);
    } finally {
      setClearing(null);
    }
  }

  if (loading) {
    return <div className="text-xs text-muted-foreground font-mono py-4">Loading sources...</div>;
  }

  return (
    <div className="space-y-3">
      {sources.map((s) => (
        <Card key={s.name} className={`bg-card/50 ${s.ingested ? "border-pk-amber/20" : "border-border/50"}`}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <DatabaseIcon className={`h-5 w-5 mt-0.5 ${s.ingested ? "text-pk-amber" : "text-muted-foreground/40"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{s.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{s.category}</span>
                  {s.ingested && (
                    <span className="text-[10px] font-mono text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">active</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono mt-1">{s.description}</p>
                <div className="flex items-center gap-4 mt-2 text-[10px] font-mono text-muted-foreground">
                  <span>{s.chunks.toLocaleString()} chunks</span>
                  {s.lastIngested && (
                    <span>updated {new Date(s.lastIngested).toLocaleDateString()}</span>
                  )}
                  <a href={s.repo} target="_blank" rel="noopener noreferrer" className="text-pk-amber/60 hover:text-pk-amber">
                    repo
                  </a>
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => pull(s.name)}
                  disabled={pulling !== null}
                  className="font-mono text-xs h-8"
                >
                  {pulling === s.name ? (
                    <RefreshCwIcon className="h-3 w-3 animate-spin" />
                  ) : s.ingested ? (
                    <><RefreshCwIcon className="h-3 w-3 mr-1" /> Refresh</>
                  ) : (
                    <><DownloadIcon className="h-3 w-3 mr-1" /> Pull</>
                  )}
                </Button>
                {s.ingested && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => clear(s.name)}
                    disabled={clearing !== null}
                    className="font-mono text-xs h-8 text-destructive hover:text-destructive"
                  >
                    {clearing === s.name ? (
                      <RefreshCwIcon className="h-3 w-3 animate-spin" />
                    ) : (
                      <TrashIcon className="h-3 w-3" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function KnowledgePage() {
  const [tab, setTab] = useState<"search" | "sources">("search");

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <BookOpenIcon className="h-5 w-5 text-pk-amber" />
        <h1 className="text-xl font-bold font-mono">Knowledge Base</h1>
      </div>

      <div className="flex rounded-lg border border-border overflow-hidden w-fit">
        <button
          onClick={() => setTab("search")}
          className={`px-4 py-2 text-sm font-mono transition-colors ${
            tab === "search"
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-muted"
          }`}
        >
          Search
        </button>
        <button
          onClick={() => setTab("sources")}
          className={`px-4 py-2 text-sm font-mono transition-colors ${
            tab === "sources"
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-muted"
          }`}
        >
          Sources
        </button>
      </div>

      {tab === "search" ? <SearchTab /> : <SourcesTab />}
    </div>
  );
}
