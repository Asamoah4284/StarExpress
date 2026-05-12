import * as React from "react"
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

/**
 * @param {{ date: string, revenue: number }[]} data
 * @param {number} [height]
 */
export function RevenueLineChart({ data, height = 320 }) {
  const yMax = React.useMemo(() => {
    const max = data.reduce((m, d) => (Number(d.revenue) > m ? Number(d.revenue) : m), 0)
    const step = 1000
    return max <= 0 ? step : Math.ceil(max / step) * step
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="date"
          tickMargin={10}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={(d) => String(d).slice(5)}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={{ stroke: "var(--border)" }}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[0, yMax]}
          tickCount={6}
          allowDecimals={false}
          tickMargin={8}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          width={52}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={{ stroke: "var(--border)" }}
          tickFormatter={(v) => `${Math.round(v / 1000)}k`}
        />
        <Tooltip
          contentStyle={{
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
            background: "var(--card)",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--muted-foreground)" }}
          formatter={(value) => [formatCedis(Number(value)), "Revenue"]}
          labelFormatter={(label) => `Date: ${label}`}
        />
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 1.5 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
