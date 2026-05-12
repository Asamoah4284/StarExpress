import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"

const SLICES = ["#7c3aed", "#a78bfa", "#c4b5fd", "#8b5cf6", "#6d28d9", "#5b21b6", "#9333ea"]

/** @param {{ name: string, value: number }[]} data */
export function PackageTypePieChart({ data, height = 340, donut = true }) {
  const enriched = data.map((d, i) => ({ ...d, fill: SLICES[i % SLICES.length] }))
  const total = enriched.reduce((s, x) => s + x.value, 0)
  const outerR = height >= 320 ? "42%" : "38%"
  const innerR = donut ? "24%" : 0

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
            return [`${v} completed (${pct}%)`, item.payload.name]
          }}
        />
        <Pie
          data={enriched}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="44%"
          innerRadius={innerR}
          outerRadius={outerR}
          paddingAngle={2}
          isAnimationActive={false}
        >
          {enriched.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} stroke="var(--card)" strokeWidth={1.5} />
          ))}
        </Pie>
        <Legend
          verticalAlign="bottom"
          layout="horizontal"
          align="center"
          height={36}
          iconType="square"
          iconSize={9}
          wrapperStyle={{ fontSize: 11, paddingTop: 4, color: "var(--muted-foreground)" }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
