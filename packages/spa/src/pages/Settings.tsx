import { useEffect, useState, useCallback } from "react";
import { useTheme } from "@/hooks/use-theme";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface Preferences {
  refreshInterval: number;
  pageLayout: "full" | "centered";
  sidebarStyle: "default" | "compact";
}

const DEFAULTS: Preferences = { refreshInterval: 5000, pageLayout: "full", sidebarStyle: "default" };

function loadPrefs(): Preferences {
  try {
    const stored = localStorage.getItem("pk-preferences");
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS;
  } catch { return DEFAULTS; }
}

function savePrefs(prefs: Preferences) { localStorage.setItem("pk-preferences", JSON.stringify(prefs)); }

interface ServerSettings { defaultModel?: string; aiProvider?: string; ollamaUrl?: string; [key: string]: unknown }

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [server, setServer] = useState<ServerSettings>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then(setServer).catch(() => {});
  }, []);

  const updatePref = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((prev) => { const next = { ...prev, [key]: value }; savePrefs(next); return next; });
  }, []);

  const saveServer = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(server) });
      toast.success("Settings saved");
    } catch { toast.error("Failed to save"); }
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6 max-w-2xl">
      <h1 className="text-xl font-bold font-mono">Settings</h1>

      <Card>
        <CardHeader><CardTitle className="text-sm font-mono">Appearance</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="font-mono text-xs">Theme</Label>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="font-mono text-xs">Refresh interval (ms)</Label>
            <Input type="number" value={prefs.refreshInterval} onChange={(e) => updatePref("refreshInterval", Number(e.target.value))} className="font-mono text-xs" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono">AI Provider</CardTitle>
          <CardDescription className="font-mono text-xs">Model and provider for the web chat</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="font-mono text-xs">Provider</Label>
            <Select value={server.aiProvider ?? "anthropic"} onValueChange={(v) => setServer((s) => ({ ...s, aiProvider: v }))}>
              <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="font-mono text-xs">Model</Label>
            <Input value={server.defaultModel ?? ""} onChange={(e) => setServer((s) => ({ ...s, defaultModel: e.target.value }))} placeholder="claude-sonnet-4-20250514" className="font-mono text-xs" />
          </div>
          {server.aiProvider === "ollama" && (
            <div className="space-y-1">
              <Label className="font-mono text-xs">Ollama URL</Label>
              <Input value={server.ollamaUrl ?? ""} onChange={(e) => setServer((s) => ({ ...s, ollamaUrl: e.target.value }))} placeholder="http://localhost:11434" className="font-mono text-xs" />
            </div>
          )}
          <Button onClick={saveServer} disabled={saving} className="font-mono text-xs">{saving ? "Saving..." : "Save"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
