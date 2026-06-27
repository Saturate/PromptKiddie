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

type Provider = "anthropic" | "openai" | "google" | "custom";
type ChatMode = "floating" | "harness";
type Harness = "claude-code" | "opencode" | "pi" | "codex";

const HARNESS_INFO: Record<Harness, { label: string; init: string; desc: string }> = {
  "claude-code": {
    label: "Claude Code",
    init: "pk init --harness claude-code",
    desc: "Anthropic's CLI agent. Creates .claude/agents/ and CLAUDE.md.",
  },
  opencode: {
    label: "OpenCode",
    init: "pk init --harness opencode",
    desc: "Open-source coding agent. Creates opencode config and agent definitions.",
  },
  pi: {
    label: "Pi.dev",
    init: "pk init --harness pi",
    desc: "AI coding agent by Pi. Creates Pi configuration files.",
  },
  codex: {
    label: "Codex",
    init: "pk init --harness codex",
    desc: "OpenAI's coding agent. Creates Codex configuration files.",
  },
};

const PROVIDER_DEFAULTS: Record<Provider, { orchestrator: string; subagent: string }> = {
  anthropic: { orchestrator: "claude-opus-4-8", subagent: "claude-opus-4-8" },
  openai:    { orchestrator: "gpt-4o",          subagent: "gpt-4o-mini" },
  google:    { orchestrator: "gemini-2.0-flash", subagent: "gemini-2.0-flash" },
  custom:    { orchestrator: "",                 subagent: "" },
};

interface ChatSettings {
  provider: Provider;
  orchestratorModel: string;
  subagentModel: string;
  baseUrl: string;
  mode: ChatMode;
  harness: Harness;
  maxSteps: number;
}

const CHAT_DEFAULTS: ChatSettings = {
  provider: "anthropic",
  orchestratorModel: "",
  subagentModel: "",
  baseUrl: "",
  mode: "harness",
  harness: "claude-code",
  maxSteps: 0,
};

function parseChatSettings(raw: Record<string, unknown>): ChatSettings {
  return {
    provider: (raw["chat.provider"] as Provider) ?? CHAT_DEFAULTS.provider,
    orchestratorModel: (raw["chat.orchestrator_model"] as string) ?? "",
    subagentModel: (raw["chat.subagent_model"] as string) ?? "",
    baseUrl: (raw["chat.base_url"] as string) ?? "",
    mode: (raw["chat.mode"] as ChatMode) ?? "harness",
    harness: (raw["chat.harness"] as Harness) ?? "claude-code",
    maxSteps: typeof raw["chat.max_steps"] === "number" ? raw["chat.max_steps"] : 0,
  };
}

function chatSettingsToPayload(s: ChatSettings): Record<string, unknown> {
  return {
    "chat.provider": s.provider,
    "chat.orchestrator_model": s.orchestratorModel,
    "chat.subagent_model": s.subagentModel,
    "chat.base_url": s.baseUrl,
    "chat.mode": s.mode,
    "chat.harness": s.harness,
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
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
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

  const fetchModels = useCallback(async (provider: string, baseUrl?: string) => {
    setLoadingModels(true);
    try {
      const params = new URLSearchParams({ provider });
      if (baseUrl) params.set("baseUrl", baseUrl);
      const res = await fetch(`/api/models?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAvailableModels(data.models ?? []);
      }
    } catch { /* ignore */ }
    finally { setLoadingModels(false); }
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
      if (patch.provider && patch.provider !== prev.provider) {
        next.orchestratorModel = "";
        next.subagentModel = "";
        fetchModels(patch.provider, next.baseUrl);
      }
      return next;
    });
  }

  useEffect(() => {
    if (mounted && chat.provider && chat.mode === "floating") {
      fetchModels(chat.provider, chat.baseUrl);
    }
  }, [mounted, chat.provider, chat.mode, chat.baseUrl, fetchModels]);

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
              {/* Chat Mode */}
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Chat Mode</Label>
                <ToggleGroup
                  options={[
                    { label: "Integrated", value: "floating" },
                    { label: "External Harness", value: "harness" },
                  ]}
                  value={chat.mode}
                  onChange={(v) => updateChat({ mode: v as ChatMode })}
                />
                <p className="text-[11px] text-muted-foreground font-mono">
                  Integrated: built-in chat widget on every page. External Harness: Claude Code, OpenCode, or Pi controls via inbox.
                </p>

              {chat.mode === "harness" && (
                <>
                <div className="space-y-2">
                  <Label className="font-mono text-xs uppercase tracking-wider">Harness</Label>
                  <ToggleGroup
                    options={[
                      { label: "Claude Code", value: "claude-code" },
                      { label: "OpenCode", value: "opencode" },
                      { label: "Pi.dev", value: "pi" },
                      { label: "Codex", value: "codex" },
                    ]}
                    value={chat.harness}
                    onChange={(v) => updateChat({ harness: v as Harness })}
                  />
                </div>
                <div className="bg-muted rounded-lg p-4 space-y-2">
                  <p className="text-xs font-mono font-semibold">{HARNESS_INFO[chat.harness].label} Setup</p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {HARNESS_INFO[chat.harness].desc}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    Run <code className="bg-background px-1.5 py-0.5 rounded text-pk-green">{HARNESS_INFO[chat.harness].init}</code> in your project directory, then:
                  </p>
                  <pre className="text-[11px] font-mono bg-background rounded p-2 text-muted-foreground">
{`pk msg poll          # read new messages
pk msg send --body "..." # send replies
pk engagement show   # get full context`}
                  </pre>
                </div>
                </>
              )}
              </div>

              {/* Provider */}
              {chat.mode === "floating" && (
              <>
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
                    <SelectItem value="custom">Custom (OpenAI-compatible)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Base URL (custom provider) */}
              {chat.provider === "custom" && (
                <div className="space-y-2">
                  <Label className="font-mono text-xs uppercase tracking-wider">Base URL</Label>
                  <Input
                    value={chat.baseUrl}
                    onChange={(e) => updateChat({ baseUrl: e.target.value })}
                    placeholder="http://localhost:11434/v1"
                    className="font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground font-mono">
                    Any OpenAI-compatible API endpoint (Ollama, LM Studio, vLLM, etc).
                  </p>
                </div>
              )}

              {/* Orchestrator Model */}
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Orchestrator Model</Label>
                {availableModels.length > 0 ? (
                  <Select
                    value={chat.orchestratorModel || placeholders.orchestrator}
                    onValueChange={(v) => updateChat({ orchestratorModel: v })}
                  >
                    <SelectTrigger className="w-full font-mono text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((m) => (
                        <SelectItem key={m} value={m} className="font-mono text-sm">{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={chat.orchestratorModel}
                    onChange={(e) => updateChat({ orchestratorModel: e.target.value })}
                    placeholder={placeholders.orchestrator || "model-name"}
                    className="font-mono text-sm"
                  />
                )}
                <p className="text-[11px] text-muted-foreground font-mono">
                  Primary model for planning and coordination.{loadingModels ? " Loading models..." : ""}
                </p>
              </div>

              {/* Sub-agent Model */}
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Sub-agent Model</Label>
                {availableModels.length > 0 ? (
                  <Select
                    value={chat.subagentModel || placeholders.subagent}
                    onValueChange={(v) => updateChat({ subagentModel: v })}
                  >
                    <SelectTrigger className="w-full font-mono text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((m) => (
                        <SelectItem key={m} value={m} className="font-mono text-sm">{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={chat.subagentModel}
                    onChange={(e) => updateChat({ subagentModel: e.target.value })}
                    placeholder={placeholders.subagent || "model-name"}
                    className="font-mono text-sm"
                  />
                )}
                <p className="text-[11px] text-muted-foreground font-mono">
                  Model used by spawned sub-agents (recon, enum, exploit).
                </p>
              </div>
              {/* Max Steps */}
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Max Steps</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={0}
                    value={chat.maxSteps}
                    onChange={(e) => updateChat({ maxSteps: Number(e.target.value) })}
                    className="font-mono text-sm w-24"
                  />
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {chat.maxSteps === 0 ? "Unlimited" : `${chat.maxSteps} steps`}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground font-mono">
                  Max tool-call steps per invocation. 0 = unlimited.
                </p>
              </div>
              </>
              )}

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
