import * as React from "react"
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { formatCedis } from "@/lib/utils"

/** @param {{ name: string, total: number }[]} data */
export function SalesByLocationBarChart({ data, height = 320 }) {
  const yMax = React.useMemo(() => {
    const max = data.reduce((m, d) => (Number(d.total) > m ? Number(d.total) : m), 0)
    const step = 3000
    return max <= 0 ? 12000 : Math.max(12000, Math.ceil(max / step) * step)
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 52 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="name"
          tickMargin={8}
          interval={0}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          angle={-28}
          textAnchor="end"
          height={64}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, yMax]}
          tickCount={5}
          allowDecimals={false}
          tickMargin={8}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          width={52}
          tickFormatter={(v) => `${Math.round(v / 1000)}k`}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
            background: "var(--card)",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--muted-foreground)" }}
          formatter={(value) => [
            Number(value) === 0 ? "No completed revenue" : formatCedis(Number(value)),
            "Completed revenue",
          ]}
        />
        <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={52} isAnimationActive={false} minPointSize={4}>
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={entry.total > 0 ? "var(--primary)" : "var(--muted)"}
              fillOpacity={entry.total > 0 ? 0.92 : 0.35}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
