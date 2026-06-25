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
  background: "#1a1a1a",
  border: "1px solid #333",
  borderRadius: "6px",
  fontFamily: "monospace",
  fontSize: "12px",
  color: "#e5e5e5",
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
          tick={{ fontSize: 10, fontFamily: "monospace", fill: "#999" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11, fontFamily: "monospace", fill: "#ccc" }}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#222", opacity: 0.5 }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
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
          tick={{ fontSize: 10, fontFamily: "monospace", fill: "#999" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fontFamily: "monospace", fill: "#999" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#222", opacity: 0.5 }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={PHASE_COLORS[entry.name] ?? "#6b7280"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
