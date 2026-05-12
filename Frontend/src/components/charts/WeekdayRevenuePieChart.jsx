import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import { formatCedis } from "@/lib/utils"

/** Mon–Sun: green / blue / orange / purple family (reference-style doughnut). */
const SLICES = [
  "#22c55e",
  "#3b82f6",
  "#f97316",
  "#9333ea",
  "#16a34a",
  "#2563eb",
  "#ea580c",
]

/**
 * Completed revenue share by weekday (Mon–Sun), doughnut chart with segment gaps.
 * @param {{ name: string, value: number }[]} data — expect 7 rows, Mon–Sun
 * @param {number} [height]
 */
export function WeekdayRevenuePieChart({ data, height = 320 }) {
  const enriched = data.map((d, i) => ({ ...d, fill: SLICES[i % SLICES.length] }))
  const total = enriched.reduce((s, x) => s + x.value, 0)
  const outerPct = height >= 340 ? "76%" : height >= 280 ? "72%" : "68%"
  const innerPct = height >= 340 ? "50%" : height >= 280 ? "46%" : "42%"

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <Tooltip
          contentStyle={{
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
            background: "var(--card)",
            fontSize: 12,
          }}
          formatter={(value, _name, item) => {
            const v = Number(value)
            const pct = total ? Math.round((v / total) * 100) : 0
            return [`${formatCedis(v)} (${pct}%)`, item.payload.name]
          }}
        />
        <Pie
          data={enriched}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="46%"
          innerRadius={innerPct}
          outerRadius={outerPct}
          paddingAngle={3}
          cornerRadius={2}
          isAnimationActive={false}
        >
          {enriched.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} stroke="var(--card)" strokeWidth={2.5} />
          ))}
        </Pie>
        <Legend
          verticalAlign="bottom"
          layout="horizontal"
          align="center"
          height={48}
          iconType="square"
          iconSize={12}
          wrapperStyle={{ fontSize: 13, paddingTop: 8, color: "var(--muted-foreground)" }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
