"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PHASE_COLORS: Record<string, string> = {
  scoping: "#6b7280",
  recon: "#3b82f6",
  enum: "#eab308",
  exploit: "#f97316",
  postexploit: "#ef4444",
  report: "#22c55e",
};

interface ChartItem {
  name: string;
  value: number;
  color?: string;
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
};

export function ToolFrequencyChart({ data }: { data: ChartItem[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm font-mono">
        No tool data
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} layout="vertical" barCategoryGap="15%">
        <XAxis
          type="number"
          tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11, fontFamily: "var(--font-mono)", fill: "hsl(var(--foreground))" }}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={{ color: "hsl(var(--foreground))" }}
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="#22c55e">
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color ?? "#22c55e"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PhaseDistributionChart({ data }: { data: ChartItem[] }) {
  if (data.every((d) => d.value === 0)) {
    return (
      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm font-mono">
        No activity
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
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
          contentStyle={tooltipStyle}
          itemStyle={{ color: "hsl(var(--foreground))" }}
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={PHASE_COLORS[entry.name] ?? "#6b7280"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
