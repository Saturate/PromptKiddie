"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

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

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    setMounted(true);
  }, []);

  function update(patch: Partial<Preferences>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  }

  if (!mounted) return null;

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6 max-w-2xl">
      <h1 className="text-xl font-bold font-mono">Settings</h1>

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
