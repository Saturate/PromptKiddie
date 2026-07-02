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
import { SearchIcon, DatabaseIcon, BookOpenIcon } from "lucide-react";

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
  source: string;
  chunks: number;
  lastIngested: string;
}

export default function KnowledgePage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"hybrid" | "vector" | "keyword">("keyword");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [results, setResults] = useState<KnowledgeResult[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []))
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

  const totalChunks = sources.reduce((n, s) => n + s.chunks, 0);

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <BookOpenIcon className="h-5 w-5 text-pk-amber" />
        <h1 className="text-xl font-bold font-mono">Knowledge Base</h1>
        <span className="text-xs text-muted-foreground font-mono ml-auto">
          {totalChunks.toLocaleString()} chunks across {sources.length} sources
        </span>
      </div>

      {/* Search bar */}
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
            <SelectItem value="keyword" className="font-mono text-xs">Keyword</SelectItem>
            <SelectItem value="hybrid" className="font-mono text-xs">Hybrid</SelectItem>
            <SelectItem value="vector" className="font-mono text-xs">Vector</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-44 font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="font-mono text-xs">All sources</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s.source} value={s.source} className="font-mono text-xs">
                {s.source}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={search} disabled={searching || !query.trim()} className="font-mono text-sm">
          {searching ? "..." : "Search"}
        </Button>
      </div>

      {/* Sources overview (when no search) */}
      {!searched && sources.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sources.map((s) => (
            <Card key={s.source} className="bg-card/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DatabaseIcon className="h-4 w-4 text-pk-amber" />
                  <span className="font-mono text-sm font-semibold">{s.source}</span>
                </div>
                <div className="text-xs text-muted-foreground font-mono space-y-0.5">
                  <div>{s.chunks.toLocaleString()} chunks</div>
                  <div>Updated {new Date(s.lastIngested).toLocaleDateString()}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* No sources */}
      {!searched && sources.length === 0 && (
        <div className="text-center py-12 text-muted-foreground font-mono text-sm">
          <p>No knowledge sources ingested yet.</p>
          <p className="mt-1">Run: <code className="bg-muted px-2 py-0.5 rounded text-pk-amber">pk knowledge pull --all</code></p>
        </div>
      )}

      {/* Results */}
      {searched && (
        <div className="space-y-3">
          {results.length === 0 && !searching && (
            <div className="text-center py-8 text-muted-foreground font-mono text-sm">
              No results for "{query}"
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
      )}
    </div>
  );
}
