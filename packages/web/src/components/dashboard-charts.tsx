"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#3b82f6",
  info: "#6b7280",
};

const PHASE_COLORS: Record<string, string> = {
  scoping: "#6b7280",
  recon: "#3b82f6",
  enum: "#8b5cf6",
  exploit: "#ef4444",
  postexploit: "#f97316",
  report: "#22c55e",
};

interface SeverityData {
  name: string;
  value: number;
}

interface PhaseData {
  name: string;
  value: number;
}

export function SeverityPieChart({ data }: { data: SeverityData[] }) {
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm font-mono">
        No findings
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={filtered}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          strokeWidth={2}
          stroke="hsl(var(--background))"
        >
          {filtered.map((entry) => (
            <Cell
              key={entry.name}
              fill={SEVERITY_COLORS[entry.name] ?? "#6b7280"}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
          }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function PhaseBarChart({ data }: { data: PhaseData[] }) {
  if (data.every((d) => d.value === 0)) {
    return (
      <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm font-mono">
        No activity
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} barCategoryGap="20%">
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
          }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={PHASE_COLORS[entry.name] ?? "#6b7280"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
