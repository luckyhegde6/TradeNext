// components/charts/GainersBarChart.tsx
"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer
} from "recharts";

export function GainersBarChart({ data }: { data: any[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.slice(0, 10)}>
          <XAxis dataKey="symbol" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="pChange" fill="#16a34a" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
