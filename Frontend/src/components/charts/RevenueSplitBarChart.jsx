import * as React from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { formatCedis } from "@/lib/utils"

/**
 * Horizontal bars: completed revenue share by category (name + revenue).
 * @param {{ name: string, revenue: number }[]} data
 * @param {number} [height]
 */
export function RevenueSplitBarChart({ data, height = 320 }) {
  const total = React.useMemo(() => data.reduce((s, d) => s + d.revenue, 0), [data])
  const maxRev = React.useMemo(() => data.reduce((m, d) => (d.revenue > m ? d.revenue : m), 0), [data])
  const xMax = maxRev <= 0 ? 1 : Math.ceil((maxRev * 1.08) / 1000) * 1000

  if (!data.length) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-sm"
        style={{ height }}
      >
        No completed revenue in this filter.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
        barCategoryGap="18%"
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, xMax]}
          tickCount={6}
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={{ stroke: "var(--border)" }}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={132}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.15 }}
          contentStyle={{
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
            background: "var(--card)",
            fontSize: 12,
          }}
          formatter={(value) => {
            const v = Number(value)
            const pct = total ? Math.round((v / total) * 100) : 0
            return [`${formatCedis(v)} (${pct}%)`, "Share"]
          }}
        />
        <Bar
          dataKey="revenue"
          fill="var(--primary)"
          fillOpacity={0.88}
          radius={[0, 6, 6, 0]}
          maxBarSize={28}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
