"use client";

import { useTheme } from "next-themes";
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// --- Local preferences (unchanged) -----------------------------------------

interface Preferences {
  refreshInterval: number;
  pageLayout: "full" | "centered";
  sidebarStyle: "default" | "compact";
}

const DEFAULTS: Preferences = {
  refreshInterval: 5000,
  pageLayout: "full",
  sidebarStyle: "default",
};

function loadPrefs(): Preferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const stored = localStorage.getItem("pk-preferences");
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function savePrefs(prefs: Preferences) {
  localStorage.setItem("pk-preferences", JSON.stringify(prefs));
}

function ToggleGroup({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-4 py-2 text-sm font-mono transition-colors ${
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-muted"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// --- Chat / AI configuration -----------------------------------------------

type Provider = "anthropic" | "openai" | "google" | "ollama";

const PROVIDER_DEFAULTS: Record<Provider, { orchestrator: string; subagent: string }> = {
  anthropic: { orchestrator: "claude-opus-4-8", subagent: "claude-sonnet-4-6" },
  openai:    { orchestrator: "gpt-4o",          subagent: "gpt-4o-mini" },
  google:    { orchestrator: "gemini-2.0-flash", subagent: "gemini-2.0-flash" },
  ollama:    { orchestrator: "llama3",           subagent: "llama3" },
};

interface ChatSettings {
  provider: Provider;
  orchestratorModel: string;
  subagentModel: string;
  maxSteps: number;
}

const CHAT_DEFAULTS: ChatSettings = {
  provider: "anthropic",
  orchestratorModel: "",
  subagentModel: "",
  maxSteps: 20,
};

function parseChatSettings(raw: Record<string, unknown>): ChatSettings {
  return {
    provider: (raw["chat.provider"] as Provider) ?? CHAT_DEFAULTS.provider,
    orchestratorModel: (raw["chat.orchestrator_model"] as string) ?? "",
    subagentModel: (raw["chat.subagent_model"] as string) ?? "",
    maxSteps: typeof raw["chat.max_steps"] === "number" ? raw["chat.max_steps"] : CHAT_DEFAULTS.maxSteps,
  };
}

function chatSettingsToPayload(s: ChatSettings): Record<string, unknown> {
  return {
    "chat.provider": s.provider,
    "chat.orchestrator_model": s.orchestratorModel,
    "chat.subagent_model": s.subagentModel,
    "chat.max_steps": s.maxSteps,
  };
}

// --- Page component --------------------------------------------------------

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [mounted, setMounted] = useState(false);

  // Chat / AI state
  const [chat, setChat] = useState<ChatSettings>(CHAT_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setChat(parseChatSettings(data));
      }
    } catch {
      // settings may not be seeded yet; use defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPrefs(loadPrefs());
    setMounted(true);
    fetchSettings();
  }, [fetchSettings]);

  function update(patch: Partial<Preferences>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  }

  function updateChat(patch: Partial<ChatSettings>) {
    setChat((prev) => {
      const next = { ...prev, ...patch };
      // When provider changes, clear model fields so placeholders show defaults
      if (patch.provider && patch.provider !== prev.provider) {
        next.orchestratorModel = "";
        next.subagentModel = "";
      }
      return next;
    });
  }

  async function saveChat() {
    setSaving(true);
    try {
      const payload = chatSettingsToPayload(chat);
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  const placeholders = PROVIDER_DEFAULTS[chat.provider];

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6 max-w-2xl">
      <h1 className="text-xl font-bold font-mono">Settings</h1>

      {/* Chat / AI Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono">Chat / AI Configuration</CardTitle>
          <CardDescription className="text-xs font-mono">
            Configure the LLM provider and models used by the orchestrator and sub-agents.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="text-xs text-muted-foreground font-mono py-4">Loading settings...</div>
          ) : (
            <>
              {/* Provider */}
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Provider</Label>
                <Select
                  value={chat.provider}
                  onValueChange={(v) => updateChat({ provider: v as Provider })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="ollama">Ollama</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Orchestrator Model */}
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Orchestrator Model</Label>
                <Input
                  value={chat.orchestratorModel}
                  onChange={(e) => updateChat({ orchestratorModel: e.target.value })}
                  placeholder={placeholders.orchestrator}
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground font-mono">
                  Primary model for planning and coordination. Leave blank for the default.
                </p>
              </div>

              {/* Sub-agent Model */}
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Sub-agent Model</Label>
                <Input
                  value={chat.subagentModel}
                  onChange={(e) => updateChat({ subagentModel: e.target.value })}
                  placeholder={placeholders.subagent}
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground font-mono">
                  Model used by spawned sub-agents (recon, enum, exploit). Leave blank for the default.
                </p>
              </div>

              {/* Max Steps */}
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Max Steps</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={chat.maxSteps}
                  onChange={(e) => updateChat({ maxSteps: Number(e.target.value) || 20 })}
                  className="font-mono text-sm w-24"
                />
                <p className="text-[11px] text-muted-foreground font-mono">
                  Maximum tool-call steps per agent invocation (1-100).
                </p>
              </div>

              {/* Save */}
              <div className="pt-2">
                <Button onClick={saveChat} disabled={saving} className="font-mono text-sm">
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono">Preferences</CardTitle>
          <CardDescription className="text-xs font-mono">
            Customize your dashboard layout preferences.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Theme Mode */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Theme Mode</Label>
            <ToggleGroup
              options={[
                { label: "Light", value: "light" },
                { label: "Dark", value: "dark" },
                { label: "System", value: "system" },
              ]}
              value={theme ?? "dark"}
              onChange={setTheme}
            />
          </div>

          {/* Auto-refresh */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Auto-refresh Interval</Label>
            <ToggleGroup
              options={[
                { label: "5s", value: "5000" },
                { label: "10s", value: "10000" },
                { label: "30s", value: "30000" },
                { label: "Off", value: "0" },
              ]}
              value={String(prefs.refreshInterval)}
              onChange={(v) => update({ refreshInterval: Number(v) })}
            />
            <p className="text-[11px] text-muted-foreground font-mono">
              How often engagement pages refresh data. Reload to apply.
            </p>
          </div>

          {/* Page Layout */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Page Layout</Label>
            <ToggleGroup
              options={[
                { label: "Full Width", value: "full" },
                { label: "Centered", value: "centered" },
              ]}
              value={prefs.pageLayout}
              onChange={(v) => update({ pageLayout: v as "full" | "centered" })}
            />
            <p className="text-[11px] text-muted-foreground font-mono">
              Coming soon.
            </p>
          </div>

          {/* Sidebar Style */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Sidebar Style</Label>
            <ToggleGroup
              options={[
                { label: "Default", value: "default" },
                { label: "Compact", value: "compact" },
              ]}
              value={prefs.sidebarStyle}
              onChange={(v) => update({ sidebarStyle: v as "default" | "compact" })}
            />
            <p className="text-[11px] text-muted-foreground font-mono">
              Coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
