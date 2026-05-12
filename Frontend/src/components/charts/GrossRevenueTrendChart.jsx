import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatCedis } from "@/lib/utils"

/** @param {number} v */
function formatAxisCedis(v) {
  if (!v) return "GH₵0"
  if (v >= 1000) return `GH₵${Math.round(v / 1000)}k`
  return `GH₵${Math.round(v)}`
}

/**
 * Multi-month completed revenue line (smooth curve + markers), dashboard styling.
 * @param {{ month: string, revenue: number }[]} data
 * @param {number} [height]
 */
export function GrossRevenueTrendChart({ data, height = 320 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 10, left: 4, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="month"
          tickMargin={10}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={{ stroke: "var(--border)" }}
        />
        <YAxis
          width={52}
          tickMargin={8}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={{ stroke: "var(--border)" }}
          tickFormatter={formatAxisCedis}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
            background: "var(--card)",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--muted-foreground)" }}
          formatter={(value) => [formatCedis(Number(value)), "Gross revenue"]}
          labelFormatter={(label) => String(label)}
        />
        <Line
          type="natural"
          dataKey="revenue"
          stroke="var(--primary)"
          strokeWidth={2.5}
          dot={{
            r: 4,
            fill: "var(--primary)",
            stroke: "var(--card)",
            strokeWidth: 2,
          }}
          activeDot={{ r: 5, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
